/**
 * @file src/content/index.ts
 * @description
 * Public Content API and store bridge.
 * This module acts as a modern entry point for content state,
 * delegating complex logic to specialized sub-modules.
 *
 * Features:
 * - Reactive store exports
 * - Unified content initialization
 * - Version polling coordination
 */

// Re-export state from specialized modules
export { collections, contentStructure, setCollection, setCollectionValue, setMode, unAssigned } from '@src/stores/collection-store.svelte';
export { contentStructure as categories } from './content-structure.svelte';

import { contentStructure } from './content-structure.svelte';
import { contentInitializer } from './content-initializer';
import { contentPolling } from './content-polling.svelte';
import { logger } from '@utils/logger';

/**
 * Modern content initialization.
 * Coordinates hydration, initial load, and polling.
 */
export async function initializeContent(pageData?: { navigationStructure: any; contentNodes: any[]; contentVersion: number; tenantId?: string | null }) {
	try {
		// 1. Fast path hydration from server data
		if (pageData?.contentNodes) {
			logger.debug('💧 Hydrating Content System from server data...');
			contentStructure.sync(pageData.contentNodes);
		}

		// 2. Mark system as initialized for this tenant (handles locks and state)
		await contentInitializer.initialize(pageData?.tenantId, true);

		// 3. Start polling for real-time updates in browser
		contentPolling.start();

		logger.info('✅ Content System Initialized');
	} catch (error) {
		logger.error('Failed to initialize content system', error);
	}
}

/**
 * Coordination for stopping background processes.
 */
export function stopPolling() {
	contentPolling.stop();
}
