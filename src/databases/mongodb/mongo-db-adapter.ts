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
} from "../db-interface";
import { MongoCrudMethods } from "./methods/crud-methods";
import { composeMongoAuthAdapter } from "./methods/auth-composition";

export class MongoDBAdapter implements IDBAdapter {
  private _connection: mongoose.Connection | null = null;
  private _models: Map<string, mongoose.Model<any>> = new Map();
  private _repos: Map<string, MongoCrudMethods<any>> = new Map();

  // Domain-Specific Adapters
  crud: ICrudAdapter;
  auth: IAuthAdapter;
  content: any;
  media: any;
  system: any = {};
  monitoring: any = {};
  batch: any = {};
  collection: any;

  constructor() {
    this.auth = composeMongoAuthAdapter();
    this.crud = this._createCrudMethods();
    this.collection = {}; // Placeholder until ensureCollections is called
    this.content = {
      drafts: { restore: (id: any) => this.crud.restore("content_drafts", id) },
      revisions: { restore: (id: any) => this.crud.restore("content_revisions", id) },
    };
    this.media = {
      files: { restore: (id: any, t: any) => this.crud.restore("media", id, { tenantId: t }) },
    };
  }

  /**
   * Internal helper to create the ICrudAdapter implementation.
   */
  private _createCrudMethods(): ICrudAdapter {
    const getRepo = (coll: string): any => {
      if (this._repos.has(coll)) {
        return this._repos.get(coll)!;
      }

      const model = this._getOrCreateModel(coll);
      const repo = new MongoCrudMethods(model as any);
      this._repos.set(coll, repo);
      return repo;
    };

    return {
      aggregate: (c, p, t) => getRepo(c).aggregate(p, { tenantId: t as any }),
      count: (c, q, o) => getRepo(c).count(q || {}, o as any),
      delete: (c, id, o) => getRepo(c).delete(id, o as any),
      deleteMany: (c, q, o) => getRepo(c).deleteMany(q, o as any),
      exists: (c, q, o) =>
        getRepo(c)
          .count(q || {}, o as any)
          .then((res: any) => ({ success: true, data: (res.data || 0) > 0 })),
      findByIds: (c, ids, o) => getRepo(c).findByIds(ids, o as any),
      findMany: (c, q, o) => getRepo(c).findMany(q, o as any),
      findOne: (c, q, o) => getRepo(c).findOne(q, o as any),
      insert: (c, d, t, s) =>
        getRepo(c).insert(d as any, { tenantId: t as any, bypassTenantCheck: s }),
      insertMany: (c, d, t, s) =>
        getRepo(c).insertMany(d as any[], { tenantId: t as any, bypassTenantCheck: s }),
      restore: (c, id, o) => getRepo(c).restore(id, o as any),
      update: (c, id, d, t, s) =>
        getRepo(c).update(id, d as any, { tenantId: t as any, bypassTenantCheck: s }),
      updateMany: (c, q, d, t, s) =>
        getRepo(c).updateMany(q, d as any, { tenantId: t as any, bypassTenantCheck: s }),
      upsert: (c, q, d, t, s) =>
        getRepo(c).upsert(q, d as any, { tenantId: t as any, bypassTenantCheck: s }),
      upsertMany: (c, items, t, s) =>
        getRepo(c).upsertMany(items, { tenantId: t as any, bypassTenantCheck: s }),
    };
  }

