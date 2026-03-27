<!-- 
 @file src/components/image-editor/widgets/Crop/Controls.svelte
 @component Controls for the Crop tool
 -->
<script lang="ts">
import { imageEditorStore } from "@src/stores/image-editor-store.svelte";
import { ASPECT_RATIO_PRESETS } from "./aspect";
import type { CropShape } from "./types";

// Keyboard shortcuts for crop
$effect(() => {
	const handleKeydown = (e: KeyboardEvent) => {
		if (imageEditorStore.activeToolId !== "crop") return;

		// R for rotate right, L for rotate left
		if (e.key.toLowerCase() === "r") imageEditorStore.rotate(90);
		if (e.key.toLowerCase() === "l") imageEditorStore.rotate(-90);

		// F for flip horizontal
		if (e.key.toLowerCase() === "f") imageEditorStore.flipH();

		// Number keys for presets
		if (e.key === "1") onAspectChange(1); // Square
		if (e.key === "0") onAspectChange(null); // Free
	};

	window.addEventListener("keydown", handleKeydown);
	return () => window.removeEventListener("keydown", handleKeydown);
});

function onAspectChange(ratio: number | null) {
	const current = imageEditorStore.state.crop;
	if (!current) return;
	imageEditorStore.updateCrop({ ...current, aspectRatio: ratio });
}

function onCropShapeChange(shape: CropShape) {
	const current = imageEditorStore.state.crop;
	if (!current) return;
	imageEditorStore.updateCrop({ ...current, shape });
}
</script>

<div class="flex flex-col gap-4 p-4 text-white">
	<!-- Aspect Ratio Presets -->
	<div class="flex flex-col gap-2">
		<span class="text-xs font-bold uppercase tracking-widest text-surface-400">Aspect Ratio</span>
		<div class="grid grid-cols-3 gap-2">
			{#each ASPECT_RATIO_PRESETS as preset}
				<button
					class="flex flex-col items-center gap-1 rounded-lg border border-surface-700 bg-surface-800 p-2 transition-all hover:border-primary-500 hover:bg-surface-700
                        {imageEditorStore.state.crop?.aspectRatio === preset.value ? 'border-primary-500 bg-primary-500/10' : ''}"
					onclick={() => onAspectChange(preset.value)}
					title={preset.description}
				>
					{#if preset.icon}
						<iconify-icon icon={preset.icon} width="20"></iconify-icon>
					{:else}
						<div class="flex h-5 w-5 items-center justify-center text-[10px] font-bold border border-current rounded-sm">
							{preset.label}
						</div>
					{/if}
					<span class="text-[10px]">{preset.label}</span>
				</button>
			{/each}
		</div>
	</div>

	<!-- Crop Shape -->
	<div class="flex flex-col gap-2">
		<span class="text-xs font-bold uppercase tracking-widest text-surface-400">Shape</span>
		<div class="flex gap-2">
			<button
				class="flex flex-1 items-center justify-center gap-2 rounded-lg border border-surface-700 bg-surface-800 p-2 transition-all hover:border-primary-500
                    {imageEditorStore.state.crop?.shape === 'rect' ? 'border-primary-500 bg-primary-500/10' : ''}"
				onclick={() => onCropShapeChange('rect')}
			>
				<iconify-icon icon="mdi:rectangle-outline" width="20"></iconify-icon>
				<span class="text-xs">Rectangle</span>
			</button>
			<button
				class="flex flex-1 items-center justify-center gap-2 rounded-lg border border-surface-700 bg-surface-800 p-2 transition-all hover:border-primary-500
                    {imageEditorStore.state.crop?.shape === 'circle' ? 'border-primary-500 bg-primary-500/10' : ''}"
				onclick={() => onCropShapeChange('circle')}
			>
				<iconify-icon icon="mdi:circle-outline" width="20"></iconify-icon>
				<span class="text-xs">Circle</span>
			</button>
		</div>
	</div>

	<!-- Transformation Shortcuts -->
	<div class="flex flex-col gap-2 pt-2 border-t border-surface-700">
		<div class="flex gap-2">
			<button
				class="btn btn-sm preset-tonal-surface flex-1"
				onclick={() => imageEditorStore.rotate(-90)}
				title="Rotate Left (L)"
			>
				<iconify-icon icon="mdi:rotate-left" width="18"></iconify-icon>
				<span>Left</span>
			</button>
			<button
				class="btn btn-sm preset-tonal-surface flex-1"
				onclick={() => imageEditorStore.rotate(90)}
				title="Rotate Right (R)"
			>
				<iconify-icon icon="mdi:rotate-right" width="18"></iconify-icon>
				<span>Right</span>
			</button>
		</div>
		<div class="flex gap-2">
			<button
				class="btn btn-sm preset-tonal-surface flex-1"
				onclick={() => imageEditorStore.flipH()}
				title="Flip Horizontal (F)"
			>
				<iconify-icon icon="mdi:flip-horizontal" width="18"></iconify-icon>
				<span>Flip H</span>
			</button>
			<button
				class="btn btn-sm preset-tonal-surface flex-1"
				onclick={() => imageEditorStore.flipV()}
			>
				<iconify-icon icon="mdi:flip-vertical" width="18"></iconify-icon>
				<span>Flip V</span>
			</button>
		</div>
	</div>
</div>
