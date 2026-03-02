/**
 * @file src/databases/mongodb/methods/crud-methods.ts
 * @description Generic, reusable CRUD operations for any MongoDB collection.
 *
 * Responsibility: ALL generic CRUD operations for any collection/model.
 *
 * This module provides:
 * - findOne, findMany, findByIds
 * - insert, update, upsert
 * - delete, deleteMany
 * - count, exists
 * - aggregate (for complex queries)
 * - Batch operations (upsertMany)
 *
 * Does NOT handle:
 * - Schema/model creation (use collectionMethods.ts)
 * - CMS-specific logic (use contentMethods.ts)
 * - Business rules or validation (handled by callers)
 *
 * This class is designed to be instantiated once per collection/model,
 * providing a clean, type-safe interface for all data operations.
 */

import { safeQuery } from '@src/utils/security/safe-query';
import { nowISODateString } from '@utils/date-utils';
import mongoose, { type Model, type QueryFilter as MongoQueryFilter, type PipelineStage, type UpdateQuery } from 'mongoose';
import type { BaseEntity, DatabaseId, DatabaseResult, QueryFilter } from '../../db-interface';
import { createDatabaseError, generateId, processDates } from './mongodb-utils';

/**
 * MongoCrudMethods provides generic CRUD operations for a Mongoose model.
 *
 * Each instance is tied to a specific model and provides all standard
 * database operations in a consistent, error-handled manner.
 *
 * @template T - The entity type (must extend BaseEntity)
 */

export class MongoCrudMethods<T extends BaseEntity> {
	public readonly model: Model<T>;

	constructor(model: Model<T>) {
		this.model = model;
	}