  // Implementation of IDBAdapter methods
  async connect(
    connectionStringOrOptions: string | ConnectionPoolOptions,
    options?: unknown,
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
          const onError = (err: any) => {
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
      await mongoose.connect(connectionString, (options as any) || {});
      this._connection = mongoose.connection;
      return { success: true, data: undefined };
    } catch (err: any) {
      return {
        success: false,
        message: err.message,
        error: {
          code: "DB_CONNECTION_FAILED",
          message: err.message,
          originalCode: err.code || (err as any).originalError?.code,
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

  getCapabilities(): any {
    return {
      maxBatchSize: 1000,
      supportsTransactions: true,
      supportsAggregation: true,
    };
  }

  async getCollectionData(): Promise<any> {
    return { success: true, data: { data: [] } };
  }

  async getConnectionHealth(): Promise<any> {
    return {
      success: true,
      data: {
        status: this.isConnected() ? "healthy" : "disconnected",
        latency: 0,
        pool: {
          total: 1,
          active: this.isConnected() ? 1 : 0,
        },
      },
    };
  }

  async getMultipleCollectionData(): Promise<any> {
    return { success: true, data: {} };
  }

  queryBuilder(): any {
    return {};
  }

  async transaction(fn: any): Promise<any> {
    const session = await mongoose.startSession();
    try {
      session.startTransaction();
      const result = await fn(session);
      await session.commitTransaction();
      return result;
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Initializes system models and methods.
   */
  async ensureSystem(): Promise<void> {
    const { SystemSettingModel, SystemPreferencesModel, ThemeModel, SystemVirtualFolderModel } =
      await import("./models");
    const { MongoSystemMethods } = await import("./methods/system-methods");
    const { MongoThemeMethods } = await import("./methods/theme-methods");

    this.system.preferences = new MongoSystemMethods(SystemPreferencesModel, SystemSettingModel);
    this.system.themes = new MongoThemeMethods(ThemeModel);
    this.system.virtualFolder = {
      ensure: async (data: any) => {
        // Strip timestamps and ID to let Mongoose handle them or avoid conflicts with $setOnInsert
        const { _id, createdAt: _, updatedAt: __, ...rest } = data;
        const result = await SystemVirtualFolderModel.findOneAndUpdate(
          { name: data.name },
          {
            $setOnInsert: {
              ...rest,
              _id: _id || new mongoose.Types.ObjectId().toHexString(),
            },
          },
          { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
        )
          .lean()
          .exec();
        return result;
      },
    };

    // Initialize tenants
    const { TenantModel } = await import("./models/tenant");
    this.system.tenants = {
      create: (t: any) => new TenantModel(t).save().then((r: any) => r.toObject()),
      getById: (id: string) => TenantModel.findById(id).lean().exec(),
      update: (id: string, d: any) =>
        TenantModel.findByIdAndUpdate(id, { $set: d }, { new: true }).lean().exec(),
      delete: (id: string) =>
        TenantModel.findByIdAndDelete(id)
          .exec()
          .then(() => {}),
      list: () => TenantModel.find().lean().exec(),
    };
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
      createModel: (schema: any, force?: boolean) => collectionMethods.createModel(schema, force),
      updateModel: (schema: any) => collectionMethods.updateModel(schema),
      deleteModel: (id: string) => collectionMethods.deleteModel(id),
      getSchema: (name: string, tenantId?: string | null) =>
        collectionMethods.getSchema(name, tenantId),
      getSchemaById: (id: string, tenantId?: string | null) =>
        collectionMethods.getSchemaById(id, tenantId),
      listSchemas: (tenantId?: string | null) => collectionMethods.listSchemas(tenantId),
      getMongooseModel: (id: string) => collectionMethods.getMongooseModel(id),
    };
  }

  /**
   * Initializes media models and methods.
   */
  async ensureMedia(): Promise<void> {
    const { MediaModel } = await import("./models/media");
    const { MongoMediaMethods } = await import("./methods/media-methods");
    this.media.methods = new MongoMediaMethods(MediaModel as any);
  }

  /**
   * Initializes content models and methods.
   */
  async ensureContent(): Promise<void> {
    // Content structure is already handled by generic crud and lazy discriminators
    // but we can add any specific initialization here if needed.
  }

  utils: any = {
    generateId: () => new mongoose.Types.ObjectId().toHexString(),
    validateId: (id: string) => mongoose.Types.ObjectId.isValid(id),
    normalizePath: (p: string) => p,
    createPagination: (i: any) => ({ items: i, total: i.length }),
  };

  private _getOrCreateModel(name: string): mongoose.Model<any> {
    if (this._models.has(name)) return this._models.get(name)!;
    // Check if model already exists in mongoose to avoid OverwriteModelError
    const model =
      mongoose.models[name] ||
      mongoose.model(name, new mongoose.Schema({}, { strict: false, timestamps: true }));
    this._models.set(name, model);
    return model;
  }
}
