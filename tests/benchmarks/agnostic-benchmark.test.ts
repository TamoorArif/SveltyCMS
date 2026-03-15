/**
 * @file tests/benchmarks/agnostic-benchmark.test.ts
 * @description Database-agnostic performance benchmarking for SveltyCMS using Vitest.
 * Measures dbAdapter CRUD latencies across all supported databases.
 */

import { it, describe, beforeAll, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

// --- UNMOCK REAL DATABASE LOGIC ---
// tests/unit/setup.ts mocks these, but we need the real ones for benchmarks
vi.unmock('../../src/databases/db');
vi.unmock('../../src/databases/config-state');
vi.unmock('@src/databases/db');
vi.unmock('@src/databases/config-state');

// --- IMPORTS ---
import { getDbInitPromise, getDb } from '../../src/databases/db';
import { loadPrivateConfig, getPrivateEnv } from '../../src/databases/config-state';

const ITERATIONS = 100;
const REGRESSION_THRESHOLD = 0.15; // 15%
const RESULTS_DIR = path.join(process.cwd(), 'tests/benchmarks/results');
const COLLECTION = 'collection_benchmarks';

describe('Database Agnostic Benchmark', () => {
	let dbType: string;
	let baselineFile: string;

	beforeAll(async () => {
		// 1. Initialize System
		console.log('\n📡 Initializing database connection...');
		await loadPrivateConfig(true);
		const env = getPrivateEnv();

		if (!env) {
			throw new Error('Configuration not found. Please run setup or provide config/private.test.ts');
		}

		dbType = env.DB_TYPE;
		console.log(`📂 DB Type: ${dbType.toUpperCase()}`);
		console.log(`📂 DB Name: ${env.DB_NAME}`);

		await getDbInitPromise(true);
		baselineFile = path.join(RESULTS_DIR, `baseline-${dbType}-agnostic.json`);
	});

	it('Measures CRUD Latencies', async () => {
		const dbAdapter = getDb();
		if (!dbAdapter) {
			throw new Error('Failed to initialize dbAdapter');
		}

		const updateBaseline = process.argv.includes('--update-baseline');

		// --- 0. PREPARE COLLECTION ---
		console.log(`📦 Creating collection: ${COLLECTION}...`);
		await dbAdapter.collection.createModel({
			_id: 'benchmarks', // COLLECTION is 'collection_benchmarks', the adapter adds the prefix
			name: 'Benchmarks',
			fields: []
		} as any);

		// --- 1. WARMUP ---
		console.log('🔥 Warming up...');
		for (let i = 0; i < 20; i++) {
			const res = await dbAdapter.crud.insert(COLLECTION, { firstName: 'Warm', lastName: 'Up', status: 'warm' } as any, null, true);
			if (res.success) {
				const id = (res.data as any)._id;
				await dbAdapter.crud.findOne(COLLECTION, { _id: id } as any, { bypassTenantCheck: true });
				await dbAdapter.crud.delete(COLLECTION, id, null, true);
			}
		}

		// --- 2. BENCHMARK ---
		console.log(`💾 Measuring CRUD Latencies (${ITERATIONS} iterations)...`);

		const metrics = {
			insert: [] as number[],
			read: [] as number[],
			update: [] as number[],
			delete: [] as number[]
		};

		for (let i = 0; i < ITERATIONS; i++) {
			const benchmarkId = `bench-${Date.now()}-${i}`;

			// INSERT
			const s1 = performance.now();
			const res = await dbAdapter.crud.insert(
				COLLECTION,
				{
					firstName: 'Bench',
					lastName: `User ${i}`,
					status: 'active',
					benchmarkId
				} as any,
				null,
				true
			);
			metrics.insert.push(performance.now() - s1);

			if (!res.success) {
				console.error(`❌ Insert failed at iteration ${i}:`, res.message);
				continue;
			}

			const docId = (res.data as any)._id;

			// READ (by ID)
			const s2 = performance.now();
			await dbAdapter.crud.findOne(COLLECTION, { _id: docId } as any, { bypassTenantCheck: true });
			metrics.read.push(performance.now() - s2);

			// UPDATE
			const s3 = performance.now();
			await dbAdapter.crud.update(COLLECTION, docId, { status: 'archived' } as any, null, true);
			metrics.update.push(performance.now() - s3);

			// DELETE
			const s4 = performance.now();
			await dbAdapter.crud.delete(COLLECTION, docId, null, true);
			metrics.delete.push(performance.now() - s4);
		}

		const avg = (arr: number[]) => (arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
		const results = {
			insert: avg(metrics.insert),
			read: avg(metrics.read),
			update: avg(metrics.update),
			delete: avg(metrics.delete)
		};

		console.log(`\n📊 Average ${dbType.toUpperCase()} Latencies (via dbAdapter):`);
		console.log('-----------------------------------------------------------');
		console.log(`Insert : ${results.insert.toFixed(3)} ms`);
		console.log(`Read   : ${results.read.toFixed(3)} ms`);
		console.log(`Update : ${results.update.toFixed(3)} ms`);
		console.log(`Delete : ${results.delete.toFixed(3)} ms`);
		console.log('-----------------------------------------------------------');

		// --- 3. REGRESSION DETECTION ---
		let baseline = null;
		try {
			baseline = JSON.parse(await fs.readFile(baselineFile, 'utf8'));
		} catch (e) {}

		if (baseline) {
			console.log('\n📉 vs Baseline:');
			const check = (name: string, cur: number, base: number) => {
				const diff = (cur - base) / base;
				const indicator = diff > REGRESSION_THRESHOLD ? '🔴 REGRESSION' : diff < -REGRESSION_THRESHOLD ? '🟢 IMPROVEMENT' : '⚪ STABLE';
				console.log(`${name.padEnd(15)}: ${cur.toFixed(3)}ms vs ${base.toFixed(3)}ms | [${indicator}] (${(diff * 100).toFixed(1)}%)`);
			};
			check('Insert', results.insert, baseline.metrics.insert);
			check('Read', results.read, baseline.metrics.read);
			check('Update', results.update, baseline.metrics.update);
			check('Delete', results.delete, baseline.metrics.delete);
		}

		if (updateBaseline) {
			await fs.mkdir(RESULTS_DIR, { recursive: true });
			await fs.writeFile(
				baselineFile,
				JSON.stringify(
					{
						date: new Date().toISOString(),
						dbType,
						metrics: results
					},
					null,
					2
				)
			);
			console.log(`\n💾 Baseline updated: ${baselineFile}`);
		}

		// Cleanup any leftovers
		await dbAdapter.crud.deleteMany(COLLECTION, { firstName: 'Bench' } as any, null, true);
		console.log('\n✅ Benchmark complete.');
	}, 60000); // 1 minute timeout
});
