<!-- 
 @file src/components/image-editor/widgets/Crop/Tool.svelte
 @component Interactive Crop tool with resizing and aspect ratio locking
 -->
<script lang="ts">
import { imageEditorStore } from '@src/stores/image-editor-store.svelte';
let isResizing = $state(false);
let activeHandle = $state<string | null>(null);

// Get current crop state
const crop = $derived(imageEditorStore.state.crop);
const canvasSize = $derived(imageEditorStore.state.canvasSize);

// Map crop coordinates (image-space) to screen coordinates
const screenCrop = $derived.by(() => {
	const img = imageEditorStore.state.imageElement;
	if (!img || !crop) return { x: 0, y: 0, width: 0, height: 0 };

	const center = { x: canvasSize.width / 2, y: canvasSize.height / 2 };
	const zoom = imageEditorStore.state.zoom;
	const pan = imageEditorStore.state.pan;

	return {
		x: center.x + pan.x + (crop.x - img.width / 2) * zoom,
		y: center.y + pan.y + (crop.y - img.height / 2) * zoom,
		width: crop.width * zoom,
		height: crop.height * zoom
	};
});

function handleResizeStart(e: PointerEvent, handle: string) {
	e.preventDefault();
	e.stopPropagation();
	isResizing = true;
	activeHandle = handle;
	(e.target as HTMLElement).setPointerCapture(e.pointerId);
}

function handleResizeMove(e: PointerEvent) {
	if (!isResizing || !activeHandle || !crop) return;

	const img = imageEditorStore.state.imageElement;
	if (!img) return;

	// Convert screen movement to image-space movement
	const zoom = imageEditorStore.state.zoom;
	const dx = e.movementX / zoom;
	const dy = e.movementY / zoom;

	let { x, y, width, height } = { ...crop };

	if (activeHandle.includes('e')) width += dx;
	if (activeHandle.includes('w')) {
		width -= dx;
		x += dx;
	}
	if (activeHandle.includes('s')) height += dy;
	if (activeHandle.includes('n')) {
		height -= dy;
		y += dy;
	}

	// Apply aspect ratio lock if active
	if (crop.aspectRatio) {
		const ratio = crop.aspectRatio;
		if (activeHandle === 'e' || activeHandle === 'w') {
			height = width / ratio;
		} else {
			width = height * ratio;
		}
	}

	// Bounds checking
	x = Math.max(0, Math.min(img.width - width, x));
	y = Math.max(0, Math.min(img.height - height, y));
	width = Math.max(10, Math.min(img.width - x, width));
	height = Math.max(10, Math.min(img.height - y, height));

	imageEditorStore.updateCrop({ ...crop, x, y, width, height });
}

function handleResizeEnd() {
	isResizing = false;
	activeHandle = null;
}

function handleDragMove(e: PointerEvent) {
	if (isResizing) return;
	if (e.buttons !== 1 || !crop) return;

	const img = imageEditorStore.state.imageElement;
	if (!img) return;

	const zoom = imageEditorStore.state.zoom;
	const dx = e.movementX / zoom;
	const dy = e.movementY / zoom;

	let { x, y, width, height } = { ...crop };
	x = Math.max(0, Math.min(img.width - width, x + dx));
	y = Math.max(0, Math.min(img.height - height, y + dy));

	imageEditorStore.updateCrop({ ...crop, x, y });
}
</script>

<div
	class="absolute inset-0 pointer-events-auto"
	onpointermove={handleResizeMove}
	onpointerup={handleResizeEnd}
    role="presentation"
>
	<!-- Dimmed Background Overlay -->
	<svg class="h-full w-full pointer-events-none">
		<defs>
			<mask id="crop-mask">
				<rect x="0" y="0" width="100%" height="100%" fill="white" />
				<rect
					x={screenCrop.x}
					y={screenCrop.y}
					width={screenCrop.width}
					height={screenCrop.height}
					fill="black"
					rx={crop?.shape === 'circle' ? '50%' : '0'}
				/>
			</mask>
		</defs>
		<rect x="0" y="0" width="100%" height="100%" fill="rgba(0,0,0,0.5)" mask="url(#crop-mask)" />
	</svg>

	<!-- Interactive Crop Box -->
	<div
		class="absolute border-2 border-white shadow-xl cursor-move group"
		style:left="{screenCrop.x}px"
		style:top="{screenCrop.y}px"
		style:width="{screenCrop.width}px"
		style:height="{screenCrop.height}px"
		style:border-radius={crop?.shape === 'circle' ? '50%' : '0'}
		onpointerdown={handleDragMove}
		role="button"
		tabindex="0"
		aria-label="Crop Area"
        onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleDragMove(e as any); }}
	>
		<!-- Grid Lines -->
		<div class="absolute inset-0 grid grid-cols-3 grid-rows-3 opacity-30 pointer-events-none">
			<div class="border-r border-b border-white"></div>
			<div class="border-r border-b border-white"></div>
			<div class="border-b border-white"></div>
			<div class="border-r border-b border-white"></div>
			<div class="border-r border-b border-white"></div>
			<div class="border-b border-white"></div>
			<div class="border-r border-white"></div>
			<div class="border-r border-white"></div>
			<div></div>
		</div>

		<!-- Resize Handles -->
		{#each ['nw', 'ne', 'sw', 'se', 'n', 's', 'e', 'w'] as handle}
			<div
				class="absolute h-4 w-4 bg-white border border-primary-500 rounded-full shadow-md z-50
                    {handle.length === 1 ? 'opacity-0 group-hover:opacity-100' : ''}
                    {handle === 'nw' ? '-left-2 -top-2 cursor-nw-resize' : ''}
                    {handle === 'ne' ? '-right-2 -top-2 cursor-ne-resize' : ''}
                    {handle === 'sw' ? '-left-2 -bottom-2 cursor-sw-resize' : ''}
                    {handle === 'se' ? '-right-2 -bottom-2 cursor-se-resize' : ''}
                    {handle === 'n' ? 'left-1/2 -top-2 -translate-x-1/2 cursor-n-resize' : ''}
                    {handle === 's' ? 'left-1/2 -bottom-2 -translate-x-1/2 cursor-s-resize' : ''}
                    {handle === 'e' ? '-right-2 top-1/2 -translate-y-1/2 cursor-e-resize' : ''}
                    {handle === 'w' ? '-left-2 top-1/2 -translate-y-1/2 cursor-w-resize' : ''}"
				onpointerdown={(e) => handleResizeStart(e, handle)}
                role="button"
                tabindex="0"
                aria-label="Resize {handle}"
                onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleResizeStart(e as any, handle); }}
			></div>
		{/each}
	</div>
</div>
