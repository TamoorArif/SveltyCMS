/**
 * @file tests/e2e/global.setup.ts
 * @description Pre-configures SveltyCMS for e2e tests.
 *
 * Order: globalSetup (this) → playwright starts tests
 *
 * Strategy:
 * 1. Write config/private.ts to filesystem
 * 2. Start dev server (it reads config, sees setup is "complete" from file perspective)
 * 3. Wait for server ready
 * 4. Seed database + create admin user via API
 * 5. Server stays running for tests
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';

const BASE_URL = process.env.PLAYWRIGHT_TEST_BASE_URL || (process.env.CI ? 'http://localhost:4173' : 'http://localhost:5173');
const PORT = parseInt(new URL(BASE_URL).port || '5173', 10);

let devServer: ChildProcess | null = null;

async function waitUntilReady(url: string, timeoutMs = 120_000): Promise<boolean> {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		try {
			const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(3000) });
			if (res.status === 200 || res.status === 302 || res.status === 307) return true;
		} catch {
			// not ready
		}
		await new Promise((r) => setTimeout(r, 2000));
	}
	return false;
}

async function globalSetup() {
	console.log(`\n🌐 [global.setup] Base URL: ${BASE_URL}, Port: ${PORT}`);

	// Kill any existing process on the port
	try {
		const { execSync } = await import('node:child_process');
		execSync(`lsof -ti :${PORT} | xargs kill -9 2>/dev/null || true`, { stdio: 'ignore' });
		await new Promise((r) => setTimeout(r, 1000));
	} catch { /* ignore */ }

	// Step 1: Write config/private.ts
	const configDir = path.join(process.cwd(), 'config');
	fs.mkdirSync(configDir, { recursive: true });

	const jwtKey = crypto.randomBytes(32).toString('base64');
	const encKey = crypto.randomBytes(32).toString('base64');
	const adminPassword = process.env.ADMIN_PASS || 'Admin123!';

	fs.writeFileSync(
		path.join(configDir, 'private.ts'),
		`
export const privateEnv = {
	DB_TYPE: '${process.env.DB_TYPE || 'sqlite'}',
	DB_HOST: '${process.env.DB_HOST || 'localhost'}',
	DB_PORT: ${Number(process.env.DB_PORT) || 0},
	DB_NAME: '${process.env.DB_NAME || 'sveltycms_test'}',
	DB_USER: '${process.env.DB_USER || ''}',
	DB_PASSWORD: '${process.env.DB_PASSWORD || ''}',
	DB_RETRY_ATTEMPTS: 5,
	DB_RETRY_DELAY: 3000,
	JWT_SECRET_KEY: '${jwtKey}',
	ENCRYPTION_KEY: '${encKey}',
	MULTI_TENANT: false,
	DEMO: false,
};
`,
		'utf-8'
	);
	console.log('[global.setup] ✅ config/private.ts written.');

	// Step 2: Start dev server
	if (process.env.CI) {
		console.log('[global.setup] CI mode — waiting for external server...');
	} else {
		console.log(`[global.setup] Starting dev server on port ${PORT}...`);
		devServer = spawn('bun', ['dev', '--port', String(PORT)], {
			cwd: process.cwd(),
			stdio: ['ignore', 'pipe', 'pipe'],
			env: { ...process.env, PLAYWRIGHT_TEST: 'true' }
		});
		devServer.stdout?.on('data', (d: Buffer) => process.stdout.write(d));
		devServer.stderr?.on('data', (d: Buffer) => process.stderr.write(d));
		devServer.unref();
	}

	if (!(await waitUntilReady(BASE_URL))) {
		console.error('[global.setup] ❌ Server failed to start.');
		return;
	}
	console.log('[global.setup] ✅ Server ready.');

	// Step 3: Seed database via API
	const dbConfig = {
		type: process.env.DB_TYPE || 'sqlite',
		host: process.env.DB_HOST || 'localhost',
		port: process.env.DB_PORT || '',
		name: process.env.DB_NAME || 'sveltycms_test',
		user: process.env.DB_USER || '',
		password: process.env.DB_PASSWORD || ''
	};

	console.log('[global.setup] Seeding database...');

	const seedForm = new FormData();
	seedForm.append('config', JSON.stringify(dbConfig));

	try {
		const seedRes = await fetch(`${BASE_URL}/setup?/seedDatabase`, {
			method: 'POST',
			headers: { Origin: BASE_URL, Referer: `${BASE_URL}/setup` },
			body: seedForm
		});
		const seedBody = await seedRes.json();
		console.log('[global.setup] seedDatabase:', JSON.stringify(seedBody).slice(0, 200));
	} catch (e) {
		console.warn('[global.setup] seedDatabase error (may be expected if already seeded):', e);
	}

	// Wait for critical seeding
	await new Promise((r) => setTimeout(r, 5000));

	// Step 4: Create admin user
	const adminData = {
		database: dbConfig,
		admin: {
			username: process.env.ADMIN_USER || 'admin',
			email: process.env.ADMIN_EMAIL || 'admin@example.com',
			password: adminPassword,
			confirmPassword: adminPassword
		},
		system: {}
	};

	console.log(`[global.setup] Creating admin user (${adminData.admin.email})...`);

	const completeForm = new FormData();
	completeForm.append('data', JSON.stringify(adminData));

	try {
		const completeRes = await fetch(`${BASE_URL}/setup?/completeSetup`, {
			method: 'POST',
			headers: { Origin: BASE_URL, Referer: `${BASE_URL}/setup` },
			body: completeForm
		});
		const completeBody = await completeRes.json();
		console.log('[global.setup] completeSetup:', JSON.stringify(completeBody).slice(0, 300));
	} catch (e) {
		console.error('[global.setup] completeSetup error:', e);
	}

	// Wait for everything to settle
	await new Promise((r) => setTimeout(r, 2000));

	console.log('[global.setup] ✅ Setup complete. Server running on port', PORT);
}

export default globalSetup;
