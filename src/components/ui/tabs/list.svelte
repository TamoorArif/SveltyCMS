<!-- 
@file src/components/ui/tabs/list.svelte
@component LIST
-->
<script lang="ts">
	import { cn } from '@utils/cn';
	import type { Snippet } from 'svelte';
	
	interface Props {
		children?: Snippet;
		class?: string;
	}
	
	let { children, class: className = '' }: Props = $props();
</script>

<div class={cn("tabs-list flex border-b border-surface-200 dark:border-surface-700 mb-4 overflow-x-auto scrollbar-hide", className)} role="tablist">
	{@render children?.()}
</div>

<style>
	.scrollbar-hide::-webkit-scrollbar { display: none; }
	.scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
</style>
