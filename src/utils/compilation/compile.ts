/**
 * @file src/utils/compilation/compile.ts
 * @description Compiles TypeScript files from the collections folder into JavaScript files using the TypeScript compiler with custom AST transformations
 *
 * Enterprise Features:
 * - Robust Error Handling & Typing
 * - Concurrent Processing with Limit
 * - Structured Logging Interface
 * - Modular AST Transformers
 * - Content Hashing & UUID Management
 * - Orphaned File Cleanup
 */

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import * as ts from "typescript";
import { generateUUID } from "../native-utils";
import {
  getCollectionsPath,
  getCompiledCollectionsPath,
  isValidTenantId,
} from "../tenant-paths.js";
import {
  addJsExtensionTransformer,
  commonjsToEsModuleTransformer,
  schemaTenantIdTransformer,
  schemaUuidTransformer,
  widgetTransformer,
} from "./transformers";
import type { CompilationResult, CompileOptions, ExistingFileData, Logger } from "./types";

const defaultLogger: Logger = {
  info: (msg) => console.log(`\x1b[34m[Compile]\x1b[0m ${msg}`),
  success: (msg) => console.log(`\x1b[34m[Compile]\x1b[0m \x1b[32m${msg}\x1b[0m`),
  warn: (msg) => console.warn(`\x1b[34m[Compile]\x1b[0m \x1b[33m${msg}\x1b[0m`),
  error: (msg, err) => console.error(`\x1b[34m[Compile]\x1b[0m \x1b[31m${msg}\x1b[0m`, err),
};

function logSuccess(logger: Logger, msg: string) {
  if (logger.success) {
    logger.success(msg);
  } else {
    logger.info(msg);
  }
}

export async function compile(options: CompileOptions = {}): Promise<CompilationResult> {
  const startTime = Date.now();
  const logger = options.logger || defaultLogger;

  if (options.tenantId !== undefined && !isValidTenantId(options.tenantId)) {
    throw new Error(`Invalid tenant ID: ${options.tenantId}`);
  }

  const userCollections = options.userCollections || getCollectionsPath(options.tenantId);
  const compiledCollections =
    options.compiledCollections || getCompiledCollectionsPath(options.tenantId);
  const concurrencyLimit = options.concurrency || 5;

  const result: CompilationResult = {
    processed: 0,
    skipped: 0,
    errors: [],
    duration: 0,
    orphanedFiles: [],
    schemaWarnings: [],
  };

  try {
    await fs.mkdir(userCollections, { recursive: true });
    await fs.mkdir(compiledCollections, { recursive: true });

    const { existingFilesByPath, existingFilesByHash } = await scanCompiledFiles(
      compiledCollections,
      logger,
    );

    const sourceFiles = await getTypescriptAndJavascriptFiles(userCollections);
    const sourceFileSet = new Set(sourceFiles);

    await createOutputDirectories(sourceFiles, compiledCollections);

    const processedJsPaths = new Set<string>();
    const queue = [...sourceFiles];
    const workers: Promise<void>[] = [];

    const worker = async () => {
      while (queue.length > 0) {
        const file = queue.shift();
        if (!file) break;

        if (options.targetFile) {
          const normalizedTarget = path.normalize(options.targetFile);
          const normalizedFile = path.normalize(path.join(userCollections, file));
          if (!(normalizedFile.endsWith(normalizedTarget) || normalizedTarget.endsWith(file))) {
            continue;
          }
        }

        try {
          const expectedJsPath = file.replace(/\.(ts|js)$/, ".js");
          const jsFilePath = await compileFile(
            file,
            userCollections,
            compiledCollections,
            existingFilesByPath,
            existingFilesByHash,
            sourceFileSet,
            logger,
            options.tenantId,
          );

          if (jsFilePath) {
            if (jsFilePath === "SKIPPED") {
              processedJsPaths.add(expectedJsPath);
              result.skipped++;
            } else {
              processedJsPaths.add(jsFilePath);
              result.processed++;
            }
          }
        } catch (err) {
          result.errors.push({
            file,
            error: err instanceof Error ? err : new Error(String(err)),
          });
          logger.error(
            `Failed to compile ${file}`,
            err instanceof Error ? err : new Error(String(err)),
          );
        }
      }
    };

    for (let i = 0; i < Math.min(concurrencyLimit, sourceFiles.length); i++) {
      workers.push(worker());
    }
    await Promise.all(workers);

    if (!options.targetFile) {
      result.orphanedFiles = await cleanupOrphanedFiles(
        existingFilesByPath,
        processedJsPaths,
        compiledCollections,
        logger,
      );
    }
  } catch (error) {
    logger.error("Fatal compilation error", error);
    if (error instanceof Error && error.message.includes("Collection name conflict")) {
      throw error;
    }
    throw error;
  }

  result.duration = Date.now() - startTime;
  return result;
}

