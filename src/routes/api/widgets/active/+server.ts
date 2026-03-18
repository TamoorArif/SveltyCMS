/**
 * @file src/routes/api/widgets/active/+server.ts
 * @description API endpoint for getting active widgets with 3-pillar architecture metadata
 */

import { getWidgetFunction, isWidgetCore, widgets } from '@src/stores/widget-store.svelte.ts';
import { json } from '@sveltejs/kit';
import { apiHandler } from '@utils/api-handler';
import { AppError } from '@utils/error-handling';
import { logger } from '@utils/logger.server';

export const GET = apiHandler(async ({ locals, url }) => {
	const { user, tenantId, dbAdapter } = locals;
	if (!user) {
		throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
	}

	let targetTenantId = tenantId || 'default-tenant';
	const requestedTenant = url.searchParams.get('tenantId');

	if (requestedTenant && requestedTenant !== targetTenantId) {
		const isSuperAdmin = user.role === 'super-admin' || (user as any).roles?.includes('super-admin');
		if (!isSuperAdmin) {
			throw new AppError('Forbidden: You cannot manage widgets for other tenants.', 403, 'FORBIDDEN');
		}
		targetTenantId = requestedTenant;
	}

	// Initialize widgets to ensure custom widgets are loaded
	await widgets.initialize(targetTenantId);

	const dbWidgets = dbAdapter?.system?.widgets;
	if (!dbWidgets) {
		throw new AppError('Widget database adapter unavailable', 501, 'DB_ADAPTER_UNAVAILABLE');
	}

	const result = await dbWidgets.getActiveWidgets();
	const widgetNamesRaw = Array.isArray(result) ? result : (result as any)?.data || [];

	// Extract names and ensure it's a string array
	let widgetNames: string[] = widgetNamesRaw.map((w: any) => (typeof w === 'string' ? w : w.name));

	// Enrich with 3-pillar architecture metadata
	const enrichedWidgets = widgetNames.map((name) => {
		const widgetFn = getWidgetFunction(name) as any;
		return {
			name,
			isCore: isWidgetCore(name),
			icon: widgetFn?.Icon || 'mdi:puzzle',
			description: widgetFn?.Description || '',
			inputComponentPath: widgetFn?.__inputComponentPath || '',
			displayComponentPath: widgetFn?.__displayComponentPath || '',
			dependencies: widgetFn?.__dependencies || []
		};
	});

	logger.trace(`Retrieved ${enrichedWidgets.length} active widgets for tenant ${targetTenantId}`);

	return json({
		success: true,
		data: {
			widgets: enrichedWidgets,
			tenantId: targetTenantId
		},
		message: 'Active widgets retrieved successfully'
	});
});
