/**
 * @file src/routes/api/widgets/active/+server.ts
 * @description API endpoint for getting active widgets with 3-pillar architecture metadata
 */

import { CacheCategory } from '@src/databases/cache/types';
import { cacheService } from '@src/databases/cache-service';
import { getWidgetFunction, isWidgetCore, widgets } from '@src/stores/widget-store.svelte.ts';
import { json } from '@sveltejs/kit';
// Unified Error Handling
import { apiHandler } from '@utils/api-handler';
import { AppError } from '@utils/error-handling';
import { logger } from '@utils/logger.server';
import { widgetRegistryService } from '@src/services/widget-registry-service';

export const GET = apiHandler(async ({ locals, url }) => {
	const start = performance.now();
	let targetTenantId = locals.tenantId || 'default-tenant';
	try {
		const { user } = locals;
		if (!user) {
			throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
		}

		// Resolve target tenant correctly to prevent IDOR
		const requestedTenant = url.searchParams.get('tenantId');

		if (requestedTenant && requestedTenant !== targetTenantId) {
			if (user.role !== 'super-admin') {
				throw new AppError('Forbidden: You cannot manage widgets for other tenants.', 403, 'FORBIDDEN');
			}
			targetTenantId = requestedTenant;
		}

		// Support ?refresh=true to bypass cache (useful for debugging)
		const forceRefresh = url.searchParams.get('refresh') === 'true';

		if (forceRefresh) {
			logger.trace('[/api/widgets/active] Force refresh requested, clearing cache', { tenantId: targetTenantId });
			await cacheService.delete('widget:active:all', targetTenantId);
		}

		// Try to get from cache first
		const cacheKey = 'widget:active:all';
		const cachedData = await cacheService.get<any>(cacheKey, targetTenantId);
		if (cachedData && !forceRefresh) {
			logger.trace('[/api/widgets/active] Serving from cache', { tenantId: targetTenantId });
			return json({
				success: true,
				data: cachedData,
				message: 'Active widgets retrieved from cache'
			});
		}

		// Initialize widgets if not already loaded
		await widgets.initialize(targetTenantId);

		// Get active widgets from database
		const dbAdapter = locals.dbAdapter;
		if (!dbAdapter?.system?.widgets?.getActiveWidgets) {
			logger.error('Widget database adapter not available');
			throw new AppError('Widget database adapter not available', 500, 'DB_ADAPTER_UNAVAILABLE');
		}

		const result = await dbAdapter.system.widgets.getActiveWidgets();
		logger.trace('[/api/widgets/active] Raw result from getActiveWidgets()', {
			tenantId: targetTenantId,
			resultType: Array.isArray(result) ? 'array' : typeof result,
			resultLength: Array.isArray(result) ? result.length : undefined
		});

		let widgetNames: string[] = [];
		if (Array.isArray(result)) {
			// If result is an array, check if it's an array of strings or objects
			if (typeof result[0] === 'string' || result.length === 0) {
				widgetNames = result as string[];
			} else if (typeof result[0] === 'object' && 'name' in result[0]) {
				// If it's an array of Widget objects, extract the name property
				widgetNames = (result as { name: string }[]).map((w) => w.name);
			}
		} else if (result && typeof result === 'object' && 'success' in result && result.success) {
			// Accept both Widget[] and string[] in result.data
			const data = (result as { data: unknown }).data;
			if (Array.isArray(data)) {
				if (typeof data[0] === 'string' || data.length === 0) {
					widgetNames = data as string[];
				} else if (typeof data[0] === 'object' && 'name' in data[0]) {
					widgetNames = (data as { name: string }[]).map((w) => w.name);
				}
			}
		}

		// Ensure core widgets are always included
		// Use widgetRegistryService (server-side) instead of widgetStore (client-side) to avoid build issues
		await widgetRegistryService.initialize();
		const allWidgets = widgetRegistryService.getAllWidgets();

		const uniqueNames = new Set(widgetNames);

		for (const [name, factory] of allWidgets.entries()) {
			if ((factory as any).__widgetType === 'core') {
				uniqueNames.add(name);
			}
		}

		widgetNames = Array.from(uniqueNames);

		logger.trace('[/api/widgets/active] Extracted widget names (including core)', {
			tenantId: targetTenantId,
			count: widgetNames.length,
			widgets: widgetNames,
			allRegistryKeys: Array.from(allWidgets.keys()),
			inputWidgetType: allWidgets.get('Input') ? (allWidgets.get('Input') as any).__widgetType : 'NOT_FOUND'
		});

		// Enrich widget data with metadata from widget functions (3-pillar architecture)
		const enrichedWidgets = widgetNames.map((name) => {
			const widgetFn = getWidgetFunction(name) as any;
			return {
				name,
				isCore: isWidgetCore(name),
				icon: widgetFn?.Icon || 'mdi:puzzle',
				description: widgetFn?.Description || '',
				// 3-Pillar Architecture metadata
				inputComponentPath: widgetFn?.__inputComponentPath || '',
				displayComponentPath: widgetFn?.__displayComponentPath || '',
				dependencies: widgetFn?.__dependencies || []
			};
		});

		const duration = performance.now() - start;
		logger.trace('Retrieved active widgets with metadata', {
			tenantId: targetTenantId,
			widgetCount: enrichedWidgets.length,
			widgetNames: enrichedWidgets.map((w) => w.name),
			duration: `${duration.toFixed(2)}ms`
		});
		const responseData = {
			widgets: enrichedWidgets,
			tenantId: targetTenantId
		};

		// Cache the enriched results
		await cacheService.setWithCategory(cacheKey, responseData, CacheCategory.WIDGET, targetTenantId);

		return json({
			success: true,
			data: responseData,
			message: 'Active widgets retrieved successfully',
			performance: { duration: `${duration.toFixed(2)}ms` }
		});
	} catch (err) {
		const duration = performance.now() - start;
		const message = `Failed to get active widgets: ${err instanceof Error ? err.message : String(err)}`;
		logger.error(message, {
			duration: `${duration.toFixed(2)}ms`,
			tenantId: typeof targetTenantId !== 'undefined' ? targetTenantId : 'unknown'
		});
		if (err instanceof AppError) {
			throw err;
		}
		throw new AppError(message, 500, 'GET_ACTIVE_WIDGETS_FAILED');
	}
});
