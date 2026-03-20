/**
 * @file src/routes/api/settings/all/+server.ts
 * @description Batch API endpoint for retrieving all settings groups at once
 */

import { dbAdapter } from "@src/databases/db";
import { getEnabledSettingGroups } from "@src/routes/(app)/config/system-settings/settings-groups";
import { getPrivateSettingSync } from "@src/services/settings-service";
import { json } from "@sveltejs/kit";
import { apiHandler } from "@utils/api-handler";
import { AppError } from "@utils/error-handling";
import { logger } from "@utils/logger.server";
import { defaultPrivateSettings, defaultPublicSettings } from "../../../setup/seed";

export const GET = apiHandler(async ({ locals, url }) => {
  if (!locals.user) {
    throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
  }

  const userRole = locals.user.role;
  const isSuperAdmin = userRole === "super-admin";
  const isMultiTenant = getPrivateSettingSync("MULTI_TENANT");
  const tenantIdFromLocals = locals.tenantId || "";
  const targetTenantId = url.searchParams.get("tenantId") || tenantIdFromLocals;

  if (isMultiTenant && targetTenantId !== tenantIdFromLocals && !isSuperAdmin) {
    throw new AppError(
      "Unauthorized: You can only access settings for your own tenant.",
      403,
      "TENANT_MISMATCH",
    );
  }

  const allGroups = getEnabledSettingGroups();
  const siteGroups = ["languages", "site", "appearance", "customCss"];

  // Filter groups based on permissions and multi-tenancy rules
  const accessibleGroups = allGroups.filter((group) => {
    const isSiteGroup = siteGroups.includes(group.id);

    // SECURITY: Infrastructure groups require super-admin in multi-tenant mode
    if (isMultiTenant && !isSiteGroup && !isSuperAdmin) return false;

    // Authorization check for admin-only groups
    if (group.adminOnly && userRole !== "admin" && !isSuperAdmin) return false;

    return true;
  });

  const allValues: Record<string, Record<string, unknown>> = {};
  const allDefaults = [...defaultPublicSettings, ...defaultPrivateSettings];

  try {
    if (!dbAdapter) {
      throw new AppError("Database not initialized", 500, "DB_UNAVAILABLE");
    }

    for (const group of accessibleGroups) {
      const fieldKeys = group.fields.map((f) => f.key);
      const groupValues: Record<string, unknown> = {};

      // 1. Apply defaults
      for (const key of fieldKeys) {
        const found = allDefaults.find((s) => s.key === key);
        groupValues[key] = found ? found.value : undefined;
      }

      // 2. Fetch database overrides
      const dbResult = await dbAdapter.system.preferences.getMany(
        fieldKeys,
        "system",
        targetTenantId as any,
      );

      // 3. Overlay database values
      if (dbResult.success && dbResult.data) {
        for (const [key, value] of Object.entries(dbResult.data)) {
          if (fieldKeys.includes(key)) {
            if (value !== null && typeof value === "object" && "value" in value) {
              groupValues[key] = (value as Record<string, unknown>).value;
            } else {
              groupValues[key] = value;
            }
          }
        }
      }

      allValues[group.id] = groupValues;
    }

    return json({
      success: true,
      groups: allValues,
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    logger.error(`Failed to get all settings:`, err);
    throw new AppError("Failed to retrieve settings", 500, "FETCH_FAILED");
  }
});
