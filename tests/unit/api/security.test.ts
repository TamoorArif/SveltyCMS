/**
 * @file tests/unit/api/security.test.ts
 * @description Whitebox unit tests for Security API endpoints (/api/security/*).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock apiHandler to be a pass-through
vi.mock('@utils/api-handler', () => ({
	apiHandler: vi.fn((handler) => handler)
}));

// 1. Mock dependencies BEFORE importing the handlers
vi.mock('@src/services/metrics-service', () => ({
	metricsService: {
		getReport: vi.fn(),
		incrementCSPViolations: vi.fn(),
		incrementSecurityViolations: vi.fn()
	}
}));

vi.mock('@src/services/security-response-service', () => ({
	securityResponseService: {
		getSecurityStats: vi.fn(),
		getActiveIncidents: vi.fn()
	}
}));

vi.mock('@src/databases/auth/api-permissions', () => ({
	hasApiPermission: vi.fn()
}));

vi.mock('@utils/logger.server', () => ({
	logger: {
		debug: vi.fn(),
		info: vi.fn(),
		trace: vi.fn(),
		warn: vi.fn(),
		error: vi.fn()
	}
}));

vi.mock('$app/environment', () => ({
	dev: false
}));

// Mock SvelteKit json to return a simple object we can inspect
vi.mock('@sveltejs/kit', () => ({
	json: vi.fn((data) => ({
		_data: data,
		status: 200,
		json: async () => data
	})),
	error: vi.fn((status, message) => {
		throw { status, message };
	})
}));

// 2. Import handlers and services (they will use the mocks)
import { GET as getStats } from '@src/routes/api/security/stats/+server';
import { POST as postCspReport } from '@src/routes/api/security/csp-report/+server';
import { metricsService } from '@src/services/metrics-service';
import { securityResponseService } from '@src/services/security-response-service';
import { hasApiPermission } from '@src/databases/auth/api-permissions';

describe('Security API', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('GET /api/security/stats', () => {
		it('should return security stats for authorized admin', async () => {
			const mockLocals = {
				user: { _id: 'user1', role: 'admin' },
				tenantId: 'tenant1'
			};

			vi.mocked(hasApiPermission).mockReturnValue(true);
			vi.mocked(securityResponseService.getSecurityStats).mockReturnValue({
				activeIncidents: 2,
				blockedIPs: 5,
				throttledIPs: 1,
				totalIncidents: 10,
				threatLevelDistribution: { low: 5, medium: 3, high: 2, critical: 0, none: 0 }
			} as any);

			vi.mocked(metricsService.getReport).mockReturnValue({
				security: { cspViolations: 10, rateLimitViolations: 5, authFailures: 2 },
				requests: { avgResponseTime: 50, errorRate: 0.01 },
				performance: { slowRequests: 1 },
				authentication: { successRate: 0.98 },
				api: { cacheHitRate: 0.85 },
				uptime: 3600
			} as any);

			vi.mocked(securityResponseService.getActiveIncidents).mockReturnValue([
				{
					id: 'inc1',
					timestamp: Date.now(),
					clientIp: '1.2.3.4',
					threatLevel: 'high',
					indicators: [{ evidence: 'SQLi' }],
					responseActions: [],
					resolved: false
				}
			] as any);

			const event = {
				locals: mockLocals,
				getClientAddress: () => '127.0.0.1'
			} as any;

			const response = await getStats(event);
			const data = await (response as any).json();

			expect(data.tenantId).toBe('tenant1');
			expect(data.activeIncidents).toBe(2);
			expect(data.recentEvents).toHaveLength(1);
			expect(securityResponseService.getSecurityStats).toHaveBeenCalledWith('tenant1');
		});

		it('should deny access if user is not authorized', async () => {
			const mockLocals = {
				user: { _id: 'user2', role: 'user' },
				tenantId: 'tenant1'
			};

			vi.mocked(hasApiPermission).mockReturnValue(false);

			const event = {
				locals: mockLocals,
				getClientAddress: () => '127.0.0.1'
			} as any;

			await expect(getStats(event)).rejects.toThrow();
		});

		it('should support global stats when no tenantId is present', async () => {
			const mockLocals = {
				user: { _id: 'user1', role: 'admin' },
				tenantId: null
			};

			vi.mocked(hasApiPermission).mockReturnValue(true);
			vi.mocked(securityResponseService.getSecurityStats).mockReturnValue({
				activeIncidents: 0,
				totalIncidents: 0,
				blockedIPs: 0,
				throttledIPs: 0,
				threatLevelDistribution: { low: 0, medium: 0, high: 0, critical: 0, none: 0 }
			} as any);
			vi.mocked(metricsService.getReport).mockReturnValue({ security: {} } as any);
			vi.mocked(securityResponseService.getActiveIncidents).mockReturnValue([]);

			const event = {
				locals: mockLocals,
				getClientAddress: () => '127.0.0.1'
			} as any;

			const response = await getStats(event);
			const data = await (response as any).json();

			expect(data.tenantId).toBe('global');
			expect(securityResponseService.getSecurityStats).toHaveBeenCalledWith(undefined);
		});
	});

	describe('POST /api/security/csp-report', () => {
		it('should record CSP violation with tenant context', async () => {
			const mockLocals = { tenantId: 'tenant1' };
			const mockReport = {
				'csp-report': {
					'document-uri': 'https://example.com',
					'violated-directive': 'script-src',
					'original-policy': 'default-src self',
					'blocked-uri': 'http://malicious.com'
				}
			};

			const event = {
				locals: mockLocals,
				request: {
					headers: { get: () => 'application/csp-report' },
					json: async () => mockReport
				},
				getClientAddress: () => '127.0.0.1'
			} as any;

			const response = await postCspReport(event);
			const data = await (response as any).json();

			expect(data.status).toBe('received');
			expect(metricsService.incrementCSPViolations).toHaveBeenCalledWith('tenant1');
		});

		it('should ignore false positives', async () => {
			const mockReport = {
				'csp-report': {
					'document-uri': 'https://example.com',
					'violated-directive': 'script-src',
					'original-policy': 'default-src self',
					'blocked-uri': 'chrome-extension://xyz'
				}
			};

			const event = {
				locals: { tenantId: 'tenant1' },
				request: {
					headers: { get: () => 'application/csp-report' },
					json: async () => mockReport
				},
				getClientAddress: () => '127.0.0.1'
			} as any;

			const response = await postCspReport(event);
			const data = await (response as any).json();

			expect(data.status).toBe('ignored');
			expect(metricsService.incrementCSPViolations).not.toHaveBeenCalled();
		});
	});
});
