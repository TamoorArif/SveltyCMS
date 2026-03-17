/**
 * @file src/hooks.server.ts
 * @description Hook middleware pipeline with unified metrics and automated security response
 *
 * This file orchestrates a streamlined sequence of middleware to handle
 * all incoming server requests. The architecture emphasizes security, observability,
 * and performance with unified metrics collection and automated threat detection.
 *
 * Updated 2026-03-15:
 * - Moved addSecurityHeaders to TOP of sequence → ensures headers on ALL responses,
 *   including errors thrown by earlier middlewares (rate-limit 429, firewall blocks, etc.)
 */

import { metricsService } from '@src/services/metrics-service';
import type { Handle } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { logger } from '@utils/logger.server';
import { building } from '$app/environment';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

// ESM Shims for legacy CJS compatibility in production build
if (typeof globalThis.__filename === 'undefined') {
	(globalThis as any).__filename = fileURLToPath(import.meta.url);
}
if (typeof globalThis.__dirname === 'undefined') {
	(globalThis as any).__dirname = dirname((globalThis as any).__filename);
}

// --- Core middleware ---
import { handleStaticAssetCaching } from './hooks/handle-static-asset-caching';
import { handleCompression } from './hooks/handle-compression';
import { handleTestIsolation } from './hooks/handle-test-isolation';
import { handleSystemState } from './hooks/handle-system-state';
import { handleFirewall } from './hooks/handle-firewall';
import { handleRateLimit } from './hooks/handle-rate-limit';
import { handleSetup } from './hooks/handle-setup';
import { handleLocale } from './hooks/handle-locale';
import { handleTheme } from './hooks/handle-theme';
import { handleAuthentication } from './hooks/handle-authentication';
import { handleAuthorization } from './hooks/handle-authorization';
import { handleLocalSdk } from './hooks/handle-local-sdk';
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
				1000 * 60 * 60 * 12 // 12 hours
			);
		});
	});

	logger.info('✅ DB module loaded. System will initialize on first request via handleSystemState.');
}

// --- Updated middleware sequence (security headers FIRST) ---
const middleware: Handle[] = [
	addSecurityHeaders, // 1. MUST be first → headers on ALL responses, including errors
	handleTestIsolation, // ✨ 2. Establish test context (PER-WORKER isolation)
	handleStaticAssetCaching, // 3. highest hit-rate early exit
	handleCompression, // 4. streaming-safe after static
	handleSystemState, // 5. readiness gate
	handleFirewall, // 5. threat detection
	handleRateLimit, // 6. abuse prevention
	handleSetup, // 7. setup gate
	handleLocale, // 8. i18n
	handleTheme, // 9. SSR theme
	handleAuthentication, // 10. identity
	handleAuthorization, // 11. permissions
	handleLocalSdk, // 12. native server-side SDK injection
	handleContentInitialization, // 13. content + redirects
	handleApiRequests, // 14. API caching
	handleAuditLogging, // 15. async audit trails
	handleTokenResolution // 16. token processing
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
