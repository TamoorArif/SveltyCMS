/**
 * @file tests/unit/databases/cache-service.test.ts
 * @description Whitebox unit tests for CacheService enhancements
 */

(globalThis as any).vi.unmock("@src/databases/cache/cache-service");

// Mock settings-service specifically for these tests
vi.mock("@src/services/settings-service", () => ({
  getPrivateSettingSync: vi.fn((key: string) => {
    if (key === "MULTI_TENANT") return (globalThis as any).__mockMultiTenant ?? false;
    if (key.startsWith("CACHE_TTL_")) return 300;
    return null;
  }),
}));

describe("CacheService (Whitebox)", () => {
  let service: any;
  let CacheServiceClass: any;

  beforeEach(async () => {
    // DYNAMIC IMPORT with query to bypass persistent Bun mock
    const module = await import("@src/databases/cache/cache-service?bun-unmock=" + Date.now());
    CacheServiceClass = module.CacheService;

    // Create a NEW instance for each test to bypass the global singleton mock
    service = new CacheServiceClass();
    await service.initialize(true); // Force init
    (globalThis as any).__mockMultiTenant = false;
  });

  describe("generateKey", () => {
    it("should generate a simple key when multi-tenant is disabled", () => {
      const key = service.generateKey("my-key");
      expect(key).toBe("my-key");
    });

    it("should generate a tenant-prefixed key when multi-tenant is enabled", () => {
      (globalThis as any).__mockMultiTenant = true;
      const key = service.generateKey("my-key", "tenant-1");
      expect(key).toBe("tenant:tenant-1:my-key");
    });

    it('should use "default" as tenantId if not provided but multi-tenant is enabled', () => {
      (globalThis as any).__mockMultiTenant = true;
      const key = service.generateKey("my-key");
      expect(key).toBe("tenant:default:my-key");
    });

    it("should memoize generated keys", () => {
      const spy = vi.spyOn(service.keyCache, "set");
      service.generateKey("cached-key");
      service.generateKey("cached-key"); // Second call should be from cache

      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  describe("finalizeTags", () => {
    it("should return tags as-is when multi-tenant is disabled", () => {
      const tags = service.finalizeTags(["tag1", "tag2"]);
      expect(tags).toEqual(["tag1", "tag2"]);
    });

    it("should prefix tags with tenant id when multi-tenant is enabled", () => {
      (globalThis as any).__mockMultiTenant = true;
      const tags = service.finalizeTags(["tag1", "tag2"], "t123");
      expect(tags).toEqual(["tenant:t123:tag1", "tenant:t123:tag2"]);
    });

    it("should not double-prefix tags that are already tenant-prefixed", () => {
      (globalThis as any).__mockMultiTenant = true;
      const tags = service.finalizeTags(["tenant:t123:tag1", "tag2"], "t123");
      expect(tags).toEqual(["tenant:t123:tag1", "tenant:t123:tag2"]);
    });
  });

  describe("clearByTags (Debouncing)", () => {
    it("should debounce multiple calls to clearByTags with the same tags", async () => {
      const storeSpy = vi.spyOn(service.store, "clearByTags");

      // Call multiple times rapidly
      service.clearByTags(["shared-tag"]);
      service.clearByTags(["shared-tag"]);
      service.clearByTags(["shared-tag"]);

      expect(storeSpy).toHaveBeenCalledTimes(0); // Should be waiting for debounce

      // Wait for debounce (300ms + buffer)
      await new Promise((resolve) => setTimeout(resolve, 400));

      expect(storeSpy).toHaveBeenCalledTimes(1);
    });

    it("should execute immediately for different tag sets", async () => {
      const storeSpy = vi.spyOn(service.store, "clearByTags");

      service.clearByTags(["tag-a"]);
      service.clearByTags(["tag-b"]);

      await new Promise((resolve) => setTimeout(resolve, 400));

      expect(storeSpy).toHaveBeenCalledTimes(2);
    });
  });
});
