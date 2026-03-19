/**
 * @file src\hooks\handle-rate-limit.ts
 * @description Middleware for rate limiting to prevent abuse and DoS attacks with clustered deployment support
 *
 * ### Rate Limiting Strategy
 * - **General Routes**: 500 requests/minute per IP, IP+UA, and cookie
 * - **API Routes**: 500 requests/minute per IP, 200 requests/minute per IP+UA (stricter)
 * - **Exemptions**: Localhost, build process, static assets
 *
 * ### Multi-Layer Protection
 * 1. **IP-based**: Prevents basic abuse from single source
 * 2. **IP + User-Agent**: Prevents abuse from same IP with multiple UAs
 * 3. **Cookie-based**: Signed cookie tracking for additional security
 * 4. **Distributed Store**: Redis/Database backend for clustered deployments
 *
 * ### Clustered Deployment Support
 * - Automatically uses Redis if available via CacheService
 * - Falls back to in-memory for single-instance deployments
 * - Shared rate limiting across all instances in load-balanced environments
 *
 * ### Behavior
 * - Returns 429 "Too Many Requests" when limits exceeded
 * - Logs violations with IP and endpoint for monitoring
 * - Exempt routes bypass all checks for performance
 *
 * ### Prerequisites
 * - handleSystemState confirmed system is READY
 * - JWT_SECRET_KEY is configured for cookie signing
 * - CacheService configured with Redis for distributed rate limiting
 *
 * @prerequisite System state is READY and JWT secret is available
 */

import { cacheService } from "@src/databases/cache/cache-service";
import { metricsService } from "@src/services/metrics-service";
import { getPrivateSettingSync } from "@src/services/settings-service";
import { dev } from "$app/environment";
import { error, type Handle, type RequestEvent } from "@sveltejs/kit";
import { AppError, handleApiError } from "@utils/error-handling";
import { logger } from "@utils/logger.server";
import { RateLimiter } from "sveltekit-rate-limiter/server";

// --- RATE LIMITER CONFIGURATION ---

/**
 * Factory that creates an isolated distributed store with its own namespace prefix.
 * Prevents cross-limiter key contamination (critical security fix).
 */
const createDistributedStore = (namespace: string) => ({
  async get(key: string): Promise<number | undefined> {
    try {
      const data = await cacheService.get<{ count: number; expires: number }>(
        `ratelimit:${namespace}:${key}`,
      );
      if (data && data.expires > Date.now()) {
        return data.count;
      }
      return undefined;
    } catch (err) {
      logger.warn(
        `Rate limit GET failed [${namespace}]: ${err instanceof Error ? err.message : String(err)}`,
      );
      return undefined;
    }
  },

  async has(key: string): Promise<boolean> {
    return (await this.get(key)) !== undefined;
  },

  async add(key: string, ttlSeconds: number): Promise<number> {
    // Delegate to increment to avoid race condition between has() → set()
    return this.increment(key, ttlSeconds);
  },

  async increment(key: string, ttlSeconds: number): Promise<number> {
    try {
      const existing = (await this.get(key)) ?? 0;
      const newCount = existing + 1;
      const expires = Date.now() + ttlSeconds * 1000;

      await cacheService.set(
        `ratelimit:${namespace}:${key}`,
        { count: newCount, expires },
        ttlSeconds,
      );
      return newCount;
    } catch (err) {
      logger.error(
        `Rate limit INCREMENT failed [${namespace}]: ${err instanceof Error ? err.message : String(err)}`,
      );
      return 1; // Fail open – better than blocking legitimate traffic
    }
  },

  async clear(): Promise<void> {
    try {
      await cacheService.delete(`ratelimit:${namespace}:*`);
    } catch (err) {
      logger.error(
        `Rate limit CLEAR failed [${namespace}]: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },
});

/** General limiter – non-API routes */
const generalLimiter = new RateLimiter({
  IP: [500, "m"],
  IPUA: [500, "m"],
  cookie: {
    name: "ratelimit",
    secret: getPrivateSettingSync("JWT_SECRET_KEY") || "fallback-dev-secret",
    rate: [500, "m"],
    preflight: true,
  },
  store: cacheService ? createDistributedStore("general") : undefined,
});

/** API limiter – stricter on IP+UA */
const apiLimiter = new RateLimiter({
  IP: [500, "m"],
  IPUA: [200, "m"],
  store: cacheService ? createDistributedStore("api") : undefined,
});

/** Auth limiter – brute-force protection */
const authLimiter = new RateLimiter({
  IP: [10, "m"],
  IPUA: [5, "m"],
  store: cacheService ? createDistributedStore("auth") : undefined,
});

// --- UTILITY FUNCTIONS ---

function getClientIp(event: RequestEvent): string {
  try {
    const address = event.getClientAddress();
    if (address) {
      return address;
    }
  } catch {}

  const forwarded = event.request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }

  const realIp = event.request.headers.get("x-real-ip");
  if (realIp) {
    return realIp;
  }

  return "127.0.0.1";
}

function isLocalhost(ip: string): boolean {
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

const STATIC_EXTENSIONS = /\.(js|css|map|woff2?|ttf|eot|svg|png|jpg|jpeg|gif|webp|ico)$/;

function isStaticAsset(pathname: string): boolean {
  return (
    pathname.startsWith("/static/") ||
    pathname.startsWith("/_app/") ||
    pathname === "/favicon.ico" ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml" ||
    STATIC_EXTENSIONS.test(pathname)
  );
}

// --- MAIN HOOK ---

export const handleRateLimit: Handle = async ({ event, resolve }) => {
  const { url } = event;
  const clientIp = getClientIp(event);
  const isLocal = isLocalhost(clientIp);

  const isUnitTesting = !!(
    process.env.VITEST ||
    process.env.BUN_TEST ||
    process.env.NODE_ENV === "test"
  );
  const isIntegrationTestServer = process.env.TEST_MODE === "true" && !isUnitTesting;
  const forceSecurity = event.request.headers.get("x-test-security") === "true";

  if (isLocal && !forceSecurity && (dev || isIntegrationTestServer)) {
    return await resolve(event);
  }

  if (isStaticAsset(url.pathname)) {
    return await resolve(event);
  }

  try {
    let limiter = generalLimiter;

    if (url.pathname.startsWith("/api/auth") || url.pathname === "/api/user/login") {
      limiter = authLimiter;
    } else if (url.pathname.startsWith("/api/")) {
      limiter = apiLimiter;
    }

    // Relax for setup wizard
    if (url.pathname.startsWith("/setup") || url.pathname.includes("setup")) {
      return await resolve(event);
    }

    if (await limiter.isLimited(event)) {
      metricsService.incrementRateLimitViolations();

      logger.warn(
        `Rate limit exceeded | IP: ${clientIp} | Path: ${url.pathname} | UA: ${event.request.headers.get("user-agent")?.substring(0, 50) || "unknown"}`,
      );

      throw new AppError(
        "Too Many Requests. Please slow down and try again later.",
        429,
        "RATE_LIMIT_EXCEEDED",
      );
    }

    return await resolve(event);
  } catch (err) {
    if (url.pathname.startsWith("/api/")) {
      return handleApiError(err, event);
    }

    if (err instanceof AppError) {
      throw error(err.status, err.message);
    }

    throw err;
  }
};
