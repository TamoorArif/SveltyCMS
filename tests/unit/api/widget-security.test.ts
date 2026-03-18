/**
 * @file tests/unit/api/widget-security.test.ts
 * @description Unit tests for Widget API security, focusing on IDOR and tenant isolation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET as getActive } from '@src/routes/api/widgets/active/+server';
import { GET as getInstalled } from '@src/routes/api/widgets/installed/+server';
import { POST as updateStatus } from '@src/routes/api/widgets/status/+server';
import { GET as validateWidgets } from '@src/routes/api/widgets/validate/+server';
import { POST as syncWidgets } from '@src/routes/api/widgets/sync/+server';
import { contentManager } from '@src/content/content-manager';

// Standardized path alias (@src) used everywhere
vi.mock('@src/content/content-manager', () => ({
	contentManager: {
		getCollections: vi.fn().mockResolvedValue([])
	}
}));

// Legacy @root mock removed as it's no longer needed after import unification

// Mock widget store
vi.mock('@src/stores/widget-store.svelte.ts', () => ({
	widgets: {
		initialize: vi.fn().mockResolvedValue(true),
		customWidgets: [],
		widgetFunctions: {},
		coreWidgets: []
	},
	getWidgetFunction: vi.fn(() => ({})),
	isWidgetCore: vi.fn(() => false)
}));

// Mock permissions
vi.mock('@src/databases/auth/permissions', () => ({
	hasPermissionWithRoles: vi.fn(() => true)
}));

// Mock services
vi.mock('@src/services/widget-registry-service', () => ({
	widgetRegistryService: {
		initialize: vi.fn().mockResolvedValue(true),
		getAllWidgets: vi.fn(() => new Map())
	}
}));

// Mock cache
vi.mock('@src/databases/cache-service', () => ({
	cacheService: {
		get: vi.fn().mockResolvedValue(null),
		setWithCategory: vi.fn().mockResolvedValue(true),
		delete: vi.fn(),
		clearByPattern: vi.fn()
	}
}));

// Mock CacheCategory
vi.mock('@src/databases/cache/types', () => ({
	CacheCategory: {
		WIDGET: 'widget'
	}
}));

describe('Widget API Security - IDOR and Tenant Isolation', () => {
	const mockUser = { _id: 'user1', role: 'admin' };
	const mockSuperAdmin = { _id: 'admin1', role: 'super-admin' };

	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('IDOR Protection (Non-Super-Admin)', () => {
		const endpoints = [
			{ name: 'active', handler: getActive },
			{ name: 'installed', handler: getInstalled },
			{ name: 'validate', handler: validateWidgets }
		];

		endpoints.forEach(({ name, handler }) => {
			it(`should prevent ${name} endpoint from overriding tenantId for non-super-admin`, async () => {
				const url = new URL(`http://localhost/api/widgets/${name}?tenantId=other-tenant&activeWidgets=Test`);
				const event = {
					url,
					locals: {
						user: mockUser,
						tenantId: 'my-tenant',
						roles: ['admin']
					},
					request: {
						headers: {
							get: (name: string) => (name === 'X-Tenant-ID' ? 'other-tenant' : null)
						}
					}
				} as any;

				const response = await handler(event);
				expect(response.status).toBe(403);
			});
		});

		it('should prevent sync endpoint from overriding tenantId for non-super-admin', async () => {
			const event = {
				locals: {
					user: mockUser,
					tenantId: 'my-tenant',
					roles: ['admin'],
					dbAdapter: { system: { widgets: { findAll: vi.fn().mockResolvedValue({ success: true, data: [] }) } } }
				},
				request: {
					headers: {
						get: (name: string) => (name === 'X-Tenant-ID' ? 'other-tenant' : null)
					}
				}
			} as any;

			const response = await syncWidgets(event);
			expect(response.status).toBe(403);
		});

		it('should prevent status endpoint from overriding tenantId for non-super-admin', async () => {
			const event = {
				locals: {
					user: mockUser,
					tenantId: 'my-tenant',
					roles: ['admin'],
					dbAdapter: { system: { widgets: { findAll: vi.fn().mockResolvedValue({ success: true, data: [] }) } } }
				},
				request: {
					headers: {
						get: (name: string) => (name === 'X-Tenant-ID' ? 'other-tenant' : null)
					},
					json: vi.fn().mockResolvedValue({ widgetName: 'test', isActive: true })
				}
			} as any;

			const response = await updateStatus(event);
			expect(response.status).toBe(403);
		});
	});

	describe('IDOR Privilege (Super-Admin)', () => {
		it('should allow super-admin to override tenantId in active endpoint', async () => {
			const url = new URL('http://localhost/api/widgets/active?tenantId=other-tenant');
			const event = {
				url,
				locals: {
					user: mockSuperAdmin,
					tenantId: 'my-tenant',
					roles: ['super-admin'],
					dbAdapter: {
						system: {
							widgets: {
								getActiveWidgets: vi.fn().mockResolvedValue({ success: true, data: [] })
							}
						}
					}
				},
				request: {
					headers: { get: () => null }
				}
			} as any;

			const response = await getActive(event);
			const data = await response.json();

			if (response.status !== 200) {
				throw new Error(`Super-admin active test failed with status ${response.status}: ${JSON.stringify(data)}`);
			}

			expect(response.status).toBe(200);
			expect(data.data.tenantId).toBe('other-tenant');
		});

		it('should allow super-admin to override tenantId in validate endpoint', async () => {
			const url = new URL('http://localhost/api/widgets/validate');
			const event = {
				url,
				locals: {
					user: mockSuperAdmin,
					tenantId: 'my-tenant',
					roles: ['super-admin']
				},
				request: {
					headers: { get: (name: string) => (name === 'X-Tenant-ID' ? 'other-tenant' : null) }
				}
			} as any;

			const response = await validateWidgets(event);
			expect(response.status).toBe(200);
			expect(contentManager.getCollections).toHaveBeenCalledWith('other-tenant');
		});
	});

	describe('Cross-Tenant Data Leak Prevention', () => {
		it('should only fetch collections for the target tenant in validate endpoint', async () => {
			const event = {
				url: new URL('http://localhost/api/widgets/validate'),
				locals: {
					user: mockUser,
					tenantId: 'tenant-1',
					roles: ['admin']
				},
				request: { headers: { get: () => null } }
			} as any;

			await validateWidgets(event);
			expect(contentManager.getCollections).toHaveBeenCalledWith('tenant-1');
		});

		it('should only fetch collections for the target tenant in status endpoint (deactivation check)', async () => {
			const event = {
				locals: {
					user: mockUser,
					tenantId: 'tenant-1',
					roles: ['admin'],
					dbAdapter: {
						system: {
							widgets: {
								findAll: vi.fn().mockResolvedValue({
									success: true,
									data: [{ _id: '1', name: 'my-widget', isActive: true }]
								}),
								update: vi.fn().mockResolvedValue({ success: true, data: { name: 'my-widget' } })
							}
						}
					}
				},
				request: {
					headers: { get: () => null },
					json: vi.fn().mockResolvedValue({ widgetName: 'my-widget', isActive: false })
				}
			} as any;

			await updateStatus(event);
			expect(contentManager.getCollections).toHaveBeenCalledWith('tenant-1');
		});
	});
});
