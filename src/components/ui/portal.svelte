<!-- 
@file src/components/ui/portal.svelte
@component
**Native Svelte 5 Portal Primitive**

Renders its children at the specified target (default: document.body).
Completely Skeleton-free.

### Props
- `target` (HTMLElement | string): Target element or selector. Default: document.body.
- `children` (Snippet): Content to portal.
-->

<script lang="ts">
import { onMount } from "svelte";
import type { Snippet } from "svelte";

interface Props {
	target?: HTMLElement | string | null;
	children: Snippet;
}

let { target = "body", children }: Props = $props();
let portalEl = $state<HTMLElement | null>(null);

onMount(() => {
	const targetEl =
		typeof target === "string" ? document.querySelector(target) : target;
	if (!targetEl || !portalEl) return;

	targetEl.appendChild(portalEl);

	return () => {
		if (portalEl?.parentNode) {
			portalEl.parentNode.removeChild(portalEl);
		}
	};
});
</script>

<div bind:this={portalEl} class="contents">
	{@render children()}
</div>
