/**
 * file src/routes/api/user/+server.ts
 * @description API endpoints for user management
 *
 * Features:
 * - user retrieval with pagination
 * - tenant-scoped user creation
 * - role assignment
 * - invite token generation
 * - email notifications
 */
import { auth, dbAdapter } from "@src/databases/db";
import type { ISODateString } from "@src/databases/db-interface";
import { getPrivateSettingSync } from "@src/services/settings-service";
import { json } from "@sveltejs/kit";
// Unified Error Handling
import { apiHandler } from "@utils/api-handler";
import { AppError } from "@utils/error-handling";
import { addUserTokenSchema } from "@utils/form-schemas";
// System Logger
import { logger } from "@utils/logger.server";
import { requireTenantContext } from "@utils/tenant-utils";
import { safeParse } from "valibot";

/**
 * GET /api/user
 * Retrieves a list of users with pagination and filtering.
 */
export const GET = apiHandler(async ({ url, locals }) => {
  const { user, hasManageUsersPermission } = locals;

  // Security: Ensure the user is authenticated and has admin-level permissions.
  if (!(user && hasManageUsersPermission)) {
    throw new AppError("Forbidden: You do not have permission to access users.", 403, "FORBIDDEN");
  }

  if (!(auth && dbAdapter)) {
    throw new AppError("Authentication system is not initialized", 500, "AUTH_SYS_ERROR");
  }

  // Resolve tenantId using shared utility
  const tenantId = requireTenantContext(locals, "User list retrieval");

  const page = Number.parseInt(url.searchParams.get("page") || "1", 10);
  const limit = Number.parseInt(url.searchParams.get("limit") || "10", 10);
  const sort = url.searchParams.get("sort") || "createdAt";
  const order = url.searchParams.get("order") === "asc" ? 1 : -1;
  const search = url.searchParams.get("search") || "";

  // Build filter for database query
  const filter: Record<string, unknown> = {};

  // Apply tenant ID isolation
  if (tenantId) {
    filter.tenantId = tenantId;
  }

  // Add search query if provided (MongoDB-style query)
  if (search) {
    filter.$or = [
      { username: { $regex: search, $options: "i" } },
      { email: { $regex: search, $options: "i" } },
    ];
  }

  // Build pagination options for the adapter
  const options = {
    filter,
    limit,
    offset: (page - 1) * limit,
    sort: { [sort]: order === 1 ? "asc" : "desc" } as {
      [key: string]: "asc" | "desc";
    },
  };

  // Parallelize database queries for better performance
  const [usersResult, totalUsersResult] = await Promise.all([
    dbAdapter.auth.getAllUsers(options),
    dbAdapter.auth.getUserCount(filter),
  ]);

  if (!usersResult.success) {
    throw new AppError(usersResult.message || "Failed to fetch users", 500, "DB_FETCH_ERROR");
  }

  if (!totalUsersResult.success) {
    throw new AppError(
      totalUsersResult.message || "Failed to get user count",
      500,
      "DB_COUNT_ERROR",
    );
  }

  const users = usersResult.data;
  const totalUsers = totalUsersResult.data;

  logger.info("Users retrieved successfully", {
    count: users.length,
    total: totalUsers,
    requestedBy: user._id,
    tenantId,
  });

  return json({
    success: true,
    data: users,
    pagination: {
      page,
      limit,
      totalItems: totalUsers,
      totalPages: Math.ceil(totalUsers / limit),
    },
  });
});

/**
 * POST /api/user
 * Create a new user and send an invitation token.
 */
export const POST = apiHandler(async ({ request, locals, url }) => {
  if (!auth) {
    throw new AppError(
      "Internal Server Error: Authentication system not initialized",
      500,
      "AUTH_SYS_ERROR",
    );
  }

  // Resolve tenantId using shared utility (enforces MULTI_TENANT if enabled)
  const tenantId = requireTenantContext(locals, "User creation");

  const formData = await request.json().catch(() => {
    throw new AppError("Invalid JSON payload", 400, "INVALID_JSON");
  });

  const result = safeParse(addUserTokenSchema, formData);
  if (!result.success) {
    logger.warn("Invalid form data for user creation", {
      issues: result.issues,
    });
    throw new AppError("Invalid form data", 400, "VALIDATION_ERROR");
  }

  const { email, role, expiresIn } = result.output;

  const expirationTimes: Record<string, number> = {
    "2 hrs": 7200,
    "12 hrs": 43_200,
    "2 days": 172_800,
    "1 week": 604_800,
  };

  const expirationTime = expirationTimes[expiresIn];
  if (!expirationTime) {
    throw new AppError("Invalid value for token validity", 400, "INVALID_EXPIRATION");
  }

  const checkCriteria: { email: string; tenantId?: string | null } = {
    email,
    tenantId,
  };
  const existingUser = await auth.checkUser(checkCriteria);

  if (existingUser) {
    logger.warn("Attempted to create a user that already exists", {
      email,
      tenantId,
    });
    throw new AppError("User already exists in this tenant", 409, "USER_EXISTS");
  }

  // Create new user scoped to tenant
  const newUser = await auth.createUser({
    email,
    role,
    tenantId,
  });

  const expiresAt = new Date(Date.now() + expirationTime * 1000);
  const token = await auth.createToken({
    user_id: newUser._id,
    expires: expiresAt.toISOString() as ISODateString,
    type: "user-invite",
    tenantId,
  });

  logger.info("User invitation created successfully", {
    userId: newUser._id,
    tenantId,
  });

  // Trigger email invitation
  await sendUserToken(url.origin, email, token, role, expirationTime);

  return json(newUser, { status: 201 });
});

/**
 * Sends a user token via the sendMail API.
 * @param origin - The origin of the request (e.g., 'http://localhost:5173') for server-side fetch.
 */
async function sendUserToken(
  origin: string,
  email: string,
  token: string,
  role: string,
  expiresIn: number,
) {
  const inviteLink = `${origin}/login?invite_token=${token}`;
  const internalKey = getPrivateSettingSync("JWT_SECRET_KEY");

  const response = await fetch(`${origin}/api/send-mail`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-key": internalKey || "",
    },
    body: JSON.stringify({
      email,
      subject: "You have been invited to join",
      message: "User Token",
      templateName: "userToken",
      props: {
        role,
        tokenLink: inviteLink,
        expiresInLabel: expiresIn,
      },
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error("Failed to send invite email", {
      status: response.status,
      errorBody,
      email,
    });
    throw new AppError(`Failed to send email: ${response.statusText}`, 502, "EMAIL_SEND_FAILED");
  }

  logger.info("User token email sent successfully", { email });
}
