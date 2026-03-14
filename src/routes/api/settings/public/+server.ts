/**
 * @file src/routes/api/settings/public/+server.ts
 * @description API endpoint to get all public settings with performance telemetry.
 */

import { dbAdapter } from '@src/databases/db';
import { settingsGroups } from '@src/routes/(app)/config/systemsetting/settings-groups';
import { defaultPublicSettings } from '@src/routes/setup/seed';
import { json } from '@sveltejs/kit';

export const GET = async () => {
	const startTime = performance.now();

	// 1. Get list of public keys from our definitions
	const publicKeys = settingsGroups
		.flatMap((g) => g.fields)
		.filter((f) => f.category === 'public')
		.map((f) => f.key);

	// 2. Initialize with defaults
	const publicSettings: Record<string, unknown> = {};
	for (const setting of defaultPublicSettings) {
		if (publicKeys.includes(setting.key)) {
			publicSettings[setting.key] = setting.value;
		}
	}

	let dbExecutionTime = 0;

	// 3. If DB is available, fetch overrides in a single batch query
	if (dbAdapter?.system.preferences) {
		try {
			const dbResult = await dbAdapter.system.preferences.getMany(publicKeys);

			if (dbResult.success && dbResult.data) {
				dbExecutionTime = dbResult.meta?.executionTime || 0;
				for (const key of publicKeys) {
					const dbEntry = dbResult.data[key];
					if (dbEntry !== undefined) {
						const val = dbEntry !== null && typeof dbEntry === 'object' && 'value' in dbEntry ? (dbEntry as { value: unknown }).value : dbEntry;

						if (key === 'AVAILABLE_CONTENT_LANGUAGES' || key === 'LOCALES') {
							if (Array.isArray(val)) {
								publicSettings[key] = val;
							}
						} else {
							publicSettings[key] = val;
						}
					}
				}
			}
		} catch (error) {
			console.error('[SettingsAPI] Failed to fetch overrides:', error);
		}
	}

	const totalDuration = performance.now() - startTime;

	// 4. Return JSON response with telemetry metadata
	return json(
		{
			success: true,
			data: publicSettings,
			meta: {
				executionTime: dbExecutionTime,
				totalTime: totalDuration
			}
		},
		{
			headers: {
				'Cache-Control': 'public, max-age=30'
			}
		}
	);
};
