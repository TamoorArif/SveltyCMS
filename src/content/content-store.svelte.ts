/**
 * @file src/content/content-store.svelte.ts
 * @description
 * Single Reactive Store for the SveltyCMS Content System.
 * Replaces content-structure, content-collections, and content-polling.
 * Uses Svelte 5 runes for tree-shakable reactivity.
 */
import type { ContentNode, Schema } from "./types";
import { browser } from "$app/environment";
import { logger } from "@utils/logger";

// --- STATE ---
let nodeMap = $state(new Map<string, ContentNode>());
let pathMap = $state(new Map<string, string>());
let version = $state(Date.now());
let state = $state<"uninitialized" | "initializing" | "initialized" | "error">("uninitialized");

// --- POLLING STATE ---
let pollingInterval: NodeJS.Timeout | null = null;
let currentPollingVersion = $state(0);

// --- DERIVED SATE ---
const sortedCollections = $derived.by(() => {
  void version; // Trigger dependency

  const list: Schema[] = [];
  for (const node of nodeMap.values()) {
    if (node.nodeType === "collection" && node.collectionDef) {
      list.push(node.collectionDef);
    }
  }

  list.sort((a, b) => {
    const orderDiff = (a.order ?? 999) - (b.order ?? 999);
    if (orderDiff !== 0) return orderDiff;
    return (a.path || "").localeCompare(b.path || "");
  });

  return list;
});

const collectionCount = $derived(() => {
  let count = 0;
  for (const node of nodeMap.values()) {
    if (node.nodeType === "collection") count++;
  }
  return count;
});

const isInitialized = $derived(() => state === "initialized");

/**
 * Pure reactive store for the entire content structure.
 */
