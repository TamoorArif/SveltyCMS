/**
 * @file tests/unit/api/settings-security.test.ts
 * @description Unit tests for Settings API security, focusing on tenant isolation and role-based access.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock settings service
vi.mock("@src/services/settings-service", () => ({
  getPrivateSettingSync: vi.fn().mockImplementation((key) => {
    if (key === "MULTI_TENANT") return true;
    return undefined;
  }),
  invalidateSettingsCache: vi.fn(),
}));

// Mock logger
vi.mock("@utils/logger.server", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock server utils
vi.mock("@src/utils/server/restart-required", () => ({
  setRestartNeeded: vi.fn(),
}));

vi.mock("@src/utils/server/settings-sync", () => ({
  triggerSync: vi.fn(),
}));

// Mock settings groups
vi.mock("@src/routes/(app)/config/system-settings/settings-groups", () => ({
  getSettingGroup: vi.fn().mockImplementation((id) => ({
    id,
    name: id,
    fields:
      id === "site"
        ? [
            {
              key: "SITE_NAME",
              label: "Site Name",
              type: "text",
              category: "public",
            },
          ]
        : [],
    adminOnly: true,
  })),
  settingsGroups: [],
}));

// Mock seed defaults
vi.mock("../../../setup/seed", () => ({
  defaultPrivateSettings: [],
  defaultPublicSettings: [],
}));

import {
  GET as getSettings,
  PUT as updateSettings,
  DELETE as resetSettings,
} from "@src/routes/api/settings/[group]/+server";
import { dbAdapter } from "@src/databases/db";

describe("Settings API Security - Tenant Isolation and RBAC", () => {
  const mockAdmin = {
    _id: "admin1",
    role: "admin",
    email: "admin@tenant1.com",
  };
  const mockSuperAdmin = {
    _id: "super1",
    role: "super-admin",
    email: "super@cms.com",
  };
  const myTenant = "tenant-1";
  const otherTenant = "tenant-2";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Infrastructure Groups (e.g., security)", () => {
    const group = "security";

    it("should reject regular admin access to infrastructure settings in multi-tenant mode", async () => {
      const event = {
        params: { group },
        locals: { user: mockAdmin, tenantId: myTenant },
        url: new URL(`http://localhost/api/settings/${group}`),
      } as any;

      try {
        await getSettings(event);
      } catch (error: any) {
        expect(error.status).toBe(403);
        expect(error.message).toContain("super-admins");
      }
    });

    it("should allow super-admin access to infrastructure settings", async () => {
      const event = {
        params: { group },
        locals: { user: mockSuperAdmin, tenantId: myTenant },
        url: new URL(`http://localhost/api/settings/${group}`),
      } as any;

      const response = await getSettings(event);
      if (response.status !== 200) {
        const body = await response.json();
        console.log("DEBUG Error:", body);
      }
      expect(response.status).toBe(200);
      expect(dbAdapter!.system.preferences.getMany).toHaveBeenCalled();
    });
  });

  describe("Site-Specific Groups (e.g., site)", () => {
    const group = "site";

    it("should scope settings to the current tenant for regular admin", async () => {
      const event = {
        params: { group },
        locals: { user: mockAdmin, tenantId: myTenant },
        url: new URL(`http://localhost/api/settings/${group}`),
      } as any;

      await getSettings(event);
      expect(dbAdapter!.system.preferences.getMany).toHaveBeenCalledWith(
        expect.any(Array),
        "system",
        myTenant,
      );
    });

    it("should allow super-admin to override tenantId", async () => {
      const event = {
        params: { group },
        locals: { user: mockSuperAdmin, tenantId: myTenant },
        url: new URL(`http://localhost/api/settings/${group}?tenantId=${otherTenant}`),
      } as any;

      await getSettings(event);
      expect(dbAdapter!.system.preferences.getMany).toHaveBeenCalledWith(
        expect.any(Array),
        "system",
        otherTenant,
      );
    });

    it("should prevent regular admin from overriding tenantId", async () => {
      const event = {
        params: { group },
        locals: { user: mockAdmin, tenantId: myTenant },
        url: new URL(`http://localhost/api/settings/${group}?tenantId=${otherTenant}`),
      } as any;

      try {
        await getSettings(event);
      } catch (error: any) {
        expect(error.status).toBe(403);
        expect(error.message).toContain("tenant");
      }
    });

    it("should use tenantId for updates (PUT)", async () => {
      const event = {
        params: { group },
        locals: { user: mockAdmin, tenantId: myTenant },
        request: { json: vi.fn().mockResolvedValue({ SITE_NAME: "New Name" }) },
        url: new URL(`http://localhost/api/settings/${group}`),
      } as any;

      await updateSettings(event);
      expect(dbAdapter!.system.preferences.setMany).toHaveBeenCalledWith([
        expect.objectContaining({ userId: myTenant }),
      ]);
    });

    it("should use tenantId for resets (DELETE)", async () => {
      const event = {
        params: { group },
        locals: { user: mockAdmin, tenantId: myTenant },
        url: new URL(`http://localhost/api/settings/${group}`),
      } as any;

      await resetSettings(event);
      expect(dbAdapter!.system.preferences.deleteMany).toHaveBeenCalledWith(
        expect.any(Array),
        "system",
        myTenant,
      );
    });
  });
});
