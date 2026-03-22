<!-- 
 @file src/components/system/dialog-manager.svelte 
@description DialogManager for handling modals 

Features: 
 - modal lifecycle management, backdrop/escape close support, skeleton v4 integration, fullscreen mode support] -->

<script lang="ts">
import Modal from '@components/ui/modal.svelte';
import { modalState } from '@utils/modal-state.svelte';

/* Derived state for fullscreen mode */
const isFullscreen = $derived(modalState.active?.props?.size === 'fullscreen');
</script>

<Modal
	bind:open={modalState.isOpen}
	title={modalState.active?.props?.title || ''}
	size={modalState.active?.props?.size || 'md'}
	class={modalState.active?.props?.modalClasses}
>
	{#if modalState.active}
		{#if modalState.active.component}
			{@const ActiveComponent = modalState.active.component}
			<div class="modal-body {isFullscreen ? 'flex-1 overflow-auto' : ''}">
				<ActiveComponent {...modalState.active.props || {}} close={() => modalState.close()} />
			</div>
		{/if}
	{/if}
</Modal>
