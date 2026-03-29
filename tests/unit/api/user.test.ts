/**
 * @file tests/unit/api/user.test.ts
 * @description Unit tests for user management endpoints.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RequestEvent } from "@sveltejs/kit";

// Mock dependencies
vi.mock("@src/databases/db", () => ({
  dbAdapter: {
    auth: {
      getAllUsers: vi.fn(),
      updateUserAttributes: vi.fn(),
      batchAction: vi.fn(),
    },
  },
  getDbInitPromise: vi.fn().mockResolvedValue(undefined),
  getAuth: vi.fn(),
}));

vi.mock("@src/services/settings-service", () => ({
  getPrivateSettingSync: vi.fn().mockReturnValue(false),
}));

vi.mock("@utils/api-handler", () => ({
  apiHandler: (fn: any) => fn,
}));

// Import raw dispatcher handler
import { handler as dispatcher } from "@src/routes/api/[...path]/+server";

describe("User API Unit Tests", () => {
  const createMockEvent = (
    method: string,
    path: string,
    body: any = {},
    user: any = { _id: "u1", role: "admin" },
    tenantId?: string,
  ) => {
    return {
      url: new URL(`http://localhost/api/${path}`),
      params: { path },
      request: {
        method,
        json: vi.fn().mockResolvedValue(body),
        formData: vi.fn(),
        headers: new Map(),
      },
      locals: {
        user,
        tenantId,
        dbAdapter: {
          auth: {
            getAllUsers: vi.fn().mockResolvedValue({ success: true, data: [] }),
            updateUserAttributes: vi.fn().mockResolvedValue({ success: true }),
            batchAction: vi.fn().mockResolvedValue({ success: true }),
          },
          collections: {},
          media: {},
          widgets: {},
          system: {},
          crud: {},
        },
      },
      cookies: { get: vi.fn(), set: vi.fn(), delete: vi.fn() },
    } as unknown as RequestEvent;
  };

  it("should list users", async () => {
    const event = createMockEvent("GET", "user");
    const response = await dispatcher(event);
    const result = await response.json();
    expect(result.success).toBe(true);
  });

  it("should update user attributes", async () => {
    const event = createMockEvent("PATCH", "user/update-user-attributes", {
      user_id: "u1",
      newUserData: { name: "New" },
    });
    const response = await dispatcher(event);
    const result = await response.json();
    expect(result.success).toBe(true);
  });
});
