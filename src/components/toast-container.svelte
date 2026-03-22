<!--
@file src/components/toast-container.svelte
@component
**Premium Svelte 5 Toast Container**
Handles positioning and lifecycle of multiple toast notifications.
-->

<script lang="ts">
import { toast } from '@src/stores/toast.svelte.ts';
import { flip } from 'svelte/animate';
import type { ToastPosition } from '@src/stores/toast.svelte.ts';
import ToastPrimitive from '@src/components/ui/toast.svelte';

interface Props {
	/** Default position - 'responsive' adapts to screen size */
	position?: ToastPosition;
	/** Custom responsive breakpoints */
	responsive?: {
		mobile?: Exclude<ToastPosition, 'responsive'>;
		tablet?: Exclude<ToastPosition, 'responsive'>;
		desktop?: Exclude<ToastPosition, 'responsive'>;
	};
	limit?: number;
}

let { position = 'responsive', responsive = {}, limit = 5 }: Props = $props();

// Merge custom responsive config with defaults
$effect(() => {
	toast.setResponsiveConfig({
		mobile: responsive.mobile ?? 'bottom-center',
		tablet: responsive.tablet ?? 'bottom-right',
		desktop: responsive.desktop ?? 'bottom-right'
	});
});

// Reactive position based on screen size
const effectivePosition = $derived(toast.getEffectivePosition(position));

// Position CSS classes
const positionClasses: Record<Exclude<ToastPosition, 'responsive'>, string> = {
	'top-left': 'top-4 left-4 items-start',
	'top-right': 'top-4 right-4 items-end',
	'top-center': 'top-4 left-1/2 -translate-x-1/2 items-center',
	'bottom-left': 'bottom-4 left-4 items-start',
	'bottom-right': 'bottom-4 right-4 items-end',
	'bottom-center': 'bottom-4 left-1/2 -translate-x-1/2 items-center'
};

const visibleToasts = $derived(toast.sortedToasts.slice(0, limit));

function handleClose(id: string) {
	toast.close(id);
}

function handlePause(id: string) {
	toast.pause(id);
}

function handleResume(id: string) {
	toast.resume(id);
}
</script>

{#if toast.toasts.length > 0}
	<div
		class="fixed z-9999 flex flex-col gap-3 {positionClasses[effectivePosition]} pointer-events-none w-full sm:w-auto px-4 sm:px-0"
		role="region"
		aria-label="Notifications"
		aria-live="polite"
	>
		{#each visibleToasts as t (t.id)}
			<div animate:flip={{ duration: 300 }}>
				<ToastPrimitive 
					toast={t} 
					onClose={handleClose} 
					onPause={handlePause} 
					onResume={handleResume} 
				/>
			</div>
		{/each}
	</div>
{/if}

<style>
	/* Container mobile optimizations */
	div[role='region'] {
		max-width: 100vw;
	}
</style>
