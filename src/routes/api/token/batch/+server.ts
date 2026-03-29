/**
 * @file src/routes/api/token/batch/+server.ts
 * @description Unified API endpoint for performing batch actions on tokens.
 *
 * This module provides a single endpoint to perform the following actions on one or more tokens:
 * - Delete tokens
 * - Block tokens
 * - Unblock tokens
 *
 * Each action is protected by its own specific permission and uses the corresponding
 * batch method defined in the authDBInterface for database-agnostic efficiency.
 *
 * @usage
 * POST /api/token/batch
 * @body {
 * "tokenIds": ["id1", "id2"],
 * "action": "delete"
 * }
 */

// Cache invalidation
import { cacheService } from "@src/databases/cache/cache-service";
// Auth
import { auth } from "@src/databases/db";
import { getPrivateSettingSync } from "@src/services/settings-service";
import { type HttpError, json } from "@sveltejs/kit";
// System Logger
import { logger } from "@utils/logger.server";
// Validation
import { array, object, parse, picklist, string, type ValiError } from "valibot";

const batchTokenActionSchema = object({
  tokenIds: array(string()),
  action: picklist(["delete", "block", "unblock"], "Invalid action specified."),
});

// Unified Error Handling
import { apiHandler } from "@utils/api-handler";
import { AppError } from "@utils/error-handling";

export const POST = apiHandler(async ({ request, locals }) => {
  try {
    const { user, tenantId } = locals; // Destructure user and tenantId
    const body = await request.json().catch(() => {
      throw new AppError("Invalid JSON in request body", 400, "INVALID_JSON");
    });
    const parsed = parse(batchTokenActionSchema, body);
    const { tokenIds, action } = parsed;
    if (!Array.isArray(tokenIds) || tokenIds.length === 0) {
      throw new AppError("At least one token ID is required.", 400, "MISSING_TOKEN_IDS");
    }

    if (!auth) {
      logger.error("Database authentication adapter not initialized");
      throw new AppError("Database authentication not available", 500, "DB_AUTH_ERROR");
    }

    // --- MULTI-TENANCY SECURITY CHECK ---
    if (getPrivateSettingSync("MULTI_TENANT")) {
      if (!tenantId) {
        throw new AppError(
          "Tenant could not be identified for this operation.",
          500,
          "TENANT_REQUIRED",
        );
      }
      // Batch methods filter by tenantId at DB level, so ownership is enforced there.
      // No need to pre-fetch all tokens for verification.
    }

    let successMessage = "";
    // All DB adapters (SQLite, PostgreSQL, MariaDB) now handle both _id and token
    // value matching in their batch methods, so no pre-resolution is needed.

    // Directly invoke database-agnostic methods (now bound in auth adapter)
    switch (action) {
      case "delete": {
        await auth.deleteTokens(tokenIds, tenantId || undefined);
        successMessage = "Tokens deleted successfully.";
        break;
      }
      case "block": {
        await auth.blockTokens(tokenIds, tenantId || undefined);
        successMessage = "Tokens blocked successfully.";
        break;
      }
      case "unblock": {
        await auth.unblockTokens(tokenIds, tenantId || undefined);
        successMessage = "Tokens unblocked successfully.";
        break;
      }
    }
    // Invalidate the tokens cache so changes appear immediately in admin area
    cacheService.delete("tokens", tenantId).catch((err: any) => {
      logger.warn(`Failed to invalidate tokens cache: ${err.message}`);
    });

    logger.info(`Batch token action '${action}' completed.`, {
      affectedIds: tokenIds,
      executedBy: user?._id,
      tenantId,
    });

    return json({ success: true, message: successMessage });
  } catch (err) {
    if (err instanceof AppError) {
      throw err;
    }
    if (err && typeof err === "object" && "name" in err && err.name === "ValiError") {
      const valiError = err as ValiError<typeof batchTokenActionSchema>;
      const issues = valiError.issues.map((issue) => issue.message).join(", ");
      logger.warn("Invalid input for token batch API:", { issues });
      throw new AppError(`Invalid input: ${issues}`, 400, "VALIDATION_ERROR");
    }
    const httpError = err as HttpError;
    const status = httpError.status || 500;
    const message = httpError.body?.message || "An unexpected error occurred.";
    logger.error("Error in token batch API:", {
      error: message,
      stack: err instanceof Error ? err.stack : undefined,
      userId: locals.user?._id,
      status,
    });
    throw new AppError(message, status, "BATCH_ACTION_FAILED");
  }
});
