/**
 * @file tests/benchmarks/graphql-api-performance.ts
 * @description Benchmark for SveltyCMS GraphQL API.
 * Measures throughput (RPS) and latency for common queries.
 */

import { performance } from "node:perf_hooks";
import fs from "node:fs/promises";
import path from "node:path";
import { prepareAuthenticatedContext } from "../integration/helpers/test-setup";
import { getApiBaseUrl, safeFetch } from "../integration/helpers/server";

const API_BASE_URL = getApiBaseUrl();
const DURATION_MS = 5000; // 5 seconds per test
const CONCURRENCY = 10; // Number of concurrent requests
const RESULTS_DIR = path.join(process.cwd(), "tests/benchmarks/results");
const REGRESSION_THRESHOLD = 0.2; // 20% for network-based benchmarks

interface BenchResult {
  query: string;
  totalRequests: number;
  rps: number;
  avgLatency: number;
  p95Latency: number;
}

async function measureGraphQL(
  name: string,
  query: string,
  variables: any = {},
  headers: Record<string, string> = {},
): Promise<BenchResult> {
  console.log(`\n🧪 Benchmarking: ${name}...`);

  const latencies: number[] = [];
  let totalRequests = 0;
  const startTime = performance.now();
  const endTime = startTime + DURATION_MS;

  const body = JSON.stringify({ query, variables });

  const workers = Array.from({ length: CONCURRENCY }).map(async () => {
    while (performance.now() < endTime) {
      const start = performance.now();
      try {
        await safeFetch(`${API_BASE_URL}/api/graphql`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...headers,
          },
          body,
        });
        latencies.push(performance.now() - start);
        totalRequests++;
      } catch {
        // console.error(e);
      }
    }
  });

  await Promise.all(workers);
  const actualDuration = performance.now() - startTime;

  const avgLatency =
    latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0;
  const sortedLatencies = [...latencies].sort((a, b) => a - b);
  const p95Latency = sortedLatencies[Math.floor(latencies.length * 0.95)] || 0;
  const rps = (totalRequests / actualDuration) * 1000;

  return {
    query: name,
    totalRequests,
    rps,
    avgLatency,
    p95Latency,
  };
}

async function runGraphQLBenchmark() {
  console.log("\n🚀 SveltyCMS GraphQL API Performance Benchmark");
  console.log("================================================");

  const updateBaseline = process.argv.includes("--update-baseline");
  const baselineFile = path.join(RESULTS_DIR, "baseline-graphql-api.json");

  try {
    const authCookie = await prepareAuthenticatedContext();
    const authHeaders = { Cookie: authCookie };

    const results: BenchResult[] = [];

    // 1. Basic Introspection (Small result)
    const introspectionQuery = `
			query {
				__schema {
					queryType { name }
				}
			}
		`;
    results.push(
      await measureGraphQL("Introspection (Basic)", introspectionQuery, {}, authHeaders),
    );

    // 2. Me Query (Auth + Simple Resolver)
    const meQuery = `
			query {
				me {
					_id
					username
					email
					role
				}
			}
		`;
    results.push(await measureGraphQL("Me Query (Authenticated)", meQuery, {}, authHeaders));

    // 3. System Health (System Resolver)
    const healthQuery = `
			query {
				contentManagerHealth {
					state
					version
					collectionCount
				}
			}
		`;
    results.push(await measureGraphQL("System Health (GraphQL)", healthQuery, {}, authHeaders));

    // 4. Large Schema Query (Complexity test)
    const largeQuery = `
			query {
				__schema {
					types {
						name
						kind
						fields {
							name
						}
					}
				}
			}
		`;
    results.push(await measureGraphQL("Large Schema Query", largeQuery, {}, authHeaders));

    console.log("\n📊 GraphQL API Benchmark Results:");
    console.table(
      results.map((r) => ({
        Query: r.query,
        Requests: r.totalRequests,
        RPS: r.rps.toFixed(2),
        "Avg Latency (ms)": r.avgLatency.toFixed(2),
        "p95 Latency (ms)": r.p95Latency.toFixed(2),
      })),
    );

    // Regression Detection
    let baseline = null;
    try {
      baseline = JSON.parse(await fs.readFile(baselineFile, "utf8"));
    } catch {}

    if (baseline) {
      console.log("\n📉 vs Baseline:");
      results.forEach((res) => {
        const base = baseline.metrics.find((m: any) => m.query === res.query);
        if (base) {
          const diff = (res.avgLatency - base.avgLatency) / base.avgLatency;
          const indicator =
            diff > REGRESSION_THRESHOLD
              ? "🔴 REGRESSION"
              : diff < -REGRESSION_THRESHOLD
                ? "🟢 IMPROVEMENT"
                : "⚪ STABLE";
          console.log(
            `${res.query.padEnd(25)}: ${res.avgLatency.toFixed(2)}ms vs ${base.avgLatency.toFixed(2)}ms | [${indicator}] (${(diff * 100).toFixed(1)}%)`,
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
            metrics: results,
          },
          null,
          2,
        ),
      );
      console.log(`\n💾 Baseline updated: ${baselineFile}`);
    }

    process.exit(0);
  } catch (error) {
    console.error("\n❌ Benchmark failed:", error);
    process.exit(1);
  }
}

runGraphQLBenchmark();
