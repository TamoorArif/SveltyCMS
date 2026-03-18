/**
 * @file tests/unit/api/media-security-critical.test.ts
 * @description Unit tests for critical Media API security fixes (Command Injection, SSRF, Directory Traversal).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { lookup } from 'node:dns/promises';
import { spawn } from 'node:child_process';
import { isPrivateIP, validateRemoteUrl } from '@src/utils/security/url-validator';
import * as storage from '@src/utils/media/media-storage.server';

// --- Mocks must be at the top level ---

// 1. Mock child_process
vi.mock('node:child_process', async (importOriginal) => {
	const actual = (await importOriginal()) as any;
	const mockSpawn = vi.fn(() => ({
		on: vi.fn((event, cb) => {
			if (event === 'exit') cb(0);
		}),
		stderr: { on: vi.fn() }
	}));
	return {
		...actual,
		spawn: mockSpawn,
		default: { ...actual, spawn: mockSpawn }
	};
});

// 2. Mock dns/promises
vi.mock('node:dns/promises', async (importOriginal) => {
	const actual = (await importOriginal()) as any;
	const mockLookup = vi.fn();
	return {
		...actual,
		lookup: mockLookup,
		default: { ...actual, lookup: mockLookup }
	};
});

// 3. Mock fs/promises
vi.mock('node:fs/promises', async (importOriginal) => {
	const actual = (await importOriginal()) as any;
	const mocks = {
		readFile: vi.fn().mockResolvedValue(Buffer.from('ok')),
		mkdir: vi.fn(),
		writeFile: vi.fn(),
		access: vi.fn()
	};
	return {
		...actual,
		...mocks,
		default: { ...actual, ...mocks }
	};
});

// 4. Mock App dependencies
vi.mock('@src/databases/db', () => ({
	dbAdapter: {
		crud: {
			findOne: vi.fn().mockResolvedValue({
				success: true,
				data: { _id: 'vid123', type: 'video', path: 'videos/test.mp4' }
			})
		}
	}
}));

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

vi.mock('@src/services/settings-service', () => ({
	getPublicSettingSync: vi.fn().mockReturnValue('mediaFolder'),
	getPrivateSettingSync: vi.fn().mockReturnValue(true)
}));

vi.mock('@src/stores/global-settings.svelte', () => ({
	publicEnv: {
		MEDIA_FOLDER: 'mediaFolder'
	}
}));

vi.mock('@src/utils/error-handling', () => ({
	AppError: class extends Error {
		constructor(
			message: string,
			public status: number,
			public code: string
		) {
			super(message);
		}
	}
}));

vi.mock('@utils/logger.server', () => ({
	logger: {
		info: vi.fn(),
		error: vi.fn(),
		warn: vi.fn(),
		debug: vi.fn()
	}
}));

// Import the handler AFTER everything is mocked
import * as transcodeHandler from '@src/routes/api/media/transcode/+server';

describe('Critical Security Fixes Verification', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('Command Injection Prevention', () => {
		it('should use spawn instead of exec for transcoding', async () => {
			const event = {
				request: {
					json: vi.fn().mockResolvedValue({ mediaId: 'vid123', targetFormat: 'hls' })
				},
				locals: { user: { _id: 'u1' }, tenantId: 't1' }
			};

			const response = await (transcodeHandler as any).POST(event as any);
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
			vi.mocked(lookup).mockResolvedValue({ address: '127.0.0.1', family: 4 } as any);
			await expect(validateRemoteUrl('https://localhost/admin')).rejects.toThrow('Access to internal/private network is forbidden');
		});

		it('should block private IPv4 ranges (10.x.x.x)', async () => {
			vi.mocked(lookup).mockResolvedValue({ address: '10.0.1.5', family: 4 } as any);
			await expect(validateRemoteUrl('https://internal.service')).rejects.toThrow('Access to internal/private network is forbidden');
		});

		it('should allow public IPs', async () => {
			vi.mocked(lookup).mockResolvedValue({ address: '8.8.8.8', family: 4 } as any);
			await expect(validateRemoteUrl('https://google.com/logo.png')).resolves.not.toThrow();
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
