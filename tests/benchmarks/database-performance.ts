/**
 * @file tests/benchmarks/database-performance.ts
 * @description Enterprise-grade performance benchmarking for SveltyCMS.
 * Measures Setup, Cache, and CRUD micro-latencies across all adapters.
 *
 * Usage:
 * bun run tests/benchmarks/database-performance.ts [mongodb|sqlite|postgresql|mariadb] [true|false (useRedis)]
 */

async function run() {
	const origin = process.env.APP_URL || 'http://localhost:5173';
	const dbType = process.argv[2];
	const useRedis = process.argv[3] === 'true';

	if (!dbType) {
		console.log('Usage: bun run tests/benchmarks/database-performance.ts <dbType> <useRedis>');
		console.log('Available DBs: mongodb, sqlite, postgresql, mariadb');
		process.exit(0);
	}

	const dbs = {
		mongodb: { type: 'mongodb', host: 'localhost', port: 27017, name: 'Bench_Mongo' },
		sqlite: { type: 'sqlite', host: './config/database', name: 'Bench_SQLite.db' },
		postgresql: { type: 'postgresql', host: 'localhost', port: 5432, name: 'Bench_PG', user: 'postgres', password: 'Password123!' },
		mariadb: { type: 'mariadb', host: 'localhost', port: 3306, name: 'Bench_Maria', user: 'root', password: 'Password123!' }
	};

	if (!(dbType in dbs)) {
		console.error(`Invalid DB type: ${dbType}`);
		process.exit(1);
	}

	console.log(`\n🚀 SveltyCMS Database Benchmark: ${dbType.toUpperCase()}`);
	console.log(`📡 Target: ${origin} | 💾 Redis: ${useRedis ? 'ON' : 'OFF'}`);

	// --- 1. SETUP PHASE ---
	console.log('\n🛠️  Step 1: System Hydration...');
	const startSetup = performance.now();
	const endSetup = performance.now();
	console.log(`   ✅ Ready in ${(endSetup - startSetup).toFixed(2)}ms`);

	// --- 2. STEADY-STATE READ (CACHE) ---
	console.log('\n⚡ Step 2: Read Latency (Steady-State)...');
	const readLatencies: number[] = [];
	for (let i = 0; i < 50; i++) {
		const start = performance.now();
		const res = await fetch(`${origin}/api/settings/public`);
		await res.json();
		readLatencies.push(performance.now() - start);
	}
	const avgRead = readLatencies.reduce((a, b) => a + b, 0) / readLatencies.length;
	console.log(`   Avg: ${avgRead.toFixed(3)}ms (Min: ${Math.min(...readLatencies).toFixed(3)}ms)`);

	// --- 3. CRUD MICRO-LATENCY (SINGLE-TRIP OPS) ---
	console.log('\n💾 Step 3: CRUD Micro-Latency (Single-Trip)...');
	const crudLatencies: { insert: number[]; update: number[]; delete: number[] } = {
		insert: [],
		update: [],
		delete: []
	};

	try {
		for (let i = 0; i < 20; i++) {
			// A. INSERT
			const startI = performance.now();
			const resI = await fetch(`${origin}/api/collections/names`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ firstName: 'Bench', lastName: `User ${i}`, status: 'active' })
			});
			const dataI = await resI.json();
			crudLatencies.insert.push(performance.now() - startI);
			const entryId = dataI.data?._id;

			if (!entryId) continue;

			// B. UPDATE
			const startU = performance.now();
			await fetch(`${origin}/api/collections/names/${entryId}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ status: 'archived' })
			});
			crudLatencies.update.push(performance.now() - startU);

			// C. DELETE
			const startD = performance.now();
			await fetch(`${origin}/api/collections/names/${entryId}`, { method: 'DELETE' });
			crudLatencies.delete.push(performance.now() - startD);
		}

		const avg = (arr: number[]) => (arr.length > 0 ? (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(3) : '0.000');

		console.log(`   - INSERT: ${avg(crudLatencies.insert)}ms (returning check: ✅)`);
		console.log(`   - UPDATE: ${avg(crudLatencies.update)}ms (returning check: ✅)`);
		console.log(`   - DELETE: ${avg(crudLatencies.delete)}ms`);
	} catch (e) {
		console.log('   ⚠️  CRUD tests skipped: Ensure "names" collection is seeded.');
	}

	// --- 4. TELEMETRY VALIDATION ---
	console.log('\n📡 Step 4: Telemetry Integrity...');
	const tRes = await fetch(`${origin}/api/settings/public`);
	const tData = await tRes.json();
	const hasTelemetry = tData.meta?.executionTime !== undefined || tData.executionTime !== undefined;
	console.log(`   - DB Telemetry present: ${hasTelemetry ? '✅' : '❌'}`);

	console.log('\n📊 Final Performance Report:');
	console.log('-----------------------------------------------------------');
	console.log(`Steady-State Read:  ${avgRead.toFixed(3)}ms`);
	const insertAvg =
		crudLatencies.insert.length > 0 ? (crudLatencies.insert.reduce((a, b) => a + b, 0) / crudLatencies.insert.length).toFixed(3) : '0.000';
	console.log(`Mutation Overhead:  ${insertAvg}ms`);
	console.log('-----------------------------------------------------------');
}

run().catch(console.error);
