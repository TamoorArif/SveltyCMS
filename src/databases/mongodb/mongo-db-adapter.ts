/**
 * @file src/databases/mongodb/mongo-db-adapter.ts
 * @description MongoDB adapter for SveltyCMS.
 */

import mongoose from "mongoose";
import type {
  ICrudAdapter,
  IDBAdapter,
  DatabaseResult,
  IAuthAdapter,
  ConnectionPoolOptions,
  IContentAdapter,
  IMediaAdapter,
  ISystemAdapter,
  IMonitoringAdapter,
  DatabaseId,
  DatabaseError,
  BaseEntity,
  QueryBuilder,
  DatabaseTransaction,
  DatabaseCapabilities,
  Schema,
  PerformanceMetrics,
  QueryFilter,
  BatchOperation,
  BatchResult,
  EntityCreate,
} from "../db-interface";
import { MongoCrudMethods } from "./methods/crud-methods";
import { composeMongoAuthAdapter } from "./methods/auth-composition";
import { MongoQueryBuilder } from "./mongo-query-builder";
import { cacheService } from "@src/databases/cache/cache-service";

export class MongoDBAdapter implements IDBAdapter {
  private _connection: mongoose.Connection | null = null;
  private _models: Map<string, mongoose.Model<any>> = new Map();
  private _repos: Map<string, MongoCrudMethods<any>> = new Map();

  // Domain-Specific Adapters
  crud: ICrudAdapter;
  auth: IAuthAdapter;
  content: IContentAdapter = {} as IContentAdapter;
  media: IMediaAdapter = {} as IMediaAdapter;
  system: ISystemAdapter = {} as ISystemAdapter;
  monitoring: IMonitoringAdapter = {} as IMonitoringAdapter;
  batch: IDBAdapter["batch"] = {
    execute: async <T extends BaseEntity>(
      operations: BatchOperation<T>[],
    ): Promise<DatabaseResult<BatchResult<T>>> => {
      const results: DatabaseResult<T>[] = [];
      let totalProcessed = 0;
      const errors: DatabaseError[] = [];

      for (const op of operations) {
        try {
          let res: DatabaseResult<T | undefined>;
          switch (op.operation) {
            case "insert":
              res = await this.crud.insert(
                op.collection,
                op.data as Omit<T & BaseEntity, "_id" | "createdAt" | "updatedAt">,
              );
              break;
            case "update":
              if (!op.id) throw new Error("ID required for update operation");
              res = await this.crud.update(
                op.collection,
                op.id,
                op.data as Partial<Omit<T & BaseEntity, "_id" | "createdAt" | "updatedAt">>,
              );
              break;
            case "delete":
              if (!op.id) throw new Error("ID required for delete operation");
              res = (await this.crud.delete(op.collection, op.id)) as unknown as DatabaseResult<T>;
              break;
            case "upsert":
              if (!(op.query && op.data)) throw new Error("Query and data required for upsert operation");
              res = await this.crud.upsert(
                op.collection,
                op.query as QueryFilter<T>,
                op.data as Omit<T & BaseEntity, "_id" | "createdAt" | "updatedAt">,
              );
              break;
            default:
              throw new Error(`Unsupported batch operation: ${op.operation}`);
          }
          results.push(res as DatabaseResult<T>);
          if (res.success) {
            totalProcessed++;
          } else {
            errors.push(res.error!);
          }
        } catch (error) {
          const dbError: DatabaseError = {
            code: "BATCH_OP_FAILED",
            message: error instanceof Error ? error.message : String(error),
          };
          results.push({ success: false, message: dbError.message, error: dbError });
          errors.push(dbError);
        }
      }

      return {
        success: errors.length === 0,
        data: { results, totalProcessed, errors, success: errors.length === 0 },
      };
    },

    bulkInsert: async <T extends BaseEntity>(
      collection: string,
      items: EntityCreate<T>[],
    ): Promise<DatabaseResult<T[]>> => {
      try {
        const model = this._getOrCreateModel(collection);
        const docs = await model.insertMany(items as any[]);
        const inserted = Array.isArray(docs)
          ? docs.map((d) => d.toObject?.() ?? d)
          : [];
        return { success: true, data: inserted as T[] };
      } catch (error) {
        return {
          success: false,
          message: error instanceof Error ? error.message : String(error),
          error: { code: "BULK_INSERT_FAILED", message: error instanceof Error ? error.message : String(error) },
        };
      }
    },

    bulkUpdate: async <T extends BaseEntity>(
      collection: string,
      updates: Array<{ id: DatabaseId; data: Partial<T> }>,
    ): Promise<DatabaseResult<{ modifiedCount: number }>> => {
      try {
        const model = this._getOrCreateModel(collection);
        let modifiedCount = 0;
        for (const { id, data } of updates) {
          const result = await model.updateOne(
            { _id: id },
            { $set: { ...data, updatedAt: new Date() } } as any,
          );
          modifiedCount += result.modifiedCount;
        }
        return { success: true, data: { modifiedCount } };
      } catch (error) {
        return {
          success: false,
          message: error instanceof Error ? error.message : String(error),
          error: { code: "BULK_UPDATE_FAILED", message: error instanceof Error ? error.message : String(error) },
        };
      }
    },

    bulkDelete: async (
      collection: string,
      ids: DatabaseId[],
    ): Promise<DatabaseResult<{ deletedCount: number }>> => {
      try {
        const model = this._getOrCreateModel(collection);
        const result = await model.deleteMany({ _id: { $in: ids } });
        return { success: true, data: { deletedCount: result.deletedCount } };
      } catch (error) {
        return {
          success: false,
          message: error instanceof Error ? error.message : String(error),
          error: { code: "BULK_DELETE_FAILED", message: error instanceof Error ? error.message : String(error) },
        };
      }
    },

    bulkUpsert: async <T extends BaseEntity>(
      collection: string,
      items: Array<Partial<T> & { id?: DatabaseId }>,
    ): Promise<DatabaseResult<T[]>> => {
      try {
        const model = this._getOrCreateModel(collection);
        const bulkOps = items.map((item) => ({
          updateOne: {
            filter: item.id ? { _id: item.id } : (item as any),
            update: { $set: item, $setOnInsert: { createdAt: new Date() } },
            upsert: true,
          },
        }));
        await model.bulkWrite(bulkOps);
        return { success: true, data: items as T[] };
      } catch (error) {
        return {
          success: false,
          message: error instanceof Error ? error.message : String(error),
          error: { code: "BULK_UPSERT_FAILED", message: error instanceof Error ? error.message : String(error) },
        };
      }
    },
  };
  collection: IDBAdapter["collection"] = {} as IDBAdapter["collection"];

