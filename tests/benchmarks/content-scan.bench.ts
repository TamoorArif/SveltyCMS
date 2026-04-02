import fs from "node:fs/promises";
import path from "node:path";

async function scanFiles() {
  const start = performance.now();
  const collectionsDir = path.resolve(process.cwd(), ".compiledCollections");
  const extension = ".js";

  async function recursivelyGetFiles(dir: string, ext: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files: string[] = [];
    await Promise.all(
      entries.map(async (entry) => {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) files.push(...(await recursivelyGetFiles(fullPath, ext)));
        else if (entry.isFile() && entry.name.endsWith(ext)) files.push(fullPath);
      }),
    );
    return files;
  }

  try {
    const files = await recursivelyGetFiles(collectionsDir, extension);
    const end = performance.now();
    console.log("--- Content Scan Baseline ---");
    console.log("Files scanned:", files.length);
    console.log("Scanning duration:", (end - start).toFixed(2), "ms");
  } catch (e) {
    console.error("Scan failed:", (e as Error).message);
  }
}

scanFiles();
