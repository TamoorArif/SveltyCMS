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

import { contentInitializer } from './content-initializer';
import { contentPolling } from './content-polling.svelte';
import { logger } from '@utils/logger';

/**
 * Modern content initialization.
 * Coordinates hydration, initial load, and polling.
 */
export async function initializeContent(_pageData?: { navigationStructure: any; contentVersion: number }) {
	try {
		// 1. Initial system hydration
		await contentInitializer.initialize(undefined, true);

		// 2. Start polling for real-time updates in browser
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
