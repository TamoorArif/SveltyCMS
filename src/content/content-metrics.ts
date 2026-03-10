/**
 * @file src/content/content-metrics.ts
 * @description
 * Lightweight, tree-shakable monitoring for ContentManager.
 * Aligned with system PerformanceService and state-management.mdx patterns.
 */
import { logger } from '@src/utils/logger.server';
import { contentStructure } from './content-structure.svelte';
import type { ContentNode } from './types';

interface Metrics {
	initializationTime: number;
	cacheHits: number;
	cacheMisses: number;
	lastRefresh: number;
	operationCounts: {
		create: number;
		update: number;
		delete: number;
		move: number;
	};
}

const metrics: Metrics = {
	initializationTime: 0,
	cacheHits: 0,
	cacheMisses: 0,
	lastRefresh: 0,
	operationCounts: {
		create: 0,
		update: 0,
		delete: 0,
		move: 0
	}
};

const performanceMetrics = {
	operations: new Map<string, { count: number; totalTime: number; avgTime: number }>()
};

const snapshots: Map<
	string,
	{
		nodes: ContentNode[];
		timestamp: number;
	}
> = new Map();

/**
 * Performance tracking, diagnostics, and snapshots.
 */
export const contentMetrics = {
	getMetrics() {
		return {
			...metrics,
			uptime: Date.now() - metrics.lastRefresh,
			cacheHitRate: metrics.cacheHits / (metrics.cacheHits + metrics.cacheMisses) || 0
		};
	},

	trackCacheHit(hit: boolean) {
		if (hit) {
			metrics.cacheHits++;
		} else {
			metrics.cacheMisses++;
		}
	},

	setInitializationTime(ms: number) {
		metrics.initializationTime = ms;
		metrics.lastRefresh = Date.now();
	},

	trackOperation(operation: string, durationMs: number) {
		if (!performanceMetrics.operations.has(operation)) {
			performanceMetrics.operations.set(operation, {
				count: 0,
				totalTime: 0,
				avgTime: 0
			});
		}

		const metric = performanceMetrics.operations.get(operation)!;
		metric.count++;
		metric.totalTime += durationMs;
		metric.avgTime = metric.totalTime / metric.count;
	},

	async withPerfTracking<T>(operation: string, fn: () => Promise<T>): Promise<T> {
		const start = performance.now();
		try {
			return await fn();
		} finally {
			this.trackOperation(operation, performance.now() - start);
		}
	},

	getHealthStatus() {
		return {
			state: contentStructure.initState,
			nodeCount: contentStructure.nodeCount,
			collectionCount: contentStructure.collectionCount,
			version: contentStructure.contentVersion
		};
	},

	getDiagnostics() {
		return {
			nodeCount: contentStructure.nodeCount,
			state: contentStructure.initState,
			version: contentStructure.contentVersion
		};
	},

	getPerformanceMetrics() {
		return {
			...metrics,
			operations: Array.from(performanceMetrics.operations.entries()).map(([op, stats]) => ({
				operation: op,
				...stats
			}))
		};
	},

	createSnapshot(snapshotId: string) {
		snapshots.set(snapshotId, {
			nodes: contentStructure.getAllNodes(),
			timestamp: Date.now()
		});

		logger.info(`[ContentMetrics] Created snapshot: ${snapshotId}`);

		// Keep only last 5 snapshots
		if (snapshots.size > 5) {
			const oldestKey = Array.from(snapshots.keys())[0];
			snapshots.delete(oldestKey);
		}
	},

	/**
	 * Returns the nodes from a snapshot for restoration.
	 */
	async rollbackToSnapshot(snapshotId: string): Promise<ContentNode[] | null> {
		const snapshot = snapshots.get(snapshotId);
		if (!snapshot) {
			logger.warn(`[ContentMetrics] Snapshot not found: ${snapshotId}`);
			return null;
		}

		logger.info(`[ContentMetrics] Retreived nodes from snapshot: ${snapshotId}`);
		return snapshot.nodes;
	},

	/**
	 * Returns metadata and statistics for a specific collection.
	 */
	getCollectionStats(collectionId: string, tenantId?: string | null) {
		const node = contentStructure.getNode(collectionId);
		if (!node || node.nodeType !== 'collection') return null;

		return {
			_id: node._id,
			name: node.name,
			path: node.path,
			fieldCount: node.collectionDef?.fields?.length || 0,
			version: contentStructure.contentVersion,
			tenantId: node.tenantId || tenantId
		};
	},

	listSnapshots() {
		const now = Date.now();
		return Array.from(snapshots.entries()).map(([id, snapshot]) => ({
			id: id,
			timestamp: snapshot.timestamp,
			age: now - snapshot.timestamp
		}));
	}
};
