/**
 * @file tests/unit/api/saml.test.ts
 * @description Unit tests for SAML SSO API routes
 *
 * Tests:
 * - POST /api/auth/saml/config - Configure SAML connection
 * - GET /api/auth/saml/login - Initiate SAML login
 * - POST /api/auth/saml/acs - SAML ACS callback
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';

// Mock dependencies
vi.mock('@src/databases/db', () => ({
	auth: {
		getUserBySamlId: vi.fn(),
		getUserByEmail: vi.fn(),
		getUserById: vi.fn(),
		createUser: vi.fn(),
		createSession: vi.fn(),
		checkUser: vi.fn(),
		createSessionCookie: vi.fn().mockReturnValue({ name: 'session', value: 'secret', attributes: {} }),
		authInterface: {
			getUserById: vi.fn()
		}
	},
	dbAdapter: {
		auth: {
			getUserCount: vi.fn(),
			getAllUsers: vi.fn()
		}
	},
	dbInitPromise: Promise.resolve()
}));

vi.mock('@src/databases/auth/saml-auth', () => ({
	createSAMLConnection: vi.fn(),
	generateSAMLAuthUrl: vi.fn(),
	getJackson: vi.fn().mockResolvedValue({
		oauthController: {
			samlResponse: vi.fn()
		}
	})
}));

vi.mock('@src/services/settings-service', () => ({
	getPrivateSettingSync: vi.fn().mockReturnValue(false),
	getPublicSettingSync: vi.fn().mockReturnValue(true)
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

// Import handlers after mocks
const configHandlers = await import('@src/routes/api/auth/saml/config/+server.ts');
const loginHandlers = await import('@src/routes/api/auth/saml/login/+server.ts');
const acsHandlers = await import('@src/routes/api/auth/saml/acs/+server.ts');

const POST_CONFIG = configHandlers.POST;
const GET_LOGIN = loginHandlers.GET;
const POST_ACS = acsHandlers.POST;

describe('SAML SSO API Unit Tests', () => {
	let mockAuth: any;
	let mockSamlAuth: any;
	let mockSettings: any;

	beforeEach(async () => {
		vi.clearAllMocks();
		const authModule = await import('@src/databases/db');
		const samlModule = await import('@src/databases/auth/saml-auth');
		const settingsModule = await import('@src/services/settings-service');

		mockAuth = authModule.auth;
		mockSamlAuth = samlModule;
		mockSettings = settingsModule;
	});

	describe('POST /api/auth/saml/config', () => {
		it('should create SAML connection successfully', async () => {
			mockSamlAuth.createSAMLConnection.mockResolvedValue({ id: 'conn-1' });

			const event = {
				request: {
					json: vi.fn().mockResolvedValue({
						tenant: 'tenant-1',
						product: 'sveltycms',
						rawMetadata: '<xml></xml>',
						defaultRedirectUrl: 'http://localhost/admin'
					})
				},
				locals: {
					user: { _id: 'admin-1', role: 'admin', tenantId: 'tenant-1' }
				}
			} as unknown as RequestEvent;

			const response = await POST_CONFIG(event);
			const data = await response.json();

			expect(data.success).toBe(true);
			expect(mockSamlAuth.createSAMLConnection).toHaveBeenCalled();
		});

		it('should throw tenant mismatch error in multi-tenant mode', async () => {
			mockSettings.getPrivateSettingSync.mockReturnValue(true); // MULTI_TENANT = true

			const event = {
				request: {
					json: vi.fn().mockResolvedValue({
						tenant: 'tenant-wrong',
						product: 'sveltycms',
						rawMetadata: '<xml></xml>',
						defaultRedirectUrl: 'http://localhost/admin'
					})
				},
				locals: {
					user: { _id: 'admin-1', role: 'admin', tenantId: 'tenant-1' }
				}
			} as unknown as RequestEvent;

			await expect(POST_CONFIG(event)).rejects.toThrow('Tenant mismatch. You are only authorized to configure SAML for tenant: tenant-1');
		});
	});

	describe('GET /api/auth/saml/login', () => {
		it('should return redirect URL for valid tenant', async () => {
			mockSamlAuth.generateSAMLAuthUrl.mockResolvedValue('http://idp.com/sso');

			const event = {
				url: new URL('http://localhost/api/auth/saml/login?tenant=tenant-1')
			} as unknown as RequestEvent;

			try {
				await GET_LOGIN(event);
			} catch (err: any) {
				expect(err.status).toBe(302);
				expect(err.location).toBe('http://idp.com/sso');
			}
		});

		it('should throw error if tenant is missing in multi-tenant mode', async () => {
			mockSettings.getPrivateSettingSync.mockReturnValue(true);

			const event = {
				url: new URL('http://localhost/api/auth/saml/login')
			} as unknown as RequestEvent;

			await expect(GET_LOGIN(event)).rejects.toThrow('Tenant identifier is required in multi-tenant mode');
		});
	});

	describe('POST /api/auth/saml/acs', () => {
		it('should process SAML assertion and create session', async () => {
			const mockJackson = await mockSamlAuth.getJackson();
			mockJackson.oauthController.samlResponse.mockResolvedValue({
				profile: {
					id: 'saml-123',
					email: 'user@tenant1.com',
					firstName: 'John',
					lastName: 'Doe',
					requested: { tenant: 'tenant-1' }
				}
			});

			mockAuth.getUserBySamlId.mockResolvedValue({ _id: 'user-1', tenantId: 'tenant-1', blocked: false });
			mockAuth.createSession.mockResolvedValue({ _id: 'session-1' });

			const event = {
				request: {
					headers: new Map([['x-forwarded-for', '127.0.0.1']]),
					formData: vi.fn().mockResolvedValue(new Map([['SAMLResponse', 'base64-blob']]))
				},
				cookies: {
					set: vi.fn()
				},
				getClientAddress: () => '127.0.0.1'
			} as unknown as RequestEvent;

			try {
				await POST_ACS(event);
			} catch (err: any) {
				expect(err.status).toBe(302);
				expect(err.location).toBe('/admin');
				expect(mockAuth.createSession).toHaveBeenCalled();
				expect(event.cookies.set).toHaveBeenCalled();
			}
		});

		it('should handle JIT provisioning', async () => {
			mockSettings.getPrivateSettingSync.mockImplementation((key: string) => {
				if (key === 'SAML_JIT_PROVISIONING') return true;
				return false;
			});

			const mockJackson = await mockSamlAuth.getJackson();
			mockJackson.oauthController.samlResponse.mockResolvedValue({
				profile: {
					id: 'saml-new',
					email: 'new-user@tenant1.com',
					requested: { tenant: 'tenant-1' }
				}
			});

			mockAuth.getUserBySamlId.mockResolvedValue(null);
			mockAuth.getUserByEmail.mockResolvedValue(null);
			mockAuth.createUser.mockResolvedValue({ _id: 'new-id', tenantId: 'tenant-1', blocked: false });
			mockAuth.getUserById.mockResolvedValue({ _id: 'new-id', role: 'VIEWER', blocked: false });
			mockAuth.createSession.mockResolvedValue({ _id: 'session-2' });

			const event = {
				request: {
					headers: new Map([['x-forwarded-for', '127.0.0.1']]),
					formData: vi.fn().mockResolvedValue(new Map([['SAMLResponse', 'blob']]))
				},
				cookies: {
					set: vi.fn()
				},
				getClientAddress: () => '127.0.0.1'
			} as unknown as RequestEvent;

			try {
				await POST_ACS(event);
			} catch (err: any) {
				expect(err.status).toBe(302);
				expect(err.location).toBe('/admin');
				expect(mockAuth.createUser).toHaveBeenCalled();
				expect(mockAuth.createSession).toHaveBeenCalled();
			}
		});
	});
});
