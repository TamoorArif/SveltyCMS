/**
 * @file tests/benchmarks/database-performance.ts
 * @description Factual performance benchmarking for SveltyCMS.
 * Measures raw MongoDB driver latencies using connection data from config/private.ts.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import mongoose from 'mongoose';
import { privateEnv } from '../../config/private';

const ITERATIONS = 100;
const REGRESSION_THRESHOLD = 0.15; // 15%
const RESULTS_DIR = path.join(process.cwd(), 'tests/benchmarks/results');
let sink = 0;

async function run() {
	const args = process.argv.slice(2);
	const updateBaseline = args.includes('--update-baseline');

	console.log(`\n🚀 SveltyCMS Database Benchmark – ${new Date().toISOString()}`);

	const dbType = (privateEnv as any).DB_TYPE || 'mongodb';
	const dbName = (privateEnv as any).DB_NAME || 'SveltyCMS';
	const host = (privateEnv as any).DB_HOST || '127.0.0.1';
	const port = (privateEnv as any).DB_PORT || 27017;
	const user = (privateEnv as any).DB_USER;
	const pass = (privateEnv as any).DB_PASSWORD;

	const baselineFile = path.join(RESULTS_DIR, `baseline-${dbType}-raw.json`);

	console.log(`📡 Connecting to ${dbType.toUpperCase()}...`);
	console.log(`📂 DB: ${dbName} | Host: ${host}:${port}`);

	const userEnc = user ? encodeURIComponent(user) : '';
	const passEnc = pass ? encodeURIComponent(pass) : '';
	const authPart = userEnc ? `${userEnc}${passEnc ? `:${passEnc}` : ''}@` : '';
	const authParam = user ? `?authSource=admin` : '';
	const connectionString = `mongodb://${authPart}${host}:${port}/${dbName}${authParam}`;

	try {
		await mongoose.connect(connectionString, {
			maxPoolSize: 10,
			serverSelectionTimeoutMS: 5000
		});
		console.log('✅ Connected.\n');

		// Define a simple benchmark schema
		const BenchSchema = new mongoose.Schema(
			{
				firstName: String,
				lastName: String,
				status: String,
				benchmarkId: { type: String, index: true }
			},
			{ timestamps: true }
		);

		const BenchModel = mongoose.model('benchmarks_raw', BenchSchema);

		// --- 1. WARMUP ---
		console.log('🔥 Warming up...');
		for (let i = 0; i < 20; i++) {
			const doc = await BenchModel.create({ firstName: 'Warm', lastName: 'Up', status: 'warm' });
			await BenchModel.findById(doc._id);
			await BenchModel.deleteOne({ _id: doc._id });
		}

		// --- 2. BENCHMARK ---
		console.log(`💾 Measuring CRUD Micro-Latencies (${ITERATIONS} iterations)...`);

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
			const doc = await BenchModel.create({
				firstName: 'Bench',
				lastName: `User ${i}`,
				status: 'active',
				benchmarkId
			});
			metrics.insert.push(performance.now() - s1);

			// READ (by ID)
			const s2 = performance.now();
			const found = await BenchModel.findById(doc._id);
			metrics.read.push(performance.now() - s2);
			sink ^= found ? 1 : 0;

			// UPDATE
			const s3 = performance.now();
			await BenchModel.updateOne({ _id: doc._id }, { status: 'archived' });
			metrics.update.push(performance.now() - s3);

			// DELETE
			const s4 = performance.now();
			await BenchModel.deleteOne({ _id: doc._id });
			metrics.delete.push(performance.now() - s4);
		}

		const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
		const results = {
			insert: avg(metrics.insert),
			read: avg(metrics.read),
			update: avg(metrics.update),
			delete: avg(metrics.delete)
		};

		console.log('\n📊 Average Raw Driver Latencies:');
		console.log('-----------------------------------------------------------');
		console.log(`MongoDB Insert : ${results.insert.toFixed(3)} ms`);
		console.log(`MongoDB Read   : ${results.read.toFixed(3)} ms`);
		console.log(`MongoDB Update : ${results.update.toFixed(3)} ms`);
		console.log(`MongoDB Delete : ${results.delete.toFixed(3)} ms`);
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

		// cleanup
		await BenchModel.deleteMany({ benchmarkId: { $exists: true } });

		console.log('\n✅ Benchmark complete.');
		process.exit(0);
	} catch (err) {
		console.error('\n❌ Benchmark Failed:', err);
		process.exit(1);
	}
}

run();
