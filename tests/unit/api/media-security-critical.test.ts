/**
 * @file tests/unit/api/media-security-critical.test.ts
 * @description Unit tests for critical Media API security fixes (Command Injection, SSRF, Directory Traversal).
 */

// --- Mocks must be at the top level ---

const actualChildProcess = require('node:child_process');
const mockSpawn = vi.fn(() => ({
	on: vi.fn((event, cb) => {
		if (event === 'exit') cb(0);
	}),
	stderr: { on: vi.fn() }
}));

vi.mock('node:child_process', () => ({
	...actualChildProcess,
	spawn: mockSpawn,
	default: { ...actualChildProcess, spawn: mockSpawn }
}));

const actualDns = require('node:dns/promises');
const mockLookup = vi.fn().mockImplementation(async (hostname: string) => {
	let ip = '8.8.8.8';
	if (hostname.includes('loopback') || hostname.includes('localhost')) ip = '127.0.0.1';
	else if (hostname.includes('internal')) ip = '10.0.1.5';
	console.log(`--- mockLookup called for: [${hostname}] -> returning ${ip}`);
	return { address: ip, family: 4 };
});
vi.mock('node:dns/promises', () => ({
	...actualDns,
	lookup: mockLookup,
	default: { ...actualDns, lookup: mockLookup }
}));

const actualFs = require('node:fs/promises');
const fsMocks = {
	readFile: vi.fn().mockResolvedValue(Buffer.from('ok')),
	mkdir: vi.fn(),
	writeFile: vi.fn(),
	access: vi.fn()
};
vi.mock('node:fs/promises', () => ({
	...actualFs,
	...fsMocks,
	default: { ...actualFs, ...fsMocks }
}));

// 4. Mock App dependencies
// Mock db, settings, error-handling, and logger are handled by setup.ts

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { spawn } from 'node:child_process';
import { isPrivateIP, validateRemoteUrl } from '@src/utils/security/url-validator';
import * as storage from '@src/utils/media/media-storage.server';

vi.mock('@src/utils/media/media-service.server', () => {
	class MockMediaService {
		ensureInitialized = vi.fn();
		getMedia = vi.fn();
		updateMedia = vi.fn().mockResolvedValue({ success: true, metadata: {} });
		deleteMedia = vi.fn();
		saveMedia = vi.fn();
		manipulateMedia = vi.fn();
		saveRemoteMedia = vi.fn();
		batchProcessImages = vi.fn();
	}
	return {
		MediaService: MockMediaService
	};
});

// Import the handler AFTER everything is mocked
import { POST as transcodePOST } from '@src/routes/api/media/transcode/+server';
import { dbAdapter } from '@src/databases/db';

describe('Critical Security Fixes Verification', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('Command Injection Prevention', () => {
		it('should use spawn instead of exec for transcoding', async () => {
			(dbAdapter!.crud.findOne as any).mockResolvedValue({
				success: true,
				data: { _id: 'vid123', type: 'video', path: 'videos/test.mp4' }
			});

			const event = {
				request: {
					json: vi.fn().mockResolvedValue({ mediaId: 'vid123', targetFormat: 'hls' })
				},
				locals: { user: { _id: 'u1' }, tenantId: 't1' }
			};

			const response = await transcodePOST(event as any);
			const result = await response.json();
			if (!result.success) {
				console.log('Transcode handler failed:', result.error);
			}

			// Verify spawn was called with array of args
			expect(spawn).toHaveBeenCalledWith('ffmpeg', expect.any(Array));
		});
	});

	describe('SSRF Prevention', () => {
		it('should block non-HTTPS protocols', async () => {
			await expect(validateRemoteUrl('http://malicious.com')).rejects.toThrow('Only HTTPS URLs are allowed');
		});

		it('should block loopback addresses', async () => {
			await expect(validateRemoteUrl('https://localhost/admin')).rejects.toThrow('Access to internal/private network is forbidden');
		});

		it('should block private IPv4 ranges (10.x.x.x)', async () => {
			await expect(validateRemoteUrl('https://internal.service')).rejects.toThrow('Access to internal/private network is forbidden');
		});

		it('should allow public IPs', async () => {
			mockLookup.mockResolvedValueOnce({ address: '8.8.8.8', family: 4 } as any);
			await validateRemoteUrl('https://google.com/logo.png');
		});

		it('isPrivateIP should correctly identify various ranges', () => {
			expect(isPrivateIP('127.0.0.1')).toBe(true);
			expect(isPrivateIP('10.0.0.1')).toBe(true);
			expect(isPrivateIP('172.16.0.1')).toBe(true);
			expect(isPrivateIP('172.31.255.255')).toBe(true);
			expect(isPrivateIP('192.168.1.1')).toBe(true);
			expect(isPrivateIP('169.254.1.1')).toBe(true);
			expect(isPrivateIP('100.64.0.1')).toBe(true);
			expect(isPrivateIP('8.8.8.8')).toBe(false);
			expect(isPrivateIP('1.1.1.1')).toBe(false);
			// IPv6
			expect(isPrivateIP('::1')).toBe(true);
			expect(isPrivateIP('fe80::1')).toBe(true);
			expect(isPrivateIP('fd00::1')).toBe(true);
			expect(isPrivateIP('2001:4860:4860::8888')).toBe(false);
		});
	});

	describe('Directory Traversal Hardening', () => {
		it('should block path traversal in getFile using startsWith check', async () => {
			const traversalPath = '../../etc/passwd';
			await expect(storage.getFile(traversalPath)).rejects.toThrow('Potential traversal attack');
		});

		it('should block path traversal in saveFile', async () => {
			const buffer = Buffer.from('test');
			await expect(storage.saveFile(buffer, '../outside.txt')).rejects.toThrow('Potential traversal attack');
		});

		it('should allow legitimate deep paths within mediaFolder', async () => {
			const safePath = 'sub/folder/image.jpg';
			await expect(storage.getFile(safePath)).resolves.toBeDefined();
		});
	});
});