export const contentStore = {
  // --- Core State ---
  get contentVersion() {
    return version;
  },
  get initState() {
    return state;
  },
  set initState(value) {
    state = value;
  },
  get collectionCount() {
    return collectionCount();
  },
  get isInitialized() {
    return isInitialized();
  },
  get nodeCount() {
    return nodeMap.size;
  },
  get pollingVersion() {
    return currentPollingVersion;
  },

  // --- Reading Nodes ---
  getNode(id: string) {
    return nodeMap.get(id);
  },
  getNodeByPath(path: string) {
    const id = pathMap.get(path);
    return id ? nodeMap.get(id) : undefined;
  },
  hasNode(id: string) {
    return nodeMap.has(id);
  },
  getNodes() {
    return nodeMap.values();
  },
  getAllNodes() {
    return Array.from(nodeMap.values());
  },
  getNodesEntries() {
    return nodeMap.entries();
  },
  getPathEntries() {
    return pathMap.entries();
  },

  getChildren(parentId: string | null = null, tenantId?: string | null) {
    const children: ContentNode[] = [];
    for (const node of nodeMap.values()) {
      const nodeParentId = node.parentId || null;
      if (nodeParentId === parentId && (!tenantId || node.tenantId === tenantId)) {
        children.push(node);
      }
    }
    return children;
  },

  getNodesForTenant(tenantId?: string | null) {
    if (!tenantId) return this.getAllNodes();
    return this.getAllNodes().filter((node) => node.tenantId === tenantId);
  },

  // --- Collection Queries ---
  getAllCollections(tenantId?: string | null): Schema[] {
    const all = sortedCollections;
    if (!tenantId) return all;
    return all.filter((c) => !c.tenantId || c.tenantId === tenantId);
  },

  getSmartFirstCollection(tenantId?: string | null): Schema | null {
    const collections = this.getAllCollections(tenantId);
    if (collections.length === 0) return null;

    const utilityNames = ["menu", "navigation", "form", "widgettest", "relation", "placeholder"];
    const smartCandidates = collections.filter((c) => {
      const name = (c.name as string)?.toLowerCase();
      return !utilityNames.includes(name);
    });

    return smartCandidates.length > 0 ? smartCandidates[0] : collections[0];
  },

  getCollection(identifier: string, tenantId?: string | null): Schema | null {
    let node = this.getNode(identifier);
    if (!node) {
      // 1. Direct path lookup
      const path = identifier.startsWith("/") ? identifier : `/${identifier}`;
      node = this.getNodeByPath(path);
      
      // 2. Fallback: Prefix-aware lookup (/collection/ prefix)
      if (!node) {
        if (path.startsWith("/collection/")) {
          // If we have the prefix but didn't find it, try without it
          node = this.getNodeByPath(path.replace("/collection", ""));
        } else {
          // If we DON'T have the prefix, try adding it
          node = this.getNodeByPath(`/collection${path}`);
        }
      }
    }
    if (!node) {
      const lowerId = identifier.toLowerCase();
      const lowerWithSlash = lowerId.startsWith("/") ? lowerId : `/${lowerId}`;
      for (const [pathKey, idValue] of this.getPathEntries()) {
        const lowerKey = pathKey.toLowerCase();
        if (lowerKey === lowerId || lowerKey === lowerWithSlash) {
          node = this.getNode(idValue);
          break;
        }
      }
    }
    if (!node) {
      for (const contentNode of this.getNodes()) {
        if (contentNode.collectionDef?._id === identifier) {
          node = contentNode;
          break;
        }
      }
    }

    if (node?.collectionDef && tenantId && node.tenantId && node.tenantId !== tenantId) {
      return null;
    }
    return node?.collectionDef ?? null;
  },

  searchCollections(query: string, filters?: any): Schema[] {
    const normalizedQuery = query.toLowerCase();
    const results: Schema[] = [];

    for (const node of nodeMap.values()) {
      if (node.nodeType !== "collection" || !node.collectionDef) continue;
      if (filters?.tenantId && node.tenantId && node.tenantId !== filters.tenantId) continue;

      const collection = node.collectionDef;
      if (filters?.status && collection.status !== filters.status) continue;
      if (filters?.hasIcon !== undefined && !!collection.icon !== filters.hasIcon) continue;

      if (
        node.name.toLowerCase().includes(normalizedQuery) ||
        (node.path || "").toLowerCase().includes(normalizedQuery)
      ) {
        results.push(collection);
      }
    }
    return results;
  },

  getCollectionStats(identifier: string, tenantId?: string | null) {
    const schema = this.getCollection(identifier, tenantId);
    if (!schema) return null;
    return {
      _id: schema._id as string,
      name: schema.name as string,
      icon: schema.icon,
      path: schema.path,
      fieldCount: schema.fields?.length ?? 0,
      hasRevisions: schema.revision === true,
      hasLivePreview: !!schema.livePreview,
      status: schema.status,
    };
  },

  // --- Mutations ---
  setNode(id: string, node: ContentNode) {
    nodeMap.set(id, node);
    if (node.path) pathMap.set(node.path, id);
    version = Date.now();
  },

  deleteNode(id: string) {
    const node = nodeMap.get(id);
    if (node?.path) pathMap.delete(node.path);
    nodeMap.delete(id);
    version = Date.now();
  },

  clear() {
    nodeMap.clear();
    pathMap.clear();
    version = Date.now();
  },

  updateVersion() {
    version = Date.now();
  },

  sync(nodes: ContentNode[]) {
    nodeMap.clear();
    pathMap.clear();
    for (const node of nodes) {
      nodeMap.set(node._id, node);
      if (node.path) pathMap.set(node.path, node._id);
    }
    version = Date.now();
    state = "initialized";
  },

  // --- Polling (Browser Only) ---
  /**
   * Periodically checks the server for content structure updates (sync token).
   * Note: This 'version' is used for cache-invalidation of the collection tree, 
   * and is separate from the application version (e.g. v0.0.6).
   */
  startPolling(onNewVersion: () => void, intervalMs = 10000) {
    if (!browser) return;

    // Strict Guard: Never poll on setup or login routes
    const pathname = window.location.pathname;
    const isRestrictedRoute = /^\/([a-z]{2,5}(-[a-zA-Z]+)?\/)?(setup|login)/i.test(pathname) || 
                             pathname.includes("/setup") || 
                             pathname.includes("/login");
                             
    if (isRestrictedRoute) {
      if (pollingInterval) this.stopPolling();
      return;
    }
    if (pollingInterval) return;

    logger.info("📡 Starting content version polling");

    const checkVersion = async () => {
      try {
        const response = await fetch("/api/content/version");
        if (!response.ok) throw new Error("Version check failed");

        const data = await response.json();
        const serverVersion = data.version;

        if (currentPollingVersion === 0) {
          currentPollingVersion = serverVersion;
          return;
        }

        if (serverVersion > currentPollingVersion) {
          logger.info(`🆕 New content version detected: ${serverVersion}`);
          currentPollingVersion = serverVersion;
          onNewVersion(); // Callback to trigger refresh in the manager
        }
      } catch (error) {
        logger.warn("Failed to poll content version", error);
      }
    };

    checkVersion();
    pollingInterval = setInterval(checkVersion, intervalMs);
  },

  stopPolling() {
    if (pollingInterval) {
      clearInterval(pollingInterval);
      pollingInterval = null;
    }
  },
};
