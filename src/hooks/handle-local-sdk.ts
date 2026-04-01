/**
 * @file src/hooks/handle-local-sdk.ts
 * @description Injects the database-agnostic SveltyCMS instance into locals
 * for zero-latency, full-stack SvelteKit integration.
 */

import { LocalCMS } from "@src/routes/api/cms";
import type { Handle } from "@sveltejs/kit";

export const handleLocalSdk: Handle = async ({ event, resolve }) => {
  const db = event.locals.dbAdapter;

  if (db) {
    const localCms = new LocalCMS(db);

    // Inject high-performance Local API into locals
    event.locals.cms = {
      // Authentication
      auth: localCms.auth,

      // Collections
      find: (collection: string, options?: any) =>
        localCms.collections.find(collection, {
          ...options,
          tenantId: event.locals.tenantId,
          user: event.locals.user,
        }),

      // Find one entry by ID
      findById: (collection: string, id: string, options?: any) =>
        localCms.collections.findById(collection, id, {
          ...options,
          tenantId: event.locals.tenantId,
          user: event.locals.user,
        }),

      // Create entry (with widget logic + cache + pubsub)
      create: (collection: string, data: any, options?: any) =>
        localCms.collections.create(collection, data, {
          ...options,
          tenantId: event.locals.tenantId,
          user: event.locals.user,
        }),

      // Update entry (with widget logic + cache + pubsub)
      update: (collection: string, id: string, data: any, options?: any) =>
        localCms.collections.update(collection, id, data, {
          ...options,
          tenantId: event.locals.tenantId,
          user: event.locals.user,
        }),

      // Delete entry (with cache + pubsub)
      delete: (collection: string, id: string, options?: any) =>
        localCms.collections.delete(collection, id, {
          ...options,
          tenantId: event.locals.tenantId,
          user: event.locals.user,
          permanent: options?.permanent,
        }),

      // Bulk Operations
      bulkCreate: (collection: string, data: any[], options?: any) =>
        localCms.collections.bulkCreate(collection, data, {
          ...options,
          tenantId: event.locals.tenantId,
          user: event.locals.user,
        }),

      bulkUpdate: (collection: string, updates: any[], options?: any) =>
        localCms.collections.bulkUpdate(collection, updates, {
          ...options,
          tenantId: event.locals.tenantId,
          user: event.locals.user,
        }),

      bulkDelete: (collection: string, ids: string[], options?: any) =>
        localCms.collections.bulkDelete(collection, ids, {
          ...options,
          tenantId: event.locals.tenantId,
          user: event.locals.user,
        }),

      // Advanced Querying
      queryBuilder: (collection: string, options?: any) =>
        localCms.collections.queryBuilder(collection, {
          ...options,
          tenantId: event.locals.tenantId,
        }),

      transaction: (fn: any, options?: any) => localCms.transaction(fn, options),

      // Media
      media: {
        find: (options?: any) =>
          localCms.media.find({
            ...options,
            tenantId: event.locals.tenantId,
          }),
        findById: (id: string, options?: any) =>
          localCms.media.findById(id, {
            ...options,
            tenantId: event.locals.tenantId,
          }),
        upload: (file: File, options?: any) =>
          localCms.media.upload(file, {
            ...options,
            userId: event.locals.user?._id,
            tenantId: event.locals.tenantId,
          }),
        update: (id: string, data: any) => localCms.media.update(id, data, event.locals.tenantId),
        delete: (id: string) => localCms.media.delete(id, { tenantId: event.locals.tenantId }),
      },

      // Widgets
      widgets: {
        list: () => localCms.widgets.list(event.locals.tenantId || "default-tenant"),
        activate: (id: string) => localCms.widgets.activate(id),
        deactivate: (id: string) => localCms.widgets.deactivate(id),
      },

      // System
      system: {
        getHealth: () => localCms.system.getHealth(),
        getPreferences: (keys: string[], options?: any) =>
          localCms.system.getPreferences(keys, {
            ...options,
            userId: event.locals.user?._id,
          }),
        setPreference: (key: string, value: any, options?: any) =>
          localCms.system.setPreference(key, value, {
            ...options,
            userId: event.locals.user?._id,
          }),
        sendMail: (params: any) => localCms.system.sendMail(params),
      },

      // Context bag for hooks to identify "local" calls
      context: {
        isLocal: true,
        tenantId: event.locals.tenantId,
        user: event.locals.user,
      },

      // Raw access for edge cases
      db,
    };
  }

  return resolve(event);
};
