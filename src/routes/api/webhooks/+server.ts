/**
 * @file src/routes/api/webhooks/+server.ts
 * @description Handles GET (list) and POST (create) requests for webhooks with strict tenant isolation.
 */

import { webhookService } from "@src/services/webhook-service";
import { json } from "@sveltejs/kit";
import { apiHandler } from "@utils/api-handler";
import { AppError } from "@utils/error-handling";
import { logger } from "@utils/logger.server";

// GET: List all webhooks for a tenant
export const GET = apiHandler(async ({ locals, url }) => {
  const userRole = locals.user?.role;
  const isSuperAdmin = userRole === "super-admin";
  const isAdmin = userRole === "admin" || isSuperAdmin;

  if (!locals.user || (!isAdmin && !isSuperAdmin)) {
    throw new AppError("Unauthorized", 403, "FORBIDDEN");
  }

  const tenantIdFromLocals = locals.tenantId || "";
  const targetTenantId = url.searchParams.get("tenantId") || tenantIdFromLocals;

  // SECURITY: Prevent IDOR (Insecure Direct Object Reference)
  // Only super-admins can override tenantId
  if (targetTenantId !== tenantIdFromLocals && !isSuperAdmin) {
    logger.warn(`Unauthorized webhook tenant override attempt by user ${locals.user?._id}`, {
      userId: locals.user?._id,
      tenantId: locals.tenantId,
      targetTenantId,
    });
    throw new AppError(
      "Unauthorized: You can only access webhooks for your own tenant.",
      403,
      "TENANT_MISMATCH",
    );
  }

  try {
    const webhooks = await webhookService.getWebhooks(targetTenantId);
    return json({ success: true, data: webhooks });
  } catch (error) {
    logger.error(`Failed to list webhooks for tenant ${targetTenantId}:`, error);
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError("Internal Server Error", 500, "WEBHOOK_LIST_FAILED");
  }
});

// POST: Create a new webhook for a tenant
export const POST = apiHandler(async ({ request, locals }) => {
  const userRole = locals.user?.role;
  const isSuperAdmin = userRole === "super-admin";
  const isAdmin = userRole === "admin" || isSuperAdmin;

  if (!locals.user || (!isAdmin && !isSuperAdmin)) {
    throw new AppError("Unauthorized", 403, "FORBIDDEN");
  }

  try {
    const data = await request.json();

    // Basic validation
    if (!(data.url && data.events && Array.isArray(data.events))) {
      throw new AppError(
        "Invalid webhook data. URL and events array are required.",
        400,
        "INVALID_DATA",
      );
    }

    // Enforce creator's tenantId
    const webhook = await webhookService.saveWebhook(data, locals.tenantId || "");

    logger.info(
      `Webhook created: ${webhook.name} (${webhook.id}) for tenant ${locals.tenantId} by ${locals.user.email}`,
    );

    return json({ success: true, data: webhook });
  } catch (error) {
    logger.error(`Failed to create webhook for tenant ${locals.tenantId}:`, error);
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError("Internal Server Error", 500, "WEBHOOK_CREATE_FAILED");
  }
});
