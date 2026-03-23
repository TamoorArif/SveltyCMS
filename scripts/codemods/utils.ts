/**
 * @file scripts\codemods\utils.ts
 * @description Utility functions for SveltyCMS codemods.
 */

import { Project, type SourceFile } from "ts-morph";
import { join } from "node:path";

/**
 * Creates a ts-morph project configured for the SveltyCMS workspace.
 */
export function createCodemodProject() {
  const project = new Project({
    tsConfigFilePath: join(process.cwd(), "tsconfig.json"),
    skipAddingFilesFromTsConfig: true,
  });
  return project;
}

/**
 * Helper to identify if an object literal is likely a SveltyCMS Collection Schema.
 */
export function isCollectionSchema(sourceFile: SourceFile) {
  // Simple heuristic: does it export a default object with 'fields'?
  const defaultExport = sourceFile.getDefaultExportSymbol();
  if (!defaultExport) return false;

  const declaration = defaultExport.getDeclarations()[0];
  if (!declaration) return false;

  const text = declaration.getText();
  return text.includes("fields:") || text.includes("name:");
}
