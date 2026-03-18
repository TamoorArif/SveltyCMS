/**
 * @file src/routes/api/dashboard/audit/+server.ts
 * @description API endpoint for fetching audit logs from the database.
 */

import { queryAuditLogs } from '@src/services/audit-log-service';
import { json } from '@sveltejs/kit';
// Unified Error Handling
import { apiHandler } from '@utils/api-handler';
import { AppError } from '@utils/error-handling';
import { logger } from '@utils/logger.server';

import { getPrivateSettingSync } from '@src/services/settings-service';

export const GET = apiHandler(async ({ url, locals }) => {
	const { user, tenantId } = locals;
	const userRole = user?.role;
	const isSuperAdmin = userRole === 'super-admin';
	const isAdmin = userRole === 'admin' || isSuperAdmin;

	// Security check: Only admins can view audit logs
	if (!isAdmin) {
		throw new AppError('Forbidden: Admin access required', 403, 'FORBIDDEN');
	}

	const isMultiTenant = getPrivateSettingSync('MULTI_TENANT');
	const limit = Number.parseInt(url.searchParams.get('limit') || '20', 10);

	// SECURITY: In multi-tenant mode, only super-admins can see other tenants' logs
	const targetTenantId = url.searchParams.get('tenantId') || tenantId;

	if (isMultiTenant && targetTenantId !== tenantId && !isSuperAdmin) {
		throw new AppError('Unauthorized: You can only view audit logs for your own tenant.', 403, 'TENANT_MISMATCH');
	}

	try {
		// Fetch logs using the advanced service (scoped to tenant if applicable)
		const result = await queryAuditLogs({
			limit,
			tenantId: (isMultiTenant ? targetTenantId : undefined) as any
		});

		if (!result.success) {
			throw new AppError(result.message || 'Failed to fetch audit logs', 500, 'AUDIT_LOG_ERROR');
		}

		return json(result.data);
	} catch (e) {
		if (e instanceof AppError) {
			throw e;
		}
		logger.error('Failed to fetch audit logs in API', { error: e });
		throw new AppError('Failed to fetch logs', 500, 'AUDIT_LOG_ERROR');
	}
});
