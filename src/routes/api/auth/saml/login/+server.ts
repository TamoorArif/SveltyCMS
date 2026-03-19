/**
 * @file src/routes/api/auth/saml/login/+server.ts
 * @description SAML 2.0 / Enterprise SSO Integration Login Redirect Endpoint
 */

import { generateSAMLAuthUrl } from "@src/databases/auth/saml-auth";
import { AppError } from "@utils/error-handling";
import { logger } from "@utils/logger.server";
import { redirect } from "@sveltejs/kit";
import { apiHandler } from "@utils/api-handler";
import { getPrivateSettingSync } from "@src/services/settings-service";

export const GET = apiHandler(async ({ url }) => {
  const tenant = url.searchParams.get("tenant") || "default";
  const product = url.searchParams.get("product") || "sveltycms";

  const isMultiTenant = getPrivateSettingSync("MULTI_TENANT");
  if (isMultiTenant && tenant === "default") {
    throw new AppError(
      "Tenant identifier is required in multi-tenant mode",
      400,
      "TENANT_REQUIRED",
    );
  }

  logger.info(`Initiating SAML SSO for tenant: ${tenant}, product: ${product}`);
  const redirectUrl = await generateSAMLAuthUrl(tenant, product);

  if (!redirectUrl) {
    throw new AppError(
      "Failed to generate SAML redirect URL. Ensure IdP is configured for this tenant.",
      404,
      "SAML_NOT_CONFIGURED",
    );
  }

  throw redirect(302, redirectUrl);
});