	async findOne(
		query: QueryFilter<T>,
<<<<<<< HEAD
		options: { fields?: (keyof T)[]; tenantId?: string | null; sudo?: boolean } = {}
	): Promise<DatabaseResult<T | null>> {
		try {
			const secureQuery = safeQuery(query, options.tenantId, { sudo: options.sudo });
=======
		options: { fields?: (keyof T)[]; tenantId?: string | null; bypassTenantCheck?: boolean } = {}
	): Promise<DatabaseResult<T | null>> {
		try {
			const secureQuery = safeQuery(query, options.tenantId, { bypassTenantCheck: options.bypassTenantCheck });
>>>>>>> 8c9d82013cc49cb63620e263d9825a2b9d36719b
			const result = await this.model.findOne(secureQuery, options.fields?.join(' ')).lean().exec();

			if (!result) {
				return { success: true, data: null };
			}
			return { success: true, data: processDates(result) as T };
		} catch (error) {
			return {
				success: false,
				message: `Failed to find document in ${this.model.modelName}`,
				error: createDatabaseError(error, 'FIND_ONE_ERROR', `Failed to find document in ${this.model.modelName}`)
			};
		}
	}

<<<<<<< HEAD
	async findById(id: DatabaseId, tenantId?: string | null, options: { sudo?: boolean } = {}): Promise<DatabaseResult<T | null>> {
		try {
			const query = safeQuery({ _id: id } as unknown as QueryFilter<T>, tenantId, { sudo: options.sudo }) as MongoQueryFilter<T>;
=======
	async findById(id: DatabaseId, tenantId?: string | null, bypassTenantCheck?: boolean): Promise<DatabaseResult<T | null>> {
		try {
			const query = safeQuery({ _id: id } as QueryFilter<T>, tenantId, { bypassTenantCheck });
>>>>>>> 8c9d82013cc49cb63620e263d9825a2b9d36719b
			const result = await this.model.findOne(query).lean().exec();
			if (!result) {
				return { success: true, data: null };
			}
			return { success: true, data: processDates(result) as T };
		} catch (error) {
			return {
				success: false,
				message: `Failed to find document by ID in ${this.model.modelName}`,
				error: createDatabaseError(error, 'FIND_BY_ID_ERROR', `Failed to find document by ID in ${this.model.modelName}`)
			};
		}
	}

<<<<<<< HEAD
	async findByIds(ids: DatabaseId[], options: { fields?: (keyof T)[]; tenantId?: string | null; sudo?: boolean } = {}): Promise<DatabaseResult<T[]>> {
		try {
			const query = { _id: { $in: ids } } as unknown as QueryFilter<T>;
			const secureQuery = safeQuery(query, options.tenantId, { sudo: options.sudo });
			const results = await this.model.find(secureQuery, options.fields?.join(' ')).lean().exec();
=======
	async findByIds(
		ids: DatabaseId[],
		options?: { fields?: (keyof T)[]; tenantId?: string | null; bypassTenantCheck?: boolean }
	): Promise<DatabaseResult<T[]>> {
		try {
			const secureQuery = safeQuery({ _id: { $in: ids } } as unknown as QueryFilter<T>, options?.tenantId, {
				bypassTenantCheck: options?.bypassTenantCheck
			});
			const results = await this.model
				.find(secureQuery)
				.select(options?.fields?.join(' ') || '')
				.lean()
				.exec();
>>>>>>> 8c9d82013cc49cb63620e263d9825a2b9d36719b
			return { success: true, data: processDates(results) as T[] };
		} catch (error) {
			return {
				success: false,
				message: `Failed to find documents by IDs in ${this.model.modelName}`,
				error: createDatabaseError(error, 'FIND_BY_IDS_ERROR', `Failed to find documents by IDs in ${this.model.modelName}`)
			};
		}
	}

	async findMany(
		query: QueryFilter<T>,
		options: {
			limit?: number;
			skip?: number;
			sort?: { [key: string]: 'asc' | 'desc' | 1 | -1 };
			fields?: (keyof T)[];
			tenantId?: string | null;
<<<<<<< HEAD
			sudo?: boolean;
		} = {}
	): Promise<DatabaseResult<T[]>> {
		try {
			const secureQuery = safeQuery(query, options.tenantId, { sudo: options.sudo });
=======
			bypassTenantCheck?: boolean;
		} = {}
	): Promise<DatabaseResult<T[]>> {
		try {
			const secureQuery = safeQuery(query, options.tenantId, { bypassTenantCheck: options.bypassTenantCheck });
>>>>>>> 8c9d82013cc49cb63620e263d9825a2b9d36719b
			const results = await this.model
				.find(secureQuery, options.fields?.join(' '))
				.sort(options.sort || {})
				.skip(options.skip ?? 0)
				.limit(options.limit ?? 0)
				.lean()
				.exec();
			return { success: true, data: processDates(results) as T[] };
		} catch (error) {
			return {
				success: false,
				message: `Failed to find documents in ${this.model.modelName}`,
				error: createDatabaseError(error, 'FIND_MANY_ERROR', `Failed to find documents in ${this.model.modelName}`)
			};
		}
	}

	async insert(
<<<<<<< HEAD
		data: Omit<T, '_id' | 'createdAt' | 'updatedAt'>,
		tenantId?: string | null,
		options: { sudo?: boolean } = {}
	): Promise<DatabaseResult<T>> {
		try {
			// Validate tenant context if multi-tenant is enabled
			safeQuery({}, tenantId, { sudo: options.sudo });

			const docData = {
				...(data as Record<string, unknown>),
=======
		data: import('../../db-interface').EntityCreate<T>,
		tenantId?: string | null,
		bypassTenantCheck?: boolean
	): Promise<DatabaseResult<T>> {
		try {
			const secureData = safeQuery(data as Record<string, unknown>, tenantId, { bypassTenantCheck });
			const now = nowISODateString();
			const doc = new this.model({
				...secureData,
>>>>>>> 8c9d82013cc49cb63620e263d9825a2b9d36719b
				_id: generateId(),
				createdAt: now,
				updatedAt: now
			});
			const result = await doc.save();
			return { success: true, data: (result as mongoose.HydratedDocument<T>).toObject() as T };
		} catch (error) {
			if (error instanceof mongoose.mongo.MongoServerError && error.code === 11_000) {
				return {
					success: false,
					message: 'A document with the same unique key already exists.',
					error: createDatabaseError(error, 'DUPLICATE_KEY_ERROR', 'A document with the same unique key already exists.')
				};
			}
			return {
				success: false,
				message: `Failed to insert document into ${this.model.modelName}`,
				error: createDatabaseError(error, 'INSERT_ERROR', `Failed to insert document into ${this.model.modelName}`)
			};
		}
	}

	async insertMany(
<<<<<<< HEAD
		data: Omit<T, '_id' | 'createdAt' | 'updatedAt'>[],
		tenantId?: string | null,
		options: { sudo?: boolean } = {}
	): Promise<DatabaseResult<T[]>> {
		try {
			// Validate tenant context if multi-tenant is enabled
			safeQuery({}, tenantId, { sudo: options.sudo });

=======
		data: import('../../db-interface').EntityCreate<T>[],
		tenantId?: string | null,
		bypassTenantCheck?: boolean
	): Promise<DatabaseResult<T[]>> {
		try {
			const now = nowISODateString();
>>>>>>> 8c9d82013cc49cb63620e263d9825a2b9d36719b
			const docs = data.map((d) => ({
				...safeQuery(d as Record<string, unknown>, tenantId, { bypassTenantCheck }),
				_id: generateId(),
				createdAt: now,
				updatedAt: now
			}));
			const result = await this.model.insertMany(docs);
			return { success: true, data: result.map((doc) => (doc as mongoose.HydratedDocument<T>).toObject() as T) };
		} catch (error) {
			return {
				success: false,
				message: `Failed to insert many documents into ${this.model.modelName}`,
				error: createDatabaseError(error, 'INSERT_MANY_ERROR', `Failed to insert many documents into ${this.model.modelName}`)
			};
		}
	}

<<<<<<< HEAD
	async update(
		id: DatabaseId,
		data: Partial<Omit<T, 'createdAt' | 'updatedAt'>>,
		tenantId?: string | null,
		options: { sudo?: boolean } = {}
	): Promise<DatabaseResult<T | null>> {
		try {
			const query = safeQuery({ _id: id } as unknown as QueryFilter<T>, tenantId, { sudo: options.sudo }) as MongoQueryFilter<T>;
=======
	async update(id: DatabaseId, data: UpdateQuery<T>, tenantId?: string | null, bypassTenantCheck?: boolean): Promise<DatabaseResult<T | null>> {
		try {
			const query = safeQuery({ _id: id } as QueryFilter<T>, tenantId, { bypassTenantCheck });
>>>>>>> 8c9d82013cc49cb63620e263d9825a2b9d36719b
			const updateData = {
				...(data as object),
				updatedAt: nowISODateString()
			};
			const result = await this.model.findOneAndUpdate(query, { $set: updateData }, { returnDocument: 'after' }).lean().exec();

			if (!result) {
				return { success: true, data: null };
			}
			return { success: true, data: processDates(result) as T };
		} catch (error) {
			return {
				success: false,
				message: `Failed to update document ${id} in ${this.model.modelName}`,
				error: createDatabaseError(error, 'UPDATE_ERROR', `Failed to update document ${id} in ${this.model.modelName}`)
			};
		}
	}

	async upsert(
		query: QueryFilter<T>,
		data: Omit<T, '_id' | 'createdAt' | 'updatedAt'>,
		tenantId?: string | null,
<<<<<<< HEAD
		options: { sudo?: boolean } = {}
	): Promise<DatabaseResult<T>> {
		try {
			const secureQuery = safeQuery(query, tenantId, { sudo: options.sudo });
=======
		bypassTenantCheck?: boolean
	): Promise<DatabaseResult<T>> {
		try {
			const secureQuery = safeQuery(query, tenantId, { bypassTenantCheck });
>>>>>>> 8c9d82013cc49cb63620e263d9825a2b9d36719b
			const result = await this.model
				.findOneAndUpdate(
					secureQuery,
					{
						$set: { ...(data as Record<string, unknown>), updatedAt: nowISODateString() },
						$setOnInsert: {
							_id: generateId(),
							createdAt: nowISODateString(),
							tenantId: tenantId || (data as unknown as Record<string, unknown>).tenantId
						}
					},
					{ returnDocument: 'after', upsert: true, runValidators: true }
				)
				.lean()
				.exec();
			return { success: true, data: processDates(result) as T };
		} catch (error) {
			return {
				success: false,
				message: `Failed to upsert document in ${this.model.modelName}`,
				error: createDatabaseError(error, 'UPSERT_ERROR', `Failed to upsert document in ${this.model.modelName}`)
			};
		}
	}

<<<<<<< HEAD
	async delete(id: DatabaseId, tenantId?: string | null, options: { sudo?: boolean } = {}): Promise<DatabaseResult<void>> {
		try {
			const query = safeQuery({ _id: id } as unknown as QueryFilter<T>, tenantId, { sudo: options.sudo }) as MongoQueryFilter<T>;
			await this.model.deleteOne(query);
			return { success: true, data: undefined };
=======
	async delete(id: DatabaseId, tenantId?: string | null, bypassTenantCheck?: boolean): Promise<DatabaseResult<boolean>> {
		try {
			const query = safeQuery({ _id: id } as QueryFilter<T>, tenantId, { bypassTenantCheck });
			const result = await this.model.deleteOne(query);
			return { success: true, data: result.deletedCount > 0 };
>>>>>>> 8c9d82013cc49cb63620e263d9825a2b9d36719b
		} catch (error) {
			return {
				success: false,
				message: `Failed to delete document ${id} from ${this.model.modelName}`,
				error: createDatabaseError(error, 'DELETE_ERROR', `Failed to delete document ${id} from ${this.model.modelName}`)
			};
		}
	}

	async updateMany(
		query: QueryFilter<T>,
		data: UpdateQuery<T>,
		tenantId?: string | null,
<<<<<<< HEAD
		options: { sudo?: boolean } = {}
	): Promise<DatabaseResult<{ modifiedCount: number; matchedCount: number }>> {
		try {
			const secureQuery = safeQuery(query, tenantId, { sudo: options.sudo });
=======
		bypassTenantCheck?: boolean
	): Promise<DatabaseResult<{ modifiedCount: number; matchedCount: number }>> {
		try {
			const secureQuery = safeQuery(query, tenantId, { bypassTenantCheck });
>>>>>>> 8c9d82013cc49cb63620e263d9825a2b9d36719b
			const updateData = {
				...(data as object),
				updatedAt: nowISODateString()
			};
			const result = await this.model.updateMany(secureQuery, {
				$set: updateData
			});
			return {
				success: true,
				data: {
					modifiedCount: result.modifiedCount,
					matchedCount: result.matchedCount
				}
			};
		} catch (error) {
			return {
				success: false,
				message: `Failed to update multiple documents in ${this.model.modelName}`,
				error: createDatabaseError(error, 'UPDATE_MANY_ERROR', `Failed to update multiple documents in ${this.model.modelName}`)
			};
		}
	}

<<<<<<< HEAD
	async deleteMany(
		query: QueryFilter<T>,
		tenantId?: string | null,
		options: { sudo?: boolean } = {}
	): Promise<DatabaseResult<{ deletedCount: number }>> {
		try {
			const secureQuery = safeQuery(query, tenantId, { sudo: options.sudo });
=======
	async deleteMany(query: QueryFilter<T>, tenantId?: string | null, bypassTenantCheck?: boolean): Promise<DatabaseResult<{ deletedCount: number }>> {
		try {
			const secureQuery = safeQuery(query, tenantId, { bypassTenantCheck });
>>>>>>> 8c9d82013cc49cb63620e263d9825a2b9d36719b
			const result = await this.model.deleteMany(secureQuery);
			return { success: true, data: { deletedCount: result.deletedCount } };
		} catch (error) {
			return {
				success: false,
				message: `Failed to delete documents from ${this.model.modelName}`,
				error: createDatabaseError(error, 'DELETE_MANY_ERROR', `Failed to delete documents from ${this.model.modelName}`)
			};
		}
	}

	async upsertMany(
		items: Array<{
			query: QueryFilter<T>;
			data: Omit<T, '_id' | 'createdAt' | 'updatedAt'>;
		}>,
		tenantId?: string | null,
<<<<<<< HEAD
		options: { sudo?: boolean } = {}
=======
		bypassTenantCheck?: boolean
>>>>>>> 8c9d82013cc49cb63620e263d9825a2b9d36719b
	): Promise<DatabaseResult<{ upsertedCount: number; modifiedCount: number }>> {
		try {
			if (items.length === 0) {
				return { success: true, data: { upsertedCount: 0, modifiedCount: 0 } };
			}

			const now = nowISODateString();
			const operations = items.map((item) => ({
				updateOne: {
<<<<<<< HEAD
					filter: safeQuery(item.query, tenantId, { sudo: options.sudo }) as MongoQueryFilter<T>,
=======
					filter: safeQuery(item.query, tenantId, { bypassTenantCheck }) as MongoQueryFilter<T>,
>>>>>>> 8c9d82013cc49cb63620e263d9825a2b9d36719b
					update: {
						$set: { ...(item.data as Record<string, unknown>), updatedAt: now },
						$setOnInsert: {
							_id: generateId(),
							createdAt: now,
							tenantId: tenantId || (item.data as unknown as Record<string, unknown>).tenantId
						}
					},
					upsert: true
				}
			}));

			const result = await this.model.bulkWrite(operations as any[]);
			return {
				success: true,
				data: {
					upsertedCount: result.upsertedCount,
					modifiedCount: result.modifiedCount
				}
			};
		} catch (error) {
			return {
				success: false,
				message: `Failed to upsert documents in ${this.model.modelName}`,
				error: createDatabaseError(error, 'UPSERT_MANY_ERROR', `Failed to upsert documents in ${this.model.modelName}`)
			};
		}
	}

<<<<<<< HEAD
	async count(query: QueryFilter<T> = {}, tenantId?: string | null, options: { sudo?: boolean } = {}): Promise<DatabaseResult<number>> {
		try {
			const secureQuery = safeQuery(query, tenantId, { sudo: options.sudo });
=======
	async count(query: QueryFilter<T> = {}, tenantId?: string | null, bypassTenantCheck?: boolean): Promise<DatabaseResult<number>> {
		try {
			const secureQuery = safeQuery(query, tenantId, { bypassTenantCheck });
>>>>>>> 8c9d82013cc49cb63620e263d9825a2b9d36719b
			const count = await this.model.countDocuments(secureQuery);
			return { success: true, data: count };
		} catch (error) {
			return {
				success: false,
				message: `Failed to count documents in ${this.model.modelName}`,
				error: createDatabaseError(error, 'COUNT_ERROR', `Failed to count documents in ${this.model.modelName}`)
			};
		}
	}

	/**
	 * Checks if a document exists matching the given query.
	 * Uses findOne with _id projection instead of exists() for faster execution.
	 * MongoDB stops scanning as soon as it finds the first match, and projection reduces network overhead.
	 */
<<<<<<< HEAD
	async exists(query: QueryFilter<T>, tenantId?: string | null, options: { sudo?: boolean } = {}): Promise<DatabaseResult<boolean>> {
		try {
			const secureQuery = safeQuery(query, tenantId, { sudo: options.sudo });
=======
	async exists(query: QueryFilter<T>, tenantId?: string | null, bypassTenantCheck?: boolean): Promise<DatabaseResult<boolean>> {
		try {
			const secureQuery = safeQuery(query, tenantId, { bypassTenantCheck });
>>>>>>> 8c9d82013cc49cb63620e263d9825a2b9d36719b
			// Use findOne with projection for optimal performance
			// Only fetches _id field, minimizing data transfer
			const doc = await this.model.findOne(secureQuery, { _id: 1 }).lean().exec();
			return { success: true, data: !!doc };
		} catch (error) {
			return {
				success: false,
				message: `Failed to check for document existence in ${this.model.modelName}`,
				error: createDatabaseError(error, 'EXISTS_ERROR', `Failed to check for document existence in ${this.model.modelName}`)
			};
		}
	}

<<<<<<< HEAD
	async aggregate<R>(pipeline: PipelineStage[], tenantId?: string | null, options: { sudo?: boolean } = {}): Promise<DatabaseResult<R[]>> {
		try {
			// Validate tenant context if multi-tenant is enabled
			safeQuery({}, tenantId, { sudo: options.sudo });

			const result = await this.model.aggregate<R>(pipeline).exec();
=======
	async aggregate(pipeline: PipelineStage[], tenantId?: string | null, bypassTenantCheck?: boolean): Promise<DatabaseResult<unknown[]>> {
		try {
			// In multi-tenant systems, we generally want to limit aggregations to a single tenant.
			const securePipeline = [...pipeline];
			if (!bypassTenantCheck && tenantId) {
				securePipeline.unshift({ $match: { tenantId } });
			} else if (!bypassTenantCheck && !tenantId) {
				// Use safeQuery logic here manually for pipeline context
				safeQuery({}, tenantId, { bypassTenantCheck }); // This will throw if context is missing
			}
			const result = await this.model.aggregate(securePipeline).exec();
>>>>>>> 8c9d82013cc49cb63620e263d9825a2b9d36719b
			return { success: true, data: result };
		} catch (error) {
			return {
				success: false,
				message: `Aggregation failed in ${this.model.modelName}`,
				error: createDatabaseError(error, 'AGGREGATION_ERROR', `Aggregation failed in ${this.model.modelName}`)
			};
		}
	}
}
