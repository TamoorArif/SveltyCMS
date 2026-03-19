/**
 * @file tests/unit/api/media-security.test.ts
 * @description Unit tests for Media API security hardening (Tenant Isolation & IDOR protection).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RequestEvent } from "@sveltejs/kit";

// Define the mock service object first
const mockMediaService = {
  ensureInitialized: vi.fn(),
  getMedia: vi.fn(),
  updateMedia: vi.fn(),
  deleteMedia: vi.fn(),
  saveMedia: vi.fn(),
  manipulateMedia: vi.fn(),
  batchProcessImages: vi.fn(),
};

// Mock dependencies
vi.mock("@utils/api-handler", () => ({
  apiHandler: (fn: any) => fn,
}));

// Mock logger and settings are handled by setup.ts

// Mock MediaService to return the mock object
vi.mock("@src/utils/media/media-service.server", () => {
  class MockMediaService {
    ensureInitialized = mockMediaService.ensureInitialized;
    getMedia = mockMediaService.getMedia;
    updateMedia = mockMediaService.updateMedia;
    deleteMedia = mockMediaService.deleteMedia;
    saveMedia = mockMediaService.saveMedia;
    manipulateMedia = mockMediaService.manipulateMedia;
    batchProcessImages = mockMediaService.batchProcessImages;
  }
  return {
    MediaService: MockMediaService,
  };
});

// Import handlers after mocking
import * as mediaIdHandler from "@src/routes/api/media/[id]/+server";
import * as mediaDeleteHandler from "@src/routes/api/media/delete/+server";
import * as mediaProcessHandler from "@src/routes/api/media/process/+server";
import { dbAdapter } from "@src/databases/db";

describe("Media API Security Unit Tests", () => {
  const user = { _id: "user-1", email: "test@example.com" };
  const roles = [{ name: "admin", isAdmin: true }];
  const tenantId = "tenant-A";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/media/[id]", () => {
    it("should propagate tenantId to MediaService.getMedia", async () => {
      const event = {
        params: { id: "media-1" },
        locals: { user, roles, tenantId },
      } as unknown as RequestEvent;

      await mediaIdHandler.GET(event as any);

      expect(mockMediaService.getMedia).toHaveBeenCalledWith("media-1", user, roles, tenantId);
    });
  });

  describe("PATCH /api/media/[id]", () => {
    it("should propagate tenantId to MediaService.getMedia and updateMedia", async () => {
      mockMediaService.getMedia.mockResolvedValue({ _id: "media-1", metadata: {} });

      const event = {
        params: { id: "media-1" },
        locals: { user, roles, tenantId },
        request: {
          json: vi.fn().mockResolvedValue({ metadata: { alt: "new alt" } }),
        },
      } as unknown as RequestEvent;

      await mediaIdHandler.PATCH(event as any);

      expect(mockMediaService.getMedia).toHaveBeenCalledWith("media-1", user, roles, tenantId);
      expect(mockMediaService.updateMedia).toHaveBeenCalledWith(
        "media-1",
        expect.anything(),
        tenantId,
      );
    });
  });

  describe("DELETE /api/media/delete", () => {
    it("should enforce tenant isolation when finding the media item", async () => {
      (dbAdapter!.crud.findMany as any).mockResolvedValue({
        success: true,
        data: [{ _id: "media-1", path: "test.jpg" } as any],
      });

      const event = {
        locals: { user, roles, tenantId },
        request: {
          json: vi.fn().mockResolvedValue({ url: "/files/test.jpg" }),
        },
      } as unknown as RequestEvent;

      await mediaDeleteHandler.DELETE(event as any);

      expect(dbAdapter!.crud.findMany).toHaveBeenCalledWith(
        "media",
        expect.objectContaining({ path: "test.jpg" }),
        expect.objectContaining({ tenantId }),
      );
      expect(mockMediaService.deleteMedia).toHaveBeenCalledWith("media-1", tenantId);
    });
  });

  describe("POST /api/media/process (batch)", () => {
    it("should propagate tenantId to MediaService.batchProcessImages", async () => {
      const formData = new FormData();
      formData.append("processType", "batch");
      formData.append("mediaIds", JSON.stringify(["m1", "m2"]));
      formData.append("options", JSON.stringify({ filters: { grayscale: 100 } }));

      const event = {
        locals: { user, roles, tenantId },
        request: {
          formData: vi.fn().mockResolvedValue(formData),
        },
      } as unknown as RequestEvent;

      await mediaProcessHandler.POST(event as any);

      expect(mockMediaService.batchProcessImages).toHaveBeenCalledWith(
        ["m1", "m2"],
        expect.objectContaining({ filters: { grayscale: 100 } }),
        user._id,
        tenantId,
      );
    });
  });

  describe("POST /api/media/process (save)", () => {
    it("should propagate tenantId to MediaService.saveMedia", async () => {
      const formData = new FormData();
      formData.append("processType", "save");
      formData.append("files", new File([""], "test.jpg", { type: "image/jpeg" }));

      const event = {
        locals: { user, roles, tenantId },
        request: {
          formData: vi.fn().mockResolvedValue(formData),
        },
      } as unknown as RequestEvent;

      await mediaProcessHandler.POST(event as any);

      expect(mockMediaService.saveMedia).toHaveBeenCalledWith(
        expect.any(File),
        user._id,
        "private",
        tenantId,
        "global",
        undefined,
      );
    });
  });
});
