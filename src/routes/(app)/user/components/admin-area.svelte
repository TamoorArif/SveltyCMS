<!--
@file src/routes/(app)/user/components/admin-area.svelte
@component
**Admin area for managing users and tokens with efficient filtering and pagination.**

### Features
- Efficient filtering and pagination
- Sorting by any column
- Bulk actions for tokens
- Copy to clipboard
-
-->

<script lang="ts">
// Type guards for template and logic
function isToken(row: User | Token): row is Token {
	return 'token' in row && typeof row.token === 'string';
}
function isUser(row: User | Token): row is User {
	return '_id' in row && typeof row._id === 'string';
}

import type { TableHeader } from '@src/content/types';

function getDisplayValue(row: TableDataType, header: TableHeader): string {
	if (header.key === 'blocked') {
		return '';
	}
	if (isUser(row)) {
		return String(row[header.key as keyof User] ?? '-');
	}
	if (isToken(row)) {
		return String(row[header.key as keyof Token] ?? '-');
	}
	return '-';
}

function checkTokenExpired(row: TableDataType): boolean {
	if (!(isToken(row) && row.expires)) {
		return false;
	}
	return new Date(row.expires) < new Date();
}

// Components
import Avatar from '@components/ui/avatar.svelte';
import Badge from '@components/ui/badge.svelte';
import Tooltip from '@components/ui/tooltip.svelte';
// import Toggle from '@components/ui/toggle.svelte';
import Table from '@components/ui/table.svelte';
import StatusBadge from '@components/ui/status-badge.svelte';
import TableFilter from '@components/ui/table/filter.svelte';
// Types
import type { Role as RoleType, Token, User } from '@src/databases/auth/types';
// Types
import {
	adminarea_activesession,
	adminarea_adminarea,
	adminarea_blocked,
	adminarea_createat,
	adminarea_emailtoken,
	adminarea_expiresin,
	adminarea_hideuserlist,
	adminarea_hideusertoken,
	adminarea_lastaccess,
	adminarea_listtoken,
	adminarea_showtoken,
	adminarea_showuserlist,
	adminarea_token,
	adminarea_updatedat,
	adminarea_user_id,
	adminarea_userlist,
	email,
	form_avatar,
	multibuttontoken_modalbody,
	multibuttontoken_modaltitle,
	role,
	username
} from '@src/paraglide/messages';
import { globalLoadingStore, loadingOperations } from '@src/stores/loading-store.svelte.ts';
import { avatarSrc, normalizeAvatarUrl } from '@src/stores/store.svelte.ts';
import { toast } from '@src/stores/toast.svelte.ts';
// Stores
import { cn } from '@utils/cn';
import { logger } from '@utils/logger';
import { modalState } from '@utils/modal-state.svelte';
import { showConfirm } from '@utils/modal-utils';
// import { debounce } from '@utils/utils';
import { untrack } from 'svelte';
import Multibutton from './multibutton.svelte';
import ModalEditToken from './modal-edit-token.svelte';

type TableDataType = User | Token;

// Props - Using API for scalability
const { currentUser = null, isMultiTenant = false, roles = [] }: { currentUser: User | null; isMultiTenant: boolean; roles: RoleType[] } = $props();

// const waitFilter = debounce(300);

// State for API-fetched data
let tableData: TableDataType[] = $state([]);
let totalItems = $state(0);

async function fetchData() {
	await globalLoadingStore.withLoading(
		loadingOperations.dataFetch,
		async () => {
			const endpoint = showUserList ? '/api/user' : '/api/token';
			const params = new URLSearchParams();
			params.set('page', String(currentPage));
			params.set('limit', String(rowsPerPage));
			params.set('sort', sortKey || 'createdAt');
			params.set('order', sortOrder);
			
			if (globalSearchValue) {
				params.set('search', globalSearchValue);
			}

			try {
				const response = await fetch(`${endpoint}?${params.toString()}`);
				if (!response.ok) {
					const errorData = await response.json();
					throw new Error(errorData.message || 'Failed to fetch data');
				}
				const result = await response.json();
				if (result.success) {
					tableData = result.data;
					totalItems = result.pagination.totalItems;
				}
			} catch (err) {
				const errorMessage = err instanceof Error ? err.message : 'Unknown error';
				logger.error('AdminArea fetch error:', errorMessage);
				toast.error(`Error fetching data: ${errorMessage}`);
				tableData = [];
				totalItems = 0;
			}
		},
		'Fetching admin data'
	);
}

