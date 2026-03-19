/**
 * @file src/routes/api/auth/saml/config/+server.ts
 * @description Admin endpoint to configure SAML IdP connections
 *
 * POST /api/auth/saml/config
 *
 * @param request - The incoming request containing the SAML connection configuration.
 * @param locals - The local state containing the authenticated user.
 * @returns A JSON response containing the created SAML connection.
 * @throws AppError if the user is not authorized or if the SAML connection configuration is invalid.
 */

import { createSAMLConnection } from "@src/databases/auth/saml-auth";
import { AppError } from "@utils/error-handling";
import { logger } from "@utils/logger.server";
import { apiHandler } from "@utils/api-handler";
import { json } from "@sveltejs/kit";
import { getPrivateSettingSync } from "@src/services/settings-service";

export const POST = apiHandler(async ({ request, locals }) => {
  const { user } = locals;
  if (!user || user.role !== "admin") {
    throw new AppError("Unauthorized", 403, "UNAUTHORIZED");
  }

  const isMultiTenant = getPrivateSettingSync("MULTI_TENANT");
  const tenantId = isMultiTenant ? user.tenantId : "default";

  const data = await request.json().catch(() => {
    throw new AppError("Invalid JSON payload", 400, "INVALID_JSON");
  });

  // Requires properties matching Jackson's createSAMLConnection
  // e.g. rawMetadata (XML string), defaultRedirectUrl, tenant, product

  if (!data.rawMetadata || !data.defaultRedirectUrl || !data.tenant || !data.product) {
    throw new AppError("Missing required SAML connection payload", 400, "INVALID_PAYLOAD");
  }

  // Enforce tenant isolation if multi-tenant
  if (isMultiTenant && data.tenant !== tenantId) {
    throw new AppError(
      `Tenant mismatch. You are only authorized to configure SAML for tenant: ${tenantId}`,
      403,
      "TENANT_MISMATCH",
    );
  }

  logger.info(`Creating new SAML connection for tenant: ${data.tenant}, product: ${data.product}`);
  const result = await createSAMLConnection(data);

  return json({
    success: true,
    data: result,
  });
});
