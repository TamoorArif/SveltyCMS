/**
 * @file src/content/content-reconciler.ts
 * @description
 * Orchestrator for content reconciliation (File system ↔ Database).
 * Delegates to specialized sub-modules in ./content-reconciler/
 */
import { logger } from "@src/utils/logger.server";
import { contentStructure } from "./content-structure.svelte";
import { contentCache } from "./content-cache.svelte";
import { dateToISODateString } from "@utils/date-utils";
import { v4 as uuidv4 } from "uuid";
import type { ContentNode, Schema, DatabaseId } from "./types";
import type { IDBAdapter } from "@src/databases/db-interface";

// Sub-module imports (server-side only, imported dynamically below)

const getDbAdapter = async () => {
  const { dbInitPromise, dbAdapter } = await import("@src/databases/db");
  await dbInitPromise;
  return dbAdapter;
};
const normalizeId = (id: string) => id.replace(/-/g, "");

/**
 * DB-agnostic reconciliation logic.
 */
export const contentReconciler = {
  /**
   * Full scan, reconcile, and populate cache
   */
  async fullReload(
    tenantId?: string | null,
    skipReconciliation = false,
    adapter?: IDBAdapter,
  ): Promise<void> {
    const { scanAndProcessFiles } = await import("./content-reconciler/scan-files.server");
    const allSchemas = await scanAndProcessFiles();
    await this.reconcileAndBuildStructure(allSchemas, tenantId, skipReconciliation, adapter);
    await contentCache.populateCache(tenantId);
  },

  /**
   * Synchronize schemas with DB
   */
  async reconcileAndBuildStructure(
    allSchemas: Schema[],
    tenantId?: string | null,
    skipReconciliation = false,
    adapter?: IDBAdapter,
  ): Promise<void> {
    const dbAdapter = adapter || ((await getDbAdapter()) as IDBAdapter);
    const schemas = allSchemas.filter((s) => !(tenantId && s.tenantId) || s.tenantId === tenantId);

    if (!dbAdapter) {
      logger.info(
        "[ContentReconciler] No database available (setup mode) - building structure from files only",
      );
      await this._buildInMemoryStructureFromSchemas(schemas);
      return;
    }

    if (dbAdapter.ensureContent) {
      await dbAdapter.ensureContent();
    }
    if (dbAdapter.ensureCollections) {
      await dbAdapter.ensureCollections();
    }

    let operations: ContentNode[] = [];
    const dbNodes: ContentNode[] = [];

    try {
      const dbResult = await dbAdapter.content.nodes.getStructure("flat", {
        tenantId,
        bypassTenantCheck: true,
        bypassCache: true,
      });
      if (dbResult.success && dbResult.data) {
        dbNodes.push(...dbResult.data);
      }
    } catch (err) {
      logger.warn("[ContentReconciler] Failed to fetch initial DB state:", err);
    }

    // Register models (Delegated)
    const { registerModels } = await import("./content-reconciler/db-operations");
    await registerModels(dbAdapter, schemas);

    // Cleanup database-only collections if their files are missing
    // This prevents "Customers" redirects when config/collections is empty
    if (!skipReconciliation) {
      const currentIds = new Set(schemas.filter((s) => s._id).map((s) => s._id));
      const staleCollections = dbNodes.filter(
        (node) => node.nodeType === "collection" && !currentIds.has(node._id.toString()),
      );

      if (staleCollections.length > 0) {
        logger.info(
          `[ContentReconciler] Cleaning up ${staleCollections.length} stale collection nodes...`,
        );
        const staleIds = staleCollections.map((n) => n._id.toString());
        await dbAdapter.crud.deleteMany("system_content_structure", {
          _id: { $in: staleIds },
          ...(tenantId ? { tenantId } : {}),
        } as any);

        // Remove from dbNodes to prevent re-processing
        for (const id of staleIds) {
          const idx = dbNodes.findIndex((n) => n._id.toString() === id);
          if (idx !== -1) dbNodes.splice(idx, 1);
        }
      }
    }

    if (skipReconciliation) {
      if (dbNodes.length === 0) {
        logger.warn(
          "[ContentReconciler] ⚠️ Skip reconciliation requested, but DB is EMPTY! Forcing reconciliation.",
        );
        skipReconciliation = false;
      } else {
        logger.info(
          `[ContentReconciler] Skipping reconciliation (trusting DB state with ${dbNodes.length} nodes).`,
        );
      }
    }

    if (skipReconciliation) {
      const { generateCategoryNodesFromPaths } = await import("./content-utils");
      const fileCategoryNodes = generateCategoryNodesFromPaths(schemas);

      for (const cat of fileCategoryNodes.values()) {
        operations.push(cat as ContentNode);
      }
      for (const schema of schemas) {
        operations.push({
          _id: (schema._id as unknown as DatabaseId) || ("" as DatabaseId),
          path: schema.path || "",
          name: schema.name || "",
          collectionDef: schema,
          nodeType: "collection",
        } as unknown as ContentNode);
      }
    } else {
      const { generateCategoryNodesFromPaths } = await import("./content-utils");
      const fileCategoryNodes = generateCategoryNodesFromPaths(schemas);

      const dbNodeMap = new Map<string, ContentNode>(
        dbNodes
          .filter((node: ContentNode) => typeof node.path === "string")
          .map((node: ContentNode) => [node.path as string, node]),
      );

      // Core Logic (Delegated)
      const { buildReconciliationOperations } =
        await import("./content-reconciler/reconcile-logic");
      operations = buildReconciliationOperations(schemas, fileCategoryNodes, dbNodeMap);

      const nodesToDelete: string[] = [];
      for (const op of operations) {
        if (!op.path) continue;
        const existingNode = dbNodeMap.get(op.path);
        if (existingNode && existingNode._id.toString() !== op._id.toString()) {
          logger.warn(
            `[ContentReconciler] ID Mismatch for path="${op.path}": DB=${existingNode._id} vs Schema=${op._id}.`,
          );
          nodesToDelete.push(op.path);
        }
      }

      if (nodesToDelete.length > 0) {
        await dbAdapter.content.nodes.deleteMany(nodesToDelete, { tenantId });
      }

      if (operations.length > 0) {
        // DB Operations (Delegated)
        const { bulkUpsertWithParentIds } = await import("./content-reconciler/db-operations");
        await bulkUpsertWithParentIds(dbAdapter, operations, tenantId, dbNodes);
      }
    }

    await this._loadFinalStructure(dbAdapter, operations, tenantId, dbNodes);
  },

  async _loadFinalStructure(
    dbAdapter: IDBAdapter,
    operations: ContentNode[],
    tenantId?: string | null,
    dbNodes?: ContentNode[],
  ): Promise<void> {
    const result =
      dbNodes && dbNodes.length > 0
        ? { success: true, data: dbNodes }
        : await dbAdapter.content.nodes.getStructure("flat", {
            tenantId,
            bypassCache: true,
            bypassTenantCheck: true,
          });

    if (!(result.success && result.data)) {
      throw new Error("Failed to fetch final content structure");
    }

    if (tenantId) {
      for (const node of contentStructure.getNodes()) {
        if (node.tenantId === tenantId) contentStructure.deleteNode(node._id);
      }
    } else {
      contentStructure.clear();
    }

    for (const node of result.data) {
      const normalizedId = normalizeId(node._id);
      if (node.nodeType === "collection") {
        const schemaFromOps = operations.find(
          (op) => op._id === normalizedId || op.path === node.path,
        );
        if (schemaFromOps?.collectionDef) node.collectionDef = schemaFromOps.collectionDef;
      }
      contentStructure.setNode(normalizedId, node);
    }
  },

  async _buildInMemoryStructureFromSchemas(schemas: Schema[]): Promise<void> {
    const now = dateToISODateString(new Date());
    const { generateCategoryNodesFromPaths } = await import("./content-utils");
    const fileCategoryNodes = generateCategoryNodesFromPaths(schemas);
    const pathToIdMap = new Map<string, DatabaseId>();

    contentStructure.clear();

    for (const [path, fileNode] of fileCategoryNodes.entries()) {
      const nodeId = uuidv4().replace(/-/g, "") as DatabaseId;
      const parentPath = path.split("/").slice(0, -1).join("/") || undefined;
      const parentId = parentPath ? pathToIdMap.get(parentPath) : undefined;

      contentStructure.setNode(nodeId, {
        _id: nodeId,
        parentId,
        path,
        name: fileNode.name,
        icon: "bi:folder",
        order: 999,
        nodeType: "category",
        translations: [],
        createdAt: now,
        updatedAt: now,
      });
      pathToIdMap.set(path, nodeId);
    }

    for (const schema of schemas) {
      if (!schema.path) continue;
      const nodeId = schema._id as DatabaseId;
      const parentPath = schema.path.split("/").slice(0, -1).join("/") || undefined;
      const parentId = parentPath ? pathToIdMap.get(parentPath) : undefined;

      contentStructure.setNode(nodeId, {
        _id: nodeId,
        parentId,
        path: schema.path,
        name: typeof schema.name === "string" ? schema.name : String(schema.name),
        icon: schema.icon ?? "bi:file",
        order: 999,
        nodeType: "collection",
        translations: schema.translations ?? [],
        collectionDef: schema,
        tenantId: schema.tenantId,
        createdAt: now,
        updatedAt: now,
      });
      pathToIdMap.set(schema.path, nodeId);
    }
  },

  /**
   * Gets the content structure directly from the database (not from in-memory cache).
   */
  async getContentStructureFromDatabase(
    format: "flat" | "nested" = "nested",
    tenantId?: string | null,
  ): Promise<ContentNode[]> {
    const dbAdapter = await getDbAdapter();
    if (!dbAdapter) throw new Error("Database adapter is not available");

    const { isSetupComplete } = await import("@utils/setup-check");
    const result = await dbAdapter.content.nodes.getStructure(format, {
      tenantId,
      bypassTenantCheck: !tenantId || !isSetupComplete(),
    });

    if (!result.success) {
      logger.error(
        "[ContentReconciler] Failed to get content structure from database:",
        result.error,
      );
      return [];
    }

    return result.data;
  },

  /**
   * Handles bulk content structure operations (create, update, move, rename, delete).
   */
  async upsertContentNodes(
    operations: import("./types").ContentNodeOperation[],
    tenantId?: string | null,
  ): Promise<ContentNode[]> {
    const dbAdapter = await getDbAdapter();
    if (!dbAdapter) throw new Error("Database adapter not available");

    const bulkUpdates: Array<{ path: string; changes: Partial<ContentNode> }> = [];
    const bulkCreates: Omit<ContentNode, "createdAt" | "updatedAt">[] = [];

    for (const operation of operations) {
      const { type, node } = operation;
      switch (type) {
        case "create": {
          if (!node.path) continue;
          const { createdAt: _createdAt, updatedAt: _updatedAt, ...createFields } = node as any;
          bulkCreates.push(createFields);
          contentStructure.setNode(node._id, node);
          break;
        }
        case "update":
        case "rename":
        case "move": {
          if (!node.path) continue;
          const { _id, createdAt: _, ...changeableFields } = node as any;
          bulkUpdates.push({
            path: node.path,
            changes: { ...changeableFields, updatedAt: dateToISODateString(new Date()) },
          });
          contentStructure.setNode(node._id, node);
          break;
        }
        case "delete":
          if (node.path) await dbAdapter.content.nodes.delete(node.path);
          contentStructure.deleteNode(node._id);
          break;
      }
    }

    if (bulkCreates.length > 0) await dbAdapter.content.nodes.createMany(bulkCreates);
    if (bulkUpdates.length > 0)
      await dbAdapter.content.nodes.bulkUpdate(bulkUpdates, { tenantId, bypassTenantCheck: true });

    const result = await dbAdapter.content.nodes.getStructure("flat", {
      tenantId,
      bypassTenantCheck: true,
    });
    return result.success ? result.data : [];
  },

  /**
   * Optimized method for reordering content nodes using transactional logic.
   */
  async reorderContentNodes(
    operations: import("./types").ContentNodeOperation[],
    tenantId?: string | null,
  ): Promise<ContentNode[]> {
    const dbAdapter = await getDbAdapter();
    if (!dbAdapter) throw new Error("Database adapter not available");

    const reorderItems = operations.map((op) => {
      const { node } = op;
      let parentId: string | null = null;
      if (typeof node.parentId === "string") parentId = node.parentId;
      else if (node.parentId) parentId = String((node.parentId as any).id || node.parentId);

      return { id: node._id, parentId, order: node.order || 0, path: node.path || "" };
    });

    await dbAdapter.content.nodes.reorderStructure(reorderItems);

    for (const op of operations) {
      contentStructure.setNode(op.node._id, op.node);
    }

    const result = await dbAdapter.content.nodes.getStructure("flat", {
      tenantId,
      bypassTenantCheck: true,
    });
    return result.success ? result.data : [];
  },

  /**
   * Move a node and all its descendants to a new parent
   */
  async moveNodeWithDescendants(nodeId: string, newParentId: string | undefined): Promise<void> {
    const node = contentStructure.getNode(nodeId);
    if (!node) throw new Error(`Node not found: ${nodeId}`);

    const dbAdapter = await getDbAdapter();
    if (!dbAdapter) throw new Error("Database adapter not available");

    node.parentId = newParentId as DatabaseId | undefined;
    node.updatedAt = dateToISODateString(new Date()) as import("./types").ISODateString;

    await dbAdapter.content.nodes.bulkUpdate(
      [
        {
          path: node.path as string,
          changes: { parentId: node.parentId, updatedAt: node.updatedAt },
        },
      ],
      {
        tenantId: node.tenantId,
        bypassTenantCheck: true,
      },
    );

    contentStructure.setNode(nodeId, node);
  },
};
