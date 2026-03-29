/**
 * @file src/hooks/handle-local-sdk.ts
 * @description Injects the database-agnostic SveltyCMS instance into locals
 * for zero-latency, full-stack SvelteKit integration.
 */

import { LocalCMS } from "@src/api/local/cms";
import type { Handle } from "@sveltejs/kit";

export const handleLocalSdk: Handle = async ({ event, resolve }) => {
  const db = event.locals.dbAdapter;

  if (db) {
    const localCms = new LocalCMS(db);

    // Inject high-performance Local API into locals
    event.locals.cms = {
      // Find entries with filters
      find: (collection: string, options?: any) =>
        localCms.find(collection, {
          ...options,
          tenantId: event.locals.tenantId,
          user: event.locals.user,
        }),

      // Find one entry by ID
      findById: (collection: string, id: string, options?: any) =>
        localCms.findById(collection, id, {
          ...options,
          tenantId: event.locals.tenantId,
          user: event.locals.user,
        }),

      // Create entry (with widget logic + cache + pubsub)
      create: (collection: string, data: any, options?: any) =>
        localCms.create(collection, data, {
          ...options,
          tenantId: event.locals.tenantId,
          user: event.locals.user,
        }),

      // Update entry (with widget logic + cache + pubsub)
      update: (collection: string, id: string, data: any, options?: any) =>
        localCms.update(collection, id, data, {
          ...options,
          tenantId: event.locals.tenantId,
          user: event.locals.user,
        }),

      // Delete entry (with cache + pubsub)
      delete: (collection: string, id: string, options?: any) =>
        localCms.delete(collection, id, {
          ...options,
          tenantId: event.locals.tenantId,
          user: event.locals.user,
          permanent: options?.permanent,
        }),

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
