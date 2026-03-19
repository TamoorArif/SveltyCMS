/**
 * @file src/content/content-utils.ts
 * @description
 * Shared utility functions for content management.
 * Safe for both client-side UI and server-side reconciliation.
 */
import type { MinimalContentNode, Schema } from "./types";

/**
 * Generates category nodes based on the hierarchical paths of collection files.
 */
export function generateCategoryNodesFromPaths(files: Schema[]): Map<string, MinimalContentNode> {
  const folders = new Map<string, MinimalContentNode>();

  for (const file of files) {
    if (!file.path) {
      continue;
    }
    const parts = file.path.split("/").filter(Boolean);
    let path = "";
    // All segments except the last one are categories
    for (let i = 0; i < parts.length - 1; i++) {
      const name = parts[i];
      path = `${path}/${name}`;
      if (!folders.has(path)) {
        folders.set(path, { name, path, nodeType: "category" });
      }
    }
  }

  return folders;
}

/**
 * Consistent sorting logic for content nodes.
 */
export function sortContentNodes<T extends { order?: number; name: string }>(a: T, b: T): number {
  const orderDiff = (a.order ?? 999) - (b.order ?? 999);
  if (orderDiff !== 0) return orderDiff;
  return a.name.localeCompare(b.name);
}

/**
 * Checks if a node with the same name already exists under the same parent.
 */
export function hasDuplicateSiblingName(
  nodes: any[],
  parentId: any,
  name: string,
  excludeId?: string,
): boolean {
  return nodes.some(
    (node) => node.name === name && node.parentId === parentId && node._id !== excludeId,
  );
}
