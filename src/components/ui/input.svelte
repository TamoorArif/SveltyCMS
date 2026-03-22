<!-- 
@file src/components/ui/input.svelte
@component
**Native Svelte 5 Input Primitive**

### Props
- `value` (string | number): Bound value.
- `label` (string): Input label string.
- `error` (string): Shows an error state and message.
-->

<script lang="ts">
import { cn } from '@utils/cn';
import type { HTMLInputAttributes } from 'svelte/elements';

// Generate a random ID for accessibility linkage if none provided
const generatedId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(7);

type Props = HTMLInputAttributes & {
	value?: string | number | string[];
	label?: string;
	labelClass?: string;
	inputClass?: string;
	error?: string;
	class?: string;
};

// Workaround for strict $props binding requirements
let {
	value = $bindable(),
	label,
	labelClass,
	inputClass,
	error,
	class: className,
	id = generatedId,
	type = 'text',
	...rest
}: Props = $props();

const baseInputStyles =
	'flex h-10 w-full rounded-md border border-surface-300 dark:border-surface-600 bg-surface-50 dark:bg-surface-900 px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-surface-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:cursor-not-allowed disabled:opacity-50';
	
const errorInputStyles = 'border-error-500 focus-visible:ring-error-500';
</script>

<div class="space-y-2 w-full">
	{#if label}
		<label
			for={id}
			class={cn("text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70", labelClass)}
		>
			{label}
		</label>
	{/if}

	<input
		{id}
		{type}
		class={cn(baseInputStyles, error && errorInputStyles, inputClass, className)}
		bind:value
		{...rest}
	/>

	{#if error}
		<p class="text-[0.8rem] font-medium text-error-500">
			{error}
		</p>
	{/if}
</div>
