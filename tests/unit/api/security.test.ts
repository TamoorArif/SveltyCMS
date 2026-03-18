/**
 * @file tests/unit/api/security.test.ts
 * @description Unit tests for unified security API endpoints, focusing on stats and reporting.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// 1. Local mocks definition
const mockStats = {
	totalIncidents: 10,
	activeIncidents: 2,
	blockedIPs: 5,
	threatLevelDistribution: { none: 20, low: 5, medium: 3, high: 1, critical: 1 },
	metrics: { cspViolations: 0, rateLimitViolations: 0, authFailures: 0 },
	overallStatus: 'stable'
};

// Mock services that might be used by the handler
const mockMetricsService = (globalThis as any).metricsService || {
	incrementCSPViolations: vi.fn(),
	getReport: vi.fn(() => ({ security: { cspViolations: 0, rateLimitViolations: 0, authFailures: 0 } }))
};

const mockSecurityResponseService = (globalThis as any).securityResponseService || {
	getSecurityStats: vi.fn(() => mockStats),
	getActiveIncidents: vi.fn(() => []),
	analyzeRequest: vi.fn(() => Promise.resolve({ level: 'none', action: 'allow' }))
};

// Set up the module mocks BEFORE importing handlers
vi.mock('@src/services/metrics-service', () => ({ metricsService: mockMetricsService }));
vi.mock('@src/services/security-response-service', () => ({ securityResponseService: mockSecurityResponseService }));

// 2. Import handlers dynamically AFTER mocks
const { GET: getStats } = await import('@src/routes/api/security/stats/+server');
const { POST: postCspReport } = await import('@src/routes/api/security/csp-report/+server');

// Import services for verification in tests
import { metricsService } from '@src/services/metrics-service';

describe('Security API Unit Tests', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('GET /api/security/stats', () => {
		it('should return security stats for authorized admin', async () => {
			const event = {
				locals: {
					user: { _id: 'admin1', role: 'admin' }
				}
			} as any;

			const response = await getStats(event);
			expect(response.status).toBe(200);

			const data = await response.json();
			expect(data.overallStatus).toBeDefined();
			expect(data.activeIncidents).toBeDefined();
		});

		it('should reject unauthorized access', async () => {
			const event = {
				locals: {
					user: { _id: 'user1', role: 'user' }
				}
			} as any;

			const response = await getStats(event);
			expect(response.status).toBe(403);
		});
	});

	describe('POST /api/security/csp-report', () => {
		it('should record CSP violation with tenant context', async () => {
			const report = {
				'csp-report': {
					'document-uri': 'http://localhost/page',
					'violated-directive': 'script-src',
					'original-policy': "script-src 'self'",
					'blocked-uri': 'http://evil.com/malicious.js',
					disposition: 'enforce'
				}
			};

			const event = {
				request: {
					headers: {
						get: (name: string) => (name === 'content-type' ? 'application/csp-report' : null)
					},
					json: vi.fn().mockResolvedValue(report)
				},
				locals: { tenantId: 'tenant1' },
				getClientAddress: () => '127.0.0.1'
			} as any;

			const response = await postCspReport(event);
			expect(response.status).toBe(200);

			const data = await response.json();
			expect(data.status).toBe('received');

			// Verify it tracked the violation
			expect(metricsService.incrementCSPViolations).toHaveBeenCalledWith('tenant1');
		});

		it('should ignore false positives', async () => {
			const report = {
				'csp-report': {
					'document-uri': 'http://localhost/page',
					'violated-directive': 'script-src',
					'original-policy': "script-src 'self'",
					'blocked-uri': 'chrome-extension://malicious/script.js',
					disposition: 'enforce'
				}
			};

			const event = {
				request: {
					headers: {
						get: (name: string) => (name === 'content-type' ? 'application/csp-report' : null)
					},
					json: vi.fn().mockResolvedValue(report)
				},
				locals: { tenantId: 'tenant1' },
				getClientAddress: () => '127.0.0.1'
			} as any;

			const response = await postCspReport(event);
			expect(response.status).toBe(200);

			const data = await response.json();
			expect(data.status).toBe('ignored');
			expect(metricsService.incrementCSPViolations).not.toHaveBeenCalled();
		});
	});
});
