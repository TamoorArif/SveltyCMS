/**
 * @file src/routes/api/http/tokenBuilder/resolve/+server.ts
 * @description Resolve tokens in a given string with tenant isolation.
 */

import { processTokensInResponse } from "@src/services/token/helper";
import { json } from "@sveltejs/kit";
import { apiHandler } from "@utils/api-handler";
import { AppError } from "@utils/error-handling";
import { getPrivateSettingSync } from "@src/services/settings-service";
import { logger } from "@utils/logger.server";

export const POST = apiHandler(async ({ request, locals }) => {
  const { user, tenantId } = locals;
  const locale = (locals as any).locale || "en";

  if (!user) {
    throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
  }

  if (getPrivateSettingSync("MULTI_TENANT") && !tenantId) {
    throw new AppError("Tenant ID required", 400, "TENANT_REQUIRED");
  }

  try {
    const { text } = await request.json();

    if (!text) {
      throw new AppError("Text is required", 400, "INVALID_DATA");
    }

    // ✨ ISOLATION: Explicitly pass tenantId to the processing context
    const resolved = await processTokensInResponse(text, user ?? undefined, locale, {
      tenantId,
    });

    return json({ resolved });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error(`Failed to resolve tokens for tenant ${tenantId}:`, error);
    throw new AppError("Failed to resolve tokens", 400, "TOKEN_RESOLUTION_FAILED", {
      originalError: message,
    });
  }
});
