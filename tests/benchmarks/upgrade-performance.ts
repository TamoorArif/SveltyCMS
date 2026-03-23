import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import pc from "picocolors";

async function runCommand(command: string, args: string[]): Promise<number> {
  const start = performance.now();
  return new Promise((resolve) => {
    const proc = spawn(command, args, { stdio: "ignore", shell: true });
    proc.on("close", () => {
      resolve(performance.now() - start);
    });
  });
}

async function benchmark() {
  console.log(pc.bold(pc.blue("\n📊 SveltyCMS Upgrade & Codemod Benchmarks")));
  console.log(pc.dim("---------------------------------------"));

  // 1. Benchmark: Upgrade Dry Run (Full Flow minus actual side effects)
  console.log(pc.cyan("1. Benchmarking: 'bun run scripts/upgrade.ts --dry-run'"));
  const upgradeTime = await runCommand("bun", [
    "run",
    "scripts/upgrade.ts",
    "--dry-run",
    "--skip-tests",
    "--skip-db",
  ]);
  console.log(`   ⏱️  Upgrade Dry Run took: ${pc.yellow(upgradeTime.toFixed(2) + "ms")}`);

  // 2. Benchmark: Codemod (TS-Morph AST transformation)
  console.log(pc.cyan("\n2. Benchmarking: 'bun run scripts/codemods/2026-migrate-schema.ts'"));
  // We'll run it directly to see the AST overhead
  const codemodTime = await runCommand("bun", ["run", "scripts/codemods/2026-migrate-schema.ts"]);
  console.log(`   ⏱️  Codemod (TS-Morph) took: ${pc.yellow(codemodTime.toFixed(2) + "ms")}`);

  console.log(pc.dim("---------------------------------------"));
  console.log(pc.green("✅ Benchmarking complete."));
}

benchmark().catch(console.error);