  constructor() {
    this.auth = composeMongoAuthAdapter();
    this.crud = this._createCrudMethods();

    // Initialize basic content interface (extended in ensureContent)
    this.content = {
      drafts: {
        restore: (id: DatabaseId) => this.crud.restore("content_drafts", id),
      },
      revisions: {
        restore: (id: DatabaseId) => this.crud.restore("content_revisions", id),
      },
    } as unknown as IContentAdapter;

    // Initialize basic media interface (extended in ensureMedia)
    this.media = {
      files: {
        restore: (id: DatabaseId, t: string | null) =>
          this.crud.restore("media", id, { tenantId: t }),
      },
    } as unknown as IMediaAdapter;
  }

  /**
   * Internal helper to create the ICrudAdapter implementation.
   */
  private _createCrudMethods(): ICrudAdapter {
    const getRepo = (coll: string): MongoCrudMethods<any> => {
      if (this._repos.has(coll)) {
        return this._repos.get(coll)!;
      }

      const model = this._getOrCreateModel(coll);
      const repo = new MongoCrudMethods(model);
      this._repos.set(coll, repo);
      return repo;
    };

    return {
      aggregate: (c, p, t) =>
        getRepo(c).aggregate(p as any[], { tenantId: t as string | null } as any) as any,
      count: (c, q, o) => getRepo(c).count(q || {}, o as any),
      delete: (c, id, o) => getRepo(c).delete(id, o as any),
      deleteMany: (c, q, o) => getRepo(c).deleteMany(q as QueryFilter<any>, o as any),
      exists: (c, q, o) =>
        getRepo(c)
          .count(q || {}, o as any)
          .then((res: DatabaseResult<number>) => {
            if (res.success) {
              return { success: true, data: (res.data || 0) > 0 };
            }
            return res as any;
          }),
      findByIds: (c, ids, o) => getRepo(c).findByIds(ids, o as any),
      findMany: (c, q, o) => getRepo(c).findMany(q as QueryFilter<any>, o as any),
      findOne: (c, q, o) => getRepo(c).findOne(q as QueryFilter<any>, o as any),
      insert: (c, d, t, s) => getRepo(c).insert(d as any, t as string | null, s),
      insertMany: (c, d, t, s) => getRepo(c).insertMany(d as any[], t as string | null, s),
      restore: (c, id, o) => getRepo(c).restore(id, o as any) as any,
      update: (c, id, d, t, s) => getRepo(c).update(id, d as any, t as string | null, s),
      updateMany: (c, q, d, t, s) =>
        getRepo(c).updateMany(q as QueryFilter<any>, d as any, t as string | null, s),
      upsert: (c, q, d, t, s) =>
        getRepo(c).upsert(q as QueryFilter<any>, d as any, t as string | null, s),
      upsertMany: (c, items, t, s) => getRepo(c).upsertMany(items as any[], t as string | null, s),
    };
  }

