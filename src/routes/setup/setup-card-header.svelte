<!--
@file src/routes/setup/setup-card-header.svelte
@component
**Internal header for the setup wizard content card.**
Displays the contextual title, dynamic icon, and global reset controls for the current step.

### Props
- `currentStep` (number): The active step index (0-indexed).
- `steps` (Array): Collection of step metadata (labels, icons).
- `onreset` (function): Callback for triggering a global state reset.

### Features:
- dynamic icon synchronization based on step index
- integrated state reset controls with tooltips
- responsive layout with standardized typography
- accessibility-first ARIA labeling
-->
<script lang="ts">
import SystemTooltip from "@src/components/system/system-tooltip.svelte";
import { setup_reset_data } from "@src/paraglide/messages";

// Using iconify-icon web component
const { currentStep, steps, onreset = () => {} } = $props();

const icons = $derived([
	"mdi:database",
	"mdi:account",
	"mdi:cog",
	"mdi:email",
	"mdi:check-circle",
]);
</script>

<div class="flex shrink-0 justify-between border-b px-4 py-3 sm:px-6 sm:py-4">
	<h2 class="flex justify-center items-center text-lg font-semibold tracking-tight sm:text-xl text-black dark:text-white">
		{#if icons[currentStep]}
			<iconify-icon icon={icons[currentStep]} class="mr-2 h-4 w-4 text-error-500 sm:h-5 sm:w-5" aria-hidden="true"></iconify-icon>
		{/if}
		{steps[currentStep]?.label || 'Loading...'}
	</h2>
	<SystemTooltip title={setup_reset_data()}>
		<button
			onclick={() => onreset()}
			type="button"
			class="flex items-center dark:text-secondary-50 preset-outlined btn-sm rounded"
			aria-label={setup_reset_data()}
		>
			<iconify-icon icon="mdi:backup-restore" width={24} class="mr-1"></iconify-icon>
			<span class="">{setup_reset_data()}</span>
		</button>
	</SystemTooltip>
</div>
