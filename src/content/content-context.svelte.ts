/**
 * @file src/content/content-context.svelte.ts
 * @description
 * Svelte 5 context for content management.
 * Provides auto-initialization and unified access to the content service.
 */
import { setContext, getContext } from 'svelte';
import { contentManager } from './content-manager';

const CONTENT_CONTEXT_KEY = Symbol('content-context');

/**
 * Creates and sets the content context for a specific tenant.
 * Typically called in a high-level layout.
 */
export function setContentContext(tenantId: string | null = null) {
	// Ensure initialization logic is active
	useContentInitializer(tenantId);

	const ctx = {
		content: contentManager,
		tenantId,

		/**
		 * Tenant-aware reactive collections view.
		 */
		get collections() {
			return contentManager.collections.getAll(tenantId);
		},

		/**
		 * Tenant-aware reactive navigation tree (progressive/sync).
		 */
		get navigation() {
			return contentManager.getNavigationStructureProgressive({ tenantId, maxDepth: 999 });
		},

		/**
		 * Quick check for system readiness.
		 */
		get isReady() {
			return contentManager.isInitialized;
		}
	};

	setContext(CONTENT_CONTEXT_KEY, ctx);
	return ctx;
}

/**
 * Retrieves the content context.
 * Provides a fallback if called outside a provider.
 */
export function useContent() {
	const context = getContext<ReturnType<typeof setContentContext>>(CONTENT_CONTEXT_KEY);
	if (!context) {
		return {
			content: contentManager,
			tenantId: null as string | null,
			get collections() {
				return contentManager.collections.getAll(null);
			},
			get navigation() {
				return contentManager.getNavigationStructureProgressive({ tenantId: null, maxDepth: 999 });
			},
			get isReady() {
				return contentManager.isInitialized;
			}
		};
	}
	return context;
}

/**
 * Hook to ensure content is initialized in a component.
 * Monitors the uninitialized state and triggers bootstrapping.
 */
export function useContentInitializer(tenantId: string | null = null) {
	// This will be called in a component, so we can use $effect
	$effect(() => {
		if (!contentManager.isInitialized && contentManager.initState === 'uninitialized') {
			contentManager.initialize(tenantId);
		}
	});
}
