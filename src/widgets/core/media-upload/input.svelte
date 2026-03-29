<!--
@file src/widgets/core/MediaUpload/Input.svelte
@component
**Enhanced Media Upload Widget Input**
Features:
- Dynamic Folder Resolution (Collection-Aware)
- Batch Selection Keyboard Support
- Drag-and-Drop Reordering
- WCAG 3.0 Accessibility Improvements
-->

<script lang="ts">
import MediaLibraryModal from "@components/media-library-modal.svelte";
import { logger } from "@utils/logger";
import { modalState } from "@utils/modal-state.svelte";
import { flip } from "svelte/animate";
import { dndzone } from "svelte-dnd-action";
import { page } from "$app/state";
import type { FieldType } from "./";
import type { MediaFile } from "./types";
import { registerHotkey } from "@src/utils/hotkeys";
import { onMount } from "svelte";

const tenantId = $derived(page.data?.tenantId);

let {
	field,
	value = $bindable(),
	error,
	collectionName,
}: {
	field: FieldType;
	value: string | string[] | null | undefined;
	error?: string | null;
	collectionName?: string;
} = $props();

let selectedFiles = $state<MediaFile[]>([]);

onMount(() => {
	registerHotkey("mod+o", openMediaLibrary, "Open Media Library");
});

async function fetchMediaData(ids: string[]): Promise<MediaFile[]> {
	try {
		const results: MediaFile[] = [];
		for (const id of ids) {
			const res = await fetch(`/api/http/media/${id}`);
			if (res.ok) {
				const found = await res.json();
				results.push({
					_id: found._id,
					name: found.filename,
					type: found.mimeType,
					size: found.size,
					url: found.url,
					thumbnailUrl: found.thumbnails?.md?.url || found.url,
				} as any);
			}
		}
		return results;
	} catch (e) {
		logger.error("Fetch failed", e);
		return [];
	}
}

$effect(() => {
	const ids = Array.isArray(value) ? value : value ? [value] : [];
	if (ids.length > 0) {
		const currentIds = selectedFiles.map((f) => f._id);
		if (JSON.stringify(ids) !== JSON.stringify(currentIds)) {
			fetchMediaData(ids).then((files) => (selectedFiles = files));
		}
	} else {
		selectedFiles = [];
	}
});

$effect(() => {
	const newIds = selectedFiles.map((f) => f._id);
	value = field.multiupload ? newIds : newIds[0] || null;
});

function openMediaLibrary() {
	const dynamicFolder =
		(field as any).folder ||
		(collectionName
			? `collections/${collectionName.toLowerCase()}`
			: tenantId || "global");

	modalState.trigger(
		MediaLibraryModal as any,
		{
			selectionMode: field.multiupload ? "multiple" : "single",
			allowedTypes: field.allowedTypes || [],
			folder: dynamicFolder,
			size: "fullscreen",
		},
		(files: any[]) => {
			if (files && Array.isArray(files)) {
				const mapped = files.map((f) => ({
					_id: f._id,
					name: f.filename,
					type: f.mimeType,
					size: f.size,
					url: f.url,
					thumbnailUrl: f.thumbnails?.md?.url || f.url,
				}));
				selectedFiles = field.multiupload
					? [...selectedFiles, ...mapped]
					: [mapped[0]];
			}
		},
	);
}

function removeFile(fileId: string) {
	selectedFiles = selectedFiles.filter((f) => f._id !== fileId);
}
</script>

<div 
	class="min-h-[140px] rounded-xl border-2 border-dashed p-4 transition-all duration-200
        {error ? 'border-error-500 bg-error-500/5' : 'border-surface-300 dark:border-surface-600 bg-surface-50 dark:bg-surface-900/50 hover:border-primary-500/50'}"
	role="group"
	aria-labelledby="label-{field.db_fieldName}"
>
	{#if selectedFiles.length > 0}
		<div 
			class="mb-4 grid gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5"
			use:dndzone={{ items: selectedFiles, flipDurationMs: 200 }}
			onconsider={(e) => selectedFiles = e.detail.items}
			onfinalize={(e) => selectedFiles = e.detail.items}
		>
			{#each selectedFiles as file (file._id)}
				<div 
					class="relative group aspect-square rounded-lg border border-surface-200 dark:border-surface-700 overflow-hidden bg-white dark:bg-surface-800 shadow-sm"
					animate:flip={{ duration: 200 }}
				>
					<img src={file.thumbnailUrl} alt={file.name} class="h-full w-full object-cover" />
					
					<div class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-between p-2">
						<button 
							onclick={() => removeFile(file._id)}
							class="btn-icon btn-icon-sm bg-error-500 text-white self-end rounded-full shadow-lg"
							aria-label="Remove {file.name}"
						>
							<iconify-icon icon="mdi:close" width="16"></iconify-icon>
						</button>
						<span class="text-[9px] text-white font-medium truncate bg-black/60 px-1.5 py-0.5 rounded backdrop-blur-sm">
							{file.name}
						</span>
					</div>
				</div>
			{/each}
		</div>
	{/if}

	<button
		type="button"
		onclick={openMediaLibrary}
		class="w-full flex flex-col items-center justify-center gap-2 py-6 rounded-lg border-2 border-dashed border-surface-300 dark:border-surface-700 
            text-surface-500 hover:text-primary-500 hover:border-primary-500 hover:bg-primary-500/5 transition-all"
		aria-label="Open Media Library (Mod+O)"
	>
		<iconify-icon icon="mdi:cloud-upload-outline" width="32"></iconify-icon>
		<span class="text-sm font-bold uppercase tracking-widest">{field.placeholder || '+ Add Media'}</span>
		<span class="text-[10px] opacity-50">(Mod + O)</span>
	</button>

	{#if error}
		<p class="mt-2 text-xs text-error-500 font-medium" role="alert">{error}</p>
	{/if}
</div>
