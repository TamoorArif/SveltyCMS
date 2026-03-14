<!-- 
@file src/routes/(app)/config/collectionbuilder/[action]/[...contentPath]/+page.svelte
@component Collection Builder Editor Shell
 -->
<script lang="ts">
import PageTitle from '@src/components/page-title.svelte';
import type { FieldInstance, Schema } from '@src/content/types';
import type { User } from '@src/databases/auth/types';
import { button_cancel, button_delete, button_save } from '@src/paraglide/messages';
import { collection, setCollection } from '@src/stores/collection-store.svelte';
import { useContent } from '@src/content/content-context.svelte';
import { validationStore } from '@src/stores/store.svelte.ts';
import { toast } from '@src/stores/toast.svelte.ts';
import { widgetStoreActions } from '@src/stores/widget-store.svelte.ts';
import { logger } from '@utils/logger';
import { showConfirm } from '@utils/modal-utils';
import { obj2formData } from '@utils/utils';
import { registerHotkey } from '@src/utils/hotkeys';
import { onMount } from 'svelte';
import { afterNavigate, goto } from '$app/navigation';
import { page } from '$app/state';
import CollectionForm from './tabs/collection-form.svelte';
import CollectionWidgetOptimized from './tabs/collection-widget-optimized.svelte';

const action = $derived(page.params.action);
const { data } = $props<{ data: { collection?: Schema; user: User } }>();
useContent();

let originalName = $state('');
let isLoading = $state(false);
let activeSection = $state('general');

onMount(() => {
	widgetStoreActions.initializeWidgets();

	// Centralized Hotkeys
	registerHotkey('mod+s', () => handleCollectionSave(), 'Save Collection');
	registerHotkey('escape', () => goto('/config/collectionbuilder'), 'Cancel & Exit', false);
});

async function handleCollectionSave(confirmDeletions = false) {
	if (validationStore.errors && Object.keys(validationStore.errors).length > 0) {
		toast.error('Please fix validation errors before saving');
		return;
	}

	try {
		isLoading = true;
		const payload = { originalName, ...collection.value };
		if (confirmDeletions) (payload as any).confirmDeletions = 'true';

		const response = await fetch('?/saveCollection', {
			method: 'POST',
			body: obj2formData(payload)
		});

		if (response.ok) {
			toast.success('Collection Saved Successfully');
			if (originalName !== collection.value?.name) {
				originalName = String(collection.value?.name);
				goto(`/config/collectionbuilder/edit/${originalName}`);
			}
		}
	} catch (error) {
		logger.error('Save failed', error);
		toast.error('Failed to save collection');
	} finally {
		isLoading = false;
	}
}

function handleCollectionDelete() {
	showConfirm({
		title: 'Delete Collection?',
		body: `Are you sure you want to delete "${collection.value?.name}"?`,
		onConfirm: async () => {
			const res = await fetch('?/deleteCollections', {
				method: 'POST',
				body: obj2formData({ ids: JSON.stringify([collection.value?._id]) })
			});
			if (res.ok) {
				toast.success('Collection Deleted');
				goto('/config/collectionbuilder');
			}
		}
	});
}

afterNavigate(() => {
	if (page.params.action === 'edit' && data.collection) {
		setCollection(data.collection);
		originalName = String(data.collection.name || '');
	} else if (page.params.action === 'new') {
		setCollection({ name: 'new', icon: 'bi:collection', status: 'unpublished', fields: [] } as any);
		originalName = '';
	}
});
</script>

<PageTitle name={action === 'edit' ? `Edit ${collection.value?.name}` : 'Create Collection'} icon={collection.value?.icon || 'ic:baseline-build'} showBackButton={true} backUrl="/config/collectionbuilder">
	<div class="flex gap-2">
		{#if action === 'edit'}
			<button onclick={handleCollectionDelete} class="preset-filled-error-500 btn flex items-center gap-1" disabled={isLoading}>
				<iconify-icon icon="mdi:delete" width="20"></iconify-icon>
				<span class="hidden sm:inline">{button_delete()}</span>
			</button>
		{/if}
		<button onclick={() => handleCollectionSave()} class="preset-filled-primary-500 btn flex items-center gap-1 min-w-[100px]" disabled={isLoading}>
			{#if isLoading}
				<iconify-icon icon="mdi:loading" width="20" class="animate-spin"></iconify-icon>
			{:else}
				<iconify-icon icon="mdi:content-save" width="20"></iconify-icon>
			{/if}
			<span>{button_save()}</span>
		</button>
	</div>
</PageTitle>

<div class="flex h-[calc(100vh-120px)] flex-col">
	<div class="flex border-b border-surface-200-800 bg-surface-50-950">
		<button class="px-4 py-3 text-sm font-medium border-b-2 {activeSection === 'general' ? 'border-primary-500 text-primary-500' : 'border-transparent'}" onclick={() => { activeSection = 'general'; document.getElementById('general-info')?.scrollIntoView({ behavior: 'smooth' }); }}>
			General Info
		</button>
		<button class="px-4 py-3 text-sm font-medium border-b-2 {activeSection === 'fields' ? 'border-primary-500 text-primary-500' : 'border-transparent'}" onclick={() => { activeSection = 'fields'; document.getElementById('fields-config')?.scrollIntoView({ behavior: 'smooth' }); }}>
			Fields
		</button>
	</div>

	<div class="flex-1 overflow-y-auto p-4 sm:p-6 scroll-smooth">
		<div class="mx-auto max-w-5xl space-y-12">
			<section id="general-info" class="rounded-xl border border-surface-200-800 p-6 shadow-sm">
				<CollectionForm data={collection.value} handlePageTitleUpdate={(t: string) => collection.value && (collection.value.name = t)} />
			</section>
			<section id="fields-config" class="rounded-xl border border-surface-200-800 p-6 shadow-sm">
				<CollectionWidgetOptimized fields={(collection.value?.fields as FieldInstance[]) || []} />
			</section>
		</div>
	</div>
</div>
