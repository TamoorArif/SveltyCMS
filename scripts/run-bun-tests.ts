/**
 * @file scripts/run-bun-tests.ts
 * @description Isolated test runner for Bun to prevent module pollution/caching issues.
 */

import { spawnSync } from 'node:child_process';
import { globSync } from 'glob';

async function run() {
	console.log('🧪 Running Bun Unit Tests in Isolated Mode...');

	const files = globSync('tests/unit/**/*.test.ts').sort();
	let totalPassed = 0;
	let totalFailed = 0;
	const failedFiles: string[] = [];

	for (const file of files) {
		// Skip samples or templates if any
		if (file.includes('sample')) continue;

		console.log(`\n---------------------------------------------------------`);
		console.log(`📂 Testing ${file}`);
		console.log(`---------------------------------------------------------`);

		const result = spawnSync('bun', ['test', '--preload', './tests/unit/setup.ts', '--timeout', '20000', file], {
			stdio: 'inherit',
			shell: true
		});

		if (result.status === 0) {
			totalPassed++;
		} else {
			totalFailed++;
			failedFiles.push(file);
		}
	}

	console.log(`\n\n=========================================================`);
	console.log(`📊 Bun Test Summary:`);
	console.log(`✅ Passed: ${totalPassed}`);
	console.log(`❌ Failed: ${totalFailed}`);
	if (totalFailed > 0) {
		console.log(`\nFailed Files:`);
		failedFiles.forEach((f) => console.log(`  - ${f}`));
		process.exit(1);
	}
	console.log(`=========================================================`);
	process.exit(0);
}

run().catch((err) => {
	console.error('Test runner failed:', err);
	process.exit(1);
});
