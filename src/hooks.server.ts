/**
 * @file src/hooks.server.ts
 * @description Hook middleware pipeline with unified metrics and automated security response
 *
 * This file orchestrates a streamlined sequence of middleware to handle
 * all incoming server requests. The architecture emphasizes security, observability,
 * and performance with unified metrics collection and automated threat detection.
 *
 * 1. Static asset caching          → highest hit rate, immutable headers
 * 2. Compression                   → after static check → streaming safe
 * 3. System state validation       → early 503 if not ready
 * 4. Application firewall          → block bad patterns early
 * 5. Rate limiting                 → prevent abuse
 * 6. Setup completion enforcement  → installation gate
 * 7. Language preferences          → i18n (skips /api)
 * 8. Theme management              → SSR dark mode (skips /api)
 * 9. Authentication                → session + rotation
 * 10. Authorization                → roles & permissions
 * 11. Content initialization       → tenant content + fresh install redirects
 * 12. API request handling         → cache + invalidation
 * 13. Token resolution             → RBAC-aware body processing
 * 14. Security headers + CSP       → defense in depth
 */
import { metricsService } from '@src/services/metrics-service';
import type { Handle } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { logger } from '@utils/logger.server';
import { building } from '$app/environment';

// --- Core middleware ---
import { handleStaticAssetCaching } from './hooks/handle-static-asset-caching';
import { handleCompression } from './hooks/handle-compression';
import { handleSystemState } from './hooks/handle-system-state';
import { handleFirewall } from './hooks/handle-firewall';
import { handleRateLimit } from './hooks/handle-rate-limit';
import { handleSetup } from './hooks/handle-setup';
import { handleLocale } from './hooks/handle-locale';
import { handleTheme } from './hooks/handle-theme';
import { handleAuthentication } from './hooks/handle-authentication';
import { handleAuthorization } from './hooks/handle-authorization';
import { handleContentInitialization } from './hooks/handle-content-initialization';
import { handleApiRequests } from './hooks/handle-api-requests';
import { handleAuditLogging } from './hooks/handle-audit-logging';
import { handleTokenResolution } from './hooks/token-resolution';
import { addSecurityHeaders } from './hooks/add-security-headers';

// --- Server Startup Logic ---
if (!building) {
	import('@src/databases/db');

	import('@src/services/scheduler').then(({ scheduler }) => {
		scheduler.start();
	});

	import('@utils/setup-check').then(({ isSetupComplete }) => {
		if (!isSetupComplete()) {
			return;
		}

		import('@src/services/telemetry-service').then(({ telemetryService }) => {
			const globalWithTelemetry = globalThis as typeof globalThis & {
				__SVELTY_TELEMETRY_INTERVAL__?: NodeJS.Timeout;
			};

			if (globalWithTelemetry.__SVELTY_TELEMETRY_INTERVAL__) {
				logger.debug('Stopping old telemetry interval (HMR detected)');
				clearInterval(globalWithTelemetry.__SVELTY_TELEMETRY_INTERVAL__);
			}

			logger.info('📡 Initializing Telemetry Service...');

			setTimeout(() => {
				telemetryService.checkUpdateStatus().catch((err) => logger.error('Initial telemetry check failed', err));
			}, 10_000);

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

// --- Updated middleware sequence ---
const middleware: Handle[] = [
	handleStaticAssetCaching, // 1. highest hit-rate early exit
	handleCompression, // 2. now streaming-safe (after static check)
	handleSystemState, // 3. readiness gate
	handleFirewall, // 4. threat detection
	handleRateLimit, // 5. abuse prevention
	handleSetup, // 6. setup gate
	handleLocale, // 7. i18n
	handleTheme, // 8. SSR theme
	handleAuthentication, // 9. identity
	handleAuthorization, // 10. permissions
	handleContentInitialization, // 11. content + redirects
	handleApiRequests, // 12. API caching
	handleAuditLogging, // 12.5. Mutation Audit Trails (Asynchronous)
	handleTokenResolution, // 13. token processing
	addSecurityHeaders // 14. headers + CSP
];

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