  // Implementation of IDBAdapter methods
  async connect(
    connectionStringOrOptions: string | ConnectionPoolOptions,
    options?: mongoose.ConnectOptions,
  ): Promise<DatabaseResult<void>> {
    try {
      const connectionString =
        typeof connectionStringOrOptions === "string"
          ? connectionStringOrOptions
          : (connectionStringOrOptions as any).connectionString || "";

      // If already connected, just return success
      if (mongoose.connection.readyState === 1) {
        this._connection = mongoose.connection;
        return { success: true, data: undefined };
      }

      // If already connecting, wait for it
      if (mongoose.connection.readyState === 2) {
        await new Promise((resolve, reject) => {
          const onConnected = () => {
            cleanup();
            resolve(true);
          };
          const onError = (err: Error) => {
            cleanup();
            reject(err);
          };
          const cleanup = () => {
            mongoose.connection.removeListener("connected", onConnected);
            mongoose.connection.removeListener("error", onError);
          };
          mongoose.connection.on("connected", onConnected);
          mongoose.connection.on("error", onError);
        });
        this._connection = mongoose.connection;
        return { success: true, data: undefined };
      }

      // Otherwise, initiate new connection
      await mongoose.connect(connectionString, options || {});
      this._connection = mongoose.connection;
      return { success: true, data: undefined };
    } catch (err: any) {
      return {
        success: false,
        message: err.message,
        error: {
          code: "DB_CONNECTION_FAILED",
          message: err.message,
          originalCode: err.code || err.errno || err.originalError?.code,
          details: err,
        },
      };
    }
  }

  async disconnect(): Promise<DatabaseResult<void>> {
    try {
      await mongoose.disconnect();
      this._connection = null;
      return { success: true, data: undefined };
    } catch (err: any) {
      return {
        success: false,
        message: err.message,
        error: { code: "DB_DISCONNECT_FAILED", message: err.message },
      };
    }
  }

  isConnected(): boolean {
    return !!this._connection && mongoose.connection.readyState === 1;
  }

  async clearDatabase(): Promise<DatabaseResult<void>> {
    if (!this.isConnected())
      return {
        success: false,
        message: "Not connected",
        error: { code: "NOT_CONNECTED", message: "Not connected" },
      };
    if (mongoose.connection.db) {
      await mongoose.connection.db.dropDatabase();
    }
    return { success: true, data: undefined };
  }

  getCapabilities(): DatabaseCapabilities {
    return {
      maxBatchSize: 1000,
      supportsTransactions: true,
      supportsAggregation: true,
      maxQueryComplexity: 100,
      supportsFullTextSearch: true,
      supportsIndexing: true,
      supportsPartitioning: false,
      supportsStreaming: true,
    };
  }

  async getCollectionData(
    collectionName: string,
    options?: {
      limit?: number;
      offset?: number;
      fields?: string[];
      sort?: { field: string; direction: "asc" | "desc" };
      filter?: Record<string, unknown>;
      includeMetadata?: boolean;
    },
  ): Promise<
    DatabaseResult<{
      data: unknown[];
      metadata?: { totalCount: number; schema?: unknown; indexes?: string[] };
    }>
  > {
    try {
      const model = this._getOrCreateModel(collectionName);
      let query = model.find(options?.filter || {});

      if (options?.fields) {
        query = query.select(options.fields.join(" "));
      }

      if (options?.sort) {
        query = query.sort({
          [options.sort.field]: options.sort.direction === "asc" ? 1 : -1,
        });
      }

      if (options?.offset) {
        query = query.skip(options.offset);
      }

      if (options?.limit) {
        query = query.limit(options.limit);
      }

      const [data, total] = await Promise.all([
        query.lean().exec(),
        options?.includeMetadata ? model.countDocuments(options?.filter || {}) : Promise.resolve(0),
      ]);

      return {
        success: true,
        data: {
          data: data as unknown[],
          metadata: options?.includeMetadata ? { totalCount: total } : undefined,
        },
      };
    } catch (error: any) {
      return {
        success: false,
        message: `Failed to get collection data for ${collectionName}`,
        error: {
          code: "COLLECTION_DATA_ERROR",
          message: error.message,
        },
      };
    }
  }

