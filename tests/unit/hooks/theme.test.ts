/**
 * @file tests/unit/hooks/theme.test.ts
 * @description Robust, type-safe tests for the handleTheme middleware.
 */

import type { RequestEvent, ResolveOptions } from "@sveltejs/kit";

// We need a variable that IS NOT hoisted by Vitest's vi.mock for our state control.
// In Vitest, vi.mock is hoisted at the top of the file, BEFORE imports and other code.
// To share state with a hoisted mock, we must use globalThis.

(globalThis as any).__mockThemeManager = {
  getTheme: vi.fn(() => Promise.resolve(null)),
  isInitialized: vi.fn(() => true),
};

// Mock ThemeManager using the global object.
vi.mock("@src/databases/theme-manager", () => ({
  ThemeManager: {
    getInstance: () => (globalThis as any).__mockThemeManager,
  },
}));

// Now import the code that uses the mock
import { handleTheme } from "@src/hooks/handle-theme";

// --- Constants ---
const BASE_HTML = '<html lang="en" dir="ltr"><head></head><body>Content</body></html>';
const DARK_CLASS_REGEX = /<html[^>]*class="[^"]*\bdark\b[^"]*"[^>]*>/;

// --- Test Helper ---
function createMockEvent(pathname: string, themeCookie?: string): RequestEvent {
  const url = new URL(pathname, "http://localhost");

  return {
    url,
    request: new Request(url.toString()),
    cookies: {
      get: (name: string) => (name === "theme" ? themeCookie : undefined),
      set: vi.fn(() => {}),
      delete: vi.fn(() => {}),
      getAll: () => [],
      serialize: () => "",
    },
    locals: {
      darkMode: false,
      theme: null,
      tenantId: "default",
    },
    params: {},
    route: { id: pathname },
    platform: {},
    setHeaders: vi.fn(() => {}),
    fetch: vi.fn(() => Promise.resolve(new Response())),
  } as unknown as RequestEvent;
}

describe("Middleware: handleTheme", () => {
  let mockResolve: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    (globalThis as any).__mockThemeManager.isInitialized.mockReturnValue(true);

    mockResolve = vi.fn(async (_event: RequestEvent, opts?: ResolveOptions) => {
      const transformPageChunk = opts?.transformPageChunk;

      if (transformPageChunk) {
        const transformedHtml = await transformPageChunk({
          html: BASE_HTML,
          done: true,
        });
        return new Response(transformedHtml, {
          headers: { "Content-Type": "text/html" },
        });
      }

      return new Response(BASE_HTML, {
        headers: { "Content-Type": "text/html" },
      });
    });
  });

  describe("Cookie Detection & Locals", () => {
    const testCases = [
      { cookie: "dark", expectedMode: true, desc: "Dark Mode" },
      { cookie: "light", expectedMode: false, desc: "Light Mode" },
      { cookie: "system", expectedMode: false, desc: "System Mode" },
      { cookie: undefined, expectedMode: false, desc: "No Cookie" },
      { cookie: "invalid-value", expectedMode: false, desc: "Invalid Cookie" },
      { cookie: "empty-value", expectedMode: false, desc: "Empty Cookie" },
    ];

    for (const { cookie, expectedMode, desc } of testCases) {
      it(`should correctly handle ${desc}`, async () => {
        const event = createMockEvent("/", cookie);
        await handleTheme({ event, resolve: mockResolve });
        expect(event.locals.darkMode).toBe(expectedMode);
      });
    }
  });

  describe("Server-Side Rendering (SSR) Injection", () => {
    it('should inject "dark" class into HTML when theme is dark', async () => {
      const event = createMockEvent("/", "dark");
      const response = await handleTheme({ event, resolve: mockResolve });
      const html = await response.text();

      expect(html).toMatch(DARK_CLASS_REGEX);
      expect(html).toContain('class="dark"');
    });

    it('should NOT inject "dark" class when theme is light', async () => {
      const event = createMockEvent("/", "light");
      const response = await handleTheme({ event, resolve: mockResolve });
      const html = await response.text();

      expect(html).not.toContain('class="dark"');
    });

    it("should preserve HTML structure (avoid double tags)", async () => {
      const event = createMockEvent("/", "dark");
      const response = await handleTheme({ event, resolve: mockResolve });
      const html = await response.text();

      const htmlTagCount = (html.match(/<html/g) || []).length;
      expect(htmlTagCount).toBe(1);
      expect(html).toContain('lang="en"');
    });
  });

  describe("Theme Manager Integration", () => {
    it("should attempt to load custom theme when initialized", async () => {
      const event = createMockEvent("/", "light");
      await handleTheme({ event, resolve: mockResolve });

      expect((globalThis as any).__mockThemeManager.isInitialized).toHaveBeenCalled();
      expect((globalThis as any).__mockThemeManager.getTheme).toHaveBeenCalled();
    });

    it("should skip theme loading when NOT initialized", async () => {
      (globalThis as any).__mockThemeManager.isInitialized.mockReturnValue(false);

      const event = createMockEvent("/", "light");
      await handleTheme({ event, resolve: mockResolve });

      expect((globalThis as any).__mockThemeManager.isInitialized).toHaveBeenCalled();
      expect((globalThis as any).__mockThemeManager.getTheme).not.toHaveBeenCalled();
      expect(event.locals.theme).toBeNull();
    });
  });

  describe("Edge Cases & Security", () => {
    it("should ignore non-HTML responses (e.g. JSON API)", async () => {
      const event = createMockEvent("/api/data", "dark");
      mockResolve = vi.fn(() => Response.json({ data: 1 }));

      const response = await handleTheme({ event, resolve: mockResolve });
      const text = await response.text();

      expect(text).not.toContain('class="dark"');
      expect(JSON.parse(text)).toEqual({ data: 1 });
    });

    it("should sanitize extremely long cookies", async () => {
      const longCookie = "dark".padEnd(1000, "x");
      const event = createMockEvent("/", longCookie);

      await handleTheme({ event, resolve: mockResolve });
      expect(event.locals.darkMode).toBe(false);
    });

    it("should handle XSS attempts in cookie gracefully", async () => {
      const event = createMockEvent("/", "dark<script>alert(1)</script>");
      await handleTheme({ event, resolve: mockResolve });

      expect(event.locals.darkMode).toBe(false);
    });
  });
});
