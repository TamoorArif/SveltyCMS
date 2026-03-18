/**
 * @file src/hooks/handle-local-sdk.ts
 * @description Injects the database-agnostic SveltyCMS instance into locals
 * for zero-latency, full-stack SvelteKit integration.
 */

import { getDb } from '@src/databases/db';
import type { Handle } from '@sveltejs/kit';

export const handleLocalSdk: Handle = async ({ event, resolve }) => {
	const db = getDb();

	if (db) {
		// Provide a simplified, developer-friendly "Local API" wrapper
		event.locals.cms = {
			find: async (collection: string, options?: any) => {
				return db.crud.findMany(collection, options?.where || {}, {
					limit: options?.limit,
					offset: options?.offset,
					sort: options?.sort,
					populate: options?.populate,
					tenantId: event.locals.tenantId as import('@src/databases/db-interface').DatabaseId
				});
			},
			findOne: async (collection: string, options?: any) => {
				return db.crud.findOne(collection, options?.where || {}, {
					populate: options?.populate,
					tenantId: event.locals.tenantId as import('@src/databases/db-interface').DatabaseId
				});
			},
			create: async (collection: string, data: any) => {
				return db.crud.insert(collection, data, event.locals.tenantId as import('@src/databases/db-interface').DatabaseId);
			},
			update: async (collection: string, id: string, data: any) => {
				return db.crud.update(
					collection,
					id as import('@src/databases/db-interface').DatabaseId,
					data,
					event.locals.tenantId as import('@src/databases/db-interface').DatabaseId
				);
			},
			delete: async (collection: string, id: string) => {
				return db.crud.delete(collection, id as import('@src/databases/db-interface').DatabaseId, { tenantId: event.locals.tenantId });
			},
			// Access to the raw adapter for advanced queries
			db
		};
	}

	return resolve(event);
};
