/**
 * @file src/content/content-navigation.ts
 * @description
 * Pure tree operations for content navigation.
 * Reads from content-structure.svelte.ts, no DB calls.
 */
import { contentStructure } from "./content-structure.svelte";
import type { ContentNode, NavigationNode } from "./types";
import { logger } from "@src/utils/logger.server";

/**
 * Navigation and tree traversal logic.
 */
export const contentNavigation = {
  /**
   * Retrieves the entire content structure as a nested tree
   */
  async getContentStructure(): Promise<ContentNode[]> {
    if (contentStructure.initState === "initializing") {
      logger.warn(
        "[ContentNavigation] getContentStructure called during initialization, returning empty array",
      );
      return [];
    }

    // Create a structured, nested tree from the flat map
    const nodes = new Map<string, ContentNode>();
    for (const node of contentStructure.getNodes()) {
      nodes.set(node._id, { ...node, children: [] as ContentNode[] });
    }

    const tree: ContentNode[] = [];
    for (const node of nodes.values()) {
      if (node.parentId && nodes.has(node.parentId)) {
        nodes.get(node.parentId)?.children?.push(node as ContentNode);
      } else {
        tree.push(node as ContentNode);
      }
    }

    return tree;
  },

  /**
   * Returns a lightweight navigation structure for client serialization.
   */
  async getNavigationStructure(tenantId: string | null = null): Promise<NavigationNode[]> {
    const fullStructure = await this.getContentStructure();

    const stripToNavigation = (nodes: ContentNode[]): NavigationNode[] => {
      return nodes
        .filter((node) => !(tenantId && node.tenantId) || node.tenantId === tenantId)
        .map((node) => ({
          _id: node._id,
          name: node.name,
          path: node.path,
          icon: node.icon,
          nodeType: node.nodeType,
          order: node.order,
          parentId: node.parentId,
          translations: node.translations,
          children:
            node.children && node.children.length > 0
              ? stripToNavigation(node.children)
              : undefined,
        }));
    };

    return stripToNavigation(fullStructure);
  },

  /**
   * Get navigation structure with progressive loading
   * Loads only visible nodes first, defers children until expanded
   */
  getNavigationStructureProgressive(options?: {
    maxDepth?: number;
    expandedIds?: Set<string>;
    tenantId?: string | null;
  }): NavigationNode[] {
    const maxDepth = options?.maxDepth ?? 1; // Default: only root level
    const expandedIds = options?.expandedIds ?? new Set<string>();

    const buildTree = (parentId: string | undefined, currentDepth: number): NavigationNode[] => {
      const children: NavigationNode[] = [];

      for (const node of contentStructure.getNodes()) {
        if (options?.tenantId && node.tenantId && node.tenantId !== options.tenantId) {
          continue;
        }

        if ((node.parentId || undefined) === (parentId || undefined)) {
          const nodeDepth = currentDepth + 1;
          const shouldLoadChildren = nodeDepth < maxDepth || expandedIds.has(node._id);

          // Check for children existence using getNodes
          let hasChildren = false;
          for (const n of contentStructure.getNodes()) {
            if (n.parentId === node._id) {
              hasChildren = true;
              break;
            }
          }

          children.push({
            _id: node._id,
            name: node.name,
            path: node.path,
            icon: node.icon,
            nodeType: node.nodeType,
            order: node.order,
            parentId: node.parentId,
            translations: node.translations,
            // Only load children if depth allows or node is expanded
            children: shouldLoadChildren ? buildTree(node._id, nodeDepth) : undefined,
            hasChildren: hasChildren && !shouldLoadChildren,
          });
        }
      }

      return children.sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
    };

    return buildTree(undefined, 0);
  },

  /**
   * Get children of a specific node
   */
  getNodeChildren(nodeId: string, tenantId?: string | null): ContentNode[] {
    const children: ContentNode[] = [];

    for (const node of contentStructure.getNodes()) {
      if (
        node.parentId === nodeId &&
        (!(tenantId && node.tenantId) || node.tenantId === tenantId)
      ) {
        children.push({ ...node });
      }
    }

    return children.sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
  },

  /**
   * Get all descendants of a node
   */
  getDescendants(nodeId: string): ContentNode[] {
    const descendants: ContentNode[] = [];
    const queue: string[] = [nodeId];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const currentId = queue.shift()!;

      if (visited.has(currentId)) {
        continue;
      }
      visited.add(currentId);

      // Find children
      for (const node of contentStructure.getNodes()) {
        if (node.parentId === currentId) {
          descendants.push(node);
          queue.push(node._id);
        }
      }
    }

    return descendants;
  },

  /**
   * Get the path from root to a specific node
   */
  getNodePath(nodeId: string): ContentNode[] {
    const path: ContentNode[] = [];
    let currentNode = contentStructure.getNode(nodeId);

    while (currentNode) {
      path.unshift(currentNode);
      currentNode = currentNode.parentId
        ? contentStructure.getNode(currentNode.parentId)
        : undefined;
    }

    return path;
  },

  /**
   * Get breadcrumb trail for a path
   */
  getBreadcrumb(path: string): Array<{ name: string; path: string }> {
    const segments = path.split("/").filter(Boolean);
    const breadcrumb: Array<{ name: string; path: string }> = [];

    let currentPath = "";
    for (const segment of segments) {
      currentPath += `/${segment}`;
      const node = contentStructure.getNodeByPath(currentPath);

      if (node) {
        breadcrumb.push({
          name: node.name,
          path: currentPath,
        });
      }
    }

    return breadcrumb;
  },

  /**
   * Resolve multiple paths in a single operation
   */
  resolvePathsBulk(paths: string[]): Map<string, ContentNode | null> {
    const results = new Map<string, ContentNode | null>();

    for (const path of paths) {
      const node = contentStructure.getNodeByPath(path);
      results.set(path, node ?? null);
    }

    return results;
  },
};
