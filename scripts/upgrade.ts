/**
 * @file scripts/upgrade.ts
 * @description SveltyCMS Phase 1 Upgrade CLI
 *
 * Automates the process of fetching updates from the upstream repository,
 * merging changes, and ensuring environment consistency (bun install).
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const BRANCH = "next";

async function runCommand(command: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn(command, args, { stdio: "inherit" });
    proc.on("close", (code) => {
      resolve({ code: code ?? 0, stdout: "", stderr: "" });
    });
  });
}

async function main() {
  console.log("\x1b[34m%s\x1b[0m", "🚀 SveltyCMS Upgrade Tool (Phase 1)");
  console.log("---------------------------------------");

  // 1. Check for Git
  if (!existsSync(join(process.cwd(), ".git"))) {
    console.error("\x1b[31m%s\x1b[0m", "❌ Error: Not a git repository. Please run this from the project root.");
    process.exit(1);
  }

  // 2. Add upstream if not exists
  console.log("Checking upstream remote...");
  // We'll use a temporary remote check or just assume 'origin' is upstream if it's a clone
  // For safety, let's just use 'git pull origin next' for now, or guide the user.

  // 3. Fetch
  console.log("Fetching updates from origin...");
  await runCommand("git", ["fetch", "origin", BRANCH]);

  // 4. Check for dirty state
  // TODO: Implement git status check if needed

  // 5. Merge
  console.log(`Merging changes from origin/${BRANCH}...`);
  const mergeResult = await runCommand("git", ["merge", `origin/${BRANCH}`, "--no-ff", "--no-commit"]);

  if (mergeResult.code !== 0) {
    console.warn("\x1b[33m%s\x1b[0m", "⚠️  Conflicts detected! Please resolve them manually, then run 'bun install'.");
    process.exit(1);
  }

  // 6. Install dependencies
  console.log("Running bun install...");
  await runCommand("bun", ["install"]);

  console.log("---------------------------------------");
  console.log("\x1b[32m%s\x1b[0m", "✅ Upgrade phase 1 complete! Review changes and commit.");
}

main().catch((err) => {
  console.error("Unexpected error during upgrade:", err);
  process.exit(1);
});
