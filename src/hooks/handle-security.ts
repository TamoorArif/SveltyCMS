/**
 * @file src/hooks/handle-security.ts
 * @description Unified security middleware consolidating firewall, rate limiting, and payload analysis.
 */

import { dev } from "$app/environment";
import { metricsService } from "@src/services/metrics-service";
import { securityResponseService } from "@src/services/security-response-service";
import { error, type Handle, type RequestEvent } from "@sveltejs/kit";
import { AppError, handleApiError } from "@utils/error-handling";
import { logger } from "@utils/logger.server";

/**
 * Consolidated security hook that performs:
 * 1. Rate Limiting
 * 2. Payload Analysis (SQLi, XSS, etc.)
 * 3. Bot Detection
 * 4. CSRF Protection
 */
export const handleSecurity: Handle = async ({ event, resolve }) => {
  const { request, url } = event;
  const clientIp = getClientIp(event);

  // Skip for static assets and dev mode localhost (unless forced)
  if (
    isStaticAsset(url.pathname) ||
    (isLocalhost(clientIp) && dev && request.headers.get("x-test-security") !== "true")
  ) {
    return await resolve(event);
  }

  try {
    // 1. Analyze request for threats (Firewall + Payload Scan)
    const securityStatus = await securityResponseService.analyzeRequest(request, clientIp);

    if (securityStatus.action === "block") {
      metricsService.incrementSecurityViolations();
      logger.warn(`Security block triggered: ${securityStatus.reason}`, {
        ip: clientIp,
        url: url.pathname,
      });
      throw new AppError(securityStatus.reason || "Forbidden", 403, "SECURITY_BLOCK");
    }

    // 2. Additional Rate Limiting Check (if not already handled by analyzeRequest)
    const rateLimit = await securityResponseService.checkRateLimit(clientIp, url.pathname);
    if (!rateLimit.allowed) {
      metricsService.incrementRateLimitViolations();
      logger.warn(`Rate limit exceeded: ${clientIp}`, { url: url.pathname });
      throw new AppError("Too Many Requests", 429, "RATE_LIMIT_EXCEEDED");
    }

    // 3. Request passed security checks
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

function getClientIp(event: RequestEvent): string {
  try {
    return event.getClientAddress();
  } catch {
    return (
      event.request.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
      event.request.headers.get("x-real-ip") ||
      "127.0.0.1"
    );
  }
}

function isLocalhost(ip: string): boolean {
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

const STATIC_EXTENSIONS = /\.(js|css|map|woff2?|ttf|eot|svg|png|jpg|jpeg|gif|webp|ico)$/;
function isStaticAsset(pathname: string): boolean {
  return (
    pathname.startsWith("/static/") ||
    pathname.startsWith("/_app/") ||
    STATIC_EXTENSIONS.test(pathname)
  );
}
