#!/usr/bin/env bun
/**
 * @file scripts/run-benchmarks.ts
 * @description Benchmark Runner for SveltyCMS.
 * Starts a production server and runs performance benchmarks against it.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readdirSync, statSync, openSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, "..");

// ✨ Configuration Constants
const HOST = "127.0.0.1";
const PORT = "4173";
const API_BASE_URL = `http://${HOST}:${PORT}`;
const pkgManager = process.env.npm_execpath || "bun";
const TEST_API_SECRET = "test-secret-123456789";

let previewProcess: ChildProcess | null = null;

async function cleanup(exitCode = 0) {
  console.log("\n🧹 Cleaning up benchmark environment...");
  if (previewProcess && previewProcess.pid) {
    if (process.platform === "win32") {
      spawn("taskkill", ["/F", "/T", "/PID", previewProcess.pid.toString()], {
        stdio: "ignore",
      });
    } else {
      try {
        process.kill(-previewProcess.pid, "SIGTERM");
      } catch {
        previewProcess.kill("SIGTERM");
      }
    }
  }
  process.exit(exitCode);
}

process.on("SIGINT", () => cleanup(130));
process.on("SIGTERM", () => cleanup(143));

async function main() {
  try {
    console.log("🚀 Starting SveltyCMS Performance Benchmark Suite...");

    const args = process.argv.slice(2);
    const benchmarkFile = args.find((arg) => !arg.startsWith("--"));

    if (!benchmarkFile) {
      console.error(
        "❌ No benchmark file specified. Usage: bun run scripts/run-benchmarks.ts <file>",
      );
      process.exit(1);
    }

    // 1. Build check
    if (requiresRebuild()) {
      console.log("🏗️ Detected changes in src/ or missing build. Rebuilding...");
      const buildCode = await runCommand(pkgManager, ["run", "build"]);
      if (buildCode !== 0) throw new Error("Build failed. Aborting benchmarks.");
    }

    // 2. Start Preview Server
    console.log("📦 Starting preview server for benchmarks...");
    await startPreviewServer();

    // 2.1. Run Fast System Setup
    console.log("⚙️ Running Fast System Setup to configure system...");
    const dbType = process.env.DB_TYPE || "sqlite";
    const originalHost = process.env.DB_HOST || HOST;
    const dbHost = dbType === "sqlite" ? "." : originalHost;

    const setupResult = await runCommand(pkgManager, ["run", "scripts/setup-system.ts"], {
      DB_TYPE: dbType,
      DB_HOST: dbHost,
      TEST_MODE: "true",
      API_BASE_URL,
      TEST_API_SECRET,
    });

    if (setupResult !== 0) throw new Error("Fast setup failed. Cannot proceed.");
    console.log("✅ System configured successfully via API.");

    // 2.2. RESTART SERVER to pick up new config/private.test.ts
    console.log("🔄 Restarting preview server to apply new configuration...");
    await startPreviewServer();

    // 3. Run Benchmark
    console.log(`\n▶️  [BENCHMARK] ${benchmarkFile}`);
    const code = await runCommand("bun", ["run", benchmarkFile], {
      TEST_MODE: "true",
      API_BASE_URL,
      TEST_API_SECRET,
    });

    cleanup(code || 0);
  } catch (error) {
    console.error("❌ Runner Error:", error instanceof Error ? error.message : error);
    cleanup(1);
  }
}

// --- Helper Functions ---

function requiresRebuild(): boolean {
  const buildPath = join(rootDir, "build");
  const srcPath = join(rootDir, "src");
  if (!existsSync(buildPath)) return true;

  const buildTime = statSync(buildPath).mtimeMs;
  const checkNewer = (dir: string): boolean => {
    for (const item of readdirSync(dir)) {
      const fullPath = join(dir, item);
      if (statSync(fullPath).isDirectory()) {
        if (checkNewer(fullPath)) return true;
      } else if (statSync(fullPath).mtimeMs > buildTime) {
        return true;
      }
    }
    return false;
  };
  return checkNewer(srcPath);
}

function runCommand(
  command: string,
  args: string[],
  extraEnv: Record<string, string> = {},
): Promise<number> {
  return new Promise((resolve) => {
    const proc = spawn(command, args, {
      cwd: rootDir,
      stdio: "inherit",
      shell: process.platform === "win32",
      env: { ...process.env, ...extraEnv },
    });
    proc.on("close", (code) => resolve(code || 0));
  });
}

async function startPreviewServer() {
  if (previewProcess && previewProcess.pid) {
    console.log("🛑 Killing existing preview process...");
    if (process.platform === "win32") {
      spawn("taskkill", ["/F", "/T", "/PID", previewProcess.pid.toString()], {
        stdio: "ignore",
      });
    } else {
      try {
        process.kill(-previewProcess.pid, "SIGTERM");
      } catch {
        previewProcess.kill("SIGTERM");
      }
    }
    await new Promise((r) => setTimeout(r, 2000)); // Wait for OS to release port
  }

  return new Promise<void>((resolve, reject) => {
    const serverPath = join(rootDir, "build", "index.js");
    if (!existsSync(serverPath)) {
      return reject(
        new Error(`Server build not found at ${serverPath}. Run 'bun run build' first.`),
      );
    }

    const logFile = join(rootDir, "benchmark-server.log");
    const out = openSync(logFile, "a");

    previewProcess = spawn("node", [serverPath], {
      cwd: rootDir,
      stdio: ["ignore", out, out],
      detached: process.platform !== "win32",
      shell: process.platform === "win32",
      env: {
        ...process.env,
        NODE_ENV: "production",
        TEST_MODE: "true",
        TEST_API_SECRET,
        PORT,
        HOST,
        ORIGIN: API_BASE_URL,
      },
    });

    let resolved = false;
    const timeout = setTimeout(() => {
      if (!resolved) reject(new Error("Timeout waiting for preview server health check"));
    }, 60000);

    waitForServer()
      .then(() => {
        clearTimeout(timeout);
        resolved = true;
        resolve();
      })
      .catch((err) => {
        if (!resolved) reject(err);
      });

    previewProcess.on("close", (code) => {
      if (!resolved && code !== null) reject(new Error(`Preview process exited with code ${code}`));
    });
  });
}

async function waitForServer() {
  console.log(`⏳ Waiting for server health check at ${API_BASE_URL}...`);
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`${API_BASE_URL}/api/system/health`);
      if (res.ok) return;
    } catch {
      // Ignore errors while waiting
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("Server health check timeout");
}

main();
