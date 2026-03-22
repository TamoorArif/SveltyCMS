<!-- 
@file src/components/system/SystemTooltip.svelte
@component
**SystemTooltip component**

This component provides a tooltip for any element.

@example
<Tooltip title="Tooltip">
	<button>Hover me</button>
</Tooltip>

### Props
- `title` {string}: Tooltip title (default: '')
- `children` {import('svelte').Snippet}: Tooltip content (default: null)
- `positioning` {object}: Tooltip positioning (default: { placement: 'top', gutter: 10 })

### Features
- Provides a tooltip for any element
- Supports dynamic updates to tooltip content
- Allows customization of tooltip positioning
- Integrates with global search and filter states
- Optimized for performance with minimal re-renders
-->

<script lang="ts">
import Tooltip from '@components/ui/tooltip.svelte';
import type { Snippet } from 'svelte';
import type { Placement } from '@floating-ui/dom';

interface Props {
	children?: Snippet; // The trigger
	content?: Snippet;  // The tooltip content (optional)
	contentClass?: string;
	positioning?: {
		placement?: Placement;
		gutter?: number;
	};
	title?: string;
	triggerClass?: string;
	triggerStyle?: string;
	wFull?: boolean;
}

let {
	title = '',
	content,
	contentClass = '',
	triggerClass = '',
	triggerStyle = '',
	wFull = false,
	children,
	positioning = { placement: 'top', gutter: 10 }
}: Props = $props();

const tooltipConfig = $derived({
	placement: positioning.placement || 'top',
	offset: positioning.gutter || 10
});
</script>

<Tooltip 
	title={title} 
	positioning={tooltipConfig}
	class={contentClass}
>
	{#snippet trigger()}
		<div class={`p-0 m-0 border-none ${triggerClass ? '' : 'bg-transparent'} ${wFull ? 'block w-full' : 'inline-block'} ${triggerClass}`} style={triggerStyle}>
			{@render children?.()}
		</div>
	{/snippet}

	{#if content}
		{@render content()}
	{/if}
</Tooltip>
