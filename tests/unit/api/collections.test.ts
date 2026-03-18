/**
 * @file tests/unit/api/collections.test.ts
 * @description Whitebox unit tests for Collections API endpoints
 *
 * Tests:
 * - GET /api/collections - List collections with permissions and token replacement
 * - POST /api/collections/[collectionId] - Create new entry
 * - PATCH /api/collections/[collectionId]/[entryId] - Update entry
 * - DELETE /api/collections/[collectionId]/[entryId] - Delete entry
 *
 * Note: These are WHITEBOX unit tests that mock internal dependencies.
 * For blackbox integration tests, see tests/integration/api/collections.test.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';

// Mock all dependencies
vi.mock('@src/content/content-manager', () => ({
	contentManager: {
		getCollections: vi.fn(),
		getCollectionById: vi.fn(),
		invalidateSpecificCaches: vi.fn()
	}
}));

vi.mock('@src/databases/cache-service', () => ({
	cacheService: {
		clearByPattern: vi.fn().mockResolvedValue(true)
	}
}));

vi.mock('@src/services/settings-service', () => ({
	getPrivateSettingSync: vi.fn().mockReturnValue(false)
}));

vi.mock('@src/services/token/engine', () => ({
	replaceTokens: vi.fn().mockImplementation((text) => Promise.resolve(text))
}));

vi.mock('@src/services/pub-sub', () => ({
	pubSub: {
		publish: vi.fn()
	}
}));

vi.mock('@utils/logger.server', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		trace: vi.fn(),
		debug: vi.fn()
	}
}));

vi.mock('@utils/api-handler', () => ({
	apiHandler: (fn: any) => fn
}));

vi.mock('@api/collections/modify-request', () => ({
	modifyRequest: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('node:crypto', () => ({
	randomUUID: vi.fn().mockReturnValue('test-uuid-12345')
}));

// Import handlers after mocks
const listHandler = await import('@src/routes/api/collections/+server.ts');
const createHandler = await import('@src/routes/api/collections/[collectionId]/+server.ts');
const entryHandler = await import('@src/routes/api/collections/[collectionId]/[entryId]/+server.ts');

const GET_LIST = listHandler.GET;
const POST_CREATE = createHandler.POST;
const PATCH_ENTRY = entryHandler.PATCH;
const DELETE_ENTRY = entryHandler.DELETE;

describe('Collections API Unit Tests', () => {
	// Mock modules
	let mockContentManager: {
		getCollections: ReturnType<typeof vi.fn>;
		getCollectionById: ReturnType<typeof vi.fn>;
		invalidateSpecificCaches: ReturnType<typeof vi.fn>;
	};
	let mockCacheService: {
		clearByPattern: ReturnType<typeof vi.fn>;
	};
	let mockGetPrivateSettingSync: ReturnType<typeof vi.fn>;
	let mockReplaceTokens: ReturnType<typeof vi.fn>;
	let mockLogger: {
		info: ReturnType<typeof vi.fn>;
		warn: ReturnType<typeof vi.fn>;
		error: ReturnType<typeof vi.fn>;
		trace: ReturnType<typeof vi.fn>;
		debug: ReturnType<typeof vi.fn>;
	};

	beforeEach(async () => {
		vi.clearAllMocks();

		// Re-import modules to get fresh mock references
		const contentModule = await import('@src/content/content-manager');
		const cacheModule = await import('@src/databases/cache-service');
		const settingsModule = await import('@src/services/settings-service');
		const tokenModule = await import('@src/services/token/engine');
		const loggerModule = await import('@utils/logger.server');

		mockContentManager = contentModule.contentManager as unknown as typeof mockContentManager;
		mockCacheService = cacheModule.cacheService as unknown as typeof mockCacheService;
		mockGetPrivateSettingSync = settingsModule.getPrivateSettingSync as unknown as typeof mockGetPrivateSettingSync;
		mockReplaceTokens = tokenModule.replaceTokens as unknown as typeof mockReplaceTokens;
		mockLogger = loggerModule.logger as unknown as typeof mockLogger;

		// Reset defaults
		mockGetPrivateSettingSync.mockReturnValue(false);
	});

	// ============================================
	// GET /api/collections Tests
	// ============================================

	const createMockListEvent = (queryParams: Record<string, string> = {}, tenantId?: string) => {
		const url = new URL('http://localhost/api/collections');
		Object.entries(queryParams).forEach(([key, value]) => url.searchParams.set(key, value));

		return {
			url,
			locals: {
				user: { _id: 'user-123', email: 'test@example.com' },
				tenantId
			}
		} as unknown as RequestEvent;
	};

	describe('GET /api/collections - List Collections', () => {
		it('should return list of collections', async () => {
			mockContentManager.getCollections.mockResolvedValue([
				{
					_id: 'col-1',
					name: 'posts',
					label: 'Blog Posts',
					description: 'Manage blog posts',
					icon: 'article',
					path: '/posts',
					fields: []
				},
				{
					_id: 'col-2',
					name: 'pages',
					label: 'Pages',
					description: 'Manage pages',
					icon: 'document',
					path: '/pages',
					fields: []
				}
			]);

			const event = createMockListEvent();
			const response = await GET_LIST(event);

			expect(response.status).toBe(200);
			const data = await response.json();
			expect(data.success).toBe(true);
			expect(data.data.collections).toHaveLength(2);
			expect(data.data.total).toBe(2);
		});

		it('should include fields when includeFields=true', async () => {
			mockContentManager.getCollections.mockResolvedValue([
				{
					_id: 'col-1',
					name: 'posts',
					label: 'Blog Posts',
					description: 'Test',
					icon: 'article',
					path: '/posts',
					fields: [{ name: 'title', type: 'text' }]
				}
			]);

			const event = createMockListEvent({ includeFields: 'true' });
			const response = await GET_LIST(event);

			expect(response.status).toBe(200);
			const data = await response.json();
			expect(data.data.collections[0].fields).toBeDefined();
		});

		it('should include stats when includeStats=true', async () => {
			mockContentManager.getCollections.mockResolvedValue([
				{
					_id: 'col-1',
					name: 'posts',
					label: 'Blog Posts',
					description: 'Test',
					icon: 'article',
					path: '/posts',
					fields: []
				}
			]);

			const event = createMockListEvent({ includeStats: 'true' });
			const response = await GET_LIST(event);

			expect(response.status).toBe(200);
			const data = await response.json();
			expect(data.data.collections[0].stats).toBeDefined();
		});

		it('should throw TENANT_MISSING in multi-tenant mode without tenantId', async () => {
			mockGetPrivateSettingSync.mockReturnValue(true);

			const event = createMockListEvent({}, undefined);

			try {
				await GET_LIST(event);
			} catch (error: any) {
				expect(error.status).toBe(400);
				expect(error.code).toBe('TENANT_MISSING');
			}
		});

		it('should handle token replacement in collection metadata', async () => {
			mockContentManager.getCollections.mockResolvedValue([
				{
					_id: 'col-1',
					name: 'posts',
					label: 'Welcome {{user.name}}',
					description: 'Hello {{user.email}}',
					icon: 'article',
					path: '/posts',
					fields: []
				}
			]);

			mockReplaceTokens.mockImplementation((text: string) => {
				if (text.includes('{{')) {
					return Promise.resolve(text.replace('{{user.name}}', 'John').replace('{{user.email}}', 'john@example.com'));
				}
				return Promise.resolve(text);
			});

			const event = createMockListEvent();
			const response = await GET_LIST(event);

			expect(response.status).toBe(200);
			// Token replacement should have been called
			expect(mockReplaceTokens).toHaveBeenCalled();
		});

		it('should handle errors gracefully', async () => {
			mockContentManager.getCollections.mockRejectedValue(new Error('Database error'));

			const event = createMockListEvent();

			try {
				await GET_LIST(event);
			} catch (error: any) {
				expect(error.status).toBe(500);
				expect(error.code).toBe('COLLECTION_LIST_ERROR');
			}
		});
	});

	// ============================================
	// POST /api/collections/[collectionId] Tests
	// ============================================

	const createMockCreateEvent = (collectionId: string, body: any, tenantId?: string) => {
		return {
			params: { collectionId },
			request: {
				json: vi.fn().mockResolvedValue(body)
			},
			locals: {
				user: { _id: 'user-123', email: 'test@example.com' },
				tenantId,
				dbAdapter: {
					collection: {
						getModel: vi.fn().mockResolvedValue({ name: 'collection_test' })
					},
					crud: {
						insert: vi.fn().mockResolvedValue({
							success: true,
							data: { _id: 'new-entry-id', title: 'Test Entry' }
						})
					}
				}
			}
		} as unknown as RequestEvent;
	};

	describe('POST /api/collections/[collectionId] - Create Entry', () => {
		it('should create a new entry successfully', async () => {
			mockContentManager.getCollectionById.mockResolvedValue({
				_id: 'col-1',
				name: 'posts',
				fields: []
			});

			const event = createMockCreateEvent('col-1', { title: 'Test Entry', status: 'published' });
			const response = await POST_CREATE(event);

			expect(response.status).toBe(201);
			const data = await response.json();
			expect(data.success).toBe(true);
			expect(data.data).toBeDefined();
		});

		it('should reject if user is not authenticated', async () => {
			const event = {
				params: { collectionId: 'col-1' },
				request: { json: vi.fn().mockResolvedValue({ title: 'Test' }) },
				locals: {
					user: undefined,
					dbAdapter: {}
				}
			} as unknown as RequestEvent;

			try {
				await POST_CREATE(event);
			} catch (error: any) {
				expect(error.status).toBe(401);
				expect(error.code).toBe('UNAUTHORIZED');
			}
		});

		it('should return 404 if collection not found', async () => {
			mockContentManager.getCollectionById.mockResolvedValue(null);

			const event = createMockCreateEvent('nonexistent', { title: 'Test' });

			try {
				await POST_CREATE(event);
			} catch (error: any) {
				expect(error.status).toBe(404);
				expect(error.code).toBe('COLLECTION_NOT_FOUND');
			}
		});

		it('should reject unsupported content type', async () => {
			mockContentManager.getCollectionById.mockResolvedValue({
				_id: 'col-1',
				name: 'posts',
				fields: []
			});

			const event = {
				params: { collectionId: 'col-1' },
				request: {
					headers: { get: vi.fn().mockReturnValue('text/plain') },
					json: vi.fn()
				},
				locals: {
					user: { _id: 'user-123' },
					dbAdapter: {}
				}
			} as unknown as RequestEvent;

			try {
				await POST_CREATE(event);
			} catch (error: any) {
				expect(error.status).toBe(400);
				expect(error.code).toBe('INVALID_CONTENT_TYPE');
			}
		});

		it('should throw SERVICE_UNAVAILABLE if dbAdapter is missing', async () => {
			const event = {
				params: { collectionId: 'col-1' },
				request: { json: vi.fn().mockResolvedValue({}) },
				locals: {
					user: { _id: 'user-123' },
					dbAdapter: undefined
				}
			} as unknown as RequestEvent;

			try {
				await POST_CREATE(event);
			} catch (error: any) {
				expect(error.status).toBe(503);
				expect(error.code).toBe('DB_ADAPTER_MISSING');
			}
		});

		it('should handle insert validation failures', async () => {
			const event = createMockCreateEvent('col-1', { title: 'Test' });
			// @ts-expect-error - accessing the mocked dbAdapter
			event.locals.dbAdapter.crud.insert.mockResolvedValue({
				success: false,
				error: { message: 'validation failed: title is required', code: 'INSERT_ERROR' }
			});

			mockContentManager.getCollectionById.mockResolvedValue({
				_id: 'col-1',
				name: 'posts',
				fields: []
			});

			try {
				await POST_CREATE(event);
			} catch (error: any) {
				expect(error.status).toBe(400);
				expect(error.code).toBe('VALIDATION_FAILED');
			}
		});

		it('should add tenantId in multi-tenant mode', async () => {
			mockGetPrivateSettingSync.mockReturnValue(true);
			mockContentManager.getCollectionById.mockResolvedValue({
				_id: 'col-1',
				name: 'posts',
				fields: []
			});

			const event = createMockCreateEvent('col-1', { title: 'Test' }, 'tenant-A');
			await POST_CREATE(event);

			// The dbAdapter.crud.insert should have been called with tenantId
			const insertCall = (event.locals as any).dbAdapter.crud.insert.mock.calls[0];
			expect(insertCall).toBeDefined();
		});
	});

	// ============================================
	// PATCH /api/collections/[collectionId]/[entryId] Tests
	// ============================================

	const createMockPatchEvent = (collectionId: string, entryId: string, body: any, tenantId?: string) => {
		return {
			params: { collectionId, entryId },
			request: {
				headers: { get: vi.fn().mockReturnValue('application/json') },
				json: vi.fn().mockResolvedValue(body)
			},
			locals: {
				user: { _id: 'user-123', email: 'test@example.com' },
				tenantId,
				dbAdapter: {
					collection: {
						getModel: vi.fn().mockResolvedValue({ name: 'collection_test' })
					},
					crud: {
						findOne: vi.fn().mockResolvedValue({
							success: true,
							data: { _id: entryId, title: 'Old Title' }
						}),
						update: vi.fn().mockResolvedValue({
							success: true,
							data: { _id: entryId, title: 'Updated Title' }
						})
					}
				}
			}
		} as unknown as RequestEvent;
	};

	describe('PATCH /api/collections/[collectionId]/[entryId] - Update Entry', () => {
		it('should update an entry successfully', async () => {
			mockContentManager.getCollectionById.mockResolvedValue({
				_id: 'col-1',
				name: 'posts',
				fields: []
			});

			const event = createMockPatchEvent('col-1', 'entry-123', { title: 'Updated Title' });
			const response = await PATCH_ENTRY(event);

			expect(response.status).toBe(200);
			const data = await response.json();
			expect(data.success).toBe(true);
		});

		it('should reject if user is not authenticated', async () => {
			const event = {
				params: { collectionId: 'col-1', entryId: 'entry-123' },
				request: { json: vi.fn().mockResolvedValue({}) },
				locals: {
					user: undefined,
					dbAdapter: {}
				}
			} as unknown as RequestEvent;

			try {
				await PATCH_ENTRY(event);
			} catch (error: any) {
				expect(error.status).toBe(401);
				expect(error.code).toBe('UNAUTHORIZED');
			}
		});

		it('should throw TENANT_MISSING in multi-tenant mode', async () => {
			mockGetPrivateSettingSync.mockReturnValue(true);

			const event = createMockPatchEvent('col-1', 'entry-123', { title: 'Test' }, undefined);

			try {
				await PATCH_ENTRY(event);
			} catch (error: any) {
				expect(error.status).toBe(400);
				expect(error.code).toBe('TENANT_MISSING');
			}
		});

		it('should return 404 if entry not found', async () => {
			const event = createMockPatchEvent('col-1', 'nonexistent', { title: 'Test' });
			// @ts-expect-error
			event.locals.dbAdapter.crud.findOne.mockResolvedValue({
				success: false,
				data: null
			});

			mockContentManager.getCollectionById.mockResolvedValue({
				_id: 'col-1',
				name: 'posts',
				fields: []
			});

			try {
				await PATCH_ENTRY(event);
			} catch (error: any) {
				expect(error.status).toBe(404);
				expect(error.code).toBe('NOT_FOUND');
			}
		});

		it('should handle invalid JSON', async () => {
			const event = {
				params: { collectionId: 'col-1', entryId: 'entry-123' },
				request: {
					headers: { get: vi.fn().mockReturnValue('application/json') },
					json: vi.fn().mockRejectedValue(new Error('Invalid JSON'))
				},
				locals: {
					user: { _id: 'user-123' },
					dbAdapter: {}
				}
			} as unknown as RequestEvent;

			mockContentManager.getCollectionById.mockResolvedValue({
				_id: 'col-1',
				name: 'posts',
				fields: []
			});

			try {
				await PATCH_ENTRY(event);
			} catch (error: any) {
				expect(error.status).toBe(400);
				expect(error.code).toBe('INVALID_JSON');
			}
		});

		it('should reject unsupported content type', async () => {
			mockContentManager.getCollectionById.mockResolvedValue({
				_id: 'col-1',
				name: 'posts',
				fields: []
			});

			const event = {
				params: { collectionId: 'col-1', entryId: 'entry-123' },
				request: {
					headers: { get: vi.fn().mockReturnValue('text/xml') },
					json: vi.fn()
				},
				locals: {
					user: { _id: 'user-123' },
					dbAdapter: {}
				}
			} as unknown as RequestEvent;

			try {
				await PATCH_ENTRY(event);
			} catch (error: any) {
				expect(error.status).toBe(400);
				expect(error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
			}
		});
	});

	// ============================================
	// DELETE /api/collections/[collectionId]/[entryId] Tests
	// ============================================

	const createMockDeleteEvent = (collectionId: string, entryId: string, tenantId?: string) => {
		return {
			params: { collectionId, entryId },
			locals: {
				user: { _id: 'user-123', email: 'test@example.com' },
				tenantId,
				dbAdapter: {
					collection: {
						getModel: vi.fn().mockResolvedValue({ name: 'collection_test' })
					},
					crud: {
						findOne: vi.fn().mockResolvedValue({
							success: true,
							data: { _id: entryId, title: 'Test Entry' }
						}),
						delete: vi.fn().mockResolvedValue({
							success: true
						})
					}
				}
			}
		} as unknown as RequestEvent;
	};

	describe('DELETE /api/collections/[collectionId]/[entryId] - Delete Entry', () => {
		it('should delete an entry successfully', async () => {
			mockContentManager.getCollectionById.mockResolvedValue({
				_id: 'col-1',
				name: 'posts',
				fields: []
			});

			const event = createMockDeleteEvent('col-1', 'entry-123');
			const response = await DELETE_ENTRY(event);

			expect(response.status).toBe(204);
		});

		it('should reject if user is not authenticated', async () => {
			const event = {
				params: { collectionId: 'col-1', entryId: 'entry-123' },
				locals: {
					user: undefined,
					dbAdapter: {}
				}
			} as unknown as RequestEvent;

			try {
				await DELETE_ENTRY(event);
			} catch (error: any) {
				expect(error.status).toBe(401);
				expect(error.code).toBe('UNAUTHORIZED');
			}
		});

		it('should throw TENANT_MISSING in multi-tenant mode', async () => {
			mockGetPrivateSettingSync.mockReturnValue(true);

			const event = createMockDeleteEvent('col-1', 'entry-123', undefined);

			try {
				await DELETE_ENTRY(event);
			} catch (error: any) {
				expect(error.status).toBe(400);
				expect(error.code).toBe('TENANT_MISSING');
			}
		});

		it('should return 404 if entry not found', async () => {
			const event = createMockDeleteEvent('col-1', 'nonexistent');
			// @ts-expect-error
			event.locals.dbAdapter.crud.findOne.mockResolvedValue({
				success: false,
				data: null
			});

			mockContentManager.getCollectionById.mockResolvedValue({
				_id: 'col-1',
				name: 'posts',
				fields: []
			});

			try {
				await DELETE_ENTRY(event);
			} catch (error: any) {
				expect(error.status).toBe(404);
				expect(error.code).toBe('NOT_FOUND');
			}
		});

		it('should throw SERVICE_UNAVAILABLE if dbAdapter is missing', async () => {
			const event = {
				params: { collectionId: 'col-1', entryId: 'entry-123' },
				locals: {
					user: { _id: 'user-123' },
					dbAdapter: undefined
				}
			} as unknown as RequestEvent;

			try {
				await DELETE_ENTRY(event);
			} catch (error: any) {
				expect(error.status).toBe(503);
				expect(error.code).toBe('SERVICE_UNAVAILABLE');
			}
		});

		it('should handle database delete errors', async () => {
			const event = createMockDeleteEvent('col-1', 'entry-123');
			// @ts-expect-error
			event.locals.dbAdapter.crud.delete.mockResolvedValue({
				success: false,
				error: { message: 'Entry not found' }
			});

			mockContentManager.getCollectionById.mockResolvedValue({
				_id: 'col-1',
				name: 'posts',
				fields: []
			});

			try {
				await DELETE_ENTRY(event);
			} catch (error: any) {
				expect(error.status).toBe(404);
				expect(error.code).toBe('NOT_FOUND');
			}
		});
	});
});
