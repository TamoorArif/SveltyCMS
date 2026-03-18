/**
 * @file src/utils/tenant-utils.ts
 * @description Multi-tenancy utilities for SveltyCMS.
 * Provides hostname-based tenant identification and isolation helpers.
 *
 * ### Features
 * - Hostname-based tenant ID derivation
 * - Test-mode worker isolation helpers
 * - Demo-mode tenant generation logic
 */

/**
 * Derives a tenant ID from the request hostname.
 *
 * Logic:
 * 1. Default for localhost/loopback
 * 2. Subdomain extraction (e.g., 'tenant1.sveltycms.com' -> 'tenant1')
 * 3. Ignore common administrative subdomains (www, app, api, etc.)
 *
 * @param hostname - The request hostname (e.g., event.url.hostname)
 * @param multiTenant - Whether multi-tenancy is enabled (from settings)
 * @returns The tenantId or null if invalid/not applicable
 */
export function getTenantIdFromHostname(hostname: string, multiTenant: boolean = true): string | null {
	if (!multiTenant) {
		return null;
	}

	if (hostname === 'localhost' || hostname.startsWith('127.0.0.1') || hostname.startsWith('192.168.')) {
		return 'default';
	}

	const parts = hostname.split('.');
	// Check for subdomain (e.g., tenant.example.com)
	// We assume a minimum of 3 parts for a valid tenant subdomain (tenant.domain.tld)
	if (parts.length > 2 && !['www', 'app', 'api', 'cdn', 'static'].includes(parts[0])) {
		return parts[0];
	}

	return null;
}

/**
 * Reusable utility to enforce multi-tenant context and resolve tenantId.
 * Reduces boilerplate across API endpoints.
 *
 * @param locals - The SvelteKit locals object
 * @param operationName - Name of the operation for logging (e.g. '2FA verification')
 * @returns Refined tenantId or null
 * @throws AppError if multi-tenancy is enabled but no tenantId is found
 */
export function requireTenantContext(locals: App.Locals, operationName: string): string | null {
	const { getPrivateSettingSync } = require('@src/services/settings-service');
	const { logger } = require('@utils/logger.server');
	const { AppError } = require('@utils/error-handling');

	const isMultiTenant = getPrivateSettingSync('MULTI_TENANT');

	// Resolve tenantId: prefer locals.tenantId (set by hook) or fallback to user's tenant
	const tenantId = locals.tenantId || locals.user?.tenantId || null;

	// Critical: In multi-tenant mode, we MUST have a tenantId to prevent cross-tenant collisions
	if (isMultiTenant && !tenantId) {
		logger.error(`${operationName} failed: Multi-tenant mode enabled but no tenantId provided`, {
			userId: locals.user?._id
		});
		throw new AppError(`Tenant context is required for ${operationName}.`, 500, 'TENANT_REQUIRED');
	}

	return tenantId;
}
