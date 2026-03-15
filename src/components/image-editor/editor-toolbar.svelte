<!-- 
 @file src/components/image-editor/editor-toolbar.svelte
 @component Toolbar for the Image Editor
 -->
<script lang="ts">
import { imageEditorStore } from '@src/stores/image-editor-store.svelte';
import { slide } from 'svelte/transition';
import { editorWidgets } from './widgets/registry';

const activeToolId = $derived(imageEditorStore.activeToolId);
const toolbarControls = $derived(activeToolId ? editorWidgets.find((w) => w.key === activeToolId) : null);

function handleToolToggle(toolId: string) {
	if (imageEditorStore.activeToolId === toolId) {
		imageEditorStore.cancelActiveTool();
	} else {
		imageEditorStore.setActiveTool(toolId);
	}
}
</script>

<div class="flex flex-col border-t border-surface-700 bg-surface-900 shadow-2xl">
	<!-- Drawer: Tool Controls (Slides up from within the dock) -->
	{#if toolbarControls?.controls}
		{@const ControlsComponent = toolbarControls.controls}
		<div class="flex flex-col border-b border-surface-700 bg-surface-800/50 backdrop-blur-md" transition:slide={{ axis: 'y', duration: 250 }}>
			<div class="flex items-center justify-between px-4 py-2 border-b border-surface-700/50">
				<span class="text-xs font-bold uppercase tracking-widest text-primary-500">
					{toolbarControls.title} Options
				</span>
				<button
					class="btn-icon btn-icon-sm preset-ghost-surface hover:preset-filled-surface"
					onclick={() => imageEditorStore.cancelActiveTool()}
					aria-label="Cancel tool"
				>
					<iconify-icon icon="mdi:close" width="16"></iconify-icon>
				</button>
			</div>
			<div class="max-h-64 overflow-y-auto">
				<ControlsComponent />
			</div>
		</div>
	{/if}

	<!-- Dock: Primary Tools -->
	<div class="flex items-center justify-between px-4 h-16 sm:h-20">
		<!-- Left: Cancel/History -->
		<div class="flex items-center gap-2">
			<button
				class="btn-icon sm:btn-md preset-tonal-surface hover:preset-filled-error-500"
				onclick={() => window.dispatchEvent(new CustomEvent('image-editor-cancel'))}
				title="Cancel Editing"
			>
				<iconify-icon icon="mdi:close" width="24"></iconify-icon>
			</button>

			<div class="h-8 w-px bg-surface-700 mx-2 hidden sm:block"></div>

			<button
				class="btn-icon sm:btn-md preset-tonal-surface disabled:opacity-30"
				onclick={() => imageEditorStore.undo()}
				disabled={!imageEditorStore.canUndo}
				title="Undo (Ctrl+Z)"
			>
				<iconify-icon icon="mdi:undo" width="24"></iconify-icon>
			</button>
			<button
				class="btn-icon sm:btn-md preset-tonal-surface disabled:opacity-30"
				onclick={() => imageEditorStore.redo()}
				disabled={!imageEditorStore.canRedo}
				title="Redo (Ctrl+Y)"
			>
				<iconify-icon icon="mdi:redo" width="24"></iconify-icon>
			</button>
		</div>

		<!-- Center: Tool Selector (Scrollable on mobile) -->
		<div class="flex items-center gap-1 sm:gap-2 px-4 overflow-x-auto no-scrollbar">
			{#each editorWidgets as widget}
				<button
					class="flex flex-col items-center justify-center min-w-[64px] sm:min-w-[80px] h-14 sm:h-16 rounded-xl transition-all duration-200
                        {activeToolId === widget.key ? 'bg-primary-500 text-white shadow-lg' : 'text-surface-400 hover:bg-surface-800 hover:text-white'}"
					onclick={() => handleToolToggle(widget.key)}
				>
					<iconify-icon icon={widget.icon} width="24"></iconify-icon>
					<span class="text-[10px] sm:text-xs font-medium mt-1">{widget.title}</span>
				</button>
			{/each}
		</div>

		<!-- Right: Save Controls -->
		<div class="flex items-center gap-3">
			<!-- Save Behavior Toggle (Copy vs Overwrite) -->
			<div class="hidden md:flex items-center bg-surface-800 rounded-full p-1 border border-surface-700">
				<button
					class="px-3 py-1 text-[10px] font-bold rounded-full transition-all
                        {imageEditorStore.saveBehavior === 'new' ? 'bg-surface-600 text-white' : 'text-surface-500'}"
					onclick={() => (imageEditorStore.saveBehavior = 'new')}
				>
					COPY
				</button>
				<button
					class="px-3 py-1 text-[10px] font-bold rounded-full transition-all
                        {imageEditorStore.saveBehavior === 'overwrite' ? 'bg-primary-500 text-white shadow-sm' : 'text-surface-500'}"
					onclick={() => (imageEditorStore.saveBehavior = 'overwrite')}
				>
					REPLACE
				</button>
			</div>

			<button
				class="btn h-10 sm:h-12 px-6 preset-filled-primary-500 font-bold shadow-lg transition-transform active:scale-95"
				onclick={() => window.dispatchEvent(new CustomEvent('image-editor-save'))}
			>
				<iconify-icon icon="mdi:check" width="20" class="mr-2"></iconify-icon>
				<span>SAVE</span>
			</button>
		</div>
	</div>
</div>

<style>
	.no-scrollbar::-webkit-scrollbar {
		display: none;
	}
	.no-scrollbar {
		-ms-overflow-style: none;
		scrollbar-width: none;
	}
</style>
