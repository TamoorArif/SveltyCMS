/**
 * @file src/routes/api/dashboard/metrics/+server.ts
 * @description Dashboard metrics API endpoint for performance monitoring
 * Protected by handleApiRequests middleware (requires authentication + dashboard API permissions)
 */

import { metricsService } from '@src/services/metrics-service';
import { json } from '@sveltejs/kit';
// Unified Error Handling
import { apiHandler } from '@utils/api-handler';
import { AppError } from '@utils/error-handling';
// System Logger
import { logger } from '@utils/logger.server';

import { getPrivateSettingSync } from '@src/services/settings-service';

export const GET = apiHandler(async ({ url, locals }) => {
	const { user, tenantId } = locals;
	const isMultiTenant = getPrivateSettingSync('MULTI_TENANT');
	const isSuperAdmin = user?.role === 'super-admin';

	try {
		// SECURITY: In multi-tenant mode, only super-admins can see global metrics
		// Regular admins should only see tenant-specific metrics (if implemented)
		if (isMultiTenant && !isSuperAdmin) {
			// For now, return empty or limited metrics for regular admins
			// In a full implementation, we would query metrics scoped to the tenantId
			return json({
				success: true,
				message: 'Tenant-specific metrics not yet fully implemented',
				tenantId
			});
		}

		const metrics = metricsService.getReport();

		// Add additional system metrics if requested
		const detailed = url.searchParams.get('detailed') === 'true';

		if (detailed) {
			// Add memory usage and other Node.js metrics
			const memoryUsage = process.memoryUsage();
			return json({
				...metrics,
				system: {
					memory: {
						used: Math.round(memoryUsage.heapUsed / 1024 / 1024), // MB
						total: Math.round(memoryUsage.heapTotal / 1024 / 1024), // MB
						external: Math.round(memoryUsage.external / 1024 / 1024), // MB
						rss: Math.round(memoryUsage.rss / 1024 / 1024) // MB
					},
					uptime: Math.floor(process.uptime()),
					nodeVersion: process.version
				}
			});
		}

		return json(metrics);
	} catch (err) {
		logger.error('Dashboard metrics error:', err);
		throw new AppError('Failed to fetch dashboard metrics', 500, 'METRICS_ERROR');
	}
});
