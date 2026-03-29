/**
 * @file src/hooks/handle-content-initialization.ts
 * @description Initializes content manager per tenant + handles fresh-install redirects
 */

import { redirect, type Handle } from "@sveltejs/kit";
import { isBootstrapRoute, isSetupCompleteAsync } from "@utils/setup-check";
import { contentManager } from "@src/content";
import { logger } from "@utils/logger.server";

export const handleContentInitialization: Handle = async ({ event, resolve }) => {
  const { locals, url } = event;
  const { pathname } = url;
  const tenantId = locals.tenantId ?? null;

  // --- Phase 1: Gated Initialization ---
  // We only initialize the content system if setup is complete.
  // This prevents unnecessary background polling and warnings during installation.
  if (locals.__setupConfigExists === undefined) {
    locals.__setupConfigExists = await isSetupCompleteAsync();
  }

  if (!locals.__setupConfigExists) {
    logger.debug(
      "[handleContentInitialization] System in SETUP mode. Skipping content initialization.",
    );
    return await resolve(event);
  }

  // Initialize content system for the resolved tenant if not already ready
  if (!contentManager.isInitializedForTenant(tenantId)) {
    // Set skipReconciliation to false to ensure stale DB nodes are cleaned up
    const initPromise = contentManager.initialize(tenantId, false);

    // 🚀 OPTIMIZATION: Don't block the first byte for bootstrap page requests!
    // However, the root path '/' requires collections to be loaded to determine
    // the correct redirect for authenticated users, so we must await it.
    if (isBootstrapRoute(pathname) && pathname !== "/") {
      logger.debug(`[handleContentInitialization] Fast-tracking bootstrap page: ${pathname}`);
    } else {
      await initPromise;
    }
  }

  // FRESH INSTALL: If no collections exist, redirect authenticated users to builder or dashboard
  if (locals.user) {
    const pathname = url.pathname;
    const isApi = pathname.startsWith("/api");
    const isConfig = pathname.startsWith("/config");
    const isUser = pathname.startsWith("/user");
    const isDashboard = pathname.startsWith("/dashboard");
    const isLogin = pathname.includes("/login");

    if (!isApi && !isConfig && !isUser && !isDashboard && !isLogin) {
      const collections = contentManager.getCollections(tenantId);
      if (collections.length === 0) {
        // Admins go to collection builder, others to dashboard
        if (locals.isAdmin) {
          logger.info(
            `[handleContentInitialization] No collections found for tenant: ${tenantId}. Redirecting Admin to builder.`,
          );
          throw redirect(302, "/config/collectionbuilder");
        }
        if (pathname !== "/dashboard") {
          logger.info(
            `[handleContentInitialization] No collections found for tenant: ${tenantId}. Redirecting to dashboard.`,
          );
          throw redirect(302, "/dashboard");
        }
      }
    }

    // Root -> first collection (when collections exist)
    if (pathname === "/") {
      const lang = locals.language || "en";
      const firstUrl = await contentManager.getFirstCollectionRedirectUrl(lang, tenantId);
      if (firstUrl) {
        logger.info(`[handleContentInitialization] Root -> first collection: ${firstUrl}`);
        throw redirect(302, firstUrl);
      }
    }
  }

  return resolve(event);
};
