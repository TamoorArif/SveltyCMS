<!-- 
 @file src/components/image-editor/editor-canvas.svelte
 @component Image Editor Canvas using svelte-canvas
 -->
<script lang="ts">
import { Canvas, Layer, type Render } from 'svelte-canvas';
import { imageEditorStore } from '@src/stores/image-editor-store.svelte';
import { onMount, type Snippet } from 'svelte';

interface Props {
	children?: Snippet;
}

let { children }: Props = $props();

let container: HTMLDivElement | undefined = $state();
let canvasSize = $derived(imageEditorStore.state.canvasSize);

// Rendering logic
const render: Render = ({ context, width, height }) => {
	const state = imageEditorStore.state;
	const img = state.imageElement;

	if (!img) return;

	context.clearRect(0, 0, width, height);

	// Apply Adjustments (Filters)
	const adj = state.filters;
	const filters = [
		`brightness(${100 + (adj.brightness || 0)}%)`,
		`contrast(${100 + (adj.contrast || 0)}%)`,
		`saturate(${100 + (adj.saturation || 0)}%)`,
		`grayscale(${adj.grayscale || 0}%)`,
		`sepia(${adj.sepia || 0}%)`,
		`hue-rotate(${adj.temperature || 0}deg)`
	].join(' ');

	context.filter = filters;

	// Draw Main Image
	context.save();
	context.translate(width / 2 + state.pan.x, height / 2 + state.pan.y);
	context.rotate((state.rotation * Math.PI) / 180);
	context.scale(state.flipH ? -1 : 1, state.flipV ? -1 : 1);
	context.scale(state.zoom, state.zoom);

	context.drawImage(img, -img.width / 2, -img.height / 2);
	context.restore();

	// Reset filter for overlays
	context.filter = 'none';
};

onMount(() => {
	if (!container) return;

	const observer = new ResizeObserver((entries) => {
		const entry = entries[0];
		if (entry) {
			imageEditorStore.state.canvasSize = {
				width: entry.contentRect.width,
				height: entry.contentRect.height
			};
		}
	});

	observer.observe(container);
	return () => observer.disconnect();
});
</script>

<div bind:this={container} class="relative h-full w-full bg-surface-900 overflow-hidden select-none">
	<Canvas width={canvasSize.width} height={canvasSize.height}>
		<Layer {render} />
	</Canvas>

	<!-- Interaction Overlay (Handled by tools) -->
	<div class="absolute inset-0 pointer-events-none">
		{#if children}
			{@render children()}
		{/if}
	</div>
</div>

<style>
	:global(canvas) {
		display: block;
	}
</style>
