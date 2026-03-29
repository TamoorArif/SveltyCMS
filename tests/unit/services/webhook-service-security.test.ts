/**
 * @file tests/unit/services/webhook-service-security.test.ts
 * @description Unit tests for WebhookService security, focusing on cache and trigger isolation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { WebhookService, type WebhookEvent } from "@src/services/webhook-service";
import { jobQueue } from "@src/services/jobs/job-queue-service";

// Mock DB adapter
const mockDb = {
  system: {
    preferences: {
      get: vi.fn(),
      set: vi.fn(),
    },
  },
};

vi.mock("@src/databases/db", () => ({
  dbAdapter: mockDb,
  getDbInitPromise: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@utils/logger.server", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock jobQueue
vi.mock("@src/services/jobs/job-queue-service", () => ({
  jobQueue: {
    dispatch: vi.fn().mockResolvedValue("job-123"),
  },
}));

// Mock fetch
global.fetch = vi.fn().mockImplementation(() => Promise.resolve({ ok: true })) as any;

describe("WebhookService Security - Tenant Isolation", () => {
  let service: WebhookService;
  const tenant1 = "tenant-1";
  const tenant2 = "tenant-2";

  beforeEach(() => {
    vi.clearAllMocks();
    // @ts-expect-error - accessing private instance for testing
    WebhookService.instance = null;
    service = WebhookService.getInstance();
  });

  it("should maintain separate caches for different tenants", async () => {
    const hooks1 = [
      {
        id: "h1",
        name: "Hook 1",
        tenantId: tenant1,
        events: ["*"] as unknown as WebhookEvent[],
        url: "http://t1.com",
        active: true,
      },
    ];
    const hooks2 = [
      {
        id: "h2",
        name: "Hook 2",
        tenantId: tenant2,
        events: ["*"] as unknown as WebhookEvent[],
        url: "http://t2.com",
        active: true,
      },
    ];

    // Mock DB to return different hooks for different tenants
    mockDb.system.preferences.get.mockImplementation((_key, _scope, tId) => {
      if (tId === tenant1) return Promise.resolve({ success: true, data: hooks1 });
      if (tId === tenant2) return Promise.resolve({ success: true, data: hooks2 });
      return Promise.resolve({ success: true, data: [] });
    });

    const result1 = await service.getWebhooks(tenant1);
    const result2 = await service.getWebhooks(tenant2);

    expect(result1).toEqual(hooks1);
    expect(result2).toEqual(hooks2);
    expect(mockDb.system.preferences.get).toHaveBeenCalledTimes(2);

    // Second call should come from cache
    await service.getWebhooks(tenant1);
    await service.getWebhooks(tenant2);
    expect(mockDb.system.preferences.get).toHaveBeenCalledTimes(2);
  });

  it("should only trigger webhooks for the specified tenant", async () => {
    const hooks1 = [
      {
        id: "h1",
        name: "Hook 1",
        tenantId: tenant1,
        events: ["entry:create"] as WebhookEvent[],
        url: "http://t1.com",
        active: true,
      },
    ];
    const hooks2 = [
      {
        id: "h2",
        name: "Hook 2",
        tenantId: tenant2,
        events: ["entry:create"] as WebhookEvent[],
        url: "http://t2.com",
        active: true,
      },
    ];

    mockDb.system.preferences.get.mockImplementation((_key, _scope, tId) => {
      if (tId === tenant1) return Promise.resolve({ success: true, data: hooks1 });
      if (tId === tenant2) return Promise.resolve({ success: true, data: hooks2 });
      return Promise.resolve({ success: true, data: [] });
    });

    // Trigger for tenant 1
    await service.trigger("entry:create", { some: "data" }, tenant1);

    // Wait for async dispatch
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Should have dispatched only for tenant 1's hook
    expect(jobQueue.dispatch).toHaveBeenCalledTimes(1);
    const dispatchArgs = (jobQueue.dispatch as any).mock.calls[0];
    expect(dispatchArgs[1].webhook.id).toBe("h1");
    expect(dispatchArgs[2]).toBe(tenant1);
  });

  it("should enforce tenantId when saving webhooks", async () => {
    mockDb.system.preferences.get.mockResolvedValue({
      success: true,
      data: [],
    });
    mockDb.system.preferences.set.mockResolvedValue({ success: true });

    const newHook = {
      name: "New Hook",
      url: "http://new.com",
      events: ["entry:create"] as WebhookEvent[],
    };
    await service.saveWebhook(newHook, tenant1);

    expect(mockDb.system.preferences.set).toHaveBeenCalledWith(
      "webhooks_config",
      expect.arrayContaining([expect.objectContaining({ tenantId: tenant1 })]),
      "system",
      tenant1,
    );
  });
});
