/**
 * @file src/routes/api/importer/scaffold/+server.ts
 * @description API endpoint for scaffolding new collections from external sources.
 */

import { fetchDrupalData, fetchWordPressData } from '@src/services/importer/source-adapters';
import { scaffoldCollectionSchema } from '@src/services/importer/scaffolder';
import { apiHandler } from '@utils/api-handler';
import { json } from '@sveltejs/kit';
import { AppError } from '@utils/error-handling';
import fs from 'node:fs/promises';
import path from 'node:path';

import { getPrivateSettingSync } from '@src/services/settings-service';

export const POST = apiHandler(async ({ request, locals }) => {
	const { user } = locals;
	const isMultiTenant = getPrivateSettingSync('MULTI_TENANT');
	const isSuperAdmin = user?.role === 'super-admin';

	if (!user) {
		throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
	}

	// SECURITY: In multi-tenant mode, only super-admins can scaffold collections as they affect global config files
	if ((isMultiTenant && !isSuperAdmin) || (!isMultiTenant && user.role !== 'admin')) {
		logger.warn(`Unauthorized scaffold attempt by user ${user._id}`);
		throw new AppError('Forbidden: Only super-admins can scaffold collections in multi-tenant mode.', 403, 'FORBIDDEN');
	}

	const { sourceType, sourceUrl, apiKey, sourceTypeIdentifier, collectionName } = await request.json();

	if (!sourceType || !sourceUrl || !sourceTypeIdentifier || !collectionName) {
		throw new AppError('Missing required parameters', 400, 'MISSING_PARAMS');
	}

	let sourceData;
	if (sourceType === 'drupal') {
		sourceData = await fetchDrupalData(sourceUrl, sourceTypeIdentifier, apiKey);
	} else if (sourceType === 'wordpress') {
		sourceData = await fetchWordPressData(sourceUrl, sourceTypeIdentifier, apiKey);
	} else {
		throw new AppError('Unsupported source type', 400, 'INVALID_SOURCE');
	}

	// 1. Generate Schema using AI Scaffolder
	const schema = await scaffoldCollectionSchema(collectionName, sourceData.schema);

	// 2. Write collection file to filesystem
	// This mirrors the structure into SveltyCMS instantly
	const collectionPath = path.join(process.cwd(), 'config', 'collections', `${schema.slug}.ts`);

	const fileContent = `
import { widgets } from '@widgets';
import type { Schema } from '@src/content/types';

export const schema: Schema = ${JSON.stringify(schema, null, 2).replace(/"widget":\s*"(\w+)"/g, '"widget": widgets.$1')};
`;

	await fs.mkdir(path.dirname(collectionPath), { recursive: true });
	await fs.writeFile(collectionPath, fileContent);

	return json({
		success: true,
		message: `Collection '${collectionName}' scaffolded successfully.`,
		slug: schema.slug
	});
});
