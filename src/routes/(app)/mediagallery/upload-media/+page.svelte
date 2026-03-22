<!-- 
@files src/routes/(app)/mediagallery/uploadMedia/+page.svelte
@component
**This page is used to upload media to the media gallery**

@example
<ModalUploadMedia parent={parent} sectionName={sectionName} files={files} onDelete={onDelete} uploadFiles={uploadFiles} />

### Props
- `parent` {any} - Parent component
- `sectionName` {string} - Name of the section
- `files` {File[]} - Array of files to be uploaded **Optional**
- `onDelete` {Function} - Function to delete a file
- `uploadFiles` {Function} - Function to upload files

### Features
- Displays a collection of media files based on the specified media type.
- Provides a user-friendly interface for searching, filtering, and navigating through media files.
- Emits the `mediaDeleted` event when a media file is deleted.
-->

<script lang="ts">
import Tabs from '@components/ui/tabs';
import PageTitle from '@src/components/page-title.svelte';
import { uploadMedia_title } from '@src/paraglide/messages';
import { goto } from '$app/navigation';
import LocalUpload from './local-upload.svelte';
import RemoteUpload from './remote-upload.svelte';

let tabSet = $state('0');

function handleUploadComplete() {
	goto('/mediagallery');
}
</script>

<!-- PageTitle -->
<div class="mb-4 flex items-center justify-between">
	<PageTitle name={uploadMedia_title()} icon="bi:images" iconColor="text-tertiary-500 dark:text-primary-500" />

	<!-- Back -->
	<button
		onclick={() => history.back()}
		aria-label="Back"
		class="preset-outlined-tertiary-500 btn-icon rounded-full dark:preset-outlined-primary-500"
	>
		<iconify-icon icon="mdi:arrow-left" width="24"></iconify-icon>
	</button>
</div>

<div class="wrapper">
	<Tabs bind:value={tabSet} class="w-full">
		<Tabs.List>
			<Tabs.Trigger value="0">Local Upload</Tabs.Trigger>
			<Tabs.Trigger value="1">Remote Upload</Tabs.Trigger>
		</Tabs.List>
		<div class="p-4">
			{#if tabSet === '0'}
				<LocalUpload onUploadComplete={handleUploadComplete} />
			{:else}
				<RemoteUpload onUploadComplete={handleUploadComplete} />
			{/if}
		</div>
	</Tabs>
</div>
