<script lang="ts">
import { onMount } from 'svelte';
import { themeStore, toggleDarkMode, initializeDarkMode } from '@src/stores/theme-store.svelte';
import Button from '@components/ui/button.svelte';
import Badge from '@components/ui/badge.svelte';
import Card from '@components/ui/card.svelte';
import Input from '@components/ui/input.svelte';
import Toggle from '@components/ui/toggle.svelte';
import FloatingInput from '@components/ui/floating-input.svelte';
import Progress from '@components/ui/progress.svelte';
import SegmentedControl from '@components/ui/segmented-control.svelte';
import Tabs from '@components/ui/tabs';
import Modal from '@components/ui/modal.svelte';
import Popover from '@components/ui/popover.svelte';
import Tooltip from '@components/ui/tooltip.svelte';
import { toast } from '@src/stores/toast.svelte.ts';
import Tags from '@components/ui/tags.svelte';
import Combobox from '@components/ui/combobox.svelte';
import DatePicker from '@components/ui/date-picker.svelte';
import Breadcrumb from '@components/ui/breadcrumb.svelte';
import TreeView from '@components/ui/tree-view.svelte';
import Drawer from '@components/ui/drawer.svelte';
import Table from '@components/ui/table.svelte';
import Alert from '@components/ui/alert.svelte';

let name = $state('SveltyCMS Developer');
let count = $state(0);
let error = $state('');
let isToggled = $state(false);
let floatingValue = $state('');
let segmentValue = $state('day');
let activeTab = $state('general');
let isModalOpen = $state(false);

// Batch 4 State
let selectedTags = $state(['Svelte 5', 'Tailwind 4', 'Premium']);
let comboboxValue = $state('opt1');
let dateValue = $state(new Date().toISOString().split('T')[0]);

// Batch 5 State
let treeExpandedIds = $state(new Set(['root']));

// Batch 6 State
let isDrawerOpen = $state(false);
let tableSortKey = $state('name');
let tableSortOrder = $state<'asc'|'desc'>('asc');
let tableSelectedIds = $state(new Set(['1']));

const tableData = [
    { id: '1', name: 'Dashboard Module', status: 'Active', version: 'v1.4.2' },
    { id: '2', name: 'Auth Service', status: 'Warning', version: 'v2.1.0' },
    { id: '3', name: 'Media Library', status: 'Draft', version: 'v1.0.5' }
];

const tableColumns = [
    { key: 'name', label: 'Component Name', sortable: true },
    { key: 'status', label: 'Current Status', sortable: true },
    { key: 'version', label: 'Version', class: 'text-right' }
];

const treeItems = [
    {
        id: 'root',
        label: 'SveltyCMS',
        icon: 'mdi:folder-home',
        children: [
            {
                id: 'src',
                label: 'src',
                icon: 'mdi:folder',
                children: [
                    { id: 'components', label: 'components', icon: 'mdi:folder-outline' },
                    { id: 'routes', label: 'routes', icon: 'mdi:folder-outline' },
                    { id: 'app-css', label: 'app.css', icon: 'mdi:language-css3' }
                ]
            },
            { id: 'package-json', label: 'package.json', icon: 'mdi:language-json' },
            { id: 'readme', label: 'README.md', icon: 'mdi:markdown' }
        ]
    }
];

const segmentOptions = [
    { label: 'Day', value: 'day', icon: 'mdi:calendar-today' },
    { label: 'Week', value: 'week', icon: 'mdi:calendar-week' },
    { label: 'Month', value: 'month', icon: 'mdi:calendar-month', disabled: true }
];

const tabItems = [
    { label: 'General', value: 'general', icon: 'mdi:cog' },
    { label: 'Security', value: 'security', icon: 'mdi:shield' },
    { label: 'Themes', value: 'themes', icon: 'mdi:palette' }
];

onMount(() => {
    initializeDarkMode();
});

function toggleError() {
    error = error ? '' : 'This is a sample error message';
}
</script>

<div class="fixed top-4 right-4 z-50">
    <Button 
        variant="outline" 
        rounded
        onclick={() => toggleDarkMode()}
        aria-label="Toggle Theme"
    >
        <iconify-icon 
            icon={themeStore.isDarkMode ? 'mdi:weather-sunny' : 'mdi:weather-night'} 
            width="20"
        ></iconify-icon>
    </Button>
</div>

