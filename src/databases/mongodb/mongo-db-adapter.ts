/**
 * @file src/databases/mongodb/mongo-db-adapter.ts
 * @description MongoDB adapter for SveltyCMS.
 */

import mongoose from "mongoose";
import type { ICrudAdapter, IDBAdapter, DatabaseResult } from "../db-interface";
import { MongoCrudMethods } from "./methods/crud-methods";

export class MongoDBAdapter implements IDBAdapter {
  private _connection: mongoose.Connection | null = null;
  private _models: Map<string, mongoose.Model<any>> = new Map();
  private _repos: Map<string, MongoCrudMethods<any>> = new Map();

  // Domain-Specific Adapters
  auth: any = {};
  content: any = {
    drafts: { restore: (id: any) => this.crud.restore("content_drafts", id) },
    revisions: { restore: (id: any) => this.crud.restore("content_revisions", id) },
  };
  media: any = {
    files: { restore: (id: any, t: any) => this.crud.restore("media", id, { tenantId: t }) },
  };
  system: any = {};
  monitoring: any = {};
  batch: any = {};
  collection: any = {};

  // Implementation of methods
  async connect(): Promise<DatabaseResult<void>> {
    return { success: true, data: undefined };
  }
  async disconnect(): Promise<DatabaseResult<void>> {
    return { success: true, data: undefined };
  }
  isConnected(): boolean {
    return !!this._connection;
  }
  async clearDatabase(): Promise<DatabaseResult<void>> {
    return { success: true, data: undefined };
  }
  getCapabilities(): any {
    return {};
  }
  async getCollectionData(): Promise<any> {
    return { success: true, data: { data: [] } };
  }
  async getConnectionHealth(): Promise<any> {
    return { success: true, data: {} };
  }
  async getMultipleCollectionData(): Promise<any> {
    return { success: true, data: {} };
  }
  queryBuilder(): any {
    return {};
  }
  async transaction(fn: any): Promise<any> {
    return fn({});
  }
  utils: any = {
    generateId: () => "id",
    validateId: () => true,
    normalizePath: (p: string) => p,
    createPagination: (i: any) => ({ items: i, total: i.length }),
  };

  // The actual CRUD adapter
  crud: ICrudAdapter = {} as any;

  constructor() {
    this._init();
  }

  private async _init() {
    this.crud = await this._createCrudAdapter();
  }

  async _createCrudAdapter(): Promise<ICrudAdapter> {
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
      findOne: (c, q, o) => getRepo(c).findOne(q, o as any),
      findMany: (c, q, o) => getRepo(c).findMany(q, o as any),
      insert: (c, d, t, s) =>
        getRepo(c).insert(d as any, { tenantId: t as any, bypassTenantCheck: s }),
      insertMany: (c, d, t, s) =>
        getRepo(c).insertMany(d as any[], { tenantId: t as any, bypassTenantCheck: s }),
      update: (c, id, d, t, s) =>
        getRepo(c).update(id, d as any, { tenantId: t as any, bypassTenantCheck: s }),
      delete: (c, id, o) => getRepo(c).delete(id, o as any),
      findByIds: (c, ids, o) => getRepo(c).findByIds(ids, o as any),
      updateMany: (c, q, d, t, s) =>
        getRepo(c).updateMany(q, d as any, { tenantId: t as any, bypassTenantCheck: s }),
      deleteMany: (c, q, o) => getRepo(c).deleteMany(q, o as any),
      upsert: (c, q, d, t, s) =>
        getRepo(c).upsert(q, d as any, { tenantId: t as any, bypassTenantCheck: s }),
      upsertMany: (c, items, t, s) =>
        getRepo(c).upsertMany(items, { tenantId: t as any, bypassTenantCheck: s }),
      count: (c, q, o) => getRepo(c).count(q || {}, o as any),
      exists: (c, q, o) =>
        getRepo(c)
          .count(q || {}, o as any)
          .then((res: any) => ({ success: true, data: (res.data || 0) > 0 })),
      aggregate: (c, p, t) => getRepo(c).aggregate(p, { tenantId: t as any }),
      restore: (c, id, o) => getRepo(c).restore(id, o as any),
    };
  }

  private _getOrCreateModel(name: string): mongoose.Model<any> {
    if (this._models.has(name)) return this._models.get(name)!;
    const model = mongoose.model(
      name,
      new mongoose.Schema({}, { strict: false, timestamps: true }),
    );
    this._models.set(name, model);
    return model;
  }
}
