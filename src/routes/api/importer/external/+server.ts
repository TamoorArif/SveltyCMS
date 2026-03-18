/**
 * @file src/routes/api/importer/external/+server.ts
 * @description API endpoint for importing content from external CMS sources.
 */

import { json } from '@sveltejs/kit';
import { apiHandler } from '@utils/api-handler';
import { AppError } from '@utils/error-handling';
import { logger } from '@utils/logger.server';
import { dbAdapter } from '@src/databases/db';
import { fetchDrupalData, fetchWordPressData } from '@src/services/importer/source-adapters';
import { MediaService } from '@src/utils/media/media-service.server';
import { aiService } from '@src/services/ai-service';

export const POST = apiHandler(async ({ request, locals }) => {
	const { user, tenantId } = locals;
	if (!user) {
		throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
	}

	const body = await request.json();
	const { sourceType, sourceUrl, apiKey, contentType, targetCollection, mapping, dryRun = false } = body;

	if (!sourceUrl || !sourceType || !contentType || !targetCollection) {
		throw new AppError('Missing required parameters', 400, 'MISSING_PARAMS');
	}

	if (!dbAdapter) {
		throw new AppError('Database adapter not initialized', 500, 'DB_ADAPTER_MISSING');
	}

	// 1. Fetch data from source
	let externalData;
	if (sourceType === 'drupal') {
		externalData = await fetchDrupalData(sourceUrl, contentType, apiKey);
	} else if (sourceType === 'wordpress') {
		externalData = await fetchWordPressData(sourceUrl, contentType, apiKey);
	} else {
		throw new AppError(`Unsupported source type: ${sourceType}`, 400, 'INVALID_SOURCE');
	}

	// 2. AI Auto-Mapping (if no manual mapping provided)
	let finalMapping = mapping;
	if (!finalMapping) {
		// We need the target collection schema
		const collectionsResult = await dbAdapter.collection.listSchemas();
		if (!collectionsResult.success) {
			throw new AppError('Failed to retrieve collection schemas', 500, 'SCHEMA_FETCH_FAILED');
		}
		const targetCol = collectionsResult.data.find((c: any) => c.name === targetCollection);
		if (!targetCol) {
			throw new AppError(`Target collection ${targetCollection} not found`, 404, 'COLLECTION_NOT_FOUND');
		}
		finalMapping = await aiService.suggestMapping(externalData.schema, targetCol);
	}

	if (dryRun) {
		return json({
			success: true,
			dryRun: true,
			mapping: finalMapping,
			sampleData: externalData.items.slice(0, 3)
		});
	}

	// 3. Process Import
	const mediaService = new MediaService(dbAdapter);
	let importedCount = 0;
	let errorCount = 0;

	for (const item of externalData.items) {
		try {
			const transformed: Record<string, any> = {};

			// Map attributes (Drupal has data.attributes, WP has items directly)
			const attributes = sourceType === 'drupal' ? item.attributes : item;

			for (const [sourceField, targetField] of Object.entries(finalMapping)) {
				let targetKey: string;
				let transform: string | undefined;

				if (typeof targetField === 'string') {
					targetKey = targetField;
				} else {
					targetKey = (targetField as any).target;
					transform = (targetField as any).transform;
				}

				let value = attributes[sourceField];

				// Handle transforms
				if (transform === 'media' && value) {
					// Auto-download media
					try {
						// For Drupal, value might be a URI or another JSON:API object.
						// For now, assume it's a direct URL or handled by the source adapter
						const media = await mediaService.saveRemoteMedia(value, user._id.toString(), 'public', tenantId || 'global');
						value = media._id;
					} catch (me) {
						logger.warn(`Failed to download remote media: ${value}`, me);
						value = null;
					}
				}

				transformed[targetKey] = value;
			}

			// Insert into database
			const result = await dbAdapter.crud.insert(`collection_${targetCollection}`, transformed);
			if (result.success) {
				importedCount++;
			} else {
				errorCount++;
			}
		} catch (err) {
			errorCount++;
			logger.error(`Import failed for item: ${JSON.stringify(item)}`, err);
		}
	}

	return json({
		success: true,
		imported: importedCount,
		errors: errorCount,
		total: externalData.items.length
	});
});
