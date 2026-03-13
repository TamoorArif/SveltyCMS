/**
 * @file src/hooks.server.ts
 * @description Hook middleware pipeline with unified metrics and automated security response
 *
 * This file orchestrates a streamlined sequence of middleware to handle
 * all incoming server requests. The architecture emphasizes security, observability,
 * and performance with unified metrics collection and automated threat detection.
 *
 * Middleware Sequence:
 * 1. Static asset caching (performance optimization, skip all processing)
 * 2. System state validation (gatekeeper)
 * 3. Rate limiting (abuse prevention)
 * 4. Application firewall (threat detection)
 * 5. Setup completion enforcement (installation gate)
 * 6. Language preferences (i18n cookie synchronization)
 * 7. Theme management (SSR dark mode support)
 * 8. Authentication & session management (identity)
 * 9. Authorization & access control (security)
 * 10. API request handling (optional, commented out by default)
 * 11. Security headers with nonce-based CSP (defense in depth)
 *
 * Core Services:
 * - MetricsService: Unified performance & security monitoring
 * - SecurityResponseService: Automated threat detection & response
 *
 * Utility Exports:
 * - getHealthMetrics(): Returns comprehensive metrics report
 * - invalidateSessionCache(): Invalidates specific user session
 * - clearAllSessionCaches(): Clears all cached sessions
 */
import { metricsService } from '@src/services/metrics-service';
import { redirect, type Handle } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { logger } from '@utils/logger.server';
import { building } from '$app/environment';
import { addSecurityHeaders } from './hooks/add-security-headers';
// API middleware for role-based access control and caching
import { handleApiRequests } from './hooks/handle-api-requests';
import { handleAuthentication } from './hooks/handle-authentication';
import { handleAuthorization } from './hooks/handle-authorization';
import { handleCompression } from './hooks/handle-compression';
import { handleFirewall } from './hooks/handle-firewall';
import { handleLocale } from './hooks/handle-locale';
import { handleRateLimit } from './hooks/handle-rate-limit';
import { handleSetup } from './hooks/handle-setup';
import { handleStaticAssetCaching } from './hooks/handle-static-asset-caching';
// --- Import enterprise middleware hooks ---
import { handleSystemState } from './hooks/handle-system-state';
import { handleTheme } from './hooks/handle-theme';
import { handleTokenResolution } from './hooks/token-resolution';
import { contentManager } from '@src/content/content-manager';

// --- Server Startup Logic ---
if (!building) {
	/**
	 * The main initialization logic (settings, DB connection) is handled
	 * in `src/databases/db.ts` to ensure it runs once on server start.
	 *
	 * The system will transition through these states:
	 * IDLE -> INITIALIZING -> READY (or DEGRADED/FAILED)
	 *
	 * The handleSystemState hook will block requests appropriately
	 * based on the current state.
	 */
	// Static import ensures the module is loaded and initialization promise is created
	import('@src/databases/db');

	// Inject server-side relation engine into TokenRegistry

	// Initialize Scheduler Service (Background Tasks)
	import('@src/services/scheduler').then(({ scheduler }) => {
		scheduler.start();
	});

	// Start telemetry heartbeat in background (Singleton pattern to survive HMR)
	import('@utils/setup-check').then(({ isSetupComplete }) => {
		if (!isSetupComplete()) {
			return;
		}

		import('@src/services/telemetry-service').then(({ telemetryService }) => {
			// Define global type for TypeScript
			const globalWithTelemetry = globalThis as typeof globalThis & {
				__SVELTY_TELEMETRY_INTERVAL__?: NodeJS.Timeout;
			};

			// Prevent duplicate intervals during Hot Module Replacement (HMR)
			if (globalWithTelemetry.__SVELTY_TELEMETRY_INTERVAL__) {
				logger.debug('Stopping old telemetry interval (HMR detected)');
				clearInterval(globalWithTelemetry.__SVELTY_TELEMETRY_INTERVAL__);
			}

			logger.info('📡 Initializing Telemetry Service...');

			// Run initial check after a short delay
			setTimeout(() => {
				telemetryService.checkUpdateStatus().catch((err) => logger.error('Initial telemetry check failed', err));
			}, 10_000);

			// Schedule periodic checks (12 hours) and store ID in global
			globalWithTelemetry.__SVELTY_TELEMETRY_INTERVAL__ = setInterval(
				() => {
					telemetryService.checkUpdateStatus().catch((err) => logger.error('Periodic telemetry check failed', err));
				},
				1000 * 60 * 60 * 12
			);
		});
	});

	logger.info('✅ DB module loaded. System will initialize on first request via handleSystemState.');
}

