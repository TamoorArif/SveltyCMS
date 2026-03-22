<!--
@file src/widgets/core/MediaUpload/MediaUpload.svelte
@component
**Enhanced Media Upload Widget**
Features:
- Focal Point Selection
- Sharp.js Image Editor Integration
- Accessibility Landmarks
- Multi-Tenant Folder Resolution
-->
<script lang="ts">
import ImageEditorModal from '@src/components/image-editor/image-editor-modal.svelte';
import FileUpload from '@components/ui/file-upload.svelte';
import { updateMediaMetadata } from '@utils/media/api';
import type { MediaImage } from '@utils/media/media-models';
import { convertTimestampToDateString } from '@utils/utils';
import { modalState } from '@utils/modal-state.svelte';
import { mediaUrl } from '@utils/media/media-utils';

let isFlipped = $state(false);

let { field, value = $bindable<File | MediaImage | undefined>() } = $props();

async function handleEdit() {
	if (!value || value instanceof File) return;

	const fullUrl = mediaUrl(value);
	if (!fullUrl) return;

	modalState.trigger(ImageEditorModal as any, {
		image: { ...value, url: fullUrl },
		onsave: handleEditorSave,
		size: 'fullscreen'
	});
}

async function handleEditorSave(detail: any) {
	const formData = new FormData();
	formData.append('file', detail.file);
	if (detail.mediaId) formData.append('mediaId', detail.mediaId);
	if (detail.operations) formData.append('operations', JSON.stringify(detail.operations));
	if (detail.saveBehavior) formData.append('saveBehavior', detail.saveBehavior);

	try {
		const response = await fetch('/api/media/edit', { method: 'POST', body: formData });
		if (response.ok) {
			const result = await response.json();
			value = result.data;
			modalState.close();
		}
	} catch (error) {
		logger.error('Error saving edited image:', error);
	}
}

// Focal Point logic
let focalPoint = $state({ x: 50, y: 50 });
let isDraggingFocalPoint = $state(false);
let containerRef: HTMLDivElement | undefined = $state();

$effect(() => {
	if (value && !(value instanceof File) && value.metadata?.focalPoint) {
		focalPoint = value.metadata.focalPoint;
	}
});

function handleFocalPointDrag(event: MouseEvent) {
	if (!isDraggingFocalPoint || !containerRef) return;
	const rect = containerRef.getBoundingClientRect();
	focalPoint = {
		x: Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100)),
		y: Math.max(0, Math.min(100, ((event.clientY - rect.top) / rect.height) * 100))
	};
}

async function saveFocalPoint() {
	isDraggingFocalPoint = false;
	if (value && !(value instanceof File) && value._id) {
		await updateMediaMetadata(value._id, { focalPoint });
	}
}

$effect(() => {
	if (isDraggingFocalPoint) {
		window.addEventListener('mousemove', handleFocalPointDrag);
		window.addEventListener('mouseup', saveFocalPoint);
		return () => {
			window.removeEventListener('mousemove', handleFocalPointDrag);
			window.removeEventListener('mouseup', saveFocalPoint);
		};
	}
});
</script>

<div class="relative mb-4 group min-h-[100px]">
	{#if !value}
		<FileUpload 
			onchange={(files) => { if (files.length > 0) value = files[0]; }} 
			multiple={field.multiupload}
			label="Upload Media"
			helper="Drop images or click to select"
		/>
	{:else}
		<div class="flex w-full flex-col border-2 border-dashed border-surface-600 bg-surface-50 dark:bg-surface-800 rounded-xl overflow-hidden shadow-sm transition-all hover:border-primary-500/50">
			<div class="flex items-center justify-between p-3 border-b border-surface-200 dark:border-surface-700 bg-surface-100/50 dark:bg-surface-900/50">
				<span class="text-xs font-bold truncate max-w-[200px]">
					{value instanceof File ? value.name : (value as MediaImage).filename}
				</span>
				<span class="text-[10px] font-mono opacity-50">
					{((value.size ?? 0) / 1024).toFixed(1)} KB
				</span>
			</div>

			<div class="flex p-4 gap-4 items-center">
				{#if !isFlipped}
					<div class="relative flex-1 bg-surface-200 dark:bg-surface-900 rounded-lg overflow-hidden flex items-center justify-center min-h-[150px]" bind:this={containerRef}>
						<img
							src={value instanceof File ? URL.createObjectURL(value) : (value as MediaImage).url}
							alt="Preview"
							class="max-h-[200px] object-contain shadow-lg"
						/>
						
						{#if value && !(value instanceof File)}
							<button
								class="absolute h-8 w-8 rounded-full bg-white/80 dark:bg-surface-800/80 shadow-xl border border-primary-500 flex items-center justify-center cursor-move"
								style:left="{focalPoint.x}%"
								style:top="{focalPoint.y}%"
								style:transform="translate(-50%, -50%)"
								onmousedown={() => isDraggingFocalPoint = true}
								title="Set Focal Point"
								aria-label="Adjust focal point"
							>
								<iconify-icon icon="mdi:crosshairs-gps" width="20" class="text-primary-500"></iconify-icon>
							</button>
						{/if}
					</div>
				{:else}
					<div class="flex-1 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
						<span class="opacity-50 uppercase tracking-tighter">Uploaded</span>
						<span class="font-mono">{convertTimestampToDateString(new Date().getTime())}</span>
					</div>
				{/if}

				<div class="flex flex-col gap-2">
					<button 
						onclick={handleEdit}
						class="btn-icon preset-tonal-surface hover:preset-filled-primary-500"
						title="Edit in Image Editor"
					>
						<iconify-icon icon="mdi:pencil" width="20"></iconify-icon>
					</button>
					<button 
						onclick={() => isFlipped = !isFlipped}
						class="btn-icon preset-tonal-surface"
						title="Toggle Metadata"
					>
						<iconify-icon icon="mdi:information-variant" width="20"></iconify-icon>
					</button>
					<button 
						onclick={() => value = undefined}
						class="btn-icon preset-tonal-surface hover:preset-filled-error-500"
						title="Remove File"
					>
						<iconify-icon icon="mdi:trash-can-outline" width="20"></iconify-icon>
					</button>
				</div>
			</div>
		</div>
	{/if}
</div>
