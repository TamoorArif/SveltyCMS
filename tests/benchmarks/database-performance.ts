/**
 * @file tests/benchmarks/database-performance.ts
 * @description Standalone Database performance benchmarking for SveltyCMS.
 * Measures raw MongoDB latencies using direct driver connection to avoid CMS overhead.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import mongoose from "mongoose";

const ITERATIONS = 100;
const REGRESSION_THRESHOLD = 0.15; // 15%
const RESULTS_DIR = path.join(process.cwd(), "tests/benchmarks/results");
const COLLECTION = "collection_benchmarks";

// Minimal Config Loader to avoid CMS dependencies
async function getDBConfig() {
  const tryFiles = ["config/private.ts", "config/private.test.ts"];
  let content = "";

  for (const file of tryFiles) {
    try {
      content = await fs.readFile(path.join(process.cwd(), file), "utf8");
      console.log(`📖 Loaded config from: ${file}`);
      break;
    } catch {}
  }

  const extract = (key: string) => {
    // Handle both 'key': 'value' and key: value (unquoted or numbers)
    const match = content.match(new RegExp(`${key}\\s*:\\s*['"]?(.*?)['"]?,?(\\s|$)`, "i"));
    return match ? match[1].trim() : process.env[key] || null;
  };

  return {
    DB_TYPE: extract("DB_TYPE") || "mongodb",
    DB_HOST: extract("DB_HOST") || "localhost",
    DB_PORT: extract("DB_PORT") || "27017",
    DB_NAME: extract("DB_NAME") || "svelty-cms",
    DB_USER: extract("DB_USER") || "",
    DB_PASSWORD: extract("DB_PASSWORD") || "",
  };
}

async function runDatabaseBenchmark() {
  console.log("\n🚀 SveltyCMS Raw Database Performance Benchmark");
  console.log(`Date: ${new Date().toISOString()}`);

  const config = await getDBConfig();
  const dbType = config.DB_TYPE.toLowerCase();
  console.log(`📂 DB: ${dbType.toUpperCase()} | ${config.DB_NAME}`);

  let db: any;
  let BenchModel: any;

  if (dbType === "mongodb") {
    const auth = config.DB_USER
      ? `${config.DB_USER}:${encodeURIComponent(config.DB_PASSWORD)}@`
      : "";
    const uri = `mongodb://${auth}${config.DB_HOST}:${config.DB_PORT}/${config.DB_NAME}?authSource=admin`;
    try {
      await mongoose.connect(uri);
      console.log("✅ Connected to MongoDB via raw driver.");
    } catch (e) {
      console.error("❌ MongoDB Connection failed:", e);
      process.exit(1);
    }
    const Schema = new mongoose.Schema(
      {
        firstName: String,
        lastName: String,
        status: String,
        benchmarkId: String,
      },
      { timestamps: true },
    );
    BenchModel = mongoose.models[COLLECTION] || mongoose.model(COLLECTION, Schema);
    db = {
      insert: (data: any) => BenchModel.create(data),
      read: (id: any) => BenchModel.findById(id),
      update: (id: any, data: any) => BenchModel.findByIdAndUpdate(id, data),
      delete: (id: any) => BenchModel.findByIdAndDelete(id),
      disconnect: () => mongoose.disconnect(),
    };
  } else if (dbType === "sqlite" || dbType === "better-sqlite3") {
    // Use Bun's native SQLite
    const { Database } = await import("bun:sqlite");
    const sqlite = new Database(`${config.DB_NAME}.sqlite`);
    sqlite.run(
      `CREATE TABLE IF NOT EXISTS ${COLLECTION} (id INTEGER PRIMARY KEY AUTOINCREMENT, firstName TEXT, lastName TEXT, status TEXT, benchmarkId TEXT, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP)`,
    );

    db = {
      insert: (data: any) => {
        const query = sqlite.prepare(
          `INSERT INTO ${COLLECTION} (firstName, lastName, status, benchmarkId) VALUES (?, ?, ?, ?)`,
        );
        const res = query.run(data.firstName, data.lastName, data.status, data.benchmarkId);
        return { _id: res.lastInsertRowid };
      },
      read: (id: any) => sqlite.prepare(`SELECT * FROM ${COLLECTION} WHERE id = ?`).get(id),
      update: (id: any, data: any) =>
        sqlite.prepare(`UPDATE ${COLLECTION} SET status = ? WHERE id = ?`).run(data.status, id),
      delete: (id: any) => sqlite.prepare(`DELETE FROM ${COLLECTION} WHERE id = ?`).run(id),
      disconnect: () => sqlite.close(),
    };
    console.log("✅ Connected to SQLite (Bun Native).");
  } else {
    console.log(`ℹ️ Skipping: This benchmark does not yet support ${dbType}`);
    process.exit(0);
  }

  // --- 1. WARMUP ---
  console.log("🔥 Warming up (20 iterations)...");
  for (let i = 0; i < 20; i++) {
    const doc = await db.insert({
      firstName: "Warm",
      lastName: "Up",
      status: "warm",
      benchmarkId: "warm",
    });
    await db.read(doc._id);
    await db.delete(doc._id);
  }

  // --- 2. BENCHMARK ---
  console.log(`💾 Measuring Raw ${dbType.toUpperCase()} Latencies (${ITERATIONS} iterations)...`);

  const metrics = {
    insert: [] as number[],
    read: [] as number[],
    update: [] as number[],
    delete: [] as number[],
  };

  for (let i = 0; i < ITERATIONS; i++) {
    const benchmarkId = `bench-${Date.now()}-${i}`;
    const s1 = performance.now();
    const doc = await db.insert({
      firstName: "Bench",
      lastName: `User ${i}`,
      status: "active",
      benchmarkId,
    });
    metrics.insert.push(performance.now() - s1);
    const docId = doc._id;
    const s2 = performance.now();
    await db.read(docId);
    metrics.read.push(performance.now() - s2);
    const s3 = performance.now();
    await db.update(docId, { status: "archived" });
    metrics.update.push(performance.now() - s3);
    const s4 = performance.now();
    await db.delete(docId);
    metrics.delete.push(performance.now() - s4);
  }

  const avg = (arr: number[]) => (arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
  const results = {
    insert: avg(metrics.insert),
    read: avg(metrics.read),
    update: avg(metrics.update),
    delete: avg(metrics.delete),
  };

  console.log(`\n📊 Average Raw ${dbType.toUpperCase()} Latencies (ms):`);
  console.log("-----------------------------------------------------------");
  console.log(`Insert : ${results.insert.toFixed(4)} ms`);
  console.log(`Read   : ${results.read.toFixed(4)} ms`);
  console.log(`Update : ${results.update.toFixed(4)} ms`);
  console.log(`Delete : ${results.delete.toFixed(4)} ms`);
  console.log("-----------------------------------------------------------");

  // --- 3. REGRESSION DETECTION ---
  const baselineFile = path.join(RESULTS_DIR, `baseline-mongodb-raw.json`);
  let baseline = null;
  try {
    baseline = JSON.parse(await fs.readFile(baselineFile, "utf8"));
  } catch {}

  if (baseline) {
    console.log("\n📉 vs Raw Baseline:");
    const check = (name: string, cur: number, base: number) => {
      const diff = (cur - base) / base;
      const indicator =
        diff > REGRESSION_THRESHOLD
          ? "🔴 REGRESSION"
          : diff < -REGRESSION_THRESHOLD
            ? "🟢 IMPROVEMENT"
            : "⚪ STABLE";
      console.log(
        `${name.padEnd(15)}: ${cur.toFixed(3)}ms vs ${base.toFixed(3)}ms | [${indicator}] (${(diff * 100).toFixed(1)}%)`,
      );
    };
    check("Insert", results.insert, baseline.metrics.insert);
    check("Read", results.read, baseline.metrics.read);
    check("Update", results.update, baseline.metrics.update);
    check("Delete", results.delete, baseline.metrics.delete);
  }

  if (process.argv.includes("--update-baseline")) {
    await fs.mkdir(RESULTS_DIR, { recursive: true });
    await fs.writeFile(
      baselineFile,
      JSON.stringify(
        { date: new Date().toISOString(), dbType: "mongodb", metrics: results },
        null,
        2,
      ),
    );
    console.log(`\n💾 Baseline updated: ${baselineFile}`);
  }

  await mongoose.disconnect();
  console.log("\n✅ Benchmark complete.");
  process.exit(0);
}

runDatabaseBenchmark().catch((err) => {
  console.error("❌ Benchmark failed:", err);
  process.exit(1);
});