// --- Middleware Sequence ---
const middleware: Handle[] = [
	// 0. Compression (GZIP/Brotli) - Outer layer to compress final processed responses
	handleCompression,

	// 1. Static assets FIRST (skip all other processing for maximum performance)
	handleStaticAssetCaching,

	// 2. System state validation (enterprise gatekeeper with metrics)
	handleSystemState,

	// 3. Application firewall (detect threats Nginx/CDN can't catch)
	// Priority: Firewall before rate limit to block known bots/threats early
	handleFirewall,

	// 4. Rate limiting (protection against abuse)
	handleRateLimit,

	// 5. Setup completion enforcement (installation gate with tracking)
	handleSetup,

	// 6. Language preferences (i18n cookie synchronization)
	handleLocale,

	// 7. Theme management (SSR dark mode support)
	handleTheme,

	// 8. Authentication & session management (identity with security monitoring)
	handleAuthentication,

	// 9. Authorization & access control (permissions with threat detection)
	handleAuthorization,

	// 9.5 Content System Initialization (Identity & Tenant aware)
	async ({ event, resolve }) => {
		const { locals, url } = event;
		// Initialize content system for the resolved tenant if not already ready
		// Reconciliation is handled only on server startup or forced refresh
		if (!contentManager.isInitializedForTenant(locals.tenantId ?? null)) {
			// Set skipReconciliation to false to ensure stale DB nodes are cleaned up
			await contentManager.initialize(locals.tenantId ?? null, false);
		}

		// FRESH INSTALL: If no collections exist, redirect authenticated users to builder or dashboard
		// Skip redirect for API, static assets, and config/builder routes
		const isApi = url.pathname.startsWith('/api');
		const isConfig = url.pathname.startsWith('/config');
		const isUser = url.pathname.startsWith('/user');
		const isDashboard = url.pathname.startsWith('/dashboard');
		const isLogin = url.pathname.includes('/login');

		if (locals.user && !isApi && !isConfig && !isUser && !isDashboard && !isLogin) {
			const collections = contentManager.getCollections(locals.tenantId);
			if (collections.length === 0) {
				// Admins go to collection builder, others to dashboard
				if (locals.isAdmin) {
					logger.info(`[hooks.server] No collections found for tenant: ${locals.tenantId}. Redirecting Admin to builder.`);
					throw redirect(302, '/config/collectionbuilder');
				}
				if (url.pathname !== '/dashboard') {
					logger.info(`[hooks.server] No collections found for tenant: ${locals.tenantId}. Redirecting to dashboard.`);
					throw redirect(302, '/dashboard');
				}
			} else if (url.pathname === '/') {
				// If collections exist and user is at root, redirect to first collection
				const firstUrl = await contentManager.getFirstCollectionRedirectUrl(locals.language || 'en', locals.tenantId);
				if (firstUrl) {
					logger.info(`[hooks.server] Redirecting to first collection: ${firstUrl}`);
					throw redirect(302, firstUrl);
				}
			}
		}

		return resolve(event);
	},

	// 10. API request handling (role-based access control & caching)
	handleApiRequests,

	// 11. Token resolution for API responses
	// CRITICAL: Must be AFTER handleAuthorization (needs locals.user, locals.roles)
	//           and BEFORE addSecurityHeaders (modifies response body)
	handleTokenResolution,

	// 12. Essential security headers (defense in depth)
	addSecurityHeaders
];

// --- Main Handle Export ---
export const handle: Handle = sequence(...middleware);

// --- Utility Functions for External Use ---
export const getHealthMetrics = () => metricsService.getReport();
export {
	clearAllSessionCaches,
	clearSessionRefreshAttempt,
	forceSessionRotation,
	getSessionCacheStats,
	invalidateSessionCache
} from './hooks/handle-authentication';
