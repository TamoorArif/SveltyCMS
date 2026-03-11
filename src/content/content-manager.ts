/**
 * @file src/content/content-manager.ts
 * @description
 * Ultra-thin coordinator (public API facade) for SveltyCMS content operations.
 * This module acts as a functional bridge to specialized, tree-shakable sub-modules.
 */
import type { ContentNode, ContentNodeOperation, Schema } from './types';
import { contentStructure } from './content-structure.svelte';
import { contentInitializer } from './content-initializer';
import { contentCache } from './content-cache.svelte';
import { contentNavigation } from './content-navigation';
import { contentMetrics } from './content-metrics';
import { contentReconciler } from './content-reconciler';
import { contentCollections } from './content-collections.svelte';
import type { IDBAdapter } from '@src/databases/db-interface';

/**
 * Re-export NavigationNode for backward compatibility
 */
export interface NavigationNode {
	_id: string;
	children?: NavigationNode[];
	hasChildren?: boolean;
	icon?: string;
	lastModified?: Date;
	name: string;
	nodeType: 'category' | 'collection';
	order?: number;
	parentId?: string;
	path?: string;
	status?: string;
	translations?: { languageTag: string; translationName: string }[];
}

/**
 * Functional facade for content management.
 * Provides a stable public API while delegating implementation.
 *
 * DESIGN: Object facade over specialized modules.
 * Enables easier tree-shaking and eliminates class-based singleton overhead.
 */
export const contentManager = {
	// --- Reactive State & Versioning ---
	get version() {
		return contentStructure.contentVersion;
	},
	get isInitialized() {
		return contentStructure.isInitialized;
	},
	get initState() {
		return contentStructure.initState;
	},

	// --- Backward Compatibility (Function-style accessors) ---
	isInitializedForTenant: (tenantId: string | null) => contentInitializer.isInitializedForTenant(tenantId),
	getContentVersion: () => contentStructure.contentVersion,
	getHealthStatus: () => contentMetrics.getHealthStatus(),
	getDiagnostics: () => contentMetrics.getDiagnostics(),
	getMetrics: () => contentMetrics.getMetrics(),
	validateStructure: () => contentManager.validate(),

	// --- Lifecycle Management ---
	initialize: (tenantId: string | null = null, skipReconciliation = false, adapter?: IDBAdapter) =>
		contentInitializer.initialize(tenantId, skipReconciliation, adapter),

	refresh: (tenantId: string | null = null, skipReconciliation = false) => contentInitializer.refresh(tenantId, skipReconciliation),

	sync: (nodes: ContentNode[]) => contentStructure.sync(nodes),

	// --- Collection Management (Delegated to content-collections) ---
	collections: contentCollections,

	getCollections(tenantId?: string | null): Schema[] {
		return contentCollections.getAll(tenantId);
	},

	getCollection(identifier: string, tenantId?: string | null): Schema | null {
		const cached = contentCache.getCollectionFromCache(identifier, tenantId);
		if (cached) return cached;

		const result = contentCollections.get(identifier, tenantId);
		if (result) contentCache.setCollectionInCache(identifier, tenantId || null, result);
		return result;
	},

	getCollectionById(collectionId: string, tenantId?: string | null): Schema | null {
		return this.getCollection(collectionId, tenantId);
	},

	getCollectionStats(collectionId: string, tenantId?: string | null) {
		return contentMetrics.getCollectionStats(collectionId, tenantId);
	},

	async getFirstCollection(tenantId?: string | null, forceRefresh = false): Promise<Schema | null> {
		const now = Date.now();
		if (
			!forceRefresh &&
			contentCache.firstCollectionCache &&
			contentCache.firstCollectionCache.tenantId === tenantId &&
			now - contentCache.firstCollectionCache.timestamp < contentCache.FIRST_COLLECTION_CACHE_TTL
		) {
			return contentCache.firstCollectionCache.collection;
		}

		const first = contentCollections.getSmartFirst(tenantId);
		contentCache.firstCollectionCache = { collection: first, timestamp: now, tenantId };
		return first;
	},

	async getFirstCollectionRedirectUrl(language = 'en', tenantId?: string | null): Promise<string | null> {
		const collection = await contentCollections.getSmartFirst(tenantId);
		if (!collection?._id) return `/config/collectionbuilder`;
		return `/${language}/${collection._id}`;
	},

	// --- Content Structure & Navigation ---
	navigation: contentNavigation,

	async getNavigationStructure(tenantId: string | null = null) {
		return contentNavigation.getNavigationStructure(tenantId);
	},

	getNavigationStructureProgressive(options?: { maxDepth?: number; expandedIds?: Set<string>; tenantId?: string | null }) {
		return contentNavigation.getNavigationStructureProgressive(options);
	},

	async getContentStructure(tenantId?: string | null): Promise<ContentNode[]> {
		return Array.from(contentStructure.getNodesForTenant(tenantId));
	},

	getNodeChildren(parentId: string | null = null, tenantId?: string | null): ContentNode[] {
		return contentNavigation.getNodeChildren(parentId || '', tenantId);
	},

	getBreadcrumb(path: string) {
		return contentNavigation.getBreadcrumb(path);
	},

	// --- Cache & Invalidation ---
	invalidate: contentCache.invalidateCollection,
	invalidateWithDependents: contentCache.invalidateWithDependents,

	async invalidateSpecificCaches(paths: string[], tenantId?: string | null) {
		return contentCache.invalidateSpecificCaches(paths, tenantId);
	},

	async warmEntriesCache(collectionId: string, entryIds: string[], tenantId?: string | null) {
		return contentCache.warmEntriesCache(collectionId, entryIds, tenantId);
	},

	clearFirstCollectionCache(): void {
		contentCache.firstCollectionCache = null;
	},

	// --- Health, Metrics & Snapshots ---
	metrics: contentMetrics,

	validate(): { valid: boolean; errors: string[]; warnings: string[] } {
		const errors: string[] = [];
		const nodes = contentStructure.getNodes();
		for (const node of nodes) {
			if (node.parentId && !contentStructure.hasNode(node.parentId)) {
				errors.push(`Node ${node._id} has missing parent ${node.parentId}`);
			}
		}
		return { valid: errors.length === 0, errors, warnings: [] };
	},

	// --- Database & Reconciliation ---
	reconciler: contentReconciler,

	async getContentStructureFromDatabase(format: 'flat' | 'nested' = 'nested', tenantId?: string | null): Promise<ContentNode[]> {
		return contentReconciler.getContentStructureFromDatabase(format, tenantId);
	},

	async upsertContentNodes(operations: ContentNodeOperation[], tenantId?: string | null) {
		const result = await contentReconciler.upsertContentNodes(operations, tenantId);
		contentStructure.updateVersion();
		return result;
	},

	async reorderContentNodes(operations: ContentNodeOperation[], tenantId?: string | null): Promise<ContentNode[]> {
		const result = await contentReconciler.reorderContentNodes(operations, tenantId);
		contentStructure.updateVersion();
		return result;
	},

	async moveNodeWithDescendants(nodeId: string, newParentId: string | undefined): Promise<void> {
		await contentReconciler.moveNodeWithDescendants(nodeId, newParentId);
		contentStructure.updateVersion();
	}
};
