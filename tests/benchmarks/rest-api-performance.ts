/**
 * @file tests/benchmarks/rest-api-performance.ts
 * @description Benchmark for SveltyCMS REST API.
 * Measures throughput (RPS) and latency for common endpoints.
 */

import { performance } from 'node:perf_hooks';
import fs from 'node:fs/promises';
import path from 'node:path';
import { prepareAuthenticatedContext } from '../integration/helpers/test-setup';
import { getApiBaseUrl, safeFetch } from '../integration/helpers/server';

const API_BASE_URL = getApiBaseUrl();
const DURATION_MS = 5000; // 5 seconds per test
const CONCURRENCY = 10; // Number of concurrent requests
const RESULTS_DIR = path.join(process.cwd(), 'tests/benchmarks/results');
const REGRESSION_THRESHOLD = 0.2; // 20% for network-based benchmarks

interface BenchResult {
	endpoint: string;
	totalRequests: number;
	rps: number;
	avgLatency: number;
	p95Latency: number;
}

async function measureEndpoint(name: string, path: string, options: RequestInit = {}): Promise<BenchResult> {
	console.log(`\n🧪 Benchmarking: ${name} (${path})...`);

	const latencies: number[] = [];
	let totalRequests = 0;
	const startTime = performance.now();
	const endTime = startTime + DURATION_MS;

	const workers = Array.from({ length: CONCURRENCY }).map(async () => {
		while (performance.now() < endTime) {
			const start = performance.now();
			try {
				await safeFetch(`${API_BASE_URL}${path}`, options);
				latencies.push(performance.now() - start);
				totalRequests++;
			} catch (e) {
				// console.error(e);
			}
		}
	});
	await Promise.all(workers);
	const actualDuration = performance.now() - startTime;

	const avgLatency = latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0;
	const sortedLatencies = [...latencies].sort((a, b) => a - b);
	const p95Latency = sortedLatencies[Math.floor(latencies.length * 0.95)] || 0;
	const rps = (totalRequests / actualDuration) * 1000;

	return {
		endpoint: name,
		totalRequests,
		rps,
		avgLatency,
		p95Latency
	};
}

async function runRestBenchmark() {
	console.log('\n🚀 SveltyCMS REST API Performance Benchmark');
	console.log('============================================');

	const updateBaseline = process.argv.includes('--update-baseline');
	const baselineFile = path.join(RESULTS_DIR, 'baseline-rest-api.json');

	try {
		// Ensure server is up
		console.log('📡 Checking server health...');
		const healthCheck = await safeFetch(`${API_BASE_URL}/api/system/health`);
		if (!healthCheck.ok) {
			throw new Error(`Server not reachable at ${API_BASE_URL}. Ensure 'bun run preview' is running.`);
		}

		const authCookie = await prepareAuthenticatedContext();
		const authHeaders = { Cookie: authCookie };

		const results: BenchResult[] = [];

		// 1. Public Health Check (No Auth, Fast)
		results.push(await measureEndpoint('System Health (Public)', '/api/system/health'));

		// 2. Authenticated Me (Auth Middleware cost)
		results.push(await measureEndpoint('User Me (Authenticated)', '/api/user/me', { headers: authHeaders }));

		// 3. List Collections (Database + Auth)
		results.push(await measureEndpoint('List Collections (DB)', '/api/collections', { headers: authHeaders }));

		// 4. List Users (Admin only + DB)
		results.push(await measureEndpoint('List Users (Admin)', '/api/user', { headers: authHeaders }));

		console.log('\n📊 REST API Benchmark Results:');
		console.table(
			results.map((r) => ({
				Endpoint: r.endpoint,
				Requests: r.totalRequests,
				RPS: r.rps.toFixed(2),
				'Avg Latency (ms)': r.avgLatency.toFixed(2),
				'p95 Latency (ms)': r.p95Latency.toFixed(2)
			}))
		);

		// Regression Detection
		let baseline = null;
		try {
			baseline = JSON.parse(await fs.readFile(baselineFile, 'utf8'));
		} catch (e) {}

		if (baseline) {
			console.log('\n📉 vs Baseline:');
			results.forEach((res) => {
				const base = baseline.metrics.find((m: any) => m.endpoint === res.endpoint);
				if (base) {
					const diff = (res.avgLatency - base.avgLatency) / base.avgLatency;
					const indicator = diff > REGRESSION_THRESHOLD ? '🔴 REGRESSION' : diff < -REGRESSION_THRESHOLD ? '🟢 IMPROVEMENT' : '⚪ STABLE';
					console.log(
						`${res.endpoint.padEnd(25)}: ${res.avgLatency.toFixed(2)}ms vs ${base.avgLatency.toFixed(2)}ms | [${indicator}] (${(diff * 100).toFixed(1)}%)`
					);
				}
			});
		}

		if (updateBaseline) {
			await fs.mkdir(RESULTS_DIR, { recursive: true });
			await fs.writeFile(
				baselineFile,
				JSON.stringify(
					{
						date: new Date().toISOString(),
						metrics: results
					},
					null,
					2
				)
			);
			console.log(`\n💾 Baseline updated: ${baselineFile}`);
		}

		process.exit(0);
	} catch (error) {
		console.error('\n❌ Benchmark failed:', error);
		process.exit(1);
	}
}

runRestBenchmark();