  async getConnectionHealth(): Promise<
    DatabaseResult<{
      healthy: boolean;
      latency: number;
      activeConnections: number;
    }>
  > {
    return {
      success: true,
      data: {
        healthy: this.isConnected(),
        latency: 0,
        activeConnections: this.isConnected() ? 1 : 0,
      },
    };
  }

  async getMultipleCollectionData(): Promise<DatabaseResult<Record<string, unknown[]>>> {
    return { success: true, data: {} };
  }

  queryBuilder<T extends BaseEntity>(collection: string): QueryBuilder<T> {
    const model = this._getOrCreateModel(collection);
    return new MongoQueryBuilder<T>(model as any);
  }

  async transaction<T>(
    fn: (transaction: DatabaseTransaction) => Promise<DatabaseResult<T>>,
  ): Promise<DatabaseResult<T>> {
    const session = await mongoose.startSession();
    try {
      session.startTransaction();
      const result = await fn(session as unknown as DatabaseTransaction);
      await session.commitTransaction();
      return result;
    } catch (error) {
      await session.abortTransaction();
      return {
        success: false,
        message: error instanceof Error ? error.message : "Transaction failed",
        error: {
          code: "TRANSACTION_FAILED",
          message: error instanceof Error ? error.message : "Transaction failed",
        },
      };
    } finally {
      session.endSession();
    }
  }

  /**
   * Initializes system models and methods.
   */
  async ensureSystem(): Promise<void> {
    const { SystemSettingModel, SystemPreferencesModel, ThemeModel } = await import("./models");
    const { MongoSystemMethods } = await import("./methods/system-methods");
    const { MongoThemeMethods } = await import("./methods/theme-methods");
    const { MongoSystemVirtualFolderMethods } =
      await import("./methods/system-virtual-folder-methods");
    const { MongoWidgetMethods } = await import("./methods/widget-methods");
    const { WidgetModel } = await import("./models/widget");

    this.system.preferences = new MongoSystemMethods(SystemPreferencesModel, SystemSettingModel);
    this.system.themes = new MongoThemeMethods(ThemeModel) as any;
    this.system.virtualFolder = new MongoSystemVirtualFolderMethods();
    this.system.widgets = new MongoWidgetMethods(WidgetModel) as any;

    // Initialize tenants
    const { TenantModel } = await import("./models/tenant");
    this.system.tenants = {
      create: (t: any) =>
        new TenantModel(t).save().then((r: any) => ({ success: true, data: r.toObject() })),
      getById: (id: DatabaseId) =>
        TenantModel.findById(id)
          .lean()
          .exec()
          .then((r) => ({ success: true, data: r })),
      update: (id: DatabaseId, d: any) =>
        TenantModel.findByIdAndUpdate(id, { $set: d }, { new: true })
          .lean()
          .exec()
          .then((r) => ({ success: true, data: r })),
      delete: (id: DatabaseId) =>
        TenantModel.findByIdAndDelete(id)
          .exec()
          .then(() => ({ success: true, data: undefined })),
      list: () =>
        TenantModel.find()
          .lean()
          .exec()
          .then((r) => ({ success: true, data: r })),
    } as any;

    // Initialize jobs
    const { JobModel } = await import("./models/job");
    this.system.jobs = {
      create: (j: any) => new JobModel(j).save().then((r: any) => r.toObject()),
      getById: (id: string) => JobModel.findById(id).lean().exec() as any,
      update: (id: string, d: any) =>
        JobModel.findByIdAndUpdate(id, { $set: d }, { new: true }).lean().exec() as any,
      delete: (id: string) =>
        JobModel.findByIdAndDelete(id)
          .exec()
          .then(() => {}),
      list: (o: any) => JobModel.find(o).lean().exec() as any,
      count: (f: any) =>
        JobModel.countDocuments(f).then((c) => ({
          success: true,
          data: c,
        })) as any,
    } as any;
  }

