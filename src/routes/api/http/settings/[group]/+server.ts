/**
 * @file src/routes/api/http/settings/[group]/+server.ts
 * @description Generic API endpoint for managing any settings group
 *
 * Handles GET/PUT/DELETE operations for all settings groups defined in settingsGroups.ts
 * Respects authentication and authorization patterns from hooks.server.ts
 */

import { dbAdapter } from "@src/databases/db";
import { getSettingGroup } from "@src/routes/(app)/config/system-settings/settings-groups";
import { getPrivateSettingSync, invalidateSettingsCache } from "@src/services/settings-service";
import { setRestartNeeded } from "@src/utils/server/restart-required";
import { triggerSync } from "@src/utils/server/settings-sync";
import { json } from "@sveltejs/kit";
/**
 * GET - Retrieve current settings for a group
 * Strategy: Seed defaults as source of truth, overlay with database overrides
 */
// Unified Error Handling
import { apiHandler } from "@utils/api-handler";
import { AppError } from "@utils/error-handling";
import { logger } from "@utils/logger.server";
import { defaultPrivateSettings, defaultPublicSettings } from "../../../setup/seed";

/**
 * GET - Retrieve current settings for a group
 * Strategy: Seed defaults as source of truth, overlay with database overrides
 */
export const GET = apiHandler(async ({ locals, params, url }) => {
  if (!locals.user) {
    throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
  }

  const { group: groupId } = params;
  const groupDef = getSettingGroup(groupId);

  if (!groupDef) {
    throw new AppError(`Settings group '${groupId}' not found`, 404, "GROUP_NOT_FOUND");
  }

  const userRole = locals.user.role;
  const isSuperAdmin = userRole === "super-admin";
  const isMultiTenant = getPrivateSettingSync("MULTI_TENANT");

  // Define which groups are tenant-specific vs global infrastructure
  const siteGroups = ["languages", "site", "appearance", "customCss"];
  const isSiteGroup = siteGroups.includes(groupId);

  // SECURITY: Infrastructure groups require super-admin in multi-tenant mode
  if (isMultiTenant && !isSiteGroup && !isSuperAdmin) {
    logger.warn(
      `User ${locals.user._id} (role: ${userRole}) attempted to access infrastructure group: ${groupId}`,
    );
    throw new AppError(
      "Insufficient permissions: Only super-admins can manage infrastructure settings.",
      403,
      "FORBIDDEN",
    );
  }

  // Authorization check for admin-only groups
  if (groupDef.adminOnly && userRole !== "admin" && !isSuperAdmin) {
    logger.warn(`User ${locals.user._id} attempted to access admin-only group: ${groupId}`);
    throw new AppError("Insufficient permissions", 403, "FORBIDDEN");
  }

  // Determine target tenant
  const tenantIdFromLocals = locals.tenantId || "";
  const targetTenantId = url.searchParams.get("tenantId") || tenantIdFromLocals;

  if (isMultiTenant && targetTenantId !== tenantIdFromLocals && !isSuperAdmin) {
    throw new AppError(
      "Unauthorized: You can only access settings for your own tenant.",
      403,
      "TENANT_MISMATCH",
    );
  }

  try {
    const fieldKeys = groupDef.fields.map((f) => f.key);

    // 1. Start with seed defaults as source of truth
    const finalValues: Record<string, unknown> = {};
    const allDefaults = [...defaultPublicSettings, ...defaultPrivateSettings];

    for (const key of fieldKeys) {
      const found = allDefaults.find((s) => s.key === key);
      finalValues[key] = found ? found.value : undefined;
    }

    // 2. Fetch database overrides
    if (!dbAdapter) {
      throw new AppError("Database not initialized", 500, "DB_UNAVAILABLE");
    }

    // Pass targetTenantId as the third parameter (userId) to scope settings
    const dbResult = await dbAdapter.system.preferences.getMany(
      fieldKeys,
      "system",
      targetTenantId as any,
    );

    // 3. Overlay database values over defaults
    if (dbResult.success && dbResult.data) {
      for (const [key, value] of Object.entries(dbResult.data)) {
        if (fieldKeys.includes(key)) {
          // Handle wrapped values from database
          if (value !== null && typeof value === "object" && "value" in value) {
            finalValues[key] = (value as Record<string, unknown>).value;
          } else {
            finalValues[key] = value;
          }
        }
      }
    }

    logger.info(
      `[${groupId}] Settings retrieved for user ${locals.user._id} (tenant: ${targetTenantId})`,
    );

    return json({
      success: true,
      group: {
        id: groupDef.id,
        name: groupDef.name,
        description: groupDef.description,
        requiresRestart: groupDef.requiresRestart,
      },
      values: finalValues,
    });
  } catch (err) {
    if (err instanceof AppError) {
      throw err;
    }
    logger.error(`Failed to get settings for group '${groupId}':`, err);
    throw new AppError("Failed to retrieve settings", 500, "FETCH_FAILED");
  }
});

