/**
 * @file scripts\codemods\2026-migrate-schema.ts
 * @description Codemod to migrate collection schemas to the 2026 format.
 *
 * Features:
 * - Adds 'version: 1' if missing.
 * - Renames 'old_prop' to 'new_prop' if found.
 */

import { createCodemodProject, isCollectionSchema } from "./utils";
import { join } from "node:path";
import { SyntaxKind } from "ts-morph";

/**
 * Example Codemod: Migrates collection schemas to the 2026 format.
 * 1. Adds 'version: 1' if missing.
 * 2. Renames 'old_prop' to 'new_prop' if found.
 */
async function run() {
  const project = createCodemodProject();
  const collectionsDir = join(process.cwd(), "config", "collections");

  // Add all collection files to the project
  project.addSourceFilesAtPaths(join(collectionsDir, "**/*.ts"));

  const sourceFiles = project.getSourceFiles();
  let modifiedCount = 0;

  for (const sourceFile of sourceFiles) {
    if (!isCollectionSchema(sourceFile)) continue;

    const defaultExport = sourceFile.getExportAssignment((d: any) => !d.isExportEquals());
    if (!defaultExport) continue;

    const obj = defaultExport.getExpressionIfKind(SyntaxKind.ObjectLiteralExpression);
    if (!obj) continue;

    let modified = false;

    // 1. Add 'version: 1' property
    if (!obj.getProperty("version")) {
      obj.addPropertyAssignment({
        name: "version",
        initializer: "1",
      });
      modified = true;
    }

    // 2. Example: Rename a property if it exists
    const oldProp = obj.getProperty("old_prop");
    if (oldProp && oldProp.isKind(SyntaxKind.PropertyAssignment)) {
      oldProp.getNameNode().replaceWithText("new_prop");
      modified = true;
    }

    if (modified) {
      modifiedCount++;
      await sourceFile.save();
      console.log(`✅ Migrated schema: ${sourceFile.getBaseName()}`);
    }
  }

  if (modifiedCount === 0) {
    console.log("✨ No schemas required migration.");
  } else {
    console.log(`🎉 Successfully migrated ${modifiedCount} schemas.`);
  }
}

run().catch(console.error);
