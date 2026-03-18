/**
 * @file src/databases/webhook-wrapper.ts
 * @description A Smart Proxy wrapper for the Database Adapter to trigger webhooks centrally.
 * This ensures that all mutations (CRUD, Media) trigger the appropriate webhooks
 * regardless of which API route or service initiates the change.
 *
 * IMPORTANT: Uses Proxy instead of object spread to preserve prototype methods
 * (count, findOne, findMany, etc.) on class-based adapter instances.
 */

import type { WebhookEvent } from '@src/services/webhook-service';
import { logger } from '@utils/logger.server';
import type { ICrudAdapter, IDBAdapter, IMediaAdapter } from './db-interface';

// Constants for identifying events
const CONTENT_COLLECTION_PREFIX = 'collection_';

export async function wrapAdapterWithWebhooks(adapter: IDBAdapter): Promise<IDBAdapter> {
	// Dynamically import webhookService to avoid circular dependency with db.ts
	const { webhookService } = await import('@src/services/webhook-service');

	logger.info('🔌 Webhook Proxy Wrapper active on Database Adapter');

	// --- Wrap CRUD Operations (Lazy Access) ---
	let originalCrud: ICrudAdapter | undefined;

	// Check instance first
	if (Object.hasOwn(adapter, 'crud')) {
		originalCrud = adapter.crud;
	} else {
		// Check prototype chain
		let proto = Object.getPrototypeOf(adapter);
		while (proto) {
			const desc = Object.getOwnPropertyDescriptor(proto, 'crud');
			if (desc) {
				if (desc.get) {
					originalCrud = desc.get.call(adapter);
				} else {
					originalCrud = desc.value;
				}
				break;
			}
			proto = Object.getPrototypeOf(proto);
		}
	}

	if (!originalCrud) {
		const internalAdapter = adapter as unknown as Record<string, ICrudAdapter>;
		originalCrud = internalAdapter._crud || internalAdapter._cachedCrud;
	}

	if (originalCrud) {
		const capturedCrud = originalCrud;

		// PERFORMANCE: Define wrapped methods once to avoid thrashing
		const wrappedMethods: Partial<ICrudAdapter> = {
			insert: async (...args) => {
				const res = await capturedCrud.insert(...args);
				const [collection, , tenantId] = args as [string, any, string];
				if (res.success && (collection.startsWith(CONTENT_COLLECTION_PREFIX) || collection === 'MediaItem')) {
					const event: WebhookEvent = collection === 'MediaItem' ? 'media:upload' : 'entry:create';
					webhookService.trigger(event, { collection, data: res.data }, tenantId);
				}
				return res;
			},
			insertMany: async (...args) => {
				const res = await capturedCrud.insertMany(...args);
				const [collection, , tenantId] = args as [string, any[], string];
				if (res.success && collection.startsWith(CONTENT_COLLECTION_PREFIX)) {
					for (const item of res.data) {
						webhookService.trigger('entry:create', { collection, data: item }, tenantId);
					}
				}
				return res;
			},
			update: async (...args) => {
				const res = await capturedCrud.update(...args);
				const [collection, id, data, tenantId] = args as [string, any, any, string];
				if (res.success && collection.startsWith(CONTENT_COLLECTION_PREFIX)) {
					let event: WebhookEvent = 'entry:update';
					if ('status' in (data as any)) {
						if ((data as any).status === 'publish') {
							event = 'entry:publish';
						} else if ((data as any).status === 'unpublish') {
							event = 'entry:unpublish';
						}
					}
					webhookService.trigger(event, { collection, id: id as any, data: res.data }, tenantId);
				}
				return res;
			},
			updateMany: async (...args) => {
				const res = await capturedCrud.updateMany(...args);
				const [collection, query, data, tenantId] = args as [string, any, any, string];
				if (res.success && collection.startsWith(CONTENT_COLLECTION_PREFIX)) {
					webhookService.trigger(
						'entry:update',
						{
							collection,
							query: query as any,
							changes: data as any,
							modifiedCount: res.data.modifiedCount
						},
						tenantId
					);
				}
				return res;
			},
			delete: async (...args) => {
				const res = await capturedCrud.delete(...args);
				const [collection, id, tenantId] = args as [string, any, string];
				if (res.success && (collection.startsWith(CONTENT_COLLECTION_PREFIX) || collection === 'MediaItem')) {
					const event: WebhookEvent = collection === 'MediaItem' ? 'media:delete' : 'entry:delete';
					webhookService.trigger(event, { collection, id: id as any }, tenantId);
				}
				return res;
			},
			deleteMany: async (...args) => {
				const res = await capturedCrud.deleteMany(...args);
				const [collection, query, tenantId] = args as [string, any, string];
				if (res.success && collection.startsWith(CONTENT_COLLECTION_PREFIX)) {
					webhookService.trigger(
						'entry:delete',
						{
							collection,
							query: query as any,
							deletedCount: res.data.deletedCount
						},
						tenantId
					);
				}
				return res;
			},
			upsert: async (...args) => {
				const res = await capturedCrud.upsert(...args);
				const [collection, query, , tenantId] = args as [string, any, any, string];
				if (res.success && collection.startsWith(CONTENT_COLLECTION_PREFIX)) {
					webhookService.trigger('entry:update', { collection, query: query as any, data: res.data }, tenantId);
				}
				return res;
			}
		};

		// PERFORMANCE: Create the proxy exactly once
		const crudProxy = new Proxy(capturedCrud, {
			get(target, prop, receiver) {
				if (typeof prop === 'string' && prop in wrappedMethods) {
					return wrappedMethods[prop as keyof ICrudAdapter];
				}
				const value = Reflect.get(target, prop, receiver);
				return typeof value === 'function' ? value.bind(target) : value;
			}
		});

		Object.defineProperty(adapter, 'crud', {
			get(): ICrudAdapter {
				return crudProxy;
			}
		});
	}

	// --- Wrap Media Operations ---
	let originalMedia: IMediaAdapter | undefined;
	if (Object.hasOwn(adapter, 'media')) {
		originalMedia = adapter.media;
	} else {
		let proto = Object.getPrototypeOf(adapter);
		while (proto) {
			const desc = Object.getOwnPropertyDescriptor(proto, 'media');
			if (desc) {
				if (desc.get) {
					originalMedia = desc.get.call(adapter);
				} else {
					originalMedia = desc.value;
				}
				break;
			}
			proto = Object.getPrototypeOf(proto);
		}
	}

	if (originalMedia) {
		const capturedMedia = originalMedia;
		const originalFiles = capturedMedia.files;

		// PERFORMANCE: Define wrapped files methods once
		const wrappedFiles: Partial<IMediaAdapter['files']> = {
			upload: async (...args) => {
				const res = await originalFiles.upload(...args);
				const [, tenantId] = args as [any, string];
				if (res.success) {
					webhookService.trigger('media:upload', { data: res.data }, tenantId);
				}
				return res;
			},
			uploadMany: async (...args) => {
				const res = await originalFiles.uploadMany(...args);
				const [, tenantId] = args as [any[], string];
				if (res.success) {
					for (const file of res.data) {
						webhookService.trigger('media:upload', { data: file }, tenantId);
					}
				}
				return res;
			},
			delete: async (...args) => {
				const res = await originalFiles.delete(...args);
				const [id, tenantId] = args as [any, string];
				if (res.success) {
					webhookService.trigger('media:delete', { id }, tenantId);
				}
				return res;
			},
			deleteMany: async (...args) => {
				const res = await originalFiles.deleteMany(...args);
				const [ids, tenantId] = args as [any[], string];
				if (res.success) {
					webhookService.trigger('media:delete', { ids }, tenantId);
				}
				return res;
			}
		};

		// PERFORMANCE: Create files proxy once
		const filesProxy = new Proxy(originalFiles, {
			get(fTarget, fProp, fReceiver) {
				if (typeof fProp === 'string' && fProp in wrappedFiles) {
					return wrappedFiles[fProp as keyof IMediaAdapter['files']];
				}
				const fValue = Reflect.get(fTarget, fProp, fReceiver);
				return typeof fValue === 'function' ? fValue.bind(fTarget) : fValue;
			}
		});

		// PERFORMANCE: Create media proxy once
		const mediaProxy = new Proxy(capturedMedia, {
			get(target, prop, receiver) {
				if (prop === 'files') {
					return filesProxy;
				}
				const value = Reflect.get(target, prop, receiver);
				return typeof value === 'function' ? value.bind(target) : value;
			}
		});

		Object.defineProperty(adapter, 'media', {
			get(): IMediaAdapter {
				return mediaProxy;
			}
		});
	}

	return adapter;
}