async function compileFile(
  file: string,
  srcDir: string,
  destDir: string,
  existingByPath: Map<string, ExistingFileData>,
  existingByHash: Map<string, ExistingFileData>,
  sourceSet: Set<string>,
  logger: Logger,
  tenantId?: string | null | null,
): Promise<string | null> {
  const srcPath = path.posix.join(srcDir, file);
  const targetRel = file.replace(/\.(ts|js)$/, ".js");
  const targetAbs = path.posix.join(destDir, targetRel);

  const content = await fs.readFile(srcPath, "utf8");
  const hash = createHash("sha256").update(content).digest("hex").slice(0, 16);
  const existing = existingByPath.get(targetRel);

  if (existing && existing.hash === hash) {
    return "SKIPPED";
  }

  let uuid: string | null = null;
  let reason = "";

  const moved = existingByHash.get(hash);
  if (!existing && moved?.uuid) {
    const origTs = moved.jsPath.replace(/\.js$/, ".ts");
    if (!sourceSet.has(origTs)) {
      uuid = moved.uuid;
      reason = "Reused (move/rename)";
    }
  }

  if (!uuid && existing?.uuid) {
    uuid = existing.uuid;
    reason = "Reused (path match)";
  }

  if (!uuid) {
    uuid = generateUUID().replace(/-/g, "");
    reason = "Generated new";
  }

  // --- OPTIMIZATION: 1-Pass Compilation ---
  // We apply the transformers directly during the transpile phase,
  // skipping the need to parse the file a second time.
  const transpile = ts.transpileModule(content, {
    compilerOptions: {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      allowJs: true, // Process both .ts and .js files
    },
    transformers: {
      before: [
        schemaUuidTransformer(uuid),
        schemaTenantIdTransformer(tenantId),
        widgetTransformer,
        addJsExtensionTransformer,
        commonjsToEsModuleTransformer,
      ],
    },
  });

  const finalCode = wrapOutput(transpile.outputText, hash, targetRel, tenantId);

  await fs.writeFile(targetAbs, finalCode);
  logSuccess(logger, `Compiled ${file} (${reason}: \x1b[33m${uuid}\x1b[0m)`);

  return targetRel;
}

function wrapOutput(
  code: string,
  hash: string,
  pathRel: string,
  tenantId?: string | null | null,
): string {
  let out = code.replace(/(\s*\*\s*@file\s+)(.*)/, `$1.compiledCollections/${pathRel}`);
  out = out.replace(/^\/\/\s*(HASH|UUID|TENANT_ID):.*$/gm, "").trimStart();

  let header = `// WARNING: Generated file. Do not edit.\n// HASH: ${hash}\n`;

  if (tenantId !== undefined) {
    header += `// TENANT_ID: ${tenantId === null ? "global" : tenantId}\n`;
  }

  return `${header}\n${out}`;
}

