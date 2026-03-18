/**
 * @file src/routes/api/webhooks/logs/+server.ts
 * @description API endpoint for viewing webhook delivery logs (DLQ).
 */

import { json } from '@sveltejs/kit';
import { apiHandler } from '@utils/api-handler';
import { AppError } from '@utils/error-handling';
import { getPrivateSettingSync } from '@src/services/settings-service';

export const GET = apiHandler(async ({ locals, url }) => {
	const { user, tenantId, dbAdapter } = locals;

	if (!user) throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
	if (!dbAdapter) throw new AppError('Database service unavailable', 503, 'SERVICE_UNAVAILABLE');

	const isMultiTenant = getPrivateSettingSync('MULTI_TENANT');
	if (isMultiTenant && !tenantId) throw new AppError('Tenant ID missing', 400, 'TENANT_MISSING');

	const status = url.searchParams.get('status');
	const limit = parseInt(url.searchParams.get('limit') || '50', 10);
	const skip = parseInt(url.searchParams.get('skip') || '0', 10);

	// Query system_jobs for webhook-delivery tasks
	const filter: any = { taskType: 'webhook-delivery' };
	if (status) filter.status = status;

	const jobsResult = await dbAdapter.system.jobs.list({
		...filter,
		limit,
		offset: skip,
		sort: { createdAt: 'desc' }
	});

	if (!jobsResult.success) {
		throw new AppError('Failed to fetch webhook logs', 500, 'FETCH_ERROR');
	}

	return json({
		success: true,
		data: jobsResult.data,
		pagination: {
			limit,
			skip,
			count: jobsResult.data.length
		}
	});
});

/**
 * POST /api/webhooks/logs/[jobId]/retry
 * Handled by a separate dynamic route or a query param here.
 * For now, let's just implement the GET list.
 */