// Custom event handler for updates from Multibutton
function handleBatchUpdate(data: { ids: string[]; action: string; type: 'user' | 'token' }) {
	const { ids, action, type } = data;

	if (action === 'refresh') {
		fetchData();
		return;
	}

	// Update the tableData instead of adminData for scalability
	if (tableData) {
		let updated = false;

		if (action === 'delete') {
			// Remove deleted items from the table
			const updatedData = tableData.filter((item: User | Token) => {
				if (type === 'user' && isUser(item)) {
					return !ids.includes(item._id);
				}
				if (type === 'token' && isToken(item)) {
					return !ids.includes(item.token);
				}
				return true;
			});

			if (updatedData.length !== tableData.length) {
				tableData = updatedData;
				updated = true;
			}
		} else {
			// Handle block/unblock actions
			const updatedData = tableData.map((item: User | Token) => {
				let shouldUpdate = false;
				if (type === 'user' && isUser(item) && ids.includes(item._id)) {
					shouldUpdate = true;
				}
				if (type === 'token' && isToken(item) && ids.includes(item.token)) {
					shouldUpdate = true;
				}

				if (shouldUpdate) {
					updated = true;
					if (action === 'block') {
						return { ...item, blocked: true };
					}
					if (action === 'unblock') {
						return { ...item, blocked: false };
					}
				}
				return item;
			});

			if (updated) {
				tableData = updatedData;
			}
		}

		// Clear selection after any action
		if (updated) {
			selectedIds = new Set();
		}
	}
}

// Table header definitions
const tableHeadersUser = [
	{ label: adminarea_blocked(), key: 'blocked' },
	{ label: form_avatar(), key: 'avatar' },
	{ label: email(), key: 'email' },
	{ label: username(), key: 'username' },
	{ label: role(), key: 'role' },
	{ label: 'Tenant ID', key: 'tenantId' },
	{ label: adminarea_user_id(), key: '_id' },
	{ label: adminarea_activesession(), key: 'activeSessions' },
	{ label: adminarea_lastaccess(), key: 'lastAccess' },
	{ label: adminarea_createat(), key: 'createdAt' },
	{ label: adminarea_updatedat(), key: 'updatedAt' }
];

const tableHeaderToken = [
	{ label: adminarea_blocked(), key: 'blocked' },
	{ label: email(), key: 'email' },
	{ label: role(), key: 'role' },
	{ label: 'Tenant ID', key: 'tenantId' },
	{ label: adminarea_token(), key: 'token' },
	{ label: adminarea_expiresin(), key: 'expires' },
	{ label: adminarea_createat(), key: 'createdAt' },
	{ label: adminarea_updatedat(), key: 'updatedAt' }
];

// State management
// let P_WFORGOT = $state(false);
// let P_WRESET = $state(false);
// let showPassword = $state(false);
// let formElement: HTMLFormElement | null = $state(null);
// const tabIndex = $state(1);

// Core state
let showUserList = $state(true);
let showUsertoken = $state(false);
// let showExpiredTokens = $state(false);
let globalSearchValue = $state('');
let selectedIds = $state(new Set());

let density = $state<'compact' | 'normal' | 'comfortable'>(
	(() => {
		const settings = localStorage.getItem('userPaginationSettings');
		return settings ? (JSON.parse(settings).density ?? 'normal') : 'normal';
	})()
);

let currentPage = $state(1);
let rowsPerPage = $state(10);
let sortKey = $state('createdAt');
let sortOrder = $state<'asc' | 'desc'>('desc');

// Pre-calculate tab indices
// const emailTabIndex = 1;
// const passwordTabIndex = 2;
// const confirmPasswordTabIndex = 3;
// const forgotPasswordTabIndex = 4;

// Selection handling
function toggleSelection(item: User | Token) {
	const id = isUser(item) ? item._id : item.token;
	if (selectedIds.has(id)) {
		selectedIds.delete(id);
	} else {
		selectedIds.add(id);
	}
}

// Columns definition for the Table primitive
let columns = $derived.by(() => {
	const baseHeaders = showUserList ? tableHeadersUser : tableHeaderToken;
	const relevantHeaders = isMultiTenant ? baseHeaders : baseHeaders.filter((h) => h.key !== 'tenantId');
	return relevantHeaders.map(h => ({
		key: h.key,
		label: h.label,
		sortable: true,
		visible: true
	}));
});

