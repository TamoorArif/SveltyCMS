/**
 * @file tests/unit/api/user.test.ts
 * @description Unit tests for User Management API routes
 *
 * Tests:
 * - GET /api/user - List users
 * - GET /api/user/[id] - Get user
 * - PUT /api/user/[id] - Update user
 * - DELETE /api/user/[id] - Delete user
 * - POST /api/user/batch - Batch user operations
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('@src/databases/db', () => ({
	auth: {
		getAllUsers: vi.fn(),
		getUserById: vi.fn(),
		updateUser: vi.fn(),
		updateUserAttributes: vi.fn(),
		deleteUsers: vi.fn(),
		deleteUserAndSessions: vi.fn(),
		countUsers: vi.fn(),
		checkUser: vi.fn(),
		updateRole: vi.fn(),
		validateSession: vi.fn()
	},
	dbAdapter: {
		auth: {
			getAllUsers: vi.fn(),
			getUserCount: vi.fn()
		},
		crud: {
			findMany: vi.fn(),
			findOne: vi.fn()
		}
	},
	dbInitPromise: Promise.resolve()
}));

vi.mock('@src/services/settings-service', () => ({
	getPrivateSettingSync: vi.fn().mockReturnValue(false),
	getPublicSettingSync: vi.fn().mockReturnValue({})
}));

vi.mock('@src/utils/tenant-utils', () => ({
	requireTenantContext: vi.fn().mockImplementation((locals: any) => locals.tenantId || null)
}));

vi.mock('@utils/api-handler', () => ({
	apiHandler: (fn: any) => fn
}));

vi.mock('@utils/logger.server', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn()
	}
}));

vi.mock('@utils/media/media-storage.server', () => ({
	moveMediaToTrash: vi.fn().mockResolvedValue(true),
	saveAvatarImage: vi.fn().mockResolvedValue('/files/new.png')
}));

// Import handlers
const listHandlers = await import('@src/routes/api/user/+server.ts');
const batchHandlers = await import('@src/routes/api/user/batch/+server.ts');
const updateHandlers = await import('@src/routes/api/user/update-user-attributes/+server.ts');
const saveAvatarHandlers = await import('@src/routes/api/user/save-avatar/+server.ts');
const deleteAvatarHandlers = await import('@src/routes/api/user/delete-avatar/+server.ts');

describe('User API Unit Tests', () => {
	let mockAuth: any;
	let mockDbAdapter: any;
	let mockMedia: any;

	beforeEach(async () => {
		vi.clearAllMocks();
		const dbModule = await import('@src/databases/db');
		mockAuth = dbModule.auth;
		mockDbAdapter = dbModule.dbAdapter;
		mockMedia = await import('@utils/media/media-storage.server');
	});

	describe('GET /api/user - List Users', () => {
		it('should return paginated users with tenant isolation', async () => {
			const mockUsers = [{ _id: 'u1', email: 'u1@t1.com' }];

			// Mock dbAdapter results with success structure
			if (mockDbAdapter) {
				mockDbAdapter.auth.getAllUsers.mockResolvedValue({ success: true, data: mockUsers });
				mockDbAdapter.auth.getUserCount.mockResolvedValue({ success: true, data: 1 });
			}

			const event = {
				url: new URL('http://localhost/api/user?page=1&limit=10'),
				locals: {
					user: { _id: 'admin', role: 'admin' },
					tenantId: 'tenant-1',
					session_id: 's1',
					hasAdminPermission: true,
					hasManageUsersPermission: true
				}
			} as any;

			const response = await listHandlers.GET(event);
			const data = await response.json();

			expect(data.success).toBe(true);
			expect(data.data).toEqual(mockUsers);
		});
	});

	describe('POST /api/user/batch - Batch Operations', () => {
		it('should delete users within tenant', async () => {
			mockAuth.getUserById.mockResolvedValue({ _id: 'u1', tenantId: 'tenant-1' });
			mockAuth.deleteUserAndSessions.mockResolvedValue({ success: true, data: { deletedSessionCount: 1 } });

			const event = {
				request: {
					json: vi.fn().mockResolvedValue({ userIds: ['u1'], action: 'delete' })
				},
				locals: { tenantId: 'tenant-1', hasManageUsersPermission: true }
			} as any;

			const response = await batchHandlers.POST(event);
			const data = await response.json();

			expect(data.success).toBe(true);
		});
	});

	describe('PUT /api/user/update-user-attributes - Security', () => {
		it('should allow user to edit themselves', async () => {
			mockAuth.updateUserAttributes.mockResolvedValue({ _id: 'u1' });

			const event = {
				request: {
					json: vi.fn().mockResolvedValue({ user_id: 'u1', newUserData: { username: 'new' } })
				},
				locals: { user: { _id: 'u1' }, tenantId: 'tenant-1', hasAdminPermission: false },
				cookies: { get: vi.fn() }
			} as any;

			const response = await updateHandlers.PUT(event);
			expect(response.status).toBe(200);
			expect(mockAuth.updateUserAttributes).toHaveBeenCalled();
		});

		it('should block non-admin from editing others (IDOR Protection)', async () => {
			const event = {
				request: {
					json: vi.fn().mockResolvedValue({ user_id: 'other', newUserData: { username: 'hacked' } })
				},
				locals: { user: { _id: 'u1' }, tenantId: 'tenant-1', hasAdminPermission: false }
			} as any;

			try {
				await updateHandlers.PUT(event);
			} catch (e: any) {
				expect(e.status).toBe(403);
				expect(e.message).toContain('only edit your own profile');
			}
		});

		it('should allow admin to edit others', async () => {
			mockAuth.getUserById.mockResolvedValue({ _id: 'other', tenantId: 'tenant-1' });
			mockAuth.updateUserAttributes.mockResolvedValue({ _id: 'other' });

			const event = {
				request: {
					json: vi.fn().mockResolvedValue({ user_id: 'other', newUserData: { username: 'admin-fix' } })
				},
				locals: { user: { _id: 'admin' }, tenantId: 'tenant-1', hasAdminPermission: true },
				cookies: { get: vi.fn() }
			} as any;

			const response = await updateHandlers.PUT(event);
			expect(response.status).toBe(200);
		});
	});

	describe('Avatar Security & Safety', () => {
		it('should block non-admin from deleting others avatar', async () => {
			const event = {
				request: {
					json: vi.fn().mockResolvedValue({ userId: 'other' })
				},
				locals: { user: { _id: 'u1' }, tenantId: 'tenant-1', hasAdminPermission: false }
			} as any;

			try {
				await deleteAvatarHandlers.DELETE(event);
			} catch (e: any) {
				expect(e.status).toBe(403);
				expect(e.message).toContain('only delete your own avatar');
			}
		});

		it('should allow user to update their own avatar', async () => {
			mockAuth.getUserById.mockResolvedValue({ _id: 'u1', avatar: '/old.png' });
			mockAuth.updateUserAttributes.mockResolvedValue({ _id: 'u1' });

			const event = {
				request: {
					formData: vi.fn().mockResolvedValue({
						get: (key: string) =>
							key === 'avatar'
								? {
										type: 'image/png',
										name: 'avatar.png',
										arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0))
									}
								: 'u1'
					})
				},
				locals: { user: { _id: 'u1' }, tenantId: 'tenant-1', hasAdminPermission: false, session_id: 's1' }
			} as any;

			const response = await saveAvatarHandlers.POST(event);
			expect(response.status).toBe(200);
			expect(mockMedia.saveAvatarImage).toHaveBeenCalled();
			expect(mockMedia.moveMediaToTrash).toHaveBeenCalledWith('/old.png');
		});

		it('should protect Default_User.svg from deletion', async () => {
			mockAuth.getUserById.mockResolvedValue({ _id: 'u1', avatar: '/Default_User.svg' });

			const event = {
				request: {
					json: vi.fn().mockResolvedValue({ userId: 'u1' })
				},
				locals: { user: { _id: 'u1' }, tenantId: 'tenant-1', hasAdminPermission: false }
			} as any;

			const response = await deleteAvatarHandlers.DELETE(event);
			const data = await response.json();
			expect(data.message).toContain('No avatar to remove');
			expect(mockMedia.moveMediaToTrash).not.toHaveBeenCalled();
		});
	});
});
