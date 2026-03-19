/**
 * @file src/hooks/handle-content-initialization.ts
 * @description Initializes content manager per tenant + handles fresh-install redirects
 */

import { redirect, type Handle } from "@sveltejs/kit";
import { contentManager } from "@src/content/content-manager";
import { logger } from "@utils/logger.server";

export const handleContentInitialization: Handle = async ({ event, resolve }) => {
  const { locals, url } = event;
  const tenantId = locals.tenantId ?? null;

  // Initialize content system for the resolved tenant if not already ready
  // Reconciliation is handled only on server startup or forced refresh
  if (!contentManager.isInitializedForTenant(tenantId)) {
    // Set skipReconciliation to false to ensure stale DB nodes are cleaned up
    await contentManager.initialize(tenantId, false);
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
