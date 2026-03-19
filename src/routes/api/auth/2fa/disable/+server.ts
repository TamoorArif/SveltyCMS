/**
 * @file src/routes/api/auth/2fa/disable/+server.ts
 * @description
 * API endpoint for disabling Two-Factor Authentication.
 * Deactivates 2FA and clears security secrets, requiring
 * manual re-authentication before sensitive changes.
 *
 * features:
 * - 2FA deactivation logic
 * - account security state transition
 * - tenant-aware session monitoring
 * - audit logging for security changes
 */

import { auth } from "@databases/db";
import { verifyPassword } from "@src/databases/auth";
import { getDefaultTwoFactorAuthService } from "@src/databases/auth/two-factor-auth";
import { json } from "@sveltejs/kit";
// Unified Error Handling
import { apiHandler } from "@utils/api-handler";
import { AppError } from "@utils/error-handling";
import { logger } from "@utils/logger.server";
import { requireTenantContext } from "@utils/tenant-utils";
import { object, parse, string } from "valibot";

// Request body schema
const disableSchema = object({
  password: string("Password is required for verification"),
});

export const POST = apiHandler(async ({ request, locals }) => {
  // Ensure user is authenticated
  if (!locals.user) {
    logger.warn("Unauthorized 2FA disable attempt");
    throw new AppError("Authentication required", 401, "UNAUTHORIZED");
  }

  const user = locals.user;

  // Resolve tenantId using shared utility
  const tenantId = requireTenantContext(locals, "2FA deactivation");

  // Parse and validate request body
  const body = await request.json().catch(() => {
    throw new AppError("Invalid JSON", 400, "INVALID_JSON");
  });
  const validatedBody = parse(disableSchema, body);

  // Security Check: Verify password before disabling 2FA
  if (!user.password) {
    logger.error("2FA disable failed: User has no password set", { userId: user._id });
    throw new AppError(
      "Authentication method not supported for 2FA management",
      400,
      "AUTH_METHOD_NOT_SUPPORTED",
    );
  }

  const isPasswordValid = await verifyPassword(validatedBody.password, user.password);
  if (!isPasswordValid) {
    logger.warn("2FA disable failed: Incorrect password", { userId: user._id, tenantId });
    throw new AppError("Incorrect password. Please try again.", 401, "INVALID_PASSWORD");
  }

  // Check if 2FA is enabled
  if (!user.is2FAEnabled) {
    logger.warn("2FA disable attempted for user without 2FA enabled", {
      userId: user._id,
      tenantId,
    });
    throw new AppError("2FA is not enabled for this account", 400, "2FA_DISABLED");
  }

  // Disable 2FA
  if (!auth) {
    logger.error("Auth service not initialized during 2FA disable request");
    throw new AppError("Auth service not available", 500, "DB_AUTH_MISSING");
  }
  const twoFactorService = getDefaultTwoFactorAuthService(auth.authInterface);
  const success = await twoFactorService.disable2FA(user._id, tenantId);

  if (!success) {
    logger.error("Failed to disable 2FA", { userId: user._id, tenantId });
    throw new AppError("Failed to disable 2FA", 500, "2FA_DISABLE_FAILED");
  }

  logger.info("2FA disabled successfully", { userId: user._id, tenantId });

  return json({
    success: true,
    message: "2FA has been disabled for your account.",
  });
});