  /**
   * Initializes auth models and methods.
   */
  async ensureAuth(): Promise<void> {
    if (this.auth && typeof (this.auth as any).setupAuthModels === "function") {
      await (this.auth as any).setupAuthModels();
    }
  }

  /**
   * Initializes collection models and methods.
   */
  async ensureCollections(): Promise<void> {
    const { MongoCollectionMethods } = await import("./methods/collection-methods");
    const collectionMethods = new MongoCollectionMethods();

    this.collection = {
      getModel: (id: string) => collectionMethods.getModel(id),
      createModel: (schema: Schema, force?: boolean) =>
        collectionMethods.createModel(schema, force),
      updateModel: (schema: Schema) => collectionMethods.updateModel(schema),
      deleteModel: (id: string) => collectionMethods.deleteModel(id),
      getSchema: (name: string, tenantId?: string | null) =>
        collectionMethods.getSchema(name, tenantId).then((r) => ({ success: true, data: r })),
      getSchemaById: (id: string, tenantId?: string | null) =>
        collectionMethods.getSchemaById(id, tenantId).then((r) => ({ success: true, data: r })),
      listSchemas: (tenantId?: string | null) =>
        collectionMethods.listSchemas(tenantId).then((r) => ({ success: true, data: r })),
      getMongooseModel: async (id: string) => collectionMethods.getMongooseModel(id),
    };
  }

  /**
   * Initializes media models and methods.
   */
  async ensureMedia(): Promise<void> {
    const { mediaSchema } = await import("./models/media");
    const { SystemVirtualFolderModel } = await import("./models/system-virtual-folder");
    const { MongoMediaMethods } = await import("./methods/media-methods");

    // Register media model directly
    if (!mongoose.models.media) {
      mongoose.model("media", mediaSchema);
    }

    // Register media_folders model if not already present
    if (!mongoose.models.media_folders) {
      mongoose.model("media_folders", SystemVirtualFolderModel.schema);
    }

    const MediaModel = mongoose.models.media;
    const mediaMethods = new MongoMediaMethods(MediaModel as any);
    const mediaAdapter = {
      files: {
        ...this.media.files,
        upload: (file: any, tenantId?: string | null) =>
          mediaMethods.uploadMany([file], tenantId).then((res) => ({
            ...res,
            data: res.success ? res.data[0] : (undefined as any),
          })),
        uploadMany: mediaMethods.uploadMany.bind(mediaMethods),
        delete: (id: DatabaseId, tenantId?: string | null) =>
          mediaMethods.deleteMany([id], tenantId).then((res) => ({
            ...res,
            data: undefined,
          })),
        deleteMany: mediaMethods.deleteMany.bind(mediaMethods),
        getMetadata: mediaMethods.getMetadata.bind(mediaMethods),
        updateMetadata: mediaMethods.updateMetadata.bind(mediaMethods),
        move: mediaMethods.move.bind(mediaMethods),
        duplicate: mediaMethods.duplicate.bind(mediaMethods),
        getByFolder: mediaMethods.getFiles.bind(mediaMethods),
        search: (query: string, options?: any, tenantId?: string | null) =>
          mediaMethods.getFiles(undefined, { ...options, search: query }, false, tenantId),
      },
      folders: {
        getTree: (_maxDepth?: number, tenantId?: string | null) =>
          mediaMethods.getFolders(undefined, tenantId),
        getFolderContents: mediaMethods.getFolders.bind(mediaMethods),
        // Placeholder methods for other folder operations
        create: (_folder: any) => Promise.resolve({ success: true, data: {} as any }),
        createMany: (_folders: any) => Promise.resolve({ success: true, data: [] }),
        delete: (_id: any) => Promise.resolve({ success: true, data: undefined }),
        deleteMany: (_ids: any) => Promise.resolve({ success: true, data: { deletedCount: 0 } }),
        move: (_id: any, _target: any) => Promise.resolve({ success: true, data: {} as any }),
      },
      setupMediaModels: () => Promise.resolve(),
    } as unknown as IMediaAdapter;

    this.media = mediaAdapter;
  }

