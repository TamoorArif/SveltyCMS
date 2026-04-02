/**
 * @file src/services/metrics-service.ts
 * @description Unified metrics service for all middleware hooks
 *
 * ### Features
 * - Centralized metrics collection for all hooks
 * - High-performance counters with minimal overhead
 * - Automatic metric aggregation and reporting
 * - Thread-safe operations with atomic updates
 * - Memory-efficient with automatic cleanup
 * - Prometheus-style metrics export
 *
 * ### Categories
 * - **Requests**: Total requests, errors, response times
 * - **Auth**: Session validations, failures, cache hits/misses
 * - **API**: API requests, cache performance, rate limiting
 * - **Performance**: Hook execution times, bottlenecks
 * - **Security**: CSP violations, rate limit violations, auth failures
 *
 * @enterprise Optimized for high-throughput production environments
 */

import { logger } from "@utils/logger.server";

// Detect build mode without $app/environment dependency (allows testing outside SvelteKit)
const isBuilding =
  typeof globalThis !== "undefined" && (globalThis as any).process?.env?.BUILDING === "true";

// --- TYPES ---

export interface MetricSnapshot {
  category: string;
  labels?: Record<string, string>;
  name: string;
  timestamp: number;
  value: number;
}

export interface MetricsReport {
  api: {
    requests: number;
    errors: number;
    cacheHits: number;
    cacheMisses: number;
    cacheHitRate: number;
  };
  authentication: {
    validations: number;
    failures: number;
    successRate: number;
    cacheHits: number;
    cacheMisses: number;
    cacheHitRate: number;
  };
  performance: {
    slowRequests: number;
    avgHookExecutionTime: number;
    bottlenecks: string[];
  };
  requests: {
    total: number;
    errors: number;
    errorRate: number;
    avgResponseTime: number;
  };
  security: {
    rateLimitViolations: number;
    cspViolations: number;
    authFailures: number;
  };
  timestamp: number;
  uptime: number;
}

// --- METRICS COUNTERS ---

/**
 * High-performance atomic counters for metrics collection.
 * Using simple objects for maximum performance in V8.
 */
class MetricsCounters {
  // Request metrics
  requests = { total: 0, errors: 0, totalResponseTime: 0 };

  // Authentication metrics
  auth = {
    validations: 0,
    failures: 0,
    cacheHits: 0,
    cacheMisses: 0,
  };

  // API metrics
  api = {
    requests: 0,
    errors: 0,
    cacheHits: 0,
    cacheMisses: 0,
  };

  // Security metrics
  security = {
    rateLimitViolations: 0,
    cspViolations: 0,
    authFailures: 0,
  };

  // Performance metrics
  performance = {
    slowRequests: 0,
    totalHookTime: 0,
    hookExecutions: 0,
    bottlenecks: new Map<string, number>(),
  };

  // Metadata
  lastReset = Date.now();
  startTime = Date.now();
}

// --- METRICS SERVICE ---

/**
 * Singleton metrics service for enterprise-grade performance monitoring.
 * Thread-safe and optimized for minimal overhead.
 */
