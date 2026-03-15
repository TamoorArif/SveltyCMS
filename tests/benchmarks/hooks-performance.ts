/**
 * @file tests/benchmarks/hooks-performance.ts
 * @description High-resolution benchmark for SveltyCMS middleware hooks pipeline (2026 edition)
 */

import { performance } from 'node:perf_hooks';

const ITERATIONS = 100_000;
const PATHS = {
	static: '/_app/immutable/chunks/index-abc123.js',
	api: '/api/collections?tenant=123',
	configPage: '/config/collectionbuilder'
};

const STATIC_ASSET_REGEX = /\.(js|css|map|woff2?|ttf|eot|svg|png|jpg|jpeg|gif|webp|ico)$/i;

// Binary sink to prevent dead-code elimination (DCE)
let sink = 0;

function simulateMiddlewareHotPath(path: string): void {
	if (STATIC_ASSET_REGEX.test(path)) {
		sink ^= 1;
		return;
	}
	if (STATIC_ASSET_REGEX.test(path)) {
		sink ^= 2;
		return;
	}
	const isApi = path.startsWith('/api/');
	if (isApi) {
		sink ^= 4;
		return;
	}
	// eslint-disable-next-line @typescript-eslint/no-unused-expressions
	sink ^= 'x-forwarded-for' in {} ? 8 : 0;
}

function simulateMiddlewareFullPath(path: string): void {
	sink ^= STATIC_ASSET_REGEX.test(path) ? 1 : 0;
	// eslint-disable-next-line @typescript-eslint/no-unused-expressions
	sink ^= path.startsWith('/api/') ? 2 : 0;
	// eslint-disable-next-line @typescript-eslint/no-unused-expressions
	sink ^= 'accept-language' in {} ? 4 : 0;
	// eslint-disable-next-line @typescript-eslint/no-unused-expressions
	sink ^= 'cookie' in {} ? 8 : 0;
	// eslint-disable-next-line @typescript-eslint/no-unused-expressions
	sink ^= path.length > 0 ? 16 : 0;
}

async function runBenchmark() {
	console.log(`\n🚀 SveltyCMS Middleware Benchmark – ${new Date().toISOString()}`);
	console.log(`Iterations: ${ITERATIONS.toLocaleString()}\n`);

	const scenarios = [
		{ name: 'Static asset early exit', fn: simulateMiddlewareHotPath, path: PATHS.static },
		{ name: 'API fast path (skip locale/theme)', fn: simulateMiddlewareHotPath, path: PATHS.api },
		{ name: 'Dynamic page full path', fn: simulateMiddlewareFullPath, path: PATHS.configPage }
	];

	const results = scenarios.map((scenario) => {
		// Warmup
		for (let i = 0; i < 1000; i++) scenario.fn(scenario.path);

		const start = performance.now();
		for (let i = 0; i < ITERATIONS; i++) {
			scenario.fn(scenario.path);
		}
		const end = performance.now();
		const totalMs = end - start;
		const avgMicro = (totalMs * 1000) / ITERATIONS;

		return {
			Scenario: scenario.name,
			'Avg (µs)': avgMicro.toFixed(4)
		};
	});

	console.table(results);

	const apiAvg = parseFloat(results[1]['Avg (µs)']);
	const fullAvg = parseFloat(results[2]['Avg (µs)']);
	const saved = (fullAvg - apiAvg).toFixed(2);

	console.log('\n-----------------------------------------------------------');
	console.log(`⚡ Savings on API paths: ~${saved} µs per request`);
	console.log(`📈 Potential throughput gain (at 500 µs baseline): +${((parseFloat(saved) / 500) * 100).toFixed(1)}%`);
	console.log(`🧪 Sink state: ${sink} (DCE guard)`);
	console.log('-----------------------------------------------------------');
	console.log('✅ Benchmark complete.');
}

runBenchmark().catch(console.error);
