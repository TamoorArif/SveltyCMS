/**
 * @file tests/unit/api/auth-2fa.test.ts
 * @description Whitebox unit tests for 2FA Authentication API endpoints
 *
 * Tests:
 * - POST /api/auth/2fa/verify - Verify code during login
 * - POST /api/auth/2fa/setup - Initiate setup
 * - POST /api/auth/2fa/verify-setup - Complete setup
 * - POST /api/auth/2fa/disable - Disable 2FA
 * - GET/POST /api/auth/2fa/backup-codes - Backup code management
 *
 * Note: These are WHITEBOX unit tests that mock internal dependencies.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';

// Mock all dependencies
vi.mock('@src/databases/db', () => ({
	auth: {
		authInterface: {},
		validateSession: vi.fn(),
		getUserById: vi.fn()
	}
}));

vi.mock('@src/databases/auth/two-factor-auth', () => ({
	getDefaultTwoFactorAuthService: vi.fn().mockReturnValue({
		verify2FA: vi.fn(),
		initiate2FASetup: vi.fn(),
		complete2FASetup: vi.fn(),
		disable2FA: vi.fn(),
		get2FAStatus: vi.fn(),
		regenerateBackupCodes: vi.fn()
	})
}));

vi.mock('@src/services/settings-service', () => ({
	getPrivateSettingSync: vi.fn().mockReturnValue(false)
}));

vi.mock('@utils/logger.server', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn()
	}
}));

vi.mock('@utils/api-handler', () => ({
	apiHandler: (fn: any) => fn
}));

// Import handlers after mocks
const setupHandler = await import('@src/routes/api/auth/2fa/setup/+server.ts');
const verifySetupHandler = await import('@src/routes/api/auth/2fa/verify-setup/+server.ts');
const verifyHandler = await import('@src/routes/api/auth/2fa/verify/+server.ts');
const disableHandler = await import('@src/routes/api/auth/2fa/disable/+server.ts');
const backupCodesHandler = await import('@src/routes/api/auth/2fa/backup-codes/+server.ts');

const POST_SETUP = setupHandler.POST;
const POST_VERIFY_SETUP = verifySetupHandler.POST;
const POST_VERIFY = verifyHandler.POST;
const POST_DISABLE = disableHandler.POST;
const GET_BACKUP_CODES = backupCodesHandler.GET;
const POST_BACKUP_CODES = backupCodesHandler.POST;

describe('2FA API Unit Tests', () => {
	let mockTwoFactorService: any;
	let mockGetPrivateSettingSync: any;

	beforeEach(async () => {
		vi.clearAllMocks();

		const { getDefaultTwoFactorAuthService } = await import('@src/databases/auth/two-factor-auth');
		mockTwoFactorService = getDefaultTwoFactorAuthService({} as any);

		const { getPrivateSettingSync } = await import('@src/services/settings-service');
		mockGetPrivateSettingSync = getPrivateSettingSync;
		mockGetPrivateSettingSync.mockReturnValue(false);
	});

	// Helper to create mock event
	const createMockEvent = (body: any = {}, user: any = null, tenantId?: string) => {
		return {
			request: {
				json: vi.fn().mockResolvedValue(body)
			},
			locals: {
				user,
				tenantId
			}
		} as unknown as RequestEvent;
	};

	describe('POST /api/auth/2fa/verify', () => {
		it('should verify TOTP code successfully', async () => {
			mockTwoFactorService.verify2FA.mockResolvedValue({
				success: true,
				method: 'totp',
				message: 'Success'
			});

			const event = createMockEvent({ userId: 'user-1', code: '123456' });
			const response = await POST_VERIFY(event);
			const result = await response.json();

			expect(result.success).toBe(true);
			expect(mockTwoFactorService.verify2FA).toHaveBeenCalledWith('user-1', '123456', undefined);
		});

		it('should verify backup code successfully', async () => {
			mockTwoFactorService.verify2FA.mockResolvedValue({
				success: true,
				method: 'backup',
				backupCodeUsed: true,
				message: 'Success'
			});

			const event = createMockEvent({ userId: 'user-1', code: 'backup-123' });
			const response = await POST_VERIFY(event);
			const result = await response.json();

			expect(result.success).toBe(true);
			expect(result.backupCodeUsed).toBe(true);
		});

		it('should return success: false for invalid code', async () => {
			mockTwoFactorService.verify2FA.mockResolvedValue({
				success: false,
				message: 'Invalid code'
			});

			const event = createMockEvent({ userId: 'user-1', code: '000000' });
			const response = await POST_VERIFY(event);
			const result = await response.json();

			expect(result.success).toBe(false);
			expect(result.message).toBe('Invalid code');
		});

		it('should throw TENANT_REQUIRED in multi-tenant mode without tenant context', async () => {
			mockGetPrivateSettingSync.mockReturnValue(true);

			const event = createMockEvent({ userId: 'user-1', code: '123456' });
			// locals.tenantId is undefined by default in createMockEvent

			await expect(POST_VERIFY(event)).rejects.toThrow('Tenant context is required');
		});

		it('should use locals.tenantId in multi-tenant mode', async () => {
			mockGetPrivateSettingSync.mockReturnValue(true);
			mockTwoFactorService.verify2FA.mockResolvedValue({ success: true });

			const event = createMockEvent({ userId: 'user-1', code: '123456' }, null, 'tenant-A');
			await POST_VERIFY(event);

			expect(mockTwoFactorService.verify2FA).toHaveBeenCalledWith('user-1', '123456', 'tenant-A');
		});
	});

	describe('POST /api/auth/2fa/setup', () => {
		it('should initiate setup for authenticated user', async () => {
			const user = { _id: 'user-1', email: 'test@example.com' };
			mockTwoFactorService.initiate2FASetup.mockResolvedValue({ secret: 'secret' });

			const event = createMockEvent({}, user);
			const response = await POST_SETUP(event);
			const result = await response.json();

			expect(result.success).toBe(true);
			expect(result.data.secret).toBe('secret');
		});

		it('should throw UNAUTHORIZED for unauthenticated user', async () => {
			const event = createMockEvent({});
			await expect(POST_SETUP(event)).rejects.toThrow('Authentication required');
		});

		it('should throw 2FA_ALREADY_ENABLED if user already has it', async () => {
			const user = { _id: 'user-1', is2FAEnabled: true };
			const event = createMockEvent({}, user);
			await expect(POST_SETUP(event)).rejects.toThrow('2FA is already enabled');
		});
	});

	describe('POST /api/auth/2fa/verify-setup', () => {
		it('should complete setup with valid code', async () => {
			const user = { _id: 'user-1' };
			mockTwoFactorService.complete2FASetup.mockResolvedValue(true);

			const event = createMockEvent(
				{
					secret: 'secret',
					verificationCode: '123456',
					backupCodes: ['code1']
				},
				user
			);

			const response = await POST_VERIFY_SETUP(event);
			const result = await response.json();

			expect(result.success).toBe(true);
		});

		it('should throw INVALID_VERIFICATION_CODE for wrong code', async () => {
			const user = { _id: 'user-1' };
			mockTwoFactorService.complete2FASetup.mockResolvedValue(false);

			const event = createMockEvent(
				{
					secret: 'secret',
					verificationCode: '000000',
					backupCodes: []
				},
				user
			);

			await expect(POST_VERIFY_SETUP(event)).rejects.toThrow('Invalid verification code');
		});
	});

	describe('POST /api/auth/2fa/disable', () => {
		it('should disable 2FA for enabled user', async () => {
			const user = { _id: 'user-1', is2FAEnabled: true };
			mockTwoFactorService.disable2FA.mockResolvedValue(true);

			const event = createMockEvent({}, user);
			const response = await POST_DISABLE(event);
			const result = await response.json();

			expect(result.success).toBe(true);
		});

		it('should throw 2FA_DISABLED if not enabled', async () => {
			const user = { _id: 'user-1', is2FAEnabled: false };
			const event = createMockEvent({}, user);
			await expect(POST_DISABLE(event)).rejects.toThrow('2FA is not enabled');
		});
	});

	describe('Backup Codes Management', () => {
		it('should return 2FA status (GET)', async () => {
			const user = { _id: 'user-1' };
			mockTwoFactorService.get2FAStatus.mockResolvedValue({ enabled: true, backupCodesCount: 5 });

			const event = createMockEvent({}, user);
			const response = await GET_BACKUP_CODES(event);
			const result = await response.json();

			expect(result.success).toBe(true);
			expect(result.data.backupCodesCount).toBe(5);
		});

		it('should regenerate backup codes (POST)', async () => {
			const user = { _id: 'user-1', is2FAEnabled: true };
			mockTwoFactorService.regenerateBackupCodes.mockResolvedValue(['new1', 'new2']);

			const event = createMockEvent({}, user);
			const response = await POST_BACKUP_CODES(event);
			const result = await response.json();

			expect(result.success).toBe(true);
			expect(result.data.backupCodes).toHaveLength(2);
		});
	});
});
