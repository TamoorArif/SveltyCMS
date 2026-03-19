/**
 * @file tests/unit/api/media-security-critical.test.ts
 * @description Unit tests for critical Media API security fixes (Command Injection, SSRF, Directory Traversal).
 */

import type {} from "vitest";

const vi = (globalThis as any).vi;

vi.mock("node:fs/promises", () => {
  const mockReadFile = vi.fn().mockResolvedValue(Buffer.from("ok"));
  const mockMkdir = vi.fn().mockResolvedValue(undefined);
  const mockWriteFile = vi.fn().mockResolvedValue(undefined);
  const mockAccess = vi.fn().mockResolvedValue(undefined);
  const mockUnlink = vi.fn().mockResolvedValue(undefined);
  return {
    readFile: mockReadFile,
    mkdir: mockMkdir,
    writeFile: mockWriteFile,
    access: mockAccess,
    unlink: mockUnlink,
    default: {
      readFile: mockReadFile,
      mkdir: mockMkdir,
      writeFile: mockWriteFile,
      access: mockAccess,
      unlink: mockUnlink,
    },
  };
});

vi.mock("@src/databases/db", () => {
  const mockDbAdapter = {
    crud: { findOne: vi.fn(), updateOne: vi.fn() },
    media: { findOne: vi.fn(), updateOne: vi.fn() },
    auth: { getUserById: vi.fn() },
  };
  return {
    dbAdapter: mockDbAdapter,
    dbInitPromise: Promise.resolve(),
    getDb: () => mockDbAdapter,
    getAuth: () => mockDbAdapter.auth,
  };
});

vi.mock("@src/services/settings-service", () => ({
  getSettings: (globalThis as any).vi.fn().mockResolvedValue({
    media: {
      allowedExtensions: ["jpg", "png", "gif"],
      maxSize: 10 * 1024 * 1024,
    },
  }),
  getPublicSettingSync: (globalThis as any).vi.fn().mockReturnValue("mediaFolder"),
}));

vi.mock("@src/utils/media/media-service.server", () => {
  class MockMediaService {
    ensureInitialized = (globalThis as any).vi.fn();
    getMedia = (globalThis as any).vi.fn();
    updateMedia = (globalThis as any).vi.fn().mockResolvedValue({ success: true, metadata: {} });
    deleteMedia = (globalThis as any).vi.fn();
    saveMedia = (globalThis as any).vi.fn();
    manipulateMedia = (globalThis as any).vi.fn();
    saveRemoteMedia = (globalThis as any).vi.fn();
    batchProcessImages = (globalThis as any).vi.fn();
  }
  return {
    MediaService: MockMediaService,
  };
});

// 3. Import modules dynamically AFTER mocks for Bun compatibility
const { spawn } = await import("node:child_process");
const { lookup } = await import("node:dns/promises");
const { isPrivateIP, validateRemoteUrl } = await import("@src/utils/security/url-validator");
const storage = await import("@src/utils/media/media-storage.server");
const { POST: transcodePOST } = await import("@src/routes/api/media/transcode/+server");
const { dbAdapter } = await import("@src/databases/db");

// Use Vitest's mocked helper for typed mocks
const mockLookup = lookup as any;

describe("Critical Security Fixes Verification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Command Injection Prevention", () => {
    it("should use spawn instead of exec for transcoding", async () => {
      (dbAdapter!.crud.findOne as any).mockResolvedValue({
        success: true,
        data: { _id: "vid123", type: "video", path: "videos/test.mp4" },
      });

      const event = {
        request: {
          json: vi.fn().mockResolvedValue({ mediaId: "vid123", targetFormat: "hls" }),
        },
        locals: { user: { _id: "u1" }, tenantId: "t1" },
      };

      const response = await transcodePOST(event as any);
      const result = await response.json();
      if (!result.success) {
        console.log("Transcode handler failed:", result.error);
      }

      // Verify spawn was called with array of args
      expect(spawn).toHaveBeenCalledWith("ffmpeg", expect.any(Array));
    });
  });

  describe("SSRF Prevention", () => {
    it("should block non-HTTPS protocols", async () => {
      await expect(validateRemoteUrl("http://malicious.com")).rejects.toThrow(
        "Only HTTPS URLs are allowed",
      );
    });

    it("should block loopback addresses", async () => {
      await expect(validateRemoteUrl("https://localhost/admin")).rejects.toThrow(
        "Access to internal/private network is forbidden",
      );
    });

    it("should block private IPv4 ranges (10.x.x.x)", async () => {
      await expect(validateRemoteUrl("https://internal.service")).rejects.toThrow(
        "Access to internal/private network is forbidden",
      );
    });

    it("should allow public IPs", async () => {
      mockLookup.mockResolvedValueOnce({ address: "8.8.8.8", family: 4 } as any);
      await validateRemoteUrl("https://google.com/logo.png");
    });

    it("isPrivateIP should correctly identify various ranges", () => {
      expect(isPrivateIP("127.0.0.1")).toBe(true);
      expect(isPrivateIP("10.0.0.1")).toBe(true);
      expect(isPrivateIP("172.16.0.1")).toBe(true);
      expect(isPrivateIP("172.31.255.255")).toBe(true);
      expect(isPrivateIP("192.168.1.1")).toBe(true);
      expect(isPrivateIP("169.254.1.1")).toBe(true);
      expect(isPrivateIP("100.64.0.1")).toBe(true);
      expect(isPrivateIP("8.8.8.8")).toBe(false);
      expect(isPrivateIP("1.1.1.1")).toBe(false);
      // IPv6
      expect(isPrivateIP("::1")).toBe(true);
      expect(isPrivateIP("fe80::1")).toBe(true);
      expect(isPrivateIP("fd00::1")).toBe(true);
      expect(isPrivateIP("2001:4860:4860::8888")).toBe(false);
    });
  });

  describe("Directory Traversal Hardening", () => {
    it("should block path traversal in getFile using startsWith check", async () => {
      const traversalPath = "../../etc/passwd";
      await expect(storage.getFile(traversalPath)).rejects.toThrow("Potential traversal attack");
    });

    it("should block path traversal in saveFile", async () => {
      const buffer = Buffer.from("test");
      await expect(storage.saveFile(buffer, "../outside.txt")).rejects.toThrow(
        "Potential traversal attack",
      );
    });

    it("should allow legitimate deep paths within mediaFolder", async () => {
      const safePath = "sub/folder/image.jpg";
      console.log("--- getFile debug:", {
        hasStorage: !!storage,
        getFileType: typeof storage.getFile,
        safePath,
      });
      const res = await storage.getFile(safePath);
      console.log("--- getFile res:", { res: !!res, resType: typeof res });
      expect(res).toBeDefined();
    });
  });
});