  /**
   * Initializes content models and methods.
   */
  async ensureContent(): Promise<void> {
    const { MongoContentMethods } = await import("./methods/content-methods");

    // Nodes Repo
    const nodeModel = this._getOrCreateModel("system_content_structure");
    const nodesRepo = new MongoCrudMethods(nodeModel);

    // Drafts Repo
    const draftModel = this._getOrCreateModel("content_drafts");
    const draftsRepo = new MongoCrudMethods(draftModel);

    // Revisions Repo
    const revisionModel = this._getOrCreateModel("content_revisions");
    const revisionsRepo = new MongoCrudMethods(revisionModel);

    const contentMethods = new MongoContentMethods(nodesRepo, draftsRepo, revisionsRepo);

    this.content = {
      ...this.content,
      nodes: {
        getStructure: contentMethods.getStructure.bind(contentMethods),
        create: (n: any) => contentMethods.upsertNodeByPath(n),
        createMany: (_n: any) => Promise.resolve({ success: true, data: [] }), // Placeholder
        update: (_p: any, _c: any) => Promise.resolve({ success: true, data: {} as any }), // Placeholder
        delete: (path: string) => contentMethods.deleteNodeByPath(path),
        deleteMany: (paths: string[], options?: { tenantId?: string | null }) =>
          contentMethods.deleteNodesByPaths(paths, options),
        bulkUpdate: contentMethods.bulkUpdateNodes.bind(contentMethods),
        reorderStructure: contentMethods.reorderStructure.bind(contentMethods),
      },
      drafts: {
        ...this.content.drafts,
        create: contentMethods.createDraft.bind(contentMethods),
        getForContent: contentMethods.getDraftsForContent.bind(contentMethods),
        publishMany: contentMethods.publishManyDrafts.bind(contentMethods),
      },
      revisions: {
        ...this.content.revisions,
        create: contentMethods.createRevision.bind(contentMethods),
        getHistory: contentMethods.getRevisionHistory.bind(contentMethods),
        cleanup: contentMethods.cleanupRevisions.bind(contentMethods),
      },
    } as unknown as IContentAdapter;
  }

  /**
   * Initializes monitoring models and methods.
   */
  async ensureMonitoring(): Promise<void> {
    this.monitoring = {
      cache: {
        get: (key: string, tenantId?: string | null) =>
          cacheService.get(key, tenantId).then((data) => ({ success: true, data })),
        set: (key: string, value: any, options?: any) =>
          cacheService
            .set(key, value, options?.ttl || 300, options?.tenantId, options?.category)
            .then(() => ({ success: true, data: undefined })),
        delete: (key: string, tenantId?: string | null) =>
          cacheService.delete(key, tenantId).then(() => ({ success: true, data: undefined })),
        clear: (tags?: string[], tenantId?: string | null) =>
          (tags
            ? cacheService.clearByTags(tags, tenantId)
            : cacheService.invalidateAll(tenantId)
          ).then(() => ({ success: true, data: undefined })),
        invalidateCollection: (collection: string, tenantId?: string | null) =>
          cacheService
            .clearByPattern(`collection:${collection}:*`, tenantId)
            .then(() => ({ success: true, data: undefined })),
        invalidateCategory: (category: string, tenantId?: string | null) =>
          cacheService
            .clearByPattern(`*:${category}:*`, tenantId || "*")
            .then(() => ({ success: true, data: undefined })),
      },
      performance: {
        getMetrics: () => Promise.resolve({ success: true, data: {} as PerformanceMetrics }),
        clearMetrics: () => Promise.resolve({ success: true, data: undefined }),
        enableProfiling: () => Promise.resolve({ success: true, data: undefined }),
        getSlowQueries: () => Promise.resolve({ success: true, data: [] }),
      },
    } as IMonitoringAdapter;
  }

  utils = {
    generateId: () => new mongoose.Types.ObjectId().toHexString(),
    validateId: (id: string) => mongoose.Types.ObjectId.isValid(id),
    normalizePath: (p: string) => p,
    createPagination: <T>(items: T[]) => ({
      items: items,
      total: items.length,
    }),
  } as any;

  private _getOrCreateModel(name: string): mongoose.Model<any> {
    if (this._models.has(name)) return this._models.get(name)!;
    // CRITICAL: Use String for _id to support UUIDs and prevent Cast to ObjectId errors
    const schema = new mongoose.Schema({ _id: String }, { strict: false, timestamps: true });
    const model = mongoose.models[name] || mongoose.model(name, schema);
    this._models.set(name, model);
    return model;
  }
}
