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

import { safeQuery } from "@src/utils/security/safe-query";
import { nowISODateString } from "@utils/date-utils";
import mongoose, {
  type Model,
  type QueryFilter as MongoQueryFilter,
  type PipelineStage,
  type UpdateQuery,
} from "mongoose";
import type { BaseEntity, DatabaseId, DatabaseResult, QueryFilter } from "../../db-interface";
import { createDatabaseError, generateId, processDates } from "./mongodb-utils";

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
    options: {
      fields?: (keyof T)[];
      tenantId?: string | null | null;
      bypassTenantCheck?: boolean;
      includeDeleted?: boolean;
    } = {},
  ): Promise<DatabaseResult<T | null>> {
    const startTime = performance.now();
    try {
      const secureQuery = safeQuery(query, options.tenantId, {
        bypassTenantCheck: options.bypassTenantCheck,
        includeDeleted: options.includeDeleted,
      });
      const result = await this.model.findOne(secureQuery, options.fields?.join(" ")).lean().exec();

      const meta = { executionTime: performance.now() - startTime };
      if (!result) {
        return { success: true, data: null, meta };
      }
      return { success: true, data: processDates(result) as T, meta };
    } catch (error) {
      return {
        success: false,
        message: `Failed to find document in ${this.model.modelName}`,
        error: createDatabaseError(
          error,
          "FIND_ONE_ERROR",
          `Failed to find document in ${this.model.modelName}`,
        ),
      };
    }
  }

  async findById(
    id: DatabaseId,
    tenantId?: string | null | null,
    bypassTenantCheck?: boolean,
    includeDeleted?: boolean,
  ): Promise<DatabaseResult<T | null>> {
    const startTime = performance.now();
    try {
      const query = safeQuery({ _id: id } as QueryFilter<T>, tenantId, {
        bypassTenantCheck,
        includeDeleted,
      });
      const result = await this.model.findOne(query).lean().exec();
      const meta = { executionTime: performance.now() - startTime };
      if (!result) {
        return { success: true, data: null, meta };
      }
      return { success: true, data: processDates(result) as T, meta };
    } catch (error) {
      return {
        success: false,
        message: `Failed to find document by ID in ${this.model.modelName}`,
        error: createDatabaseError(
          error,
          "FIND_BY_ID_ERROR",
          `Failed to find document by ID in ${this.model.modelName}`,
        ),
      };
    }
  }

  async findByIds(
    ids: DatabaseId[],
    options?: {
      fields?: (keyof T)[];
      tenantId?: string | null | null;
      bypassTenantCheck?: boolean;
      includeDeleted?: boolean;
    },
  ): Promise<DatabaseResult<T[]>> {
    const startTime = performance.now();
    try {
      const secureQuery = safeQuery(
        { _id: { $in: ids } } as unknown as QueryFilter<T>,
        options?.tenantId,
        {
          bypassTenantCheck: options?.bypassTenantCheck,
          includeDeleted: options?.includeDeleted,
        },
      );
      const results = await this.model
        .find(secureQuery)
        .select(options?.fields?.join(" ") || "")
        .lean()
        .exec();
      return {
        success: true,
        data: processDates(results) as T[],
        meta: { executionTime: performance.now() - startTime },
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to find documents by IDs in ${this.model.modelName}`,
        error: createDatabaseError(
          error,
          "FIND_BY_IDS_ERROR",
          `Failed to find documents by IDs in ${this.model.modelName}`,
        ),
      };
    }
  }

  async findMany(
    query: QueryFilter<T>,
    options: {
      limit?: number;
      skip?: number;
      sort?: { [key: string]: "asc" | "desc" | 1 | -1 };
      fields?: (keyof T)[];
      tenantId?: string | null | null;
      bypassTenantCheck?: boolean;
      includeDeleted?: boolean;
    } = {},
  ): Promise<DatabaseResult<T[]>> {
    const startTime = performance.now();
    try {
      const secureQuery = safeQuery(query, options.tenantId, {
        bypassTenantCheck: options.bypassTenantCheck,
        includeDeleted: options.includeDeleted,
      });
      const results = await this.model
        .find(secureQuery)
        .sort(options.sort || {})
        .skip(options.skip ?? 0)
        .limit(options.limit ?? 0)
        .select(options.fields?.join(" ") || "")
        .lean()
        .exec();
      return {
        success: true,
        data: processDates(results) as T[],
        meta: { executionTime: performance.now() - startTime },
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to find documents in ${this.model.modelName}`,
        error: createDatabaseError(
          error,
          "FIND_MANY_ERROR",
          `Failed to find documents in ${this.model.modelName}`,
        ),
      };
    }
  }

  async insert(
    data: import("../../db-interface").EntityCreate<T>,
    tenantId?: string | null | null,
    bypassTenantCheck?: boolean,
  ): Promise<DatabaseResult<T>> {
    const startTime = performance.now();
    try {
      const secureData = safeQuery(data as Record<string, unknown>, tenantId, {
        bypassTenantCheck,
        includeDeleted: true,
      });
      const now = nowISODateString();
      const doc = new this.model({
        ...secureData,
        _id: (secureData._id as string) || generateId(),
        createdAt: now,
        updatedAt: now,
        isDeleted: false,
      });
      const result = await doc.save();
      return {
        success: true,
        data: (result as mongoose.HydratedDocument<T>).toObject() as T,
        meta: { executionTime: performance.now() - startTime },
      };
    } catch (error) {
      if (error instanceof mongoose.mongo.MongoServerError && error.code === 11_000) {
        return {
          success: false,
          message: "A document with the same unique key already exists.",
          error: createDatabaseError(
            error,
            "DUPLICATE_KEY_ERROR",
            "A document with the same unique key already exists.",
          ),
        };
      }
      return {
        success: false,
        message: `Failed to insert document into ${this.model.modelName}`,
        error: createDatabaseError(
          error,
          "INSERT_ERROR",
          `Failed to insert document into ${this.model.modelName}`,
        ),
      };
    }
  }

  async insertMany(
    data: import("../../db-interface").EntityCreate<T>[],
    tenantId?: string | null | null,
    bypassTenantCheck?: boolean,
  ): Promise<DatabaseResult<T[]>> {
    const startTime = performance.now();
    try {
      const now = nowISODateString();
      const docs = data.map((d) => {
        const secureData = safeQuery(d as Record<string, unknown>, tenantId, {
          bypassTenantCheck,
          includeDeleted: true,
        });
        return {
          ...secureData,
          _id: (secureData._id as string) || generateId(),
          createdAt: now,
          updatedAt: now,
          isDeleted: false,
        };
      });
      const result = await this.model.insertMany(docs);
      return {
        success: true,
        data: result.map((doc) => (doc as unknown as mongoose.HydratedDocument<T>).toObject() as T),
        meta: { executionTime: performance.now() - startTime },
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to insert many documents into ${this.model.modelName}`,
        error: createDatabaseError(
          error,
          "INSERT_MANY_ERROR",
          `Failed to insert many documents into ${this.model.modelName}`,
        ),
      };
    }
  }

  async update(
    id: DatabaseId,
    data: UpdateQuery<T>,
    tenantId?: string | null | null,
    bypassTenantCheck?: boolean,
  ): Promise<DatabaseResult<T | null>> {
    const startTime = performance.now();
    try {
      const query = safeQuery({ _id: id } as QueryFilter<T>, tenantId, {
        bypassTenantCheck,
      });
      const updateData = {
        ...(data as object),
        updatedAt: nowISODateString(),
      };
      const result = await this.model
        .findOneAndUpdate(query, { $set: updateData }, { returnDocument: "after" })
        .lean()
        .exec();

      const meta = { executionTime: performance.now() - startTime };
      if (!result) {
        return { success: true, data: null, meta };
      }
      return { success: true, data: processDates(result) as T, meta };
    } catch (error) {
      return {
        success: false,
        message: `Failed to update document ${id} in ${this.model.modelName}`,
        error: createDatabaseError(
          error,
          "UPDATE_ERROR",
          `Failed to update document ${id} in ${this.model.modelName}`,
        ),
      };
    }
  }

  async upsert(
    query: QueryFilter<T>,
    data: Omit<T, "_id" | "createdAt" | "updatedAt">,
    tenantId?: string | null | null,
    bypassTenantCheck?: boolean,
  ): Promise<DatabaseResult<T>> {
    try {
      const secureQuery = safeQuery(query, tenantId, { bypassTenantCheck });
      const result = await this.model
        .findOneAndUpdate(
          secureQuery,
          {
            $set: {
              ...(data as Record<string, unknown>),
              updatedAt: nowISODateString(),
            },
            $setOnInsert: {
              _id: generateId(),
              createdAt: nowISODateString(),
              tenantId: tenantId || (data as unknown as Record<string, unknown>).tenantId,
            },
          },
          { returnDocument: "after", upsert: true, runValidators: true },
        )
        .lean()
        .exec();
      return { success: true, data: processDates(result) as T };
    } catch (error) {
      return {
        success: false,
        message: `Failed to upsert document in ${this.model.modelName}`,
        error: createDatabaseError(
          error,
          "UPSERT_ERROR",
          `Failed to upsert document in ${this.model.modelName}`,
        ),
      };
    }
  }

  async delete(
    id: DatabaseId,
    options: {
      tenantId?: string | null;
      bypassTenantCheck?: boolean;
      permanent?: boolean;
      userId?: string;
    } = {},
  ): Promise<DatabaseResult<void>> {
    try {
      const { tenantId, bypassTenantCheck, permanent, userId } = options;
      const query = safeQuery({ _id: id } as QueryFilter<T>, tenantId, {
        bypassTenantCheck,
      });

      if (permanent) {
        const result = await this.model.deleteOne(query);
        if ((result.deletedCount ?? 0) === 0) {
          return {
            success: false,
            message: "Item not found",
            error: { code: "NOT_FOUND", message: "Item not found" },
          };
        }
        return { success: true, data: undefined };
      }

      // Soft Delete with Mangling
      const doc = await this.model.findOne(query).lean().exec();
      if (!doc) {
        return {
          success: false,
          message: "Item not found",
          error: { code: "NOT_FOUND", message: "Item not found" },
        };
      }

      const now = nowISODateString();
      const timestamp = Date.now();
      const updateData: Record<string, any> = {
        isDeleted: true,
        deletedAt: now,
        deletedBy: userId,
        updatedAt: now,
      };

      // Identify unique fields from Mongoose schema to mangle them
      const schema = this.model.schema;
      for (const [path, schemaType] of Object.entries(schema.paths)) {
        const isUnique = (schemaType as any)._userProvidedOptions?.unique;
        if (isUnique && (doc as any)[path] !== undefined && (doc as any)[path] !== null) {
          // Mangle: slug -> slug_DELETED_1710793389
          updateData[path] = `${(doc as any)[path]}_DELETED_${timestamp}`;
        }
      }

      await this.model.updateOne(query, { $set: updateData });
      return { success: true, data: undefined };
    } catch (error) {
      return {
        success: false,
        message: `Failed to delete document ${id} from ${this.model.modelName}`,
        error: createDatabaseError(
          error,
          "DELETE_ERROR",
          `Failed to delete document ${id} from ${this.model.modelName}`,
        ),
      };
    }
  }

  async restore(
    id: DatabaseId,
    options: { tenantId?: string | null; bypassTenantCheck?: boolean } = {},
  ): Promise<DatabaseResult<boolean>> {
    try {
      const { tenantId, bypassTenantCheck } = options;
      // Find specifically in deleted items
      const query = safeQuery({ _id: id } as QueryFilter<T>, tenantId, {
        bypassTenantCheck,
        includeDeleted: true,
      });
      const doc = await this.model.findOne(query).lean().exec();

      if (!doc || !(doc as any).isDeleted) {
        return {
          success: false,
          message: "Document not found in Trash",
          error: { code: "NOT_FOUND", message: "Document not found in Trash" },
        };
      }

      const updateData: Record<string, any> = {
        isDeleted: false,
        updatedAt: nowISODateString(),
      };

      const unsetData: Record<string, any> = {
        deletedAt: "",
        deletedBy: "",
      };

      // De-mangle unique fields
      const schema = this.model.schema;
      for (const [path, schemaType] of Object.entries(schema.paths)) {
        const isUnique = (schemaType as any)._userProvidedOptions?.unique;
        const value = (doc as any)[path];
        if (isUnique && typeof value === "string" && value.includes("_DELETED_")) {
          // Restore original value by stripping suffix
          updateData[path] = value.split("_DELETED_")[0];
        }
      }

      // Check if restored unique values would collide
      for (const [path, value] of Object.entries(updateData)) {
        if (path !== "isDeleted" && path !== "updatedAt") {
          const collisionQuery = safeQuery({ [path]: value } as QueryFilter<T>, tenantId, {
            bypassTenantCheck,
          });
          const exists = await this.model.findOne(collisionQuery).lean().exec();
          if (exists) {
            return {
              success: false,
              message: `Cannot restore: unique field '${path}' with value '${value}' already exists.`,
              error: {
                code: "COLLISION",
                message: `Unique constraint violation on ${path}`,
              },
            };
          }
        }
      }

      const result = await this.model.updateOne(query, {
        $set: updateData,
        $unset: unsetData,
      });
      return { success: true, data: result.modifiedCount > 0 };
    } catch (error) {
      return {
        success: false,
        message: `Failed to restore document ${id} from ${this.model.modelName}`,
        error: createDatabaseError(
          error,
          "RESTORE_ERROR",
          `Failed to restore document ${id} from ${this.model.modelName}`,
        ),
      };
    }
  }

  async updateMany(
    query: QueryFilter<T>,
    data: UpdateQuery<T>,
    tenantId?: string | null | null,
    bypassTenantCheck?: boolean,
  ): Promise<DatabaseResult<{ modifiedCount: number; matchedCount: number }>> {
    try {
      const secureQuery = safeQuery(query, tenantId, { bypassTenantCheck });
      const updateData = {
        ...(data as object),
        updatedAt: nowISODateString(),
      };
      const result = await this.model.updateMany(secureQuery, {
        $set: updateData,
      });
      return {
        success: true,
        data: {
          modifiedCount: result.modifiedCount,
          matchedCount: result.matchedCount,
        },
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to update multiple documents in ${this.model.modelName}`,
        error: createDatabaseError(
          error,
          "UPDATE_MANY_ERROR",
          `Failed to update multiple documents in ${this.model.modelName}`,
        ),
      };
    }
  }

  async deleteMany(
    query: QueryFilter<T>,
    options: {
      tenantId?: string | null;
      bypassTenantCheck?: boolean;
      permanent?: boolean;
      userId?: string;
    } = {},
  ): Promise<DatabaseResult<{ deletedCount: number }>> {
    try {
      const { tenantId, bypassTenantCheck, permanent, userId } = options;
      const secureQuery = safeQuery(query, tenantId, { bypassTenantCheck });

      if (permanent) {
        const result = await this.model.deleteMany(secureQuery);
        return { success: true, data: { deletedCount: result.deletedCount } };
      }

      // Soft Delete Many
      const now = nowISODateString();
      const result = await this.model.updateMany(secureQuery, {
        $set: {
          isDeleted: true,
          deletedAt: now,
          deletedBy: userId,
          updatedAt: now,
        },
      });
      // Note: Mass mangling is complex and might be omitted for bulk deletes in this phase,
      // or handled by iterating if unique fields are present.
      return { success: true, data: { deletedCount: result.modifiedCount } };
    } catch (error) {
      return {
        success: false,
        message: `Failed to delete documents from ${this.model.modelName}`,
        error: createDatabaseError(
          error,
          "DELETE_MANY_ERROR",
          `Failed to delete documents from ${this.model.modelName}`,
        ),
      };
    }
  }

  async upsertMany(
    items: Array<{
      query: QueryFilter<T>;
      data: Omit<T, "_id" | "createdAt" | "updatedAt">;
    }>,
    tenantId?: string | null | null,
    bypassTenantCheck?: boolean,
  ): Promise<DatabaseResult<{ upsertedCount: number; modifiedCount: number }>> {
    try {
      if (items.length === 0) {
        return { success: true, data: { upsertedCount: 0, modifiedCount: 0 } };
      }

      const now = nowISODateString();
      const operations = items.map((item) => ({
        updateOne: {
          filter: safeQuery(item.query, tenantId, {
            bypassTenantCheck,
          }) as MongoQueryFilter<T>,
          update: {
            $set: { ...(item.data as Record<string, unknown>), updatedAt: now },
            $setOnInsert: {
              _id: generateId(),
              createdAt: now,
              tenantId: tenantId || (item.data as unknown as Record<string, unknown>).tenantId,
              isDeleted: false,
            },
          },
          upsert: true,
        },
      }));

      const result = await this.model.bulkWrite(operations as any[]);
      return {
        success: true,
        data: {
          upsertedCount: result.upsertedCount,
          modifiedCount: result.modifiedCount,
        },
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to upsert documents in ${this.model.modelName}`,
        error: createDatabaseError(
          error,
          "UPSERT_MANY_ERROR",
          `Failed to upsert documents in ${this.model.modelName}`,
        ),
      };
    }
  }

  async count(
    query: QueryFilter<T> = {},
    options: {
      tenantId?: string | null;
      bypassTenantCheck?: boolean;
      includeDeleted?: boolean;
      silent?: boolean;
    } = {},
  ): Promise<DatabaseResult<number>> {
    try {
      const secureQuery = safeQuery(query, options.tenantId, {
        bypassTenantCheck: options.bypassTenantCheck,
        includeDeleted: options.includeDeleted,
      });
      const count = await this.model.countDocuments(secureQuery);
      return { success: true, data: count };
    } catch (error) {
      return {
        success: false,
        message: `Failed to count documents in ${this.model.modelName}`,
        error: createDatabaseError(
          error,
          "COUNT_ERROR",
          `Failed to count documents in ${this.model.modelName}`,
          options.silent,
        ),
      };
    }
  }

  /**
   * Checks if a document exists matching the given query.
   * Uses findOne with _id projection instead of exists() for faster execution.
   */
  async exists(
    query: QueryFilter<T>,
    options: {
      tenantId?: string | null;
      bypassTenantCheck?: boolean;
      includeDeleted?: boolean;
    } = {},
  ): Promise<DatabaseResult<boolean>> {
    try {
      const secureQuery = safeQuery(query, options.tenantId, {
        bypassTenantCheck: options.bypassTenantCheck,
        includeDeleted: options.includeDeleted,
      });
      const doc = await this.model.findOne(secureQuery, { _id: 1 }).lean().exec();
      return { success: true, data: !!doc };
    } catch (error) {
      return {
        success: false,
        message: `Failed to check for document existence in ${this.model.modelName}`,
        error: createDatabaseError(
          error,
          "EXISTS_ERROR",
          `Failed to check for document existence in ${this.model.modelName}`,
        ),
      };
    }
  }

  async aggregate(
    pipeline: PipelineStage[],
    tenantId?: string | null | null,
    bypassTenantCheck?: boolean,
  ): Promise<DatabaseResult<unknown[]>> {
    try {
      // In multi-tenant systems, we generally want to limit aggregations to a single tenant.
      const securePipeline = [...pipeline];
      if (!bypassTenantCheck && tenantId) {
        securePipeline.unshift({ $match: { tenantId } });
      }
      // Enforce soft-delete filter in aggregations by default
      securePipeline.unshift({ $match: { isDeleted: { $ne: true } } });

      const result = await this.model.aggregate(securePipeline).exec();
      return { success: true, data: result };
    } catch (error) {
      return {
        success: false,
        message: `Aggregation failed in ${this.model.modelName}`,
        error: createDatabaseError(
          error,
          "AGGREGATION_ERROR",
          `Aggregation failed in ${this.model.modelName}`,
        ),
      };
    }
  }
}
