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

      // Media
      media: localCms.media,

      // Widgets
      widgets: localCms.widgets,

      // System
      system: localCms.system,

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