async function scanCompiledFiles(
  dir: string,
  logger: Logger,
): Promise<{
  existingFilesByPath: Map<string, ExistingFileData>;
  existingFilesByHash: Map<string, ExistingFileData>;
}> {
  const byPath = new Map<string, ExistingFileData>();
  const byHash = new Map<string, ExistingFileData>();
  async function traverse(current: string) {
    try {
      const entries = await fs.readdir(current, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.posix.join(current, entry.name);
        if (entry.isDirectory()) {
          await traverse(fullPath);
        } else if (entry.isFile() && entry.name.endsWith(".js")) {
          const relativePath = path.posix.relative(dir, fullPath);
          try {
            const content = await fs.readFile(fullPath, "utf8");
            const hash = extractHashFromJs(content);
            const uuid = extractUUIDFromJs(content);
            const data: ExistingFileData = { jsPath: relativePath, uuid, hash };
            byPath.set(relativePath, data);
            if (hash) byHash.set(hash, data);
          } catch {
            logger.warn(`Could not read compiled file ${relativePath}`);
          }
        }
      }
    } catch {
      // Ignore directory read errors
    }
  }
  await traverse(dir);
  return { existingFilesByPath: byPath, existingFilesByHash: byHash };
}

async function getTypescriptAndJavascriptFiles(folder: string, subdir = ""): Promise<string[]> {
  const files: string[] = [];
  try {
    const entries = await fs.readdir(path.posix.join(folder, subdir), { withFileTypes: true });
    const collectionNames = new Set<string>();
    for (const entry of entries) {
      const relativePath = path.posix.join(subdir, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await getTypescriptAndJavascriptFiles(folder, relativePath)));
      } else if (entry.isFile() && /\.(ts|js)$/.test(entry.name)) {
        const name = entry.name.replace(/\.(ts|js)$/, "");
        if (collectionNames.has(name))
          throw new Error(
            `Collection name conflict: "${name}" used multiple times in ${path.posix.join(folder, subdir)}`,
          );
        collectionNames.add(name);
        files.push(relativePath);
      }
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
  return files;
}

async function createOutputDirectories(files: string[], baseDir: string): Promise<void> {
  const dirs = new Set(files.map((f) => path.posix.dirname(f)).filter((d) => d !== "."));
  await Promise.all(
    Array.from(dirs).map((d) => fs.mkdir(path.posix.join(baseDir, d), { recursive: true })),
  );
}

function extractHashFromJs(content: string) {
  return content.match(/^\/\/\s*HASH:\s*([a-f0-9]{16})\s*$/m)?.[1] || null;
}
function extractUUIDFromJs(content: string) {
  return content.match(/^\/\/\s*UUID:\s*([a-f0-9-]+)\s*$/m)?.[1] || null;
}

async function cleanupOrphanedFiles(
  existing: Map<string, ExistingFileData>,
  kept: Set<string>,
  compiledCollections: string,
  logger: Logger,
): Promise<string[]> {
  const orphanedFiles = Array.from(existing.keys()).filter((f) => !kept.has(f) && f !== "SKIPPED");
  if (orphanedFiles.length > 0) {
    const divider = "─".repeat(60);
    logger.warn(`\n┌${divider}┐`);
    logger.warn(`│  ⚠️  Orphaned Compiled Collections Detected${" ".repeat(15)}│`);
    logger.warn(`├${divider}┤`);
    for (const file of orphanedFiles) {
      const padding = 57 - file.length;
      logger.warn(`│    • ${file}${" ".repeat(Math.max(0, padding))}│`);
    }
    logger.warn(`└${divider}┘\n`);
    for (const relativePath of orphanedFiles) {
      try {
        await fs.unlink(path.join(compiledCollections, relativePath));
        logger.info(`Removed orphan: ${relativePath}`);
      } catch {
        logger.warn(`Could not remove orphaned file ${relativePath}`);
      }
    }
  }
  return orphanedFiles;
}
