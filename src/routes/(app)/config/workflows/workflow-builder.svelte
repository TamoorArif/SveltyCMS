<!-- 
@file src/routes/(app)/config/workflows/workflow-builder.svelte
@component Visual State Machine Editor for Content Lifecycles
 -->
<script lang="ts">
import { toast } from "@src/stores/toast.svelte.ts";
import { fade } from "svelte/transition";

interface State {
	id: string;
	label: string;
	color: string;
	isInitial?: boolean;
	isFinal?: boolean;
}

interface Transition {
	id: string;
	from: string;
	to: string;
	label: string;
	requiredRole?: string;
}

let states = $state<State[]>([
	{ id: "draft", label: "Draft", color: "#94a3b8", isInitial: true },
	{ id: "review", label: "In Review", color: "#fbbf24" },
	{ id: "published", label: "Published", color: "#22c55e", isFinal: true },
]);

let transitions = $state<Transition[]>([
	{ id: "t1", from: "draft", to: "review", label: "Submit for Review" },
	{ id: "t2", from: "review", to: "published", label: "Approve & Publish" },
	{ id: "t3", from: "review", to: "draft", label: "Reject" },
]);

let selectedNodeId = $state<string | null>(null);

function addState() {
	const id = `state_${Math.random().toString(36).substring(7)}`;
	states.push({ id, label: "New State", color: "#3b82f6" });
}

function addTransition() {
	if (states.length < 2) return;
	const id = `trans_${Math.random().toString(36).substring(7)}`;
	transitions.push({
		id,
		from: states[0].id,
		to: states[1].id,
		label: "New Transition",
	});
}

function removeState(id: string) {
	states = states.filter((s) => s.id !== id);
	transitions = transitions.filter((t) => t.from !== id && t.to !== id);
}

function removeTransition(id: string) {
	transitions = transitions.filter((t) => t.id !== id);
}
</script>

<div class="flex h-full flex-col gap-6 p-6 bg-surface-50 dark:bg-surface-950">
	<div class="flex items-center justify-between bg-white dark:bg-surface-900 p-4 rounded-xl shadow-sm border border-surface-200 dark:border-surface-800">
		<div>
			<h1 class="text-2xl font-bold flex items-center gap-2">
				<iconify-icon icon="mdi:sitemap" class="text-primary-500"></iconify-icon>
				Workflow Engine
			</h1>
			<p class="text-sm opacity-50 font-medium">Visual Lifecycle Management (FSM)</p>
		</div>
		<div class="flex gap-2">
			<button class="btn preset-tonal-surface" onclick={addState}>+ Add State</button>
			<button class="btn preset-tonal-surface" onclick={addTransition}>+ Add Transition</button>
			<button class="btn preset-filled-primary-500" onclick={() => toast.success('Workflow Published')}>Save Workflow</button>
		</div>
	</div>

	<div class="grid grid-cols-1 lg:grid-cols-4 gap-6 flex-1 min-h-0">
		<!-- Canvas Area -->
		<div class="lg:col-span-3 bg-surface-100 dark:bg-surface-900/50 rounded-2xl border-2 border-dashed border-surface-200 dark:border-surface-800 relative overflow-hidden p-12">
			<div class="flex flex-wrap gap-12 justify-center items-start">
				{#each states as state (state.id)}
					<div 
						role="button"
						tabindex="0"
						class="w-48 bg-white dark:bg-surface-800 rounded-xl shadow-lg border-2 transition-all p-4 relative
                            {selectedNodeId === state.id ? 'border-primary-500 ring-4 ring-primary-500/10 scale-105' : 'border-surface-200 dark:border-surface-700'}"
						onclick={() => selectedNodeId = state.id}
						onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') selectedNodeId = state.id; }}
					>
						{#if state.isInitial}
							<span class="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary-500 text-white text-[8px] px-2 py-0.5 rounded-full font-bold uppercase">Initial</span>
						{/if}
						<div class="flex items-center justify-between mb-2">
							<div class="h-3 w-3 rounded-full" style:background-color={state.color}></div>
							<button class="text-error-500 opacity-0 group-hover:opacity-100" onclick={() => removeState(state.id)}>×</button>
						</div>
						<input bind:value={state.label} class="bg-transparent border-none font-bold text-sm w-full focus:ring-0" />
						
						<!-- Outgoing Transitions -->
						<div class="mt-4 space-y-1">
							{#each transitions.filter(t => t.from === state.id) as trans}
								<div class="text-[10px] bg-surface-50 dark:bg-surface-900 p-1.5 rounded flex items-center justify-between border border-surface-200/50">
									<span class="truncate pr-2">➔ {states.find(s => s.id === trans.to)?.label}</span>
									<button onclick={() => removeTransition(trans.id)}>×</button>
								</div>
							{/each}
						</div>
					</div>
				{/each}
			</div>
		</div>

		<!-- Properties Inspector -->
		<div class="bg-white dark:bg-surface-900 rounded-2xl shadow-sm border border-surface-200 dark:border-surface-800 p-6 overflow-y-auto">
			<h3 class="text-xs font-bold uppercase tracking-widest opacity-40 mb-6">Properties</h3>
			
			{#if selectedNodeId}
				{@const node = states.find(s => s.id === selectedNodeId)}
				{#if node}
					<div class="space-y-6" in:fade>
						<div class="space-y-2">
							<label for="state-name" class="label text-xs font-bold">State Name</label>
							<input id="state-name" bind:value={node.label} class="input input-sm" />
						</div>
						<div class="space-y-2">
							<label for="accent-color" class="label text-xs font-bold">Accent Color</label>
							<input id="accent-color" type="color" bind:value={node.color} class="w-full h-10 rounded-lg cursor-pointer border-none" />
						</div>
						<div class="flex items-center gap-4">
							<label class="flex items-center gap-2 text-xs font-bold">
								<input type="checkbox" bind:checked={node.isInitial} class="checkbox checkbox-sm" />
								Initial State
							</label>
							<label class="flex items-center gap-2 text-xs font-bold">
								<input type="checkbox" bind:checked={node.isFinal} class="checkbox checkbox-sm" />
								Final State
							</label>
						</div>
					</div>
				{/if}
			{:else}
				<div class="h-full flex flex-col items-center justify-center text-center opacity-30 italic">
					<iconify-icon icon="mdi:gesture-tap" width="48" class="mb-4"></iconify-icon>
					<p class="text-sm font-medium">Select a state on the canvas to edit its properties</p>
				</div>
			{/if}
		</div>
	</div>
</div>
