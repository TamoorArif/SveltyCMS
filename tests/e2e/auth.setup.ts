import { test as setup, expect } from '@playwright/test';
import { loginAsAdmin, ADMIN_CREDENTIALS } from './helpers/auth';

const authFile = 'tests/e2e/.auth/user.json';

setup('authenticate as admin', async ({ page }) => {
	// 1. Reset Database for a clean slate
	console.log('[Setup] Resetting database...');
	const resetResponse = await page.request.post('/api/testing', {
		data: { action: 'reset' }
	});
	expect(resetResponse.ok()).toBeTruthy();

	// 2. Seed system via Testing API with explicit credentials
	console.log(`[Setup] Seeding database with ${ADMIN_CREDENTIALS.email}...`);
	const seedResponse = await page.request.post('/api/testing', {
		data: {
			action: 'seed',
			email: ADMIN_CREDENTIALS.email,
			password: ADMIN_CREDENTIALS.password
		}
	});

	if (!seedResponse.ok()) {
		const errorBody = await seedResponse.text();
		console.error(`[Setup] Seeding failed with status ${seedResponse.status()}: ${errorBody}`);
	}
	expect(seedResponse.ok()).toBeTruthy();

	// 3. Perform login
	await loginAsAdmin(page);

	// 4. Save storage state for all tests
	await page.context().storageState({ path: authFile });
});