// Reactive effect to fetch data
$effect(() => {
	// Rerun when any of these reactive variables change
	void showUserList;
	void showUsertoken;
	void currentPage;
	void rowsPerPage;
	void sortKey;
	void sortOrder;
	void globalSearchValue;
	void currentUser; // Watch for changes to current user (triggers refresh after user update)

	untrack(() => {
		fetchData();
	});
});

// Helper function to edit a specific token
function editToken(tokenId: Token) {
	modalState.trigger(
		ModalEditToken as any,
		{
			token: tokenId.token,
			email: tokenId.email,
			role: tokenId.role,
			expires: convertDateToExpiresFormat(tokenId.expires),
			title: multibuttontoken_modaltitle(),
			body: multibuttontoken_modalbody(),
			roles // Pass roles explicitly
		},
		(result: any) => {
			if (result?.success) {
				fetchData();
			} else if (result?.success === false) {
				toast.error(result.error || 'Failed to update token');
			}
		}
	);
}

// Helper function to convert Date to expires format expected by ModalEditToken
function convertDateToExpiresFormat(expiresDate: Date | string | null): string {
	if (!expiresDate) return '2 days'; // Default
	const now = new Date();
	const expires = new Date(expiresDate);
	const diffMs = expires.getTime() - now.getTime();
	const diffHours = Math.ceil(diffMs / (1000 * 60 * 60));
	const diffDays = Math.ceil(diffHours / 24);

	// Match the available options in ModalEditToken
	if (diffHours <= 2) return '2 hrs';
	if (diffHours <= 12) return '12 hrs';
	if (diffDays <= 2) return '2 days';
	if (diffDays <= 7) return '1 week';
	if (diffDays <= 14) return '2 weeks';
	if (diffDays <= 30) return '1 month';
	return '1 month'; // Max available option
}

// Helper function to calculate remaining time until expiration for display in table
function getRemainingTime(expiresDate: Date | string | null): string {
	if (!expiresDate) return 'Never';
	const now = new Date();
	const expires = new Date(expiresDate);
	const diffMs = expires.getTime() - now.getTime();
	if (diffMs <= 0) return 'Expired';

	const diffMinutes = Math.floor(diffMs / (1000 * 60));
	const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
	const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

	if (diffDays > 0) {
		const remainingHours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
		return remainingHours > 0 ? `${diffDays}d ${remainingHours}h` : `${diffDays}d`;
	}
	if (diffHours > 0) {
		const remainingMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
		return remainingMinutes > 0 ? `${diffHours}h ${remainingMinutes}m` : `${diffHours}h`;
	}
	return `${diffMinutes}m`;
}

// Safe date formatter for unknown values coming from API
function formatDate(value: unknown): string {
	if (!value) return '-';
	try {
		const d = new Date(String(value));
		return Number.isNaN(d.getTime()) ? '-' : d.toLocaleString();
	} catch {
		return '-';
	}
}

// Toggle user blocked status - always show confirmation modal (like Multibutton)
async function toggleUserBlocked(user: User) {
	if (!user._id) return;

	// Prevent admins from blocking themselves
	if (currentUser && user._id === currentUser._id) {
		toast.warning('You cannot block your own account');
		return;
	}

	const action = user.blocked ? 'unblock' : 'block';
	const actionPastTense = user.blocked ? 'unblocked' : 'blocked';

	// Always show confirmation modal (same logic as Multibutton) with enhanced styling using theme colors
	const actionColor = user.blocked ? 'text-success-500' : 'text-error-500';
	const actionWord = user.blocked ? 'Unblock' : 'Block';

	showConfirm({
		title: `Please Confirm User <span class="${actionColor} font-bold">${actionWord}</span>`,
		body: `Are you sure you want to ${actionWord.toLowerCase()} user <strong>${user.email}</strong>?`,
		onConfirm: async () => {
			await performBlockAction(user, action, actionPastTense);
		}
	});
}

async function performBlockAction(user: User, action: string, actionPastTense: string) {
	try {
		const response = await fetch('/api/user/batch', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ userIds: [user._id], action })
		});

		const result = await response.json();
		if (result.success) {
			fetchData();
			toast.success(`User ${actionPastTense} successfully`);
		} else {
			throw new Error(result.message || `Failed to ${action} user`);
		}
	} catch (err) {
		toast.error(`Error: ${err instanceof Error ? err.message : 'Unknown'}`);
	}
}

