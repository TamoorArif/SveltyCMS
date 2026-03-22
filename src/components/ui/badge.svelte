<script lang="ts">
import { cn } from '@utils/cn';
import type { Snippet } from 'svelte';
import type { HTMLAttributes } from 'svelte/elements';

type Props = HTMLAttributes<HTMLDivElement> & {
	variant?: 'primary' | 'secondary' | 'tertiary' | 'success' | 'warning' | 'error' | 'surface' | 'outline';
	preset?: 'filled' | 'tonal' | 'outlined';
	color?: 'primary' | 'secondary' | 'tertiary' | 'success' | 'warning' | 'error' | 'surface';
	size?: 'sm' | 'md' | 'lg';
	children?: Snippet;
	class?: string;
	rounded?: boolean;
};

let { 
	variant = 'primary', 
	preset: propPreset,
	color: propColor,
	size = 'md',
	children, 
	class: className, 
	rounded = true,
	...rest 
}: Props = $props();

const sizeClasses = {
	sm: 'px-1.5 py-0.5 text-[10px]',
	md: 'px-2 py-0.5 text-xs',
	lg: 'px-3 py-1 text-sm'
};

// Map legacy variant
const variantMap: Record<string, { preset: string; color: string }> = {
	primary: { preset: 'filled', color: 'primary' },
	secondary: { preset: 'tonal', color: 'secondary' },
	tertiary: { preset: 'filled', color: 'tertiary' },
	success: { preset: 'filled', color: 'success' },
	warning: { preset: 'filled', color: 'warning' },
	error: { preset: 'filled', color: 'error' },
	outline: { preset: 'outlined', color: 'surface' }
};

const finalPreset = $derived(propPreset || variantMap[variant]?.preset || 'filled');
const finalColor = $derived(propColor || variantMap[variant]?.color || 'primary');

// Preset classes
const getPresetClass = (p: string, c: string) => {
	if (p === 'tonal') return `preset-tonal-${c}`;
	if (p === 'outlined') return `preset-outlined-${c}-500`;
	return `preset-filled-${c}-500`;
};

const classes = $derived(cn(
	'badge inline-flex items-center font-bold uppercase tracking-wider transition-colors',
	getPresetClass(finalPreset, finalColor),
	sizeClasses[size],
	rounded ? 'rounded-full' : 'rounded-md',
	className
));
</script>

<div class={classes} {...rest}>
	{@render children?.()}
</div>