<div class="p-8 mx-auto space-y-16 bg-surface-50 dark:bg-surface-950 min-h-screen pb-32">
    <header class="space-y-4 text-center">
        <h1 class="text-5xl font-extrabold text-surface-900 dark:text-white tracking-tight">
            UI Showcase Lab
        </h1>
        <p class="text-xl text-surface-600 dark:text-surface-400 max-w-2xl mx-auto">
            Native Svelte 5 UI Primitives with Tailwind CSS v4 and Skeleton v4 Aesthetics
        </p>
        <div class="flex justify-center gap-4 pt-4">
            <Badge color="success" size="lg">Svelte 5 Stable</Badge>
            <Badge color="primary" size="lg">Tailwind 4 Ready</Badge>
            <Badge preset="outlined" color="tertiary" size="lg">v0.0.7</Badge>
        </div>
    </header>

    <div class="max-w-5xl mx-auto space-y-24">
        <!-- Buttons Category -->
        <section class="space-y-8">
            <div class="flex items-center gap-3 border-b border-surface-200 dark:border-surface-800 pb-4">
                <div class="h-12 w-12 rounded-xl bg-primary-500/10 flex items-center justify-center text-primary-500">
                    <iconify-icon icon="mdi:button-cursor" width="32"></iconify-icon>
                </div>
                <div>
                    <h2 class="text-3xl font-bold">Buttons & Actions</h2>
                    <p class="text-surface-500 text-sm">Versatile button primitives with loading states and icons.</p>
                </div>
            </div>
            
            <Card class="p-8 space-y-8">
                <div class="flex flex-wrap gap-4">
                    <Button variant="primary" onclick={() => count++}>Primary Counter ({count})</Button>
                    <Button variant="secondary">Secondary</Button>
                    <Button variant="tertiary">Tertiary</Button>
                    <Button variant="success">Success</Button>
                    <Button variant="warning">Warning</Button>
                    <Button variant="error">Error</Button>
                </div>
                <div class="flex flex-wrap gap-4 items-center">
                    <Button variant="outline">Outline</Button>
                    <Button variant="ghost">Ghost</Button>
                    <Button preset="tonal" color="primary">Tonal Primary</Button>
                    <Button rounded variant="primary">Rounded</Button>
                </div>
                <div class="flex flex-wrap gap-4 items-center">
                    <Button size="sm">Small</Button>
                    <Button size="md">Medium</Button>
                    <Button size="lg">Large</Button>
                    <Button size="xl">Extra Large</Button>
                </div>
                <div class="flex flex-wrap gap-4 items-center">
                    <Button leadingIcon="mdi:plus">Leading Icon</Button>
                    <Button trailingIcon="mdi:arrow-right">Trailing Icon</Button>
                    <Button loading>Loading State</Button>
                    <Button disabled leadingIcon="mdi:lock">Disabled State</Button>
                </div>
            </Card>
        </section>

        <!-- Overlays Section -->
        <section class="space-y-8">
            <div class="flex items-center gap-3 border-b border-surface-200 dark:border-surface-800 pb-4">
                <div class="h-12 w-12 rounded-xl bg-secondary-500/10 flex items-center justify-center text-secondary-500">
                    <iconify-icon icon="mdi:layers-outline" width="32"></iconify-icon>
                </div>
                <div>
                    <h2 class="text-3xl font-bold">Overlays & Floating</h2>
                    <p class="text-surface-500 text-sm">Premium floating components with native browser transitions.</p>
                </div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
                <Card class="p-6 space-y-6">
                    <h3 class="text-xl font-bold flex items-center gap-2">
                        <iconify-icon icon="mingcute:window-line" class="text-primary-500"></iconify-icon>
                        Modals & Drawers
                    </h3>
                    <div class="flex gap-4">
                        <Button variant="primary" class="flex-1" onclick={() => isModalOpen = true}>Open Modal</Button>
                        <Button variant="secondary" class="flex-1" onclick={() => isDrawerOpen = true}>Open Drawer</Button>
                    </div>

                    <Modal bind:open={isModalOpen} title="Superior Modal" color="primary">
                        <div class="space-y-4">
                            <p>This is 100% native Svelte 5 logic using the HTML5 <code>&lt;dialog&gt;</code> element.</p>
                            <Alert variant="info" title="Zero Dependency">No external libraries required for this overlay.</Alert>
                        </div>
                        {#snippet footer()}
                            <Button variant="ghost" onclick={() => isModalOpen = false}>Cancel</Button>
                            <Button variant="primary" onclick={() => { toast.success('Confirmed!'); isModalOpen = false; }}>Confirm</Button>
                        {/snippet}
                    </Modal>

                    <Drawer bind:open={isDrawerOpen} title="Navigation Drawer">
                        <div class="space-y-8">
                            <nav class="space-y-1">
                                {#each tabItems as item}
                                    <button class="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors">
                                        <iconify-icon icon={item.icon} width="20"></iconify-icon>
                                        <span class="font-medium">{item.label}</span>
                                    </button>
                                {/each}
                            </nav>
                            <hr class="opacity-10" />
                            <div class="p-4 bg-surface-100 dark:bg-surface-800 rounded-xl space-y-4">
                                <h4 class="text-xs font-bold uppercase tracking-widest opacity-50">Storage Usage</h4>
                                <Progress value={75} color="primary" />
                                <p class="text-[10px] opacity-60 italic">Cloud storage is 75% full. Upgrade for more.</p>
                            </div>
                        </div>
                    </Drawer>
                </Card>

                <Card class="p-6 space-y-6">
                    <h3 class="text-xl font-bold flex items-center gap-2">
                        <iconify-icon icon="mingcute:message-2-line" class="text-primary-500"></iconify-icon>
                        Toasts & Popovers
                    </h3>
                    <div class="flex flex-wrap gap-4">
                        <Button variant="outline" size="sm" onclick={() => toast.success('Success message!')}>Success Toast</Button>
                        <Button variant="outline" size="sm" onclick={() => toast.error('Error occurred!')}>Error Toast</Button>
                        <Button variant="outline" size="sm" onclick={() => toast.info('New information available.')}>Info Toast</Button>
                    </div>
                    <div class="flex items-center justify-between p-4 bg-surface-100 dark:bg-surface-800 rounded-xl">
                        <div class="flex items-center gap-4">
                            <span class="font-bold">Popover Demo</span>
                            <Popover position="bottom">
                                {#snippet trigger()}
                                    <iconify-icon icon="mingcute:settings-3-line" class="text-2xl cursor-pointer text-primary-500"></iconify-icon>
                                {/snippet}
                                <div class="w-48 space-y-2 text-surface-900 dark:text-surface-100">
                                    <h4 class="font-bold text-sm mb-2">Adjust Settings</h4>
                                    <Toggle label="Enable AI" value={true} />
                                    <Toggle label="Auto-save" value={false} />
                                    <hr class="opacity-10 my-2" />
                                    <Button size="sm" variant="primary" class="w-full">Save</Button>
                                </div>
                            </Popover>
                        </div>
                        <Tooltip title="Helpful hint here!">
                            <iconify-icon icon="mingcute:question-line" class="text-2xl opacity-50 text-surface-900 dark:text-surface-100"></iconify-icon>
                        </Tooltip>
                    </div>
                </Card>
            </div>
        </section>

        <!-- Data Grid Section -->
        <section class="space-y-8">
            <div class="flex items-center gap-3 border-b border-surface-200 dark:border-surface-800 pb-4">
                <div class="h-12 w-12 rounded-xl bg-tertiary-500/10 flex items-center justify-center text-tertiary-500">
                    <iconify-icon icon="mingcute:table-line" width="32"></iconify-icon>
                </div>
                <div>
                    <h2 class="text-3xl font-bold">Data Management</h2>
                    <p class="text-surface-500 text-sm">Advanced DataGrid with sorting, selection, and custom cells.</p>
                </div>
            </div>

            <Card class="p-8 space-y-6">
                <Table 
                    data={tableData} 
                    columns={tableColumns}
                    selectable
                    bind:sortKey={tableSortKey}
                    bind:sortOrder={tableSortOrder}
                    bind:selectedIds={tableSelectedIds}
                    onrowclick={(row: any) => toast.info(`Clicked row: ${row.name}`)}
                />
                <div class="flex gap-4 text-xs opacity-50 font-mono">
                    <span>Selected: {tableSelectedIds.size}</span>
                    <span>Sorted by: {tableSortKey} ({tableSortOrder})</span>
                </div>
            </Card>
        </section>

        <!-- Navigation Section -->
        <section class="space-y-8">
            <div class="flex items-center gap-3 border-b border-surface-200 dark:border-surface-800 pb-4">
                <div class="h-12 w-12 rounded-xl bg-surface-500/10 flex items-center justify-center text-surface-500">
                    <iconify-icon icon="mingcute:node-tree-line" width="32"></iconify-icon>
                </div>
                <div>
                    <h2 class="text-3xl font-bold">Navigation & Structure</h2>
                    <p class="text-surface-500 text-sm">Complex recursive trees and navigational primitives.</p>
                </div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
                <Card class="p-6 space-y-6">
                    <h3 class="text-xl font-bold flex items-center gap-2">
                        <iconify-icon icon="mingcute:layout-left-line" class="text-primary-500"></iconify-icon>
                        Adaptive TreeView
                    </h3>
                    <div class="p-4 bg-surface-50 dark:bg-surface-800/30 rounded-xl border border-surface-200 dark:border-surface-800 text-surface-900 dark:text-surface-100">
                        <TreeView 
                            items={treeItems}
                            bind:expandedIds={treeExpandedIds}
                            allowDragDrop
                            onselect={(item) => toast.info(`Selected: ${item.label}`)}
                        />
                    </div>
                </Card>

                <Card class="p-6 space-y-8">
                    <div class="space-y-4">
                        <h3 class="text-xl font-bold flex items-center gap-2">
                            <iconify-icon icon="mingcute:tab-line" class="text-primary-500"></iconify-icon>
                            Tabs & Segments
                        </h3>
                        <Tabs bind:value={activeTab}>
                            <Tabs.List>
                                {#each tabItems as item}
                                    <Tabs.Trigger value={item.value}>
                                        {#if item.icon}
                                            <iconify-icon icon={item.icon} width="18"></iconify-icon>
                                        {/if}
                                        <span>{item.label}</span>
                                    </Tabs.Trigger>
                                {/each}
                            </Tabs.List>
                        </Tabs>
                        <SegmentedControl options={segmentOptions} bind:value={segmentValue} />
                    </div>
                    
                    <div class="space-y-4">
                        <h3 class="text-xl font-bold flex items-center gap-2">
                            <iconify-icon icon="mingcute:direction-line" class="text-primary-500"></iconify-icon>
                            Breadcrumbs
                        </h3>
                        <Breadcrumb 
                            items={[
                                { label: 'Home', icon: 'ri:home-4-line', href: '#' },
                                { label: 'System', icon: 'ri:settings-line', href: '#' },
                                { label: 'UI Lab', icon: 'ri:flask-line' }
                            ]}
                        />
                    </div>
                </Card>
            </div>
        </section>

        <!-- Forms Section -->
        <section class="space-y-8 pb-32">
            <div class="flex items-center gap-3 border-b border-surface-200 dark:border-surface-800 pb-4">
                <div class="h-12 w-12 rounded-xl bg-primary-500/10 flex items-center justify-center text-primary-500">
                    <iconify-icon icon="mingcute:edit-2-line" width="32"></iconify-icon>
                </div>
                <div>
                    <h2 class="text-3xl font-bold">Input & Forms</h2>
                    <p class="text-surface-500 text-sm">Type-safe inputs with validation states and floating labels.</p>
                </div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
                <Card class="p-8 space-y-6">
                    <Input label="Standard Input" placeholder="Enter text..." bind:value={name} />
                    <FloatingInput label="Floating Label" bind:value={floatingValue} icon="mdi:email" />
                    <div class="flex gap-4">
                        <Toggle label="Toggle State" bind:value={isToggled} class="flex-1" />
                        <Button variant="outline" size="sm" onclick={toggleError}>Test Error</Button>
                    </div>
                    {#if error}
                        <Input label="Error Validation" {error} placeholder="Invalid content..." />
                    {/if}
                </Card>

                <Card class="p-8 space-y-6">
                    <Combobox 
                        label="Advanced Search"
                        bind:value={comboboxValue}
                        options={[
                            { label: 'Svelte 5', value: 's5', icon: 'ri:svelte-fill' },
                            { label: 'Tailwind 4', value: 't4', icon: 'ri:tailwind-css-fill' },
                            { label: 'Vite 7', value: 'v7' }
                        ]}
                    />
                    <DatePicker label="Native Date Selection" bind:value={dateValue} />
                    <Tags label="Reactive Tags" bind:tags={selectedTags} />
                </Card>
            </div>
        </section>
    </div>
</div>