// Toggle token blocked status - similar to user blocking
async function toggleTokenBlocked(token: Token) {
	if (!token.token) return;

	const action = token.blocked ? 'unblock' : 'block';
	const actionPastTense = token.blocked ? 'unblocked' : 'blocked';
	const actionWord = token.blocked ? 'Unblock' : 'Block';

	showConfirm({
		title: `Confirm Token ${actionWord}`,
		body: `Are you sure you want to ${actionWord.toLowerCase()} token for <strong>${token.email}</strong>?`,
		onConfirm: async () => {
			try {
				const response = await fetch('/api/token/batch', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ tokenIds: [token.token], action })
				});
				if (response.ok) {
					fetchData();
					toast.success(`Token ${actionPastTense} successfully`);
				}
			} catch (err) {
				toast.error('Failed to update token status');
			}
		}
	});
}

function modalTokenUser() {
	modalState.trigger(
		ModalEditToken as any,
		{
			title: multibuttontoken_modaltitle(),
			body: multibuttontoken_modalbody(),
			roles, // Pass available roles
			user: currentUser // Pass current user context if needed
		},
		(result: any) => {
			// Refresh data if token was created
			if (result?.success) fetchData();
		}
	);
}

// Toggle views
function toggleUserList() {
	showUserList = !showUserList;
	if (showUsertoken) showUsertoken = false;
}

function toggleUserToken() {
	showUsertoken = !showUsertoken;
	showUserList = false;
}

// Map selectedIds Set back to Record or Array for Multibutton
let selectedRows = $derived(
	tableData.filter(row => selectedIds.has(isUser(row) ? row._id : row.token))
);

