/**
 * @file src/content/content-collections.svelte.ts
 * @description
 * Svelte 5 runes-based service for collection-specific logic.
 * Handles sorting, filtering, and memoization of collection views.
 */
import type { Schema } from "./types";
import { contentStructure } from "./content-structure.svelte";

/**
 * Derived state for sorted collections.
 * Uses $derived.by for efficient memoization.
 * Automatically updates when contentStructure.contentVersion changes.
 */
const sortedCollections = $derived.by(() => {
  // Trigger dependency on version to ensure re-calculation on updates
  void contentStructure.contentVersion;

  const list: Schema[] = [];
  for (const node of contentStructure.getNodes()) {
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

export const contentCollections = {
  /**
   * Returns all collections, optionally filtered by tenant.
   * Uses memoized sorted list.
   */
  getAll(tenantId?: string | null): Schema[] {
    const all = sortedCollections;
    if (!tenantId) return all;
    return all.filter((c) => !c.tenantId || c.tenantId === tenantId);
  },

  /**
   * Returns a single collection by identifier (ID or Path).
   */
  get(identifier: string, tenantId?: string | null): Schema | null {
    // Try by ID first
    let node = contentStructure.getNode(identifier);

    // Try by Path
    if (!node) {
      const path = identifier.startsWith("/") ? identifier : `/${identifier}`;
      node = contentStructure.getNodeByPath(path);
    }

    // Fallback: Case-insensitive path search
    if (!node) {
      const lowerId = identifier.toLowerCase();
      const lowerWithSlash = lowerId.startsWith("/") ? lowerId : `/${lowerId}`;
      for (const [pathKey, idValue] of contentStructure.getPathEntries()) {
        const lowerKey = pathKey.toLowerCase();
        if (lowerKey === lowerId || lowerKey === lowerWithSlash) {
          node = contentStructure.getNode(idValue);
          break;
        }
      }
    }

    // Final fallback: Exhaustive ID search in collectionDefs (legacy)
    if (!node) {
      for (const contentNode of contentStructure.getNodes()) {
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

  /**
   * Returns the first collection for the dashboard.
   * Prioritizes non-utility collections.
   */
  getSmartFirst(tenantId?: string | null): Schema | null {
    const collections = this.getAll(tenantId);
    if (collections.length === 0) return null;

    const utilityNames = ["menu", "navigation", "form", "widgettest", "relation", "placeholder"];
    const smartCandidates = collections.filter((c) => {
      const name = (c.name as string)?.toLowerCase();
      return !utilityNames.includes(name);
    });

    return smartCandidates.length > 0 ? smartCandidates[0] : collections[0];
  },

  /**
   * Searches collections by query string and filters.
   */
  search(query: string, filters?: any): Schema[] {
    const normalizedQuery = query.toLowerCase();
    const results: Schema[] = [];

    for (const node of contentStructure.getNodes()) {
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

  /**
   * Returns basic stats for a collection.
   */
  getStats(identifier: string, tenantId?: string | null) {
    const schema = this.get(identifier, tenantId);
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
};
