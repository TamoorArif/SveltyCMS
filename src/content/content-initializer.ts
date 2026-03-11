/**
 * @file src/content/content-initializer.ts
 * @description
 * Lifecycle management for ContentManager.
 * Aligned with system state machine (IDLE→READY).
 */
import { logger } from '@src/utils/logger.server';
import { contentStructure } from './content-structure.svelte';
import { contentReconciler } from './content-reconciler';
import { contentCache } from './content-cache.svelte';
import { contentMetrics } from './content-metrics';
import type { IDBAdapter } from '@src/databases/db-interface';
import { browser } from '$app/environment';

const initPromises = new Map<string | null, Promise<void>>();
const initializedTenants = new Set<string>();
let initializedInSetupMode = false;

const getDbAdapter = async () => (await import('@src/databases/db')).dbAdapter as IDBAdapter;

/**
 * Orchestrates: contentCache.loadFromCache() → contentReconciler.fullReload() → contentCache.populateCache()
 */
export const contentInitializer = {
	/**
	 * Initializes the ContentManager, handling race conditions and loading data
	 */
	async initialize(tenantId: string | null = null, skipReconciliation = false, adapter?: IDBAdapter): Promise<void> {
		// 1. Check if already initialized for this specific tenant
		if (initializedTenants.has(tenantId || '')) {
			const { isSetupComplete } = await import('@utils/setup-check');
			if (initializedInSetupMode && isSetupComplete()) {
				logger.info('[ContentInitializer] Setup completed after previous initialization. Forcing re-initialization...', { tenantId });
				initializedInSetupMode = false;
				initializedTenants.delete(tenantId || '');
				initPromises.delete(tenantId);
				skipReconciliation = true;
			} else {
				return;
			}
		}

		// 2. Already initializing this specific tenant? Wait for it.
		const existingPromise = initPromises.get(tenantId);
		if (existingPromise) {
			logger.debug('[ContentInitializer] Waiting for existing initialization to complete', { tenantId });
			return existingPromise;
		}

		// 3. Start new initialization for this tenant
		logger.info('[ContentInitializer] Starting initialization', {
			tenantId,
			skipReconciliation
		});

		const initPromise = this._doInitialize(tenantId, skipReconciliation, adapter);
		initPromises.set(tenantId, initPromise);

		try {
			await initPromise;
			initializedTenants.add(tenantId || '');
		} catch (error) {
			// Reset promise to allow retry on failure
			initPromises.delete(tenantId);
			throw error;
		}
	},

	/**
	 * Core initialization logic with self-healing retry
	 */
	async _doInitialize(tenantId?: string | null, skipReconciliation = false, adapter?: IDBAdapter): Promise<void> {
		if (browser) {
			logger.debug('[ContentInitializer] Client-side initialization complete (deferred/hydrated).');
			if (contentStructure.initState === 'uninitialized') {
				contentStructure.initState = 'initialized';
			}
			return;
		}

		const { isSetupComplete } = await import('@utils/setup-check');
		const setupComplete = isSetupComplete();

		contentStructure.initState = 'initializing';
		const startTime = performance.now();
		const maxRetries = 3;
		let lastError: Error | null = null;

		for (let attempt = 1; attempt <= maxRetries; attempt++) {
			try {
				logger.trace(`[ContentInitializer] initialization attempt ${attempt}/${maxRetries}`, { tenantId });

				// 1. Attempt to load from high-speed cache
				// CRITICAL: Only load from cache if we are skipping reconciliation.
				// If skipReconciliation is false, we WANT to verify against DB/Files.
				if (skipReconciliation && setupComplete && (await contentCache.loadFromCache(tenantId))) {
					// CRITICAL: Ensure database query builder infra is initialized even on cache hits
					// Since we bypass contentReconciler.fullReload(), we must ensure adapter is ready.
					const dbAdapter = adapter || (await getDbAdapter());
					if (dbAdapter) {
						if (dbAdapter.ensureCollections) await dbAdapter.ensureCollections();
						if (dbAdapter.ensureContent) await dbAdapter.ensureContent();
					}

					contentStructure.initState = 'initialized';
					contentMetrics.setInitializationTime(performance.now() - startTime);
					logger.info(`🚀 [ContentInitializer] initialized from cache in ${contentMetrics.getMetrics().initializationTime.toFixed(2)}ms`);
					return;
				}

				// 2. Full reload from source (files and DB)
				await contentReconciler.fullReload(tenantId, skipReconciliation, adapter);

				contentStructure.initState = 'initialized';
				if (!setupComplete) {
					initializedInSetupMode = true;
					logger.info('🛠️ [ContentInitializer] initialized in SETUP MODE (models registered).');
				}

				contentMetrics.setInitializationTime(performance.now() - startTime);
				logger.info(`📦 [ContentInitializer] fully initialized in ${contentMetrics.getMetrics().initializationTime.toFixed(2)}ms`);
				return;
			} catch (error) {
				lastError = error instanceof Error ? error : new Error(String(error));
				logger.warn(`[ContentInitializer] Initialization attempt ${attempt} failed:`, lastError.message);

				if (attempt < maxRetries) {
					const delay = Math.min(1000 * 2 ** (attempt - 1), 5000);
					logger.debug(`[ContentInitializer] Retrying in ${delay}ms...`);
					await new Promise((resolve) => setTimeout(resolve, delay));
				}
			}
		}

		contentStructure.initState = 'error';
		logger.error('[ContentInitializer] initialization failed after all retries:', lastError);
		throw lastError || new Error('Initialization failed');
	},

	/**
	 * Forces a full reload of all collections and content structure.
	 */
	async refresh(tenantId: string | null = null, skipReconciliation = false): Promise<void> {
		logger.info(`[ContentInitializer] Refreshing content state${skipReconciliation ? ' (fast/skip-reconcile)' : ''}...`, { tenantId });
		contentStructure.initState = 'initializing';
		contentCache.clear();

		const refreshPromise = contentReconciler.fullReload(tenantId, skipReconciliation).then(() => {
			contentStructure.initState = 'initialized';
			contentStructure.updateVersion(); // Notify clients
			initPromises.delete(tenantId);
		});

		initPromises.set(tenantId, refreshPromise);
		await refreshPromise;
	},

	isInitializedForTenant(tenantId: string | null): boolean {
		return initializedTenants.has(tenantId || '');
	},

	get initializedTenants() {
		return initializedTenants;
	}
};