function handleKeydown(event: KeyboardEvent) {
	if (event.key === 'Escape') {
		// handle modals if needed
	}
}
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="flex flex-col gap-6 p-6 max-w-7xl mx-auto w-full">
	<div class="text-center">
		<h1 class="text-4xl font-black tracking-tight dark:text-white mb-2">{adminarea_adminarea()}</h1>
		<p class="text-surface-500 dark:text-surface-400">Manage users, roles and access tokens</p>
	</div>

	<div class="flex flex-col sm:flex-row items-center justify-center gap-4">
		<button onclick={modalTokenUser} class="btn preset-filled-primary-500 flex-1 sm:max-w-xs gap-2">
			<iconify-icon icon="mingcute:mail-line" width="20"></iconify-icon>
			{adminarea_emailtoken()}
		</button>

		<button onclick={toggleUserToken} class="btn preset-filled-secondary-500 flex-1 sm:max-w-xs gap-2">
			<iconify-icon icon={showUsertoken ? 'mingcute:close-circle-line' : 'mingcute:key-line'} width="20"></iconify-icon>
			{showUsertoken ? adminarea_hideusertoken() : adminarea_showtoken()}
		</button>

		<button onclick={toggleUserList} class="btn preset-filled-tertiary-500 flex-1 sm:max-w-xs gap-2">
			<iconify-icon icon={showUserList ? 'mingcute:close-circle-line' : 'mingcute:user-4-line'} width="20"></iconify-icon>
			{showUserList ? adminarea_hideuserlist() : adminarea_showuserlist()}
		</button>
	</div>

	{#if showUserList || showUsertoken}
		<Table 
			data={tableData} 
			{columns}
			selectable
			bind:selectedIds
			bind:currentPage
			bind:rowsPerPage
			bind:sortKey
			bind:sortOrder
			bind:density
			{totalItems}
			loading={globalLoadingStore.isLoading}
			class="shadow-2xl border-none"
		>
			{#snippet header()}
				<TableFilter bind:search={globalSearchValue} bind:density>
					<div class="flex items-center gap-4">
						<h2 class="text-xl font-bold text-surface-900 dark:text-white">
							{showUserList ? adminarea_userlist() : adminarea_listtoken()}
						</h2>
						<Multibutton {selectedRows} type={showUserList ? 'user' : 'token'} totalUsers={totalItems} {currentUser} onUpdate={handleBatchUpdate} />
					</div>
				</TableFilter>
			{/snippet}

			{#snippet row({ row })}
				<tr
					class="cursor-pointer transition-colors duration-150 hover:bg-surface-100 dark:hover:bg-surface-800"
					onclick={(event) => {
						// Only handle click if it's on a token row and not on the checkbox
						if (showUsertoken && !(event.target as HTMLElement)?.closest('td:first-child')) {
							if (isToken(row)) editToken(row);
						}
					}}
				>
					<td class="w-10 text-center">
						<input
							type="checkbox"
							class="checkbox p-2"
							checked={selectedIds.has(isUser(row) ? row._id : isToken(row) ? row._id : '')}
							onchange={() => toggleSelection(row)}
							onclick={(e) => e.stopPropagation()}
						/>
					</td>
					{#each columns.filter((header) => header.visible) as header (header.key)}
						<td class="px-4 py-3 text-center">
							{#if header.key === 'blocked'}
								{#if showUserList && isUser(row)}
									<button
										onclick={() => toggleUserBlocked(row)}
										class="btn-sm cursor-pointer rounded-md p-1 transition-all duration-200 hover:scale-105 hover:bg-surface-200 hover:shadow-md dark:hover:bg-surface-600"
										aria-label={row.blocked ? 'Unblock user' : 'Block user'}
										title={row.blocked ? 'Click to unblock user' : 'Click to block user'}
									>
										<StatusBadge status={!!(header.key && row[header.key])} />
									</button>
								{:else if isToken(row)}
									<button
										onclick={(event) => {
											event.stopPropagation();
											toggleTokenBlocked(row);
										}}
										class="btn-sm cursor-pointer rounded-md p-1 transition-all duration-200 hover:scale-105 hover:bg-surface-200 hover:shadow-md dark:hover:bg-surface-600"
										aria-label={row.blocked ? 'Unblock token' : 'Block token'}
										title={row.blocked ? 'Click to unblock token' : 'Click to block token'}
									>
										<StatusBadge status={!!(header.key && row[header.key])} />
									</button>
								{/if}
							{:else if showUserList && header.key === 'avatar' && isUser(row)}
								<Avatar
									src={currentUser && row._id === currentUser._id
										? normalizeAvatarUrl(avatarSrc.value)
										: normalizeAvatarUrl(row.avatar)}
									initials={(row.username || '').substring(0, 2).toUpperCase()}
									class="h-10 w-10 ring-2 ring-surface-200 dark:ring-surface-700 overflow-hidden rounded-full border border-surface-200/50 mx-auto"
								/>
							{:else if header.key === 'role'}
								<Badge variant="outline" class="mx-auto">
									{isUser(row) ? row.role : isToken(row) ? (row.role ?? 'token') : ''}
								</Badge>
							{:else if header.key === '_id'}
								<div class="flex items-center justify-center gap-2">
									<span class="font-mono text-sm">{isUser(row) ? row._id : isToken(row) ? row._id : '-'}</span>
									<Tooltip title="Copy ID">
										<button
											class="preset-ghost btn-icon btn-icon-sm"
											aria-label="Copy ID"
											onclick={(e) => {
												e.stopPropagation();
												navigator.clipboard.writeText(String(isUser(row) ? row._id : row._id));
												toast.success('ID copied');
											}}
										>
											<iconify-icon icon="oui:copy-clipboard"></iconify-icon>
										</button>
									</Tooltip>
								</div>
							{:else if header.key === 'token' && isToken(row)}
								<div class="flex items-center justify-center gap-2">
									<span class="max-w-50 truncate font-mono text-sm">{row.token}</span>
									<Tooltip title="Copy Token">
										<button
											class="preset-ghost btn-icon btn-icon-sm"
											aria-label="Copy Token"
											onclick={(e) => {
												e.stopPropagation();
												navigator.clipboard.writeText(row.token);
												toast.success('Token copied');
											}}
										>
											<iconify-icon icon="oui:copy-clipboard"></iconify-icon>
										</button>
									</Tooltip>
								</div>
							{:else if ['createdAt', 'updatedAt', 'lastAccess'].includes(header.key)}
								<span class="text-sm opacity-70">
									{formatDate(isUser(row) ? row[header.key as keyof User] : isToken(row) ? row[header.key as keyof Token] : undefined)}
								</span>
							{:else if header.key === 'expires' && isToken(row)}
								{@const expired = checkTokenExpired(row)}
								<span class={cn("text-sm", expired && "text-error-500 font-bold")}>
									{getRemainingTime(row.expires)}
									{#if expired}
										<iconify-icon icon="mingcute:warning-line" class="ml-1"></iconify-icon>
									{/if}
								</span>
							{:else}
								<span class="text-sm">{getDisplayValue(row, header)}</span>
							{/if}
						</td>
					{/each}
				</tr>
			{/snippet}
		</Table>
	{/if}
</div>