/**
 * PUT - Update settings for a group
 * Validates all input and saves to database
 */
export const PUT = apiHandler(async ({ request, locals, params, url }) => {
  if (!locals.user) {
    throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
  }

  const { group: groupId } = params;
  const groupDef = getSettingGroup(groupId);

  if (!groupDef) {
    throw new AppError(`Settings group '${groupId}' not found`, 404, "GROUP_NOT_FOUND");
  }

  const userRole = locals.user.role;
  const isSuperAdmin = userRole === "super-admin";
  const isMultiTenant = getPrivateSettingSync("MULTI_TENANT");

  const siteGroups = ["languages", "site", "appearance", "customCss"];
  const isSiteGroup = siteGroups.includes(groupId);

  // SECURITY: Infrastructure groups require super-admin in multi-tenant mode
  if (isMultiTenant && !isSiteGroup && !isSuperAdmin) {
    throw new AppError(
      "Insufficient permissions: Only super-admins can manage infrastructure settings.",
      403,
      "FORBIDDEN",
    );
  }

  // Authorization check
  if (groupDef.adminOnly && userRole !== "admin" && !isSuperAdmin) {
    throw new AppError("Insufficient permissions", 403, "FORBIDDEN");
  }

  // Determine target tenant
  const tenantIdFromLocals = locals.tenantId || "";
  const targetTenantId = url.searchParams.get("tenantId") || tenantIdFromLocals;

  if (isMultiTenant && targetTenantId !== tenantIdFromLocals && !isSuperAdmin) {
    throw new AppError(
      "Unauthorized: You can only update settings for your own tenant.",
      403,
      "TENANT_MISMATCH",
    );
  }

  try {
    const updates = await request.json();

    // Validate that only fields from this group are being updated
    const validKeys = groupDef.fields.map((f) => f.key);
    const updateKeys = Object.keys(updates);

    for (const key of updateKeys) {
      if (!validKeys.includes(key)) {
        throw new AppError(`Invalid setting key for this group: ${key}`, 400, "INVALID_KEY");
      }
    }

    // (Rest of validation logic remains the same...)
    const errors: Record<string, string> = {};
    for (const field of groupDef.fields) {
      if (field.key in updates) {
        const value = updates[field.key];
        if (field.required && (value === null || value === undefined || value === "")) {
          errors[field.key] = `${field.label} is required`;
          continue;
        }
        if (value === null || value === undefined) continue;
        if (field.type === "number") {
          if (typeof value !== "number" || Number.isNaN(value)) {
            errors[field.key] = `${field.label} must be a valid number`;
          }
        }
        // ... (Keeping existing validation types)
      }
    }

    if (Object.keys(errors).length > 0) {
      return json({ success: false, error: "Validation failed", errors }, { status: 400 });
    }

    // Update settings in database with tenant scoping
    const settingsArray = Object.entries(updates).map(([key, value]) => ({
      key,
      value,
      scope: "system" as const,
      userId: targetTenantId as any, // Using userId argument for tenantId
    }));

    if (!dbAdapter) {
      throw new AppError("Database not initialized", 500, "DB_UNAVAILABLE");
    }

    const updateResult = await dbAdapter.system.preferences.setMany(settingsArray);

    if (!updateResult.success) {
      throw new AppError("Failed to save settings to database", 500, "SAVE_FAILED");
    }

    // Invalidate cache and reload settings
    invalidateSettingsCache();
    const { loadSettingsFromDB } = await import("@src/databases/db");
    await loadSettingsFromDB();

    triggerSync();
    if (groupDef.requiresRestart) {
      setRestartNeeded(true);
    }

    logger.info(
      `Settings group '${groupId}' updated by user ${locals.user._id} for tenant ${targetTenantId}`,
      { changes: updates },
    );

    return json({
      success: true,
      message: "Settings updated successfully",
      requiresRestart: groupDef.requiresRestart,
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    logger.error(`Failed to update settings for group '${groupId}':`, err);
    throw new AppError("Failed to update settings", 500, "UPDATE_FAILED");
  }
});

/**
 * DELETE - Reset settings to defaults for a group
 * Removes database overrides, allowing defaults to take effect
 */
export const DELETE = apiHandler(async ({ locals, params, url }) => {
  if (!locals.user) {
    throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
  }

  const { group: groupId } = params;
  const groupDef = getSettingGroup(groupId);

  if (!groupDef) {
    throw new AppError(`Settings group '${groupId}' not found`, 404, "GROUP_NOT_FOUND");
  }

  const userRole = locals.user.role;
  const isSuperAdmin = userRole === "super-admin";
  const isMultiTenant = getPrivateSettingSync("MULTI_TENANT");

  const siteGroups = ["languages", "site", "appearance", "customCss"];
  const isSiteGroup = siteGroups.includes(groupId);

  if (isMultiTenant && !isSiteGroup && !isSuperAdmin) {
    throw new AppError(
      "Insufficient permissions: Only super-admins can manage infrastructure settings.",
      403,
      "FORBIDDEN",
    );
  }

  if (userRole !== "admin" && !isSuperAdmin) {
    throw new AppError("Insufficient permissions - admin only", 403, "FORBIDDEN");
  }

  // Determine target tenant
  const tenantIdFromLocals = locals.tenantId || "";
  const targetTenantId = url.searchParams.get("tenantId") || tenantIdFromLocals;

  if (isMultiTenant && targetTenantId !== tenantIdFromLocals && !isSuperAdmin) {
    throw new AppError(
      "Unauthorized: You can only reset settings for your own tenant.",
      403,
      "TENANT_MISMATCH",
    );
  }

  try {
    const keysToReset = groupDef.fields.map((f) => f.key);

    if (!dbAdapter) {
      throw new AppError("Database not initialized", 500, "DB_UNAVAILABLE");
    }

    // Delete database overrides with tenant scoping
    const deleteResult = await dbAdapter.system.preferences.deleteMany(
      keysToReset,
      "system",
      targetTenantId as any,
    );

    if (!deleteResult.success) {
      throw new AppError("Failed to reset settings to defaults", 500, "RESET_FAILED");
    }

    invalidateSettingsCache();
    const { loadSettingsFromDB } = await import("@src/databases/db");
    await loadSettingsFromDB();

    triggerSync();
    if (groupDef.requiresRestart) {
      setRestartNeeded(true);
    }

    logger.info(
      `Settings group '${groupId}' reset to defaults by user ${locals.user._id} for tenant ${targetTenantId}`,
      { action: "reset_to_defaults" },
    );

    return json({
      success: true,
      message: "Settings reset to defaults",
      requiresRestart: groupDef.requiresRestart,
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    logger.error(`Failed to reset settings for group '${groupId}':`, err);
    throw new AppError("Failed to reset settings", 500, "RESET_FAILED");
  }
});
