/**
 * @file tests/unit/api/token.test.ts
 * @description Unit tests for all token API routes
 *
 * Tests:
 * - GET /api/token - List tokens with pagination, sorting, filtering
 * - POST /api/token/create-token - Create invitation tokens
 * - POST /api/token/batch - Batch operations (delete, block, unblock)
 * - GET /api/token/[tokenID] - Validate token
 * - PUT /api/token/[tokenID] - Update token
 * - DELETE /api/token/[tokenID] - Delete token
 *
 * Note: These are WHITEBOX unit tests that mock internal dependencies.
 * For blackbox integration tests, see tests/integration/api/token.test.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';

// Mock all dependencies before importing the module

vi.mock('@utils/api-handler', () => ({
	apiHandler: (fn: any) => fn
}));

vi.mock('@src/databases/mongodb/models/auth-token', () => ({
	TokenAdapter: vi.fn().mockImplementation(function (this: any) {
		this.updateToken = vi.fn();
		this.deleteTokens = vi.fn();
		return this;
	})
}));

vi.mock('@src/databases/auth/default-roles', () => ({
	getDefaultRoles: vi.fn().mockReturnValue([
		{ _id: 'admin', name: 'Administrator', isAdmin: true },
		{ _id: 'developer', name: 'Developer', isAdmin: false },
		{ _id: 'editor', name: 'Editor', isAdmin: false }
	])
}));

vi.mock('@src/paraglide/runtime', () => ({
	getLocale: vi.fn().mockReturnValue('en')
}));

// Import after mocks are set up
const tokenIdHandlers = await import('@src/routes/api/token/[tokenId]/+server.ts');
const listHandlers = await import('@src/routes/api/token/+server.ts');
const createHandlers = await import('@src/routes/api/token/create-token/+server.ts');
const batchHandlers = await import('@src/routes/api/token/batch/+server.ts');

const GET_TOKEN = tokenIdHandlers.GET;
const PUT_TOKEN = tokenIdHandlers.PUT;
const DELETE_TOKEN = tokenIdHandlers.DELETE;
const GET_LIST = listHandlers.GET;
const POST_CREATE = createHandlers.POST;
const POST_BATCH = batchHandlers.POST;

describe('Token API Unit Tests', () => {
	// Get reference to mocked functions
	let mockAuth: {
		getTokenByValue: ReturnType<typeof vi.fn>;
		updateToken: ReturnType<typeof vi.fn>;
		deleteTokens: ReturnType<typeof vi.fn>;
		getAllTokens: ReturnType<typeof vi.fn>;
		createToken: ReturnType<typeof vi.fn>;
		blockTokens: ReturnType<typeof vi.fn>;
		unblockTokens: ReturnType<typeof vi.fn>;
		checkUser: ReturnType<typeof vi.fn>;
	};
	let mockDbAdapter: {
		auth: {
			getAllTokens: ReturnType<typeof vi.fn>;
			createToken: ReturnType<typeof vi.fn>;
		};
	};
	let mockCacheDelete: ReturnType<typeof vi.fn>;
	let mockGetPrivateSettingSync: ReturnType<typeof vi.fn>;
	let mockLogger: {
		info: ReturnType<typeof vi.fn>;
		warn: ReturnType<typeof vi.fn>;
		error: ReturnType<typeof vi.fn>;
		debug: ReturnType<typeof vi.fn>;
	};

	beforeEach(async () => {
		vi.clearAllMocks();

		// Re-import modules to get fresh mock references
		const cacheModule = await import('@src/databases/cache/cache-service');
		const authModule = await import('@src/databases/db');
		const settingsModule = await import('@src/services/settings-service');
		const loggerModule = await import('@utils/logger.server');

		mockCacheDelete = cacheModule.cacheService.delete as unknown as ReturnType<typeof vi.fn>;
		mockAuth = authModule.auth as unknown as typeof mockAuth;
		mockDbAdapter = authModule.dbAdapter as unknown as typeof mockDbAdapter;
		mockGetPrivateSettingSync = settingsModule.getPrivateSettingSync as unknown as ReturnType<typeof vi.fn>;
		mockLogger = loggerModule.logger as unknown as typeof mockLogger;

		// Reset defaults
		mockGetPrivateSettingSync.mockReturnValue(false);
		if (mockAuth.updateToken) {
			(mockAuth as any).updateToken = vi.fn();
		}
		if (mockAuth.deleteTokens) {
			(mockAuth as any).deleteTokens = vi.fn();
		}
		if (mockAuth.blockTokens) {
			(mockAuth as any).blockTokens = vi.fn();
		}
		if (mockAuth.unblockTokens) {
			(mockAuth as any).unblockTokens = vi.fn();
		}
		if (mockAuth.createToken) {
			(mockAuth as any).createToken = vi.fn();
		}
		if (mockAuth.checkUser) {
			(mockAuth as any).checkUser = vi.fn();
		}
		if (mockDbAdapter?.auth?.createToken) {
			(mockDbAdapter.auth as any).createToken = vi.fn();
		}
	});

	// ============================================
	// GET /api/token/[tokenID] Tests
	// ============================================

	const createMockGetEvent = (tokenId: string) => {
		return {
			params: { tokenID: tokenId },
			fetch: vi.fn().mockResolvedValue({
				ok: true,
				json: vi.fn().mockResolvedValue({ success: true })
			})
		} as unknown as RequestEvent;
	};

	describe('GET /api/token/[tokenID] - Validate Token', () => {
		it('should return valid=true for a non-expired token', async () => {
			const futureDate = new Date();
			futureDate.setDate(futureDate.getDate() + 7);

			(mockAuth.getTokenByValue as ReturnType<typeof vi.fn>).mockResolvedValue({
				email: 'test@example.com',
				expires: futureDate.toISOString(),
				type: 'invitation'
			});

			const event = createMockGetEvent('valid-token-123');
			const response = await GET_TOKEN(event);

			expect(response.status).toBe(200);
			const data = await response.json();
			expect(data.success).toBe(true);
			expect(data.data.valid).toBe(true);
			expect(data.data.email).toBe('test@example.com');
			expect(data.data.type).toBe('invitation');
		});

		it('should return valid=false for an expired token', async () => {
			const pastDate = new Date();
			pastDate.setDate(pastDate.getDate() - 7);

			(mockAuth.getTokenByValue as ReturnType<typeof vi.fn>).mockResolvedValue({
				email: 'expired@example.com',
				expires: pastDate.toISOString(),
				type: 'invitation'
			});

			const event = createMockGetEvent('expired-token-456');
			const response = await GET_TOKEN(event);

			expect(response.status).toBe(200);
			const data = await response.json();
			expect(data.success).toBe(true);
			expect(data.data.valid).toBe(false);
		});

		it('should return valid=true for token without expiration', async () => {
			(mockAuth.getTokenByValue as ReturnType<typeof vi.fn>).mockResolvedValue({
				email: 'noexpire@example.com',
				type: 'invitation'
			});

			const event = createMockGetEvent('noexpire-token-789');
			const response = await GET_TOKEN(event);

			expect(response.status).toBe(200);
			const data = await response.json();
			expect(data.data.valid).toBe(true);
		});

		it('should throw error if token ID is missing', async () => {
			const event = createMockGetEvent('');

			try {
				await GET_TOKEN(event);
			} catch (error: any) {
				expect(error.status).toBe(400);
				expect(error.code).toBe('MISSING_TOKEN_ID');
			}
		});

		it('should throw error if token is not found', async () => {
			(mockAuth.getTokenByValue as ReturnType<typeof vi.fn>).mockResolvedValue(null);

			const event = createMockGetEvent('non-existent-token');

			try {
				await GET_TOKEN(event);
			} catch (error: any) {
				expect(error.status).toBe(404);
				expect(error.code).toBe('TOKEN_NOT_FOUND');
			}
		});

		it('should handle auth service errors gracefully', async () => {
			(mockAuth.getTokenByValue as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Database connection failed'));

			const event = createMockGetEvent('some-token');

			await expect(GET_TOKEN(event)).rejects.toThrow('Database connection failed');
		});
	});

	// ============================================
	// PUT /api/token/[tokenID] Tests
	// ============================================

	const createMockPutEvent = (tokenId: string, bodyObj?: any, role = 'admin', tenantId?: string) => {
		return {
			params: { tokenID: tokenId },
			request: {
				json: vi.fn().mockResolvedValue(bodyObj || {})
			},
			locals: {
				user: { _id: 'user-123', role },
				tenantId
			},
			fetch: vi.fn().mockResolvedValue({
				ok: true,
				json: vi.fn().mockResolvedValue({ success: true })
			})
		} as unknown as RequestEvent;
	};

	describe('PUT /api/token/[tokenID] - Update Token', () => {
		it('should update token and invalidate cache successfully', async () => {
			(mockAuth.getTokenByValue as ReturnType<typeof vi.fn>).mockResolvedValue({ tenantId: 'tenant-1' });
			(mockAuth.updateToken as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true });

			const event = createMockPutEvent('token-xyz', { newTokenData: { role: 'editor' } }, 'admin', 'tenant-1');
			const response = await PUT_TOKEN(event);

			expect(mockAuth.updateToken).toHaveBeenCalledWith('token-xyz', { role: 'editor' });
			expect(mockCacheDelete).toHaveBeenCalledWith('tokens', 'tenant-1');
			expect(response.status).toBe(200);
			const data = await response.json();
			expect(data.success).toBe(true);
		});

		it('should throw AppError if tenant is missing when MULTI_TENANT is true', async () => {
			mockGetPrivateSettingSync.mockReturnValue(true);

			const event = createMockPutEvent('token-xyz', { newTokenData: {} });

			await expect(PUT_TOKEN(event)).rejects.toThrow('Tenant could not be identified for this operation.');
		});

		it('should strictly enforce cross-tenant update spoofing', async () => {
			mockGetPrivateSettingSync.mockReturnValue(true);
			(mockAuth.getTokenByValue as ReturnType<typeof vi.fn>).mockResolvedValue({ tenantId: 'tenant-A' });

			const event = createMockPutEvent('token-xyz', { newTokenData: {} }, 'admin', 'tenant-B');

			await expect(PUT_TOKEN(event)).rejects.toThrow('Forbidden: You can only edit tokens within your own tenant.');
			expect(mockLogger.warn).toHaveBeenCalled();
		});

		it('should fallback to TokenAdapter if global auth lacks updateToken', async () => {
			// @ts-expect-error
			mockAuth.updateToken = undefined;

			const { TokenAdapter } = await import('@src/databases/mongodb/models/auth-token');
			const mockUpdateToken = vi.fn().mockResolvedValue({ success: true });
			(TokenAdapter as any).mockImplementation(function (this: any) {
				this.updateToken = mockUpdateToken;
				this.deleteTokens = vi.fn();
				return this;
			});

			const event = createMockPutEvent('token-xyz', { newTokenData: { email: 'test@example.com' } });
			const response = await PUT_TOKEN(event);

			expect(response.status).toBe(200);
			const data = await response.json();
			expect(data.success).toBe(true);
			expect(mockUpdateToken).toHaveBeenCalled();
		});
	});

	// ============================================
	// DELETE /api/token/[tokenID] Tests
	// ============================================

	describe('DELETE /api/token/[tokenID] - Delete Token', () => {
		it('should delete token and invalidate cache successfully', async () => {
			(mockAuth.getTokenByValue as ReturnType<typeof vi.fn>).mockResolvedValue({ _id: 'real-id-123', tenantId: 'tenant-1' });
			(mockAuth.deleteTokens as ReturnType<typeof vi.fn>).mockResolvedValue(1);

			const event = createMockPutEvent('token-val', undefined, 'admin', 'tenant-1');
			const response = await DELETE_TOKEN(event);

			expect(mockAuth.deleteTokens).toHaveBeenCalledWith(['real-id-123']);
			expect(mockCacheDelete).toHaveBeenCalledWith('tokens', 'tenant-1');
			expect(response.status).toBe(200);
		});

		it('should strictly enforce cross-tenant delete spoofing', async () => {
			mockGetPrivateSettingSync.mockReturnValue(true);
			(mockAuth.getTokenByValue as ReturnType<typeof vi.fn>).mockResolvedValue({ _id: 'real-id-123', tenantId: 'tenant-A' });

			const event = createMockPutEvent('token-val', undefined, 'admin', 'tenant-B');

			await expect(DELETE_TOKEN(event)).rejects.toThrow('Token not found.');
		});

		it('should handle missing token gracefully', async () => {
			(mockAuth.getTokenByValue as ReturnType<typeof vi.fn>).mockResolvedValue(null);

			const event = createMockPutEvent('non-existent-token', undefined, 'admin', 'tenant-1');

			await expect(DELETE_TOKEN(event)).rejects.toThrow('Token not found.');
		});
	});

	// ============================================
	// GET /api/token Tests (List Tokens)
	// ============================================

	const createMockListEvent = (queryParams: Record<string, string> = {}, tenantId?: string) => {
		const url = new URL('http://localhost/api/token');
		Object.entries(queryParams).forEach(([key, value]) => url.searchParams.set(key, value));

		return {
			url,
			locals: {
				user: { _id: 'user-123', role: 'admin' },
				tenantId,
				hasManageUsersPermission: true
			},
			fetch: vi.fn().mockResolvedValue({
				ok: true,
				json: vi.fn().mockResolvedValue({ success: true })
			})
		} as unknown as RequestEvent;
	};

	describe('GET /api/token - List Tokens', () => {
		it('should return paginated list of tokens', async () => {
			(mockDbAdapter.auth.getAllTokens as ReturnType<typeof vi.fn>).mockResolvedValue({
				success: true,
				data: [
					{ _id: '1', email: 'test1@example.com', createdAt: '2024-01-01' },
					{ _id: '2', email: 'test2@example.com', createdAt: '2024-01-02' },
					{ _id: '3', email: 'test3@example.com', createdAt: '2024-01-03' }
				]
			});

			const event = createMockListEvent({ page: '1', limit: '2' });
			const response = await GET_LIST(event);

			expect(response.status).toBe(200);
			const data = await response.json();
			expect(data.success).toBe(true);
			expect(data.data).toHaveLength(2);
			expect(data.pagination.totalItems).toBe(3);
			expect(data.pagination.totalPages).toBe(2);
			expect(data.pagination.page).toBe(1);
			expect(data.pagination.limit).toBe(2);
		});

		it('should return 403 if user lacks permission', async () => {
			const event = {
				url: new URL('http://localhost/api/token'),
				locals: {
					user: { _id: 'user-123', role: 'editor' },
					tenantId: 'tenant-1',
					hasManageUsersPermission: false
				}
			} as unknown as RequestEvent;

			try {
				await GET_LIST(event);
			} catch (error: any) {
				expect(error.status).toBe(403);
				expect(error.code).toBe('FORBIDDEN');
			}
		});

		it('should apply sorting (ascending)', async () => {
			(mockDbAdapter.auth.getAllTokens as ReturnType<typeof vi.fn>).mockResolvedValue({
				success: true,
				data: [
					{ _id: '3', email: 'test3@example.com', createdAt: '2024-01-03' },
					{ _id: '1', email: 'test1@example.com', createdAt: '2024-01-01' },
					{ _id: '2', email: 'test2@example.com', createdAt: '2024-01-02' }
				]
			});

			const event = createMockListEvent({ sort: 'createdAt', order: 'asc' });
			const response = await GET_LIST(event);

			expect(response.status).toBe(200);
			const data = await response.json();
			expect(data.data[0]._id).toBe('1');
			expect(data.data[1]._id).toBe('2');
			expect(data.data[2]._id).toBe('3');
		});

		it('should apply sorting (descending)', async () => {
			(mockDbAdapter.auth.getAllTokens as ReturnType<typeof vi.fn>).mockResolvedValue({
				success: true,
				data: [
					{ _id: '1', email: 'test1@example.com', createdAt: '2024-01-01' },
					{ _id: '2', email: 'test2@example.com', createdAt: '2024-01-02' },
					{ _id: '3', email: 'test3@example.com', createdAt: '2024-01-03' }
				]
			});

			const event = createMockListEvent({ sort: 'createdAt', order: 'desc' });
			const response = await GET_LIST(event);

			expect(response.status).toBe(200);
			const data = await response.json();
			expect(data.data[0]._id).toBe('3');
			expect(data.data[1]._id).toBe('2');
			expect(data.data[2]._id).toBe('1');
		});

		it('should apply search filter', async () => {
			(mockDbAdapter.auth.getAllTokens as ReturnType<typeof vi.fn>).mockResolvedValue({
				success: true,
				data: [{ _id: '1', email: 'test1@example.com', token: 'abc123' }]
			});

			const event = createMockListEvent({ search: 'test1' });
			const response = await GET_LIST(event);

			expect(response.status).toBe(200);
			const data = await response.json();
			expect(data.success).toBe(true);
			// The search filter should be applied to the database query
			expect(mockDbAdapter.auth.getAllTokens).toHaveBeenCalled();
		});

		it('should handle database errors gracefully', async () => {
			(mockDbAdapter.auth.getAllTokens as ReturnType<typeof vi.fn>).mockResolvedValue({
				success: false,
				error: { message: 'Database error' }
			});

			const event = createMockListEvent();

			try {
				await GET_LIST(event);
			} catch (error: any) {
				expect(error.status).toBe(500);
				expect(error.code).toBe('DB_FETCH_ERROR');
			}
		});

		it('should handle multi-tenant filtering', async () => {
			mockGetPrivateSettingSync.mockReturnValue(true);

			(mockDbAdapter.auth.getAllTokens as ReturnType<typeof vi.fn>).mockResolvedValue({
				success: true,
				data: []
			});

			const event = createMockListEvent({}, 'tenant-A');
			const response = await GET_LIST(event);

			expect(response.status).toBe(200);
			// Should have been called with tenant filter
			expect(mockDbAdapter.auth.getAllTokens).toHaveBeenCalled();
		});
	});

	// ============================================
	// POST /api/token/create-token Tests
	// ============================================

	const createMockCreateEvent = (body: any, tenantId?: string) => {
		return {
			request: {
				json: vi.fn().mockResolvedValue(body)
			},
			locals: {
				user: { _id: 'user-123', role: 'admin' },
				tenantId
			},
			url: new URL('http://localhost/api/token/create-token'),
			fetch: vi.fn().mockResolvedValue({
				ok: true,
				json: vi.fn().mockResolvedValue({ success: true })
			})
		} as unknown as RequestEvent;
	};

	describe('POST /api/token/create-token - Create Token', () => {
		it('should create token with valid input', async () => {
			(mockAuth.checkUser as ReturnType<typeof vi.fn>).mockResolvedValue(null);
			(mockAuth.getAllTokens as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true, data: [] });
			(mockDbAdapter.auth.createToken as ReturnType<typeof vi.fn>).mockResolvedValue({
				success: true,
				data: 'generated-token-123'
			});

			const event = createMockCreateEvent({
				email: 'newuser@example.com',
				role: 'editor',
				expiresIn: '2 days'
			});

			// Mock the fetch for sending email
			global.fetch = vi.fn().mockResolvedValue({
				ok: true,
				json: vi.fn().mockResolvedValue({ dev_mode: true })
			}) as any;

			const response = await POST_CREATE(event);

			expect(response.status).toBe(200);
			const data = await response.json();
			expect(data.success).toBe(true);
			expect(data.token).toBeDefined();
		});

		it('should reject invalid email format', async () => {
			const event = createMockCreateEvent({
				email: 'invalid-email',
				role: 'editor',
				expiresIn: '2 days'
			});

			try {
				await POST_CREATE(event);
			} catch (error: any) {
				expect(error.status).toBe(400);
				expect(error.code).toBe('VALIDATION_ERROR');
			}
		});

		it('should reject invalid role', async () => {
			const event = createMockCreateEvent({
				email: 'newuser@example.com',
				role: 'invalid-role',
				expiresIn: '2 days'
			});

			try {
				await POST_CREATE(event);
			} catch (error: any) {
				expect(error.status).toBe(400);
				expect(error.code).toBe('INVALID_ROLE');
			}
		});

		it('should reject invalid expiration value', async () => {
			const event = createMockCreateEvent({
				email: 'newuser@example.com',
				role: 'editor',
				expiresIn: 'invalid-duration'
			});

			try {
				await POST_CREATE(event);
			} catch (error: any) {
				expect(error.status).toBe(400);
				expect(error.code).toBe('INVALID_EXPIRATION');
			}
		});

		it('should reject if user already exists', async () => {
			(mockAuth.checkUser as ReturnType<typeof vi.fn>).mockResolvedValue({ _id: 'existing-user' });

			const event = createMockCreateEvent({
				email: 'existing@example.com',
				role: 'editor',
				expiresIn: '2 days'
			});

			try {
				await POST_CREATE(event);
			} catch (error: any) {
				expect(error.status).toBe(409);
				expect(error.code).toBe('USER_EXISTS');
			}
		});

		it('should reject if token already exists for email', async () => {
			(mockAuth.checkUser as ReturnType<typeof vi.fn>).mockResolvedValue(null);
			(mockAuth.getAllTokens as ReturnType<typeof vi.fn>).mockResolvedValue({
				success: true,
				data: [{ _id: 'existing-token' }]
			});

			const event = createMockCreateEvent({
				email: 'existing@example.com',
				role: 'editor',
				expiresIn: '2 days'
			});

			try {
				await POST_CREATE(event);
			} catch (error: any) {
				expect(error.status).toBe(409);
				expect(error.code).toBe('TOKEN_EXISTS');
			}
		});

		it('should handle email sending failure gracefully', async () => {
			(mockAuth.checkUser as ReturnType<typeof vi.fn>).mockResolvedValue(null);
			(mockAuth.getAllTokens as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true, data: [] });
			(mockDbAdapter.auth.createToken as ReturnType<typeof vi.fn>).mockResolvedValue({
				success: true,
				data: 'generated-token-123'
			});

			const event = createMockCreateEvent({
				email: 'newuser@example.com',
				role: 'editor',
				expiresIn: '2 days'
			});

			// ✨ Override the event's fetch to return a failure
			event.fetch = vi.fn().mockImplementation(() =>
				Promise.resolve({
					ok: false,
					status: 500,
					json: async () => ({ message: 'SMTP error' })
				})
			) as any;

			// Also mock global fetch just in case
			global.fetch = event.fetch as any;

			const response = await POST_CREATE(event);

			expect(response.status).toBe(200);
			const data = await response.json();
			expect(data.email_sent).toBe(false);
			expect(data.dev_mode).toBe(true);
			// Token should still be returned for manual delivery
			expect(data.token).toBeDefined();
		});

		it('should correctly calculate expiration times', async () => {
			(mockAuth.checkUser as ReturnType<typeof vi.fn>).mockResolvedValue(null);
			(mockAuth.getAllTokens as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true, data: [] });
			(mockDbAdapter.auth.createToken as ReturnType<typeof vi.fn>).mockResolvedValue({
				success: true,
				data: 'token'
			});

			global.fetch = vi.fn().mockResolvedValue({
				ok: true,
				json: vi.fn().mockResolvedValue({})
			}) as any;

			// Test '2 days' = 172800 seconds
			const event = createMockCreateEvent({
				email: 'test@example.com',
				role: 'editor',
				expiresIn: '2 days'
			});

			await POST_CREATE(event);

			expect(mockDbAdapter.auth.createToken).toHaveBeenCalled();
			const callArgs = (mockDbAdapter.auth.createToken as ReturnType<typeof vi.fn>).mock.calls[0][0];
			const expiresDate = new Date(callArgs.expires);
			const now = new Date();
			const diffMs = expiresDate.getTime() - now.getTime();
			const diffDays = diffMs / (1000 * 60 * 60 * 24);
			// Should be approximately 2 days (allow some tolerance for test execution time)
			expect(diffDays).toBeGreaterThan(1.9);
			expect(diffDays).toBeLessThan(2.1);
		});

		it('should validate all expiration options', async () => {
			const validExpirations = ['2 hrs', '12 hrs', '2 days', '1 week', '2 weeks', '1 month'];

			for (const expiresIn of validExpirations) {
				(mockAuth.checkUser as ReturnType<typeof vi.fn>).mockResolvedValue(null);
				(mockAuth.getAllTokens as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true, data: [] });
				(mockDbAdapter.auth.createToken as ReturnType<typeof vi.fn>).mockResolvedValue({
					success: true,
					data: 'token'
				});

				global.fetch = vi.fn().mockResolvedValue({
					ok: true,
					json: vi.fn().mockResolvedValue({})
				}) as any;

				const event = createMockCreateEvent({
					email: `test-${expiresIn.replace(' ', '')}@example.com`,
					role: 'editor',
					expiresIn
				});

				const response = await POST_CREATE(event);
				expect(response.status).toBe(200);
			}
		});
	});

	// ============================================
	// POST /api/token/batch Tests
	// ============================================

	const createMockBatchEvent = (body: any, tenantId?: string) => {
		return {
			request: {
				json: vi.fn().mockResolvedValue(body)
			},
			locals: {
				user: { _id: 'user-123', role: 'admin' },
				tenantId
			},
			fetch: vi.fn().mockResolvedValue({
				ok: true,
				json: vi.fn().mockResolvedValue({ success: true })
			})
		} as unknown as RequestEvent;
	};

	describe('POST /api/token/batch - Batch Operations', () => {
		it('should delete multiple tokens', async () => {
			(mockAuth.getAllTokens as ReturnType<typeof vi.fn>).mockResolvedValue({
				success: true,
				data: [{ token: 'token1' }, { token: 'token2' }]
			});
			(mockAuth.deleteTokens as ReturnType<typeof vi.fn>).mockResolvedValue(2);

			const event = createMockBatchEvent({
				tokenIds: ['token1', 'token2'],
				action: 'delete'
			});

			const response = await POST_BATCH(event);

			expect(response.status).toBe(200);
			const data = await response.json();
			expect(data.success).toBe(true);
			expect(mockAuth.deleteTokens).toHaveBeenCalledWith(['token1', 'token2'], undefined);
		});

		it('should block multiple tokens', async () => {
			(mockAuth.getAllTokens as ReturnType<typeof vi.fn>).mockResolvedValue({
				success: true,
				data: [{ token: 'token1' }]
			});
			(mockAuth.blockTokens as ReturnType<typeof vi.fn>).mockResolvedValue(1);

			const event = createMockBatchEvent({
				tokenIds: ['token1'],
				action: 'block'
			});

			const response = await POST_BATCH(event);

			expect(response.status).toBe(200);
			const data = await response.json();
			expect(data.success).toBe(true);
			expect(mockAuth.blockTokens).toHaveBeenCalled();
		});

		it('should unblock multiple tokens', async () => {
			(mockAuth.getAllTokens as ReturnType<typeof vi.fn>).mockResolvedValue({
				success: true,
				data: [{ token: 'token1' }]
			});
			(mockAuth.unblockTokens as ReturnType<typeof vi.fn>).mockResolvedValue(1);

			const event = createMockBatchEvent({
				tokenIds: ['token1'],
				action: 'unblock'
			});

			const response = await POST_BATCH(event);

			expect(response.status).toBe(200);
			const data = await response.json();
			expect(data.success).toBe(true);
			expect(mockAuth.unblockTokens).toHaveBeenCalled();
		});

		it('should reject invalid action', async () => {
			const event = createMockBatchEvent({
				tokenIds: ['token1'],
				action: 'invalid-action'
			});

			try {
				await POST_BATCH(event);
			} catch (error: any) {
				expect(error.status).toBe(400);
				expect(error.code).toBe('VALIDATION_ERROR');
			}
		});

		it('should reject empty tokenIds array', async () => {
			const event = createMockBatchEvent({
				tokenIds: [],
				action: 'delete'
			});

			try {
				await POST_BATCH(event);
			} catch (error: any) {
				expect(error.status).toBe(400);
			}
		});

		it('should enforce multi-tenant security boundary', async () => {
			mockGetPrivateSettingSync.mockReturnValue(true);

			// Tokens belong to tenant-A
			(mockAuth.getAllTokens as ReturnType<typeof vi.fn>).mockResolvedValue({
				success: true,
				data: [{ token: 'token-A' }]
			});

			// But request is from tenant-B
			const event = createMockBatchEvent({ tokenIds: ['token-A'], action: 'delete' }, 'tenant-B');

			try {
				await POST_BATCH(event);
			} catch (error: any) {
				expect(error.status).toBe(403);
				expect(error.code).toBe('FORBIDDEN');
			}
		});

		it('should throw TENANT_REQUIRED in multi-tenant mode without tenantId', async () => {
			mockGetPrivateSettingSync.mockReturnValue(true);

			const event = createMockBatchEvent({
				tokenIds: ['token1'],
				action: 'delete'
			});
			// No tenantId in locals

			try {
				await POST_BATCH(event);
			} catch (error: any) {
				expect(error.status).toBe(500);
				expect(error.code).toBe('TENANT_REQUIRED');
			}
		});

		it('should handle invalid JSON gracefully', async () => {
			const event = {
				request: {
					json: vi.fn().mockRejectedValue(new Error('Invalid JSON'))
				},
				locals: {
					user: { _id: 'user-123', role: 'admin' },
					tenantId: 'tenant-1'
				}
			} as unknown as RequestEvent;

			try {
				await POST_BATCH(event);
			} catch (error: any) {
				expect(error.status).toBe(400);
				expect(error.code).toBe('INVALID_JSON');
			}
		});
	});
});
