/**
 * @file src/content/content-cache.svelte.ts
 * @description
 * Content caching logic integrated with CacheService.
 * Aligned with cache-system.mdx.
 */
import { CacheCategory } from '@src/databases/cache/types';
import { logger } from '@src/utils/logger.server';
import { contentStructure } from './content-structure.svelte';
import { contentMetrics } from './content-metrics';
import type { Schema } from './types';

// Uses lazy import to prevent client-side bundling
const getCacheService = async () => (await import('@src/databases/cache/cache-service')).cacheService;
const getRedisTTL = async () => (await import('@src/databases/cache/cache-service')).REDIS_TTL_S;

// Reactive state for first collection cache
let firstCollCache = $state<{
	collection: Schema | null;
	timestamp: number;
	tenantId?: string | null;
} | null>(null);

const collectionCache = new Map<string, { schema: any; timestamp: number }>();
const collectionDependencies = new Map<string, Set<string>>();

const COLLECTION_CACHE_TTL = 20 * 1000; // 20 seconds
const FIRST_COLLECTION_CACHE_TTL = 60 * 1000; // 60 seconds

/**
 * L1+L2 caching via CacheService.
 * In-memory Map for fast path collection lookups.
 */
export const contentCache = {
	get firstCollectionCache() {
		return firstCollCache;
	},
	set firstCollectionCache(value) {
		firstCollCache = value;
	},

	trackCacheHit(hit: boolean) {
		contentMetrics.trackCacheHit(hit);
	},

	/**
	 * Attempt to load state from high-speed cache (Redis)
	 */
	async loadFromCache(tenantId?: string | null): Promise<boolean> {
		try {
			const cacheService = await getCacheService();
			const cachedState = await cacheService.get('cms:content_structure', tenantId, CacheCategory.CONTENT);

			if (cachedState && typeof cachedState === 'object') {
				const { nodes } = cachedState as any;

				const nodesToSync = Object.values(nodes || {}) as any[];
				contentStructure.sync(nodesToSync);

				logger.info(`🚀 ContentManager initialized from cache for tenant: ${tenantId || 'global'}`);
				return true;
			}
		} catch (error) {
			logger.warn('[ContentCache] Failed to load from cache:', error);
		}
		return false;
	},

	/**
	 * Populate Redis cache with current state
	 */
	async populateCache(tenantId?: string | null): Promise<void> {
		try {
			const cacheService = await getCacheService();
			const ttl = await getRedisTTL();

			const state = {
				nodes: Object.fromEntries(contentStructure.getNodesEntries()),
				paths: Object.fromEntries(contentStructure.getPathEntries()),
				version: contentStructure.contentVersion
			};

			await cacheService.set('cms:content_structure', state, ttl, tenantId, CacheCategory.CONTENT, ['cms:content']);
			logger.debug(`[ContentCache] Populated content structure cache for tenant: ${tenantId || 'global'}`);
		} catch (error) {
			logger.warn('[ContentCache] Failed to populate cache:', error);
		}
	},

	/**
	 * Get collection from in-memory cache
	 */
	getCollectionFromCache(identifier: string, tenantId?: string | null): Schema | null {
		const cacheKey = `${identifier}:${tenantId ?? 'default'}`;
		const cached = collectionCache.get(cacheKey);

		if (cached && Date.now() - cached.timestamp < COLLECTION_CACHE_TTL) {
			this.trackCacheHit(true);
			return cached.schema;
		}

		this.trackCacheHit(false);
		return null;
	},

	/**
	 * Set collection in in-memory cache
	 */
	setCollectionInCache(identifier: string, tenantId: string | null, schema: any) {
		const cacheKey = `${identifier}:${tenantId ?? 'default'}`;
		collectionCache.set(cacheKey, {
			schema,
			timestamp: Date.now()
		});
	},

	/**
	 * Get stats from cache
	 */
	getStatsFromCache(identifier: string, tenantId?: string | null): any | null {
		const cacheKey = `stats:${identifier}:${tenantId ?? 'default'}`;
		const cached = collectionCache.get(cacheKey);
		if (cached && Date.now() - cached.timestamp < COLLECTION_CACHE_TTL) {
			return cached.schema;
		}
		return null;
	},

	/**
	 * Set stats in cache
	 */
	setStatsInCache(identifier: string, tenantId: string | null, stats: any) {
		const cacheKey = `stats:${identifier}:${tenantId ?? 'default'}`;
		collectionCache.set(cacheKey, {
			schema: stats,
			timestamp: Date.now()
		});
	},

	/**
	 * Clear all in-memory caches
	 */
	clear() {
		collectionCache.clear();
		collectionDependencies.clear();
		firstCollCache = null;
		logger.debug('[ContentCache] Cleared in-memory caches');
	},

	/**
	 * Invalidate specific collection caches
	 */
	invalidateCollection(collectionId: string, path?: string) {
		collectionCache.delete(`${collectionId}:default`);
		if (path) {
			collectionCache.delete(`${path}:default`);
		}
		firstCollCache = null;
	},

	/**
	 * Dependency tracking for cache invalidation
	 */
	registerDependency(collectionId: string, dependsOn: string): void {
		if (!collectionDependencies.has(collectionId)) {
			collectionDependencies.set(collectionId, new Set<string>());
		}
		collectionDependencies.get(collectionId)?.add(dependsOn);
	},

	getDependentCollections(collectionId: string): string[] {
		const dependents: string[] = [];
		for (const [id, deps] of collectionDependencies.entries()) {
			if (deps.has(collectionId)) dependents.push(id);
		}
		return dependents;
	},

	async invalidateWithDependents(collectionId: string): Promise<void> {
		const toInvalidate = [collectionId, ...this.getDependentCollections(collectionId)];
		for (const id of toInvalidate) {
			this.invalidateCollection(id);
		}
	},

	/**
	 * Invalidate specific caches by paths/patterns.
	 */
	async invalidateSpecificCaches(paths: string[], tenantId?: string | null): Promise<void> {
		const cacheService = await getCacheService();
		for (const path of paths) {
			await cacheService.clearByPattern(path, tenantId);
			this.invalidateCollection(path);
		}
	},

	/**
	 * Proactively warms the cache for specific entries.
	 */
	async warmEntriesCache(collectionId: string, entryIds: string[], tenantId?: string | null): Promise<void> {
		const cacheService = await getCacheService();
		logger.info(`[ContentCache] Warming cache for ${entryIds.length} entries in ${collectionId}`, { tenantId });
		// In a real implementation, this would fetch from DB and populate Redis
		// For now, we clear any stale entries to ensure next read is fresh
		for (const id of entryIds) {
			await cacheService.delete(`entry:${collectionId}:${id}`, tenantId);
		}
	},

	/**
	 * TTL constants
	 */
	get FIRST_COLLECTION_CACHE_TTL() {
		return FIRST_COLLECTION_CACHE_TTL;
	}
};
