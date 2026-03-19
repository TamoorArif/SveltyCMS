/**
 * @file src/content/content-reconciler/reconcile-logic.ts
 * @description
 * Pure logic for calculating reconciliation operations.
 */
import { dateToISODateString } from "@utils/date-utils";
import { v4 as uuidv4 } from "uuid";
import type { ContentNode, Schema, DatabaseId } from "../types";

/**
 * Calculates the operations needed to synchronize the DB with the file system.
 */
export function buildReconciliationOperations(
  schemas: Schema[],
  fileCategoryNodes: Map<string, { name: string }>,
  dbNodeMapByPath: Map<string, ContentNode>,
): ContentNode[] {
  const operations: ContentNode[] = [];
  const now = dateToISODateString(new Date());
  const pathToIdMap = new Map<string, DatabaseId>();
  const dbNodeMapById = new Map<string, ContentNode>();

  for (const node of dbNodeMapByPath.values()) {
    dbNodeMapById.set(node._id.toString(), node);
  }

  const toDatabaseId = (id: string) => id as DatabaseId;
  const processedPaths = new Set<string>();

  // 1. Collections
  for (const schema of schemas) {
    if (!schema.path) continue;

    const dbNode = (dbNodeMapById.get(schema._id as string) || dbNodeMapByPath.get(schema.path)) as
      | ContentNode
      | undefined;
    const nodeId = toDatabaseId(schema._id as string);

    operations.push({
      _id: nodeId,
      parentId: undefined,
      path: schema.path,
      name: typeof schema.name === "string" ? schema.name : String(schema.name),
      icon: schema.icon ?? dbNode?.icon ?? "bi:file",
      slug: schema.slug ?? dbNode?.slug,
      description: schema.description ?? dbNode?.description,
      order: dbNode?.order ?? 999,
      nodeType: "collection",
      translations: schema.translations ?? dbNode?.translations ?? [],
      collectionDef: schema,
      tenantId: schema.tenantId,
      createdAt: dbNode?.createdAt ? dateToISODateString(new Date(dbNode.createdAt)) : now,
      updatedAt: now,
    });

    pathToIdMap.set(schema.path, nodeId);
    processedPaths.add(schema.path);
  }

  // 2. Categories from FS
  for (const [path, fileNode] of fileCategoryNodes.entries()) {
    if (processedPaths.has(path)) continue;

    const dbNode = dbNodeMapByPath.get(path);
    const nodeId = toDatabaseId(dbNode?._id ?? uuidv4().replace(/-/g, ""));

    operations.push({
      _id: nodeId,
      parentId: undefined,
      path,
      name: (dbNode?.name ?? fileNode.name) as string,
      icon: dbNode?.icon ?? "bi:folder",
      order: dbNode?.order ?? 999,
      nodeType: "category",
      translations: dbNode?.translations ?? [],
      createdAt: dbNode?.createdAt ? dateToISODateString(new Date(dbNode.createdAt)) : now,
      updatedAt: now,
    });

    pathToIdMap.set(path, nodeId);
    processedPaths.add(path);
  }

  // 3. Required Ancestors
  const requiredCategoryPaths = new Set<string>();
  for (const schema of schemas) {
    if (!schema.path) continue;
    const parts = schema.path.split("/").filter(Boolean);
    for (let i = 1; i < parts.length; i++) {
      requiredCategoryPaths.add(`/${parts.slice(0, i).join("/")}`);
    }
  }

  for (const [path, dbNode] of dbNodeMapByPath.entries()) {
    const isRequired = requiredCategoryPaths.has(path);
    if (!processedPaths.has(path) && dbNode.nodeType === "category" && isRequired) {
      operations.push({
        ...dbNode,
        _id: toDatabaseId(dbNode._id.toString()),
        createdAt: dbNode.createdAt ? dateToISODateString(new Date(dbNode.createdAt)) : now,
        updatedAt: now,
      });
      pathToIdMap.set(path, toDatabaseId(dbNode._id.toString()));
    }
  }

  // Sort by depth
  operations.sort((a, b) => (a.path?.split("/").length ?? 0) - (b.path?.split("/").length ?? 0));

  // 4. Resolve parentIds
  for (const op of operations) {
    if (!op.path) continue;
    const pathParts = op.path.split("/").filter(Boolean);
    if (pathParts.length > 1) {
      const parentPath = `/${pathParts.slice(0, -1).join("/")}`;
      op.parentId = pathToIdMap.get(parentPath);
    }
  }

  return operations;
}
