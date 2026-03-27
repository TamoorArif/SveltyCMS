<!-- 
 @file src/components/image-editor/editor.svelte
 @component Primary shell for the Image Editor
 -->
<script lang="ts">
import { imageEditorStore } from "@src/stores/image-editor-store.svelte";
import { onMount, onDestroy } from "svelte";
import { fade } from "svelte/transition";
import { registerHotkey } from "@src/utils/hotkeys";
import Canvas from "./editor-canvas.svelte";
import Toolbar from "./editor-toolbar.svelte";
import { editorWidgets } from "./widgets/registry";

let { image, onsave, oncancel } = $props<{
	image: { url: string; _id?: string };
	oncancel: () => void;
	onsave: (data: any) => void;
}>();

// Initialize Editor
onMount(async () => {
	imageEditorStore.reset();

	// Register Standard Hotkeys
	registerHotkey("mod+s", handleSave, "Save Image");
	registerHotkey("mod+z", () => imageEditorStore.undo(), "Undo");
	registerHotkey("mod+shift+z", () => imageEditorStore.redo(), "Redo");
	registerHotkey("mod+y", () => imageEditorStore.redo(), "Redo (Alternate)");
	registerHotkey("escape", oncancel, "Cancel Editing", false);

	// Load image element
	const img = new Image();
	img.crossOrigin = "anonymous";
	img.onload = () => {
		imageEditorStore.imageElement = img;
		imageEditorStore.state.crop = {
			x: 0,
			y: 0,
			width: img.width,
			height: img.height,
			aspectRatio: undefined,
			shape: "rect",
		};
		imageEditorStore.saveHistory();
	};
	img.src = image.url;

	// Global event bridges
	window.addEventListener("image-editor-save", handleSave);
});

onDestroy(() => {
	window.removeEventListener("image-editor-save", handleSave);
});

async function handleSave() {
	const canvas = document.querySelector("canvas");
	if (!canvas) return;

	const dataURL = canvas.toDataURL("image/jpeg", 0.9);
	const res = await fetch(dataURL);
	const blob = await res.blob();
	const file = new File([blob], "edited-image.jpg", { type: "image/jpeg" });

	onsave({
		dataURL,
		file,
		mediaId: image._id,
		operations: {
			adjustments: $state.snapshot(imageEditorStore.state.filters),
			crop: $state.snapshot(imageEditorStore.state.crop),
			rotation: imageEditorStore.state.rotation,
			flipH: imageEditorStore.state.flipH,
			flipV: imageEditorStore.state.flipV,
		},
		focalPoint: $state.snapshot(imageEditorStore.state.focalPoint),
		saveBehavior: imageEditorStore.saveBehavior,
	});
}
</script>

<div class="flex h-full w-full flex-col bg-surface-950 overflow-hidden" transition:fade={{ duration: 200 }}>
	<div class="flex items-center justify-between px-4 h-12 bg-surface-900 border-b border-surface-800">
		<div class="flex items-center gap-2">
			<iconify-icon icon="mdi:image-edit" width="20" class="text-primary-500"></iconify-icon>
			<span class="text-sm font-bold text-white uppercase tracking-tighter">Photo Editor</span>
		</div>
		<div class="flex items-center gap-4 text-[10px] text-surface-400 font-mono">
			{#if imageEditorStore.imageElement}
				<span>{imageEditorStore.imageElement.width} × {imageEditorStore.imageElement.height} px</span>
			{/if}
			<span>ZOOM: {Math.round(imageEditorStore.state.zoom * 100)}%</span>
		</div>
	</div>

	<div class="relative flex-1">
		<Canvas>
			{#if imageEditorStore.activeToolId}
				{@const ToolComponent = editorWidgets.find((w) => w.key === imageEditorStore.activeToolId)?.tool}
				{#if ToolComponent}
					<ToolComponent onCancel={() => imageEditorStore.cancelActiveTool()} />
				{/if}
			{/if}
		</Canvas>

		<div class="absolute bottom-4 right-4 flex flex-col gap-2 pointer-events-auto">
			<button class="btn-icon bg-surface-800/80 hover:bg-surface-700 text-white border border-surface-700 shadow-xl" onclick={() => imageEditorStore.updateZoom(0.1)} title="Zoom In">
				<iconify-icon icon="mdi:plus" width="20"></iconify-icon>
			</button>
			<button class="btn-icon bg-surface-800/80 hover:bg-surface-700 text-white border border-surface-700 shadow-xl" onclick={() => imageEditorStore.updateZoom(-0.1)} title="Zoom Out">
				<iconify-icon icon="mdi:minus" width="20"></iconify-icon>
			</button>
		</div>
	</div>

	<Toolbar />
</div>
