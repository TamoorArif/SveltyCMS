/**
 * @file src/routes/api/webhooks/[id]/test/+server.ts
 * @description Manual trigger for testing webhook connectivity with IDOR protection.
 */

import { webhookService } from "@src/services/webhook-service";
import { json } from "@sveltejs/kit";
import { apiHandler } from "@utils/api-handler";
import { AppError } from "@utils/error-handling";
import { logger } from "@utils/logger.server";

export const POST = apiHandler(async ({ params, locals }) => {
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
    // SECURITY: Verify ownership before testing (IDOR protection)
    const currentTenantId = locals.tenantId || "";
    const webhooks = await webhookService.getWebhooks(currentTenantId);
    const exists = webhooks.some((w) => w.id === id);

    if (!exists) {
      logger.warn(
        `Unauthorized webhook test attempt for ID ${id} by user ${locals.user._id} in tenant ${locals.tenantId}`,
      );
      throw new AppError("Webhook not found or access denied", 404, "NOT_FOUND");
    }

    await webhookService.testWebhook(id, locals.user.email, currentTenantId);
    return json({ success: true, message: "Test event dispatched" });
  } catch (error) {
    logger.error(`Failed to test webhook ${id} for tenant ${locals.tenantId}:`, error);
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError(
      error instanceof Error ? error.message : "Webhook test failed",
      500,
      "WEBHOOK_TEST_FAILED",
    );
  }
});
