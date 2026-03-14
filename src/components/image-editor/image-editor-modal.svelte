<!-- 
 @file src/components/image-editor/image-editor-modal.svelte
 @component Fullscreen modal wrapper for the Image Editor
 -->
<script lang="ts">
import { modalState } from '@utils/modal-state.svelte';
import { registerHotkey } from '@src/utils/hotkeys';
import { onMount } from 'svelte';
import Editor from './editor.svelte';

const { image, onsave } = $props<{
	image: { url: string; _id?: string };
	onsave: (data: any) => Promise<void>;
}>();

let isSaving = $state(false);

async function handleSave(data: any) {
	if (isSaving) return;
	isSaving = true;

	try {
		await onsave(data);
		modalState.close();
	} catch (error) {
		console.error('Failed to save image:', error);
	} finally {
		isSaving = false;
	}
}

onMount(() => {
	// Register modal-specific hotkeys if needed
	const unregister = registerHotkey(
		'escape',
		() => {
			if (!isSaving) modalState.close();
		},
		'Close Image Editor',
		false
	);

	return unregister;
});
</script>

<div class="fixed inset-0 z-[9999] flex flex-col bg-surface-950">
	<!-- Editor Shell -->
	<div class="flex-1 min-h-0">
		<Editor {image} onsave={handleSave} oncancel={() => modalState.close()} />
	</div>

	<!-- Global Loading Overlay during Save -->
	{#if isSaving}
		<div class="fixed inset-0 z-[10000] flex flex-col items-center justify-center bg-surface-950/80 backdrop-blur-sm animate-fade-in">
			<div class="flex flex-col items-center gap-4">
				<div class="h-16 w-16 animate-spin rounded-full border-4 border-primary-500 border-t-transparent shadow-xl"></div>
				<div class="flex flex-col items-center">
					<span class="text-xl font-bold text-white uppercase tracking-widest">Processing Image</span>
					<span class="text-sm text-surface-400">Applying transformations and generating variants...</span>
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	:global(body) {
		overflow: hidden !important;
	}
</style>
