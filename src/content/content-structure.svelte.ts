/**
 * @file src/content/content-structure.svelte.ts
 * @description
 * Svelte 5 runes-based state for content structure.
 * Aligned with architecture/state-management.mdx patterns.
 *
 * Encapsulates internal maps and provides controlled query access.
 */
import type { ContentNode } from './types';

// Observable state via $state() — matches architecture/state-management.mdx
let nodeMap = $state(new Map<string, ContentNode>());
let pathMap = $state(new Map<string, string>());
let version = $state(Date.now());
let state = $state<'uninitialized' | 'initializing' | 'initialized' | 'error'>('uninitialized');

// Derived computed properties
const collectionCount = $derived(() => {
	let count = 0;
	for (const node of nodeMap.values()) {
		if (node.nodeType === 'collection') count++;
	}
	return count;
});

const isInitialized = $derived(() => state === 'initialized');

/**
 * Pure in-memory state for content structure.
 * No DB or cache calls.
 */
export const contentStructure = {
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

	// --- Controlled Accessors ---

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

	/**
	 * Returns an iterator for all nodes.
	 * Preferred over exposing the raw Map to prevent direct mutation.
	 */
	getNodes() {
		return nodeMap.values();
	},

	/**
	 * Returns all nodes as an array.
	 */
	getAllNodes() {
		return Array.from(nodeMap.values());
	},

	/**
	 * Returns children of a specific node, optionally filtered by tenant.
	 */
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

	/**
	 * Returns all nodes for a specific tenant.
	 */
	getNodesForTenant(tenantId?: string | null) {
		if (!tenantId) return this.getAllNodes();
		return this.getAllNodes().filter((node) => node.tenantId === tenantId);
	},

	getNodesEntries() {
		return nodeMap.entries();
	},

	getPathEntries() {
		return pathMap.entries();
	},

	get nodeCount() {
		return nodeMap.size;
	},

	// --- Mutation Methods ---

	setNode(id: string, node: ContentNode) {
		nodeMap.set(id, node);
		if (node.path) {
			pathMap.set(node.path, id);
		}
		version = Date.now();
	},

	deleteNode(id: string) {
		const node = nodeMap.get(id);
		if (node?.path) {
			pathMap.delete(node.path);
		}
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

	/**
	 * Bulk update for reconciliation performance.
	 */
	sync(nodes: ContentNode[]) {
		nodeMap.clear();
		pathMap.clear();
		for (const node of nodes) {
			nodeMap.set(node._id, node);
			if (node.path) {
				pathMap.set(node.path, node._id);
			}
		}
		version = Date.now();
		state = 'initialized';
	}
};