class MetricsService {
  private globalCounters = new MetricsCounters();
  private tenantCounters = new Map<string, MetricsCounters>();
  private resetInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Auto-reset metrics every hour to prevent memory growth
    if (!isBuilding) {
      this.resetInterval = setInterval(
        () => {
          this.reset();
        },
        60 * 60 * 1000,
      );
    }
  }

  /**
   * Gets the appropriate counters for a tenant.
   */
  private getCounters(tenantId?: string): MetricsCounters {
    if (!tenantId || tenantId === "global") {
      return this.globalCounters;
    }
    let counters = this.tenantCounters.get(tenantId);
    if (!counters) {
      counters = new MetricsCounters();
      this.tenantCounters.set(tenantId, counters);
    }
    return counters;
  }

  // --- REQUEST METRICS ---

  /**
   * Increment total request counter.
   * Call this at the start of request processing.
   */
  incrementRequests(tenantId?: string): void {
    this.getCounters(tenantId).requests.total++;
  }

  /**
   * Increment error counter.
   * Call this when a request results in an error.
   */
  incrementErrors(tenantId?: string): void {
    this.getCounters(tenantId).requests.errors++;
  }

  /**
   * Record response time for performance analysis.
   * @param timeMs - Response time in milliseconds
   */
  recordResponseTime(timeMs: number, tenantId?: string): void {
    const counters = this.getCounters(tenantId);
    counters.requests.totalResponseTime += timeMs;

    // Track slow requests (>2 seconds)
    if (timeMs > 2000) {
      counters.performance.slowRequests++;
    }
  }

  // --- AUTHENTICATION METRICS ---

  /**
   * Increment authentication validation counter.
   * Call this for each session validation attempt.
   */
  incrementAuthValidations(tenantId?: string): void {
    this.getCounters(tenantId).auth.validations++;
  }

  /**
   * Increment authentication failure counter.
   * Call this when session validation fails.
   */
  incrementAuthFailures(tenantId?: string): void {
    const counters = this.getCounters(tenantId);
    counters.auth.failures++;
    counters.security.authFailures++;
  }

  /**
   * Record authentication cache hit.
   * Call this when session is found in cache.
   */
  recordAuthCacheHit(tenantId?: string): void {
    this.getCounters(tenantId).auth.cacheHits++;
  }

  /**
   * Record authentication cache miss.
   * Call this when session must be fetched from database.
   */
  recordAuthCacheMiss(tenantId?: string): void {
    this.getCounters(tenantId).auth.cacheMisses++;
  }

  // --- API METRICS ---

  /**
   * Increment API request counter.
   * Call this for each API request processed.
   */
  incrementApiRequests(tenantId?: string): void {
    this.getCounters(tenantId).api.requests++;
  }

  /**
   * Increment API error counter.
   * Call this when an API request fails.
   */
  incrementApiErrors(tenantId?: string): void {
    this.getCounters(tenantId).api.errors++;
  }

  /**
   * Record API cache hit.
   * Call this when API response is served from cache.
   */
  recordApiCacheHit(tenantId?: string): void {
    this.getCounters(tenantId).api.cacheHits++;
  }

  /**
   * Record API cache miss.
   * Call this when API response must be generated.
   */
  recordApiCacheMiss(tenantId?: string): void {
    this.getCounters(tenantId).api.cacheMisses++;
  }

  // --- SECURITY METRICS ---

  /**
   * Increment rate limit violation counter.
   * Call this when a request is rate limited.
   */
  incrementRateLimitViolations(tenantId?: string): void {
    this.getCounters(tenantId).security.rateLimitViolations++;
  }

  /**
   * Increment CSP violation counter.
   * Call this when a CSP violation is detected.
   */
  incrementCSPViolations(tenantId?: string): void {
    this.getCounters(tenantId).security.cspViolations++;
  }

  /**
   * Increment security violations counter.
   */
  incrementSecurityViolations(tenantId?: string): void {
    this.getCounters(tenantId).security.cspViolations++; // Using CSP counter for now, can be extended
  }

  // --- PERFORMANCE METRICS ---

  /**
   * Record hook execution time for performance analysis.
   * @param hookName - Name of the hook
   * @param timeMs - Execution time in milliseconds
   */
  recordHookExecutionTime(hookName: string, timeMs: number, tenantId?: string): void {
    const counters = this.getCounters(tenantId);
    counters.performance.totalHookTime += timeMs;
    counters.performance.hookExecutions++;

    // Track potential bottlenecks (hooks taking >100ms)
    if (timeMs > 100) {
      const current = counters.performance.bottlenecks.get(hookName) || 0;
      counters.performance.bottlenecks.set(hookName, current + 1);
    }
  }

  /**
   * Generic method to record any metric.
   * Maps specific names to their corresponding counters.
   */
  recordMetric(name: string, value: number, tenantId?: string): void {
    const counters = this.getCounters(tenantId);
    switch (name) {
      case "sdk:init":
        counters.api.requests += value;
        break;
      case "sdk:transaction:duration":
        counters.performance.totalHookTime += value;
        counters.performance.hookExecutions++;
        break;
      case "sdk:transaction:error":
        counters.api.errors += value;
        break;
      default:
        // Log unmapped metrics for future extension
        logger.trace(`Generic metric recorded: ${name} = ${value}`);
    }
  }

  // --- REPORTING ---

  // Generate a comprehensive metrics report
  getReport(tenantId?: string): MetricsReport {
    const counters = this.getCounters(tenantId);
    const now = Date.now();
    const uptime = now - (tenantId ? counters.startTime : this.globalCounters.startTime);

    // Calculate rates with safe division
    const safeRate = (numerator: number, denominator: number): number =>
      denominator > 0 ? (numerator / denominator) * 100 : 0;

    const avgResponseTime =
      counters.requests.total > 0
        ? counters.requests.totalResponseTime / counters.requests.total
        : 0;

    const avgHookTime =
      counters.performance.hookExecutions > 0
        ? counters.performance.totalHookTime / counters.performance.hookExecutions
        : 0;

    // Get top bottlenecks
    const bottlenecks = Array.from(counters.performance.bottlenecks.entries())
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([name]) => name);

    return {
      timestamp: now,
      uptime,
      requests: {
        total: counters.requests.total,
        errors: counters.requests.errors,
        errorRate: safeRate(counters.requests.errors, counters.requests.total),
        avgResponseTime,
      },
      authentication: {
        validations: counters.auth.validations,
        failures: counters.auth.failures,
        successRate: safeRate(
          counters.auth.validations - counters.auth.failures,
          counters.auth.validations,
        ),
        cacheHits: counters.auth.cacheHits,
        cacheMisses: counters.auth.cacheMisses,
        cacheHitRate: safeRate(
          counters.auth.cacheHits,
          counters.auth.cacheHits + counters.auth.cacheMisses,
        ),
      },
      api: {
        requests: counters.api.requests,
        errors: counters.api.errors,
        cacheHits: counters.api.cacheHits,
        cacheMisses: counters.api.cacheMisses,
        cacheHitRate: safeRate(
          counters.api.cacheHits,
          counters.api.cacheHits + counters.api.cacheMisses,
        ),
      },
      security: {
        rateLimitViolations: counters.security.rateLimitViolations,
        cspViolations: counters.security.cspViolations,
        authFailures: counters.security.authFailures,
      },
      performance: {
        slowRequests: counters.performance.slowRequests,
        avgHookExecutionTime: avgHookTime,
        bottlenecks,
      },
    };
  }

  // Reset all metrics counters periodically to prevent memory growth
  reset(): void {
    this.globalCounters = new MetricsCounters();
    this.tenantCounters.clear();
    logger.trace("Unified metrics reset");
  }

  // Export metrics in Prometheus format for monitoring systems
  exportPrometheus(): string {
    const report = this.getReport();
    const lines: string[] = [];

    // Global metrics (using globalCounters for raw counts)
    lines.push("# HELP svelty_requests_total Total number of requests (global)");
    lines.push("# TYPE svelty_requests_total counter");
    lines.push(`svelty_requests_total ${this.globalCounters.requests.total}`);

    lines.push("# HELP svelty_requests_errors_total Total number of request errors (global)");
    lines.push("# TYPE svelty_requests_errors_total counter");
    lines.push(`svelty_requests_errors_total ${this.globalCounters.requests.errors}`);

    // Authentication metrics
    lines.push("# HELP svelty_auth_cache_hit_rate Authentication cache hit rate");
    lines.push("# TYPE svelty_auth_cache_hit_rate gauge");
    lines.push(`svelty_auth_cache_hit_rate ${report.authentication.cacheHitRate / 100}`);

    // API metrics
    lines.push("# HELP svelty_api_cache_hit_rate API cache hit rate");
    lines.push("# TYPE svelty_api_cache_hit_rate gauge");
    lines.push(`svelty_api_cache_hit_rate ${report.api.cacheHitRate / 100}`);

    // Security metrics
    lines.push("# HELP svelty_security_violations_total Total security violations");
    lines.push("# TYPE svelty_security_violations_total counter");
    lines.push(
      `svelty_security_violations_total{type="rate_limit"} ${report.security.rateLimitViolations}`,
    );
    lines.push(`svelty_security_violations_total{type="csp"} ${report.security.cspViolations}`);

    return `${lines.join("\n")}\n`;
  }

  // Cleanup resources when shutting down
  destroy(): void {
    if (this.resetInterval) {
      clearInterval(this.resetInterval);
      this.resetInterval = null;
    }
  }
}

// --- SINGLETON INSTANCE ---

/**
 * Global metrics service instance.
 * Use this throughout the application for consistent metrics collection.
 */
const globalWithMetrics = globalThis as typeof globalThis & {
  __SVELTY_METRICS_INSTANCE__?: MetricsService;
  __SVELTY_PROCESS_CLEANUP_REGISTERED__?: boolean;
};

export const metricsService = (() => {
  if (!globalWithMetrics.__SVELTY_METRICS_INSTANCE__) {
    globalWithMetrics.__SVELTY_METRICS_INSTANCE__ = new MetricsService();
  }
  return globalWithMetrics.__SVELTY_METRICS_INSTANCE__;
})();

/**
 * Cleanup function for graceful shutdown.
 * Call this when the application is shutting down.
 */
export const cleanupMetrics = (): void => {
  metricsService.destroy();
};

// Cleanup on process exit
if (!(isBuilding || globalWithMetrics.__SVELTY_PROCESS_CLEANUP_REGISTERED__)) {
  process.on("SIGTERM", cleanupMetrics);
  process.on("SIGINT", cleanupMetrics);
  globalWithMetrics.__SVELTY_PROCESS_CLEANUP_REGISTERED__ = true;
}
