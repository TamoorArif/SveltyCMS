/**
 * @file src/routes/api/performance.bench.ts
 * @description
 * High-performance benchmark comparing Traditional HTTP dispatch (via unified gateway)
 * vs Direct Local SDK access.
 */

import { dbAdapter, getDbInitPromise } from "@src/databases/db";
import { LocalCMS } from "@src/routes/api/cms";
import { _handler as dispatcher } from "@src/routes/api/[...path]/+server";
import { contentManager } from "@src/content";

async function runBenchmark() {
  console.log("🚀 Starting SveltyCMS API Performance Benchmark...");

  await getDbInitPromise();
  if (!dbAdapter) throw new Error("DB not initialized");

  // Initialize content manager to ensure collections are loaded
  console.log("📦 Initializing content manager...");
  await contentManager.initialize("global", false, dbAdapter);

  const collections = await contentManager.getCollections();

  if (collections.length === 0) {
    console.warn("⚠️ No user collections found. Using internal 'auth' fallback for benchmark.");
    await benchmarkAuth(dbAdapter, dispatcher);
    return;
  }

  const targetCollection = collections[0]._id as string;
  console.log(`📊 Benchmarking against collection: "${targetCollection}"`);

  const cms = new LocalCMS(dbAdapter);
  const iterations = 100;

  // --- 1. DIRECT SDK PERFORMANCE ---
  console.log(
    `\n[Local SDK] Running ${iterations} iterations of 'cms.collections.find('${targetCollection}')...`,
  );
  const sdkStart = performance.now();
  for (let i = 0; i < iterations; i++) {
    await cms.collections.find(targetCollection, { limit: 10 });
  }
  const sdkEnd = performance.now();
  const sdkAvg = (sdkEnd - sdkStart) / iterations;

  // --- 2. UNIFIED DISPATCHER PERFORMANCE (Simulated HTTP) ---
  console.log(`[HTTP Dispatcher] Running ${iterations} iterations...`);
  const dispatchStart = performance.now();
  for (let i = 0; i < iterations; i++) {
    const mockEvent = {
      request: new Request(`http://localhost/api/collections/${targetCollection}`),
      params: { path: `collections/${targetCollection}` },
      locals: { user: { _id: "admin", role: "admin" }, tenantId: "global" },
      cookies: { get: () => null, set: () => {}, delete: () => {} },
    } as any;

    await dispatcher(mockEvent);
  }
  const dispatchEnd = performance.now();
  const dispatchAvg = (dispatchEnd - dispatchStart) / iterations;

  printResults(targetCollection, sdkAvg, dispatchAvg);
  process.exit(0);
}

async function benchmarkAuth(dbAdapter: any, dispatcher: any) {
  const cms = new LocalCMS(dbAdapter);
  const iterations = 100;
  const credentials = { email: "admin@example.com" }; // Mock

  console.log(`\n[Local SDK] Running ${iterations} iterations of 'cms.auth.login'...`);
  const sdkStart = performance.now();
  for (let i = 0; i < iterations; i++) {
    try {
      await cms.auth.login(credentials);
    } catch {}
  }
  const sdkEnd = performance.now();
  const sdkAvg = (sdkEnd - sdkStart) / iterations;

  console.log(`[HTTP Dispatcher] Running ${iterations} iterations...`);
  const dispatchStart = performance.now();
  for (let i = 0; i < iterations; i++) {
    const mockEvent = {
      request: new Request("http://localhost/api/auth/login", {
        method: "POST",
        body: JSON.stringify(credentials),
      }),
      params: { path: "auth/login" },
      locals: { user: null, tenantId: "global" },
      cookies: { get: () => null, set: () => {}, delete: () => {} },
    } as any;
    await dispatcher(mockEvent).catch(() => {});
  }
  const dispatchEnd = performance.now();
  const dispatchAvg = (dispatchEnd - dispatchStart) / iterations;

  printResults("Auth (Login)", sdkAvg, dispatchAvg);
  process.exit(0);
}

function printResults(target: string, sdkAvg: number, dispatchAvg: number) {
  const speedup = (dispatchAvg / sdkAvg).toFixed(2);
  console.log("\n============================================");
  console.log("   SveltyCMS ARCHITECTURAL BENCHMARK       ");
  console.log("============================================");
  console.log(`Target:               ${target}`);
  console.log(`Local SDK Latency:    ${sdkAvg.toFixed(4)}ms`);
  console.log(`HTTP Dispatch Latency: ${dispatchAvg.toFixed(4)}ms`);
  console.log(`Total Speedup:        ${speedup}x faster`);
  console.log("============================================");
}

runBenchmark().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
