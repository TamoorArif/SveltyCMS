/**
 * @file src/services/webhook-service.ts
 * @description Service for managing and dispatching system webhooks.
 * Allows external systems to subscribe to CMS events.
 */

import { logger } from '@utils/logger.server';
import { v4 as uuidv4 } from 'uuid';

// Types
export interface Webhook {
	active: boolean;
	events: WebhookEvent[];
	failureCount?: number;
	headers?: Record<string, string>;
	id: string;
	lastTriggered?: string;
	name: string;
	secret?: string; // For signature verification
	url: string;
	tenantId: string; // Added for multi-tenancy
}

export type WebhookEvent = 'entry:create' | 'entry:update' | 'entry:delete' | 'entry:publish' | 'entry:unpublish' | 'media:upload' | 'media:delete';

const getDbAdapter = async () => (await import('@src/databases/db')).dbAdapter;

export class WebhookService {
	private static instance: WebhookService;

	// In-memory cache of webhooks per tenant
	private webhooksCache: Map<string, { data: Webhook[]; timestamp: number }> = new Map();
	private readonly CACHE_TTL = 60 * 1000; // 1 minute

	private constructor() {}

	public static getInstance(): WebhookService {
		if (!WebhookService.instance) {
			WebhookService.instance = new WebhookService();
		}
		return WebhookService.instance;
	}

	/**
	 * Dispatch an event to all subscribed webhooks for a specific tenant
	 */
	public async trigger(event: WebhookEvent, payload: unknown, tenantId: string) {
		if (!tenantId) {
			logger.warn(`Webhook trigger called without tenantId for event: ${event}`);
			return;
		}
		// Don't block main thread
		this._dispatch(event, payload, tenantId).catch((err) => logger.error(`Error dispatching webhook event ${event} for tenant ${tenantId}:`, err));
	}

	/**
	 * Send a test event to a specific webhook
	 */
	public async testWebhook(id: string, userEmail: string, tenantId: string) {
		const webhooks = await this.getWebhooks(tenantId);
		const webhook = webhooks.find((w) => w.id === id);
		if (!webhook) {
			throw new Error('Webhook not found');
		}

		// We dispatch only to this one
		await this._dispatchTo(webhook, 'entry:create', {
			test: true,
			message: 'This is a test event from SveltyCMS',
			triggeredBy: userEmail
		});
	}

	private async _dispatch(event: WebhookEvent, payload: unknown, tenantId: string) {
		const webhooks = await this.getWebhooks(tenantId);
		const matchingHooks = webhooks.filter((wh) => wh.active && (wh.events.includes(event) || wh.events.includes('*' as unknown as WebhookEvent)));

		if (matchingHooks.length === 0) {
			return;
		}

		logger.debug(`Queueing ${event} for ${matchingHooks.length} webhooks for tenant ${tenantId}`);

		const { jobQueue } = await import('./jobs/job-queue-service');

		for (const webhook of matchingHooks) {
			await jobQueue.dispatch(
				'webhook-delivery',
				{
					webhook,
					event,
					payload
				},
				tenantId
			);
		}
	}

	private async _dispatchTo(webhook: Webhook, event: WebhookEvent, payload: unknown) {
		// This is now used by testWebhook. We delegate to jobQueue for consistency,
		// but maybe for tests we want immediate feedback?
		// For now, let's keep it immediate for the "Test Webhook" button but use the new logic.
		const { webhookDeliveryHandler } = await import('./jobs/webhook-jobs');
		await webhookDeliveryHandler({ webhook, event, payload });
	}

	/**
	 * Get all configured webhooks for a tenant
	 */
	public async getWebhooks(tenantId: string): Promise<Webhook[]> {
		if (!tenantId) {
			return [];
		}

		// Simple memory cache per tenant
		const cached = this.webhooksCache.get(tenantId);
		if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
			return cached.data;
		}

		try {
			const db = await getDbAdapter();
			if (!db) {
				return [];
			}

			// webhooks_config is stored in system_preferences scoped by tenantId
			const result = await db.system.preferences.get<Webhook[]>('webhooks_config', 'system', tenantId as any);

			const webhooks = result.success && Array.isArray(result.data) ? result.data : [];

			// Enforce tenantId consistency on load
			const sanitizedWebhooks = webhooks.map((w) => ({ ...w, tenantId }));

			this.webhooksCache.set(tenantId, { data: sanitizedWebhooks, timestamp: Date.now() });

			return sanitizedWebhooks;
		} catch (e) {
			logger.error(`Failed to load webhooks for tenant ${tenantId}:`, e);
			return [];
		}
	}

	/**
	 * Save a new webhook or update existing for a tenant
	 */
	public async saveWebhook(webhook: Partial<Webhook>, tenantId: string): Promise<Webhook> {
		if (!tenantId) {
			throw new Error('tenantId is required');
		}

		const db = await getDbAdapter();
		if (!db) {
			throw new Error('DB not available');
		}

		const current = await this.getWebhooks(tenantId);
		let updated: Webhook[];

		const newWebhook = {
			...webhook,
			id: webhook.id || uuidv4(),
			active: webhook.active ?? true,
			events: webhook.events || [],
			name: webhook.name || 'Untitled Webhook',
			url: webhook.url || '',
			tenantId // Ensure correct tenantId is set
		} as Webhook;

		if (webhook.id) {
			// Check if webhook exists in current tenant's list
			const exists = current.some((w) => w.id === webhook.id);
			if (!exists && current.length > 0) {
				// If adding a new one with a pre-provided ID, or if ID is wrong
				updated = [...current, newWebhook];
			} else {
				updated = current.map((w) => (w.id === webhook.id ? newWebhook : w));
			}
		} else {
			updated = [...current, newWebhook];
		}

		await db.system.preferences.set('webhooks_config', updated, 'system', tenantId as any);

		// Update cache immediately
		this.webhooksCache.set(tenantId, { data: updated, timestamp: Date.now() });

		return newWebhook;
	}

	public async deleteWebhook(id: string, tenantId: string) {
		if (!tenantId) {
			return;
		}

		const db = await getDbAdapter();
		if (!db) {
			return;
		}

		const current = await this.getWebhooks(tenantId);
		const initialLength = current.length;
		const updated = current.filter((w) => w.id !== id);

		if (updated.length !== initialLength) {
			await db.system.preferences.set('webhooks_config', updated, 'system', tenantId as any);
			this.webhooksCache.set(tenantId, { data: updated, timestamp: Date.now() });
		}
	}
}

export const webhookService = WebhookService.getInstance();
