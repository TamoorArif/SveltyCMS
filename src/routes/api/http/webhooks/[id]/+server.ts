/**
 * @file src/routes/api/http/webhooks/[id]/+server.ts
 * @description Handles DELETE and PATCH requests for a specific webhook with IDOR protection.
 */

import { webhookService } from "@src/services/webhook-service";
import { json } from "@sveltejs/kit";
import { apiHandler } from "@utils/api-handler";
import { AppError } from "@utils/error-handling";
import { logger } from "@utils/logger.server";

// DELETE: Remove a webhook
export const DELETE = apiHandler(async ({ params, locals }) => {
  const userRole = locals.user?.role;
  const isSuperAdmin = userRole === "super-admin";
  const isAdmin = userRole === "admin" || isSuperAdmin;

  if (!locals.user || (!isAdmin && !isSuperAdmin)) {
    throw new AppError("Unauthorized", 403, "FORBIDDEN");
  }

  const { id } = params;
  if (!id) {
    throw new AppError("Missing ID", 400, "MISSING_ID");
  }

  try {
    // SECURITY: Verify ownership before deletion (IDOR protection)
    const currentTenantId = locals.tenantId || "";
    const webhooks = await webhookService.getWebhooks(currentTenantId);
    const exists = webhooks.some((w) => w.id === id);

    if (!exists) {
      logger.warn(
        `Unauthorized webhook delete attempt for ID ${id} by user ${locals.user._id} in tenant ${locals.tenantId}`,
      );
      throw new AppError("Webhook not found or access denied", 404, "NOT_FOUND");
    }

    await webhookService.deleteWebhook(id, currentTenantId);
    logger.info(`Webhook deleted: ${id} for tenant ${locals.tenantId} by ${locals.user.email}`);

    return json({ success: true });
  } catch (error) {
    logger.error(`Failed to delete webhook ${id} for tenant ${locals.tenantId}:`, error);
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError("Internal Server Error", 500, "WEBHOOK_DELETE_FAILED");
  }
});

// PATCH: Update a webhook
export const PATCH = apiHandler(async ({ params, request, locals }) => {
  const userRole = locals.user?.role;
  const isSuperAdmin = userRole === "super-admin";
  const isAdmin = userRole === "admin" || isSuperAdmin;

  if (!locals.user || (!isAdmin && !isSuperAdmin)) {
    throw new AppError("Unauthorized", 403, "FORBIDDEN");
  }

  const { id } = params;
  if (!id) {
    throw new AppError("Missing ID", 400, "MISSING_ID");
  }

  try {
    // SECURITY: Verify ownership before update (IDOR protection)
    const currentTenantId = locals.tenantId || "";
    const webhooks = await webhookService.getWebhooks(currentTenantId);
    const exists = webhooks.some((w) => w.id === id);

    if (!exists) {
      logger.warn(
        `Unauthorized webhook update attempt for ID ${id} by user ${locals.user._id} in tenant ${locals.tenantId}`,
      );
      throw new AppError("Webhook not found or access denied", 404, "NOT_FOUND");
    }

    const updates = await request.json();

    // Ensure we don't accidentally move to another ID or tenant via payload
    const webhook = await webhookService.saveWebhook({ ...updates, id }, currentTenantId);

    logger.info(
      `Webhook updated: ${webhook.name} (${id}) for tenant ${locals.tenantId} by ${locals.user.email}`,
    );

    return json({ success: true, data: webhook });
  } catch (error) {
    logger.error(`Failed to update webhook ${id} for tenant ${locals.tenantId}:`, error);
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError("Internal Server Error", 500, "WEBHOOK_UPDATE_FAILED");
  }
});
