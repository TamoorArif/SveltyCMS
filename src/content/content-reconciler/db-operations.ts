/**
 * @file src/content/content-reconciler/db-operations.ts
 * @description
 * Database-specific operations for content reconciliation.
 */
import { logger } from '@src/utils/logger.server';
import { CacheCategory } from '@src/databases/cache/types';
import type { ContentNode, Schema, DatabaseId } from '../types';
import type { IDBAdapter } from '@src/databases/db-interface';

const invalidateCategoryCache = async (
	...args: Parameters<typeof import('@src/databases/mongodb/methods/mongodb-cache-utils').invalidateCategoryCache>
) => (await import('@src/databases/mongodb/methods/mongodb-cache-utils')).invalidateCategoryCache(...args);

/**
 * Registers schema models in the database.
 */
export async function registerModels(dbAdapter: IDBAdapter, schemas: Schema[]): Promise<void> {
	const collectionsToProcess = schemas.filter((s) => 'fields' in s);
	const BATCH_SIZE = 10;

	for (let i = 0; i < collectionsToProcess.length; i += BATCH_SIZE) {
		const batch = collectionsToProcess.slice(i, i + BATCH_SIZE);
		await Promise.all(
			batch.map(async (schema) => {
				try {
					await dbAdapter.collection.createModel(schema);
				} catch (error) {
					logger.error(`[DbOperations] Failed to register model for ${schema.name}:`, error);
				}
			})
		);
	}
}

/**
 * Performs bulk upsert of content nodes and handles orphan cleanup.
 */
export async function bulkUpsertWithParentIds(
	dbAdapter: IDBAdapter,
	operations: ContentNode[],
	tenantId?: string | null,
	dbNodes?: ContentNode[]
): Promise<void> {
	const upsertOps = operations.map((op) => ({
		path: op.path as string,
		id: op._id.toString(),
		changes: {
			...op,
			_id: op._id.toString() as DatabaseId,
			parentId: op.parentId ? (op.parentId.toString() as DatabaseId) : undefined,
			collectionDef: op.collectionDef
				? ({
						_id: op.collectionDef._id,
						name: op.collectionDef.name,
						icon: op.collectionDef.icon,
						status: op.collectionDef.status,
						path: op.collectionDef.path,
						tenantId: op.collectionDef.tenantId,
						fields: []
					} as Schema)
				: undefined
		} as Partial<ContentNode>
	}));

	await dbAdapter.content.nodes.bulkUpdate(upsertOps, { tenantId, bypassTenantCheck: true });

	// Orphan cleanup
	const currentPaths = new Set(operations.map((op) => op.path));
	const dbResult =
		dbNodes && dbNodes.length > 0
			? { success: true, data: dbNodes }
			: await dbAdapter.content.nodes.getStructure('flat', { tenantId, bypassCache: true, bypassTenantCheck: true });

	if (dbResult.success && dbResult.data) {
		const orphans = dbResult.data.filter((node: ContentNode) => node.path && !currentPaths.has(node.path));
		if (orphans.length > 0) {
			const orphanedIds = orphans.map((n: ContentNode) => n._id.toString());
			await dbAdapter.crud.deleteMany('system_content_structure', {
				_id: { $in: orphanedIds },
				...(tenantId ? { tenantId } : {})
			} as any);
		}
	}

	await invalidateCategoryCache(CacheCategory.CONTENT);
}
