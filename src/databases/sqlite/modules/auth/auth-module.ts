/**
 * @file src/databases/sqlite/modules/auth/auth-module.ts
 * @description Authentication and authorization module for SQLite
 *
 * Features:
 * - Create user
 * - Update user
 * - Delete user
 * - Get user by id
 * - Get user by email
 * - Session management
 * - Token management
 * - Multi-tenancy support
 * - Role management
 */

import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { DatabaseResult, PaginationOption } from "../../../db-interface";
import type { IAuthAdapter } from "../../../db-interface";
import type { Role, Session, Token, User } from "../../../auth/types";
import type { AdapterCore } from "../../adapter/adapter-core";
import { schema } from "../../schema";
import * as utils from "../../utils";
import { logger } from "../../../../utils/logger.server";
import { isoDateStringToDate, nowISODateString } from "../../../../utils/date-utils";
import type { ISODateString } from "@src/content/types";

export class AuthModule implements IAuthAdapter {
  constructor(private core: AdapterCore) {}

  private get db() {
    return this.core.db;
  }

  private mapUser(dbUser: typeof schema.authUsers.$inferSelect): User {
    if (!dbUser) {
      throw new Error("User not found");
    }
    const user = utils.convertDatesToISO(dbUser);

    // Handle roleIds - ensure it is an array
    let roleIds = user.roleIds;
    if (typeof roleIds === "string") {
      try {
        roleIds = JSON.parse(roleIds);
      } catch {
        // Fallback if parsing fails
        roleIds = [];
      }
    }

    const finalRoleIds = Array.isArray(roleIds) ? (roleIds as string[]) : [];

    return {
      ...user,
      roleIds: finalRoleIds,
      role: finalRoleIds.length > 0 ? finalRoleIds[0] : "user",
      isAdmin: !!dbUser.isAdmin,
      isRegistered: !!dbUser.isRegistered,
      blocked: !!dbUser.blocked,
      emailVerified: !!dbUser.emailVerified,
      permissions: (user as unknown as { permissions?: string[] }).permissions || [],
    } as User;
  }

  // Setup method for model registration
  async setupAuthModels(): Promise<void> {
    // No-op for SQL - tables created by migrations
    logger.debug("Auth models setup (no-op for SQL)");
  }

  // User methods
  async createUser(userData: Partial<User>): Promise<DatabaseResult<User>> {
    return this.core.wrap(async () => {
      const id = (userData._id || utils.generateId()) as string;
      const now = isoDateStringToDate(nowISODateString());

      // Ensure password is hashed if provided and not already hashed
      let password = userData.password;
      if (password && !password.startsWith("$argon2")) {
        const argon2 = await import("argon2");
        password = await argon2.hash(password);
      }

      // Map legacy 'role' string to 'roleIds' array if roleIds is missing/empty
      let roleIds: string[] = [];
      if (userData.roleIds?.length) {
        roleIds = userData.roleIds;
      } else if (userData.role) {
        roleIds = [userData.role];
      }

      const values: typeof schema.authUsers.$inferInsert = {
        email: userData.email || "",
        username: userData.username || null,
        password: password || null,
        firstName: userData.firstName || null,
        lastName: userData.lastName || null,
        avatar: userData.avatar || null,
        roleIds: roleIds,
        isAdmin: userData.isAdmin || false,
        isRegistered: userData.isRegistered || false,
        blocked: userData.blocked || false,
        emailVerified: userData.emailVerified || false,
        tenantId: userData.tenantId || null,
        _id: id,
        createdAt: now,
        updatedAt: now,
      };

      logger.debug(
        `[SQLite/Auth] Creating user: ${values.email}, isAdmin: ${values.isAdmin}, roles: ${JSON.stringify(values.roleIds)}`,
      );

      await this.db.insert(schema.authUsers).values(values);
      const [result] = await this.db
        .select()
        .from(schema.authUsers)
        .where(eq(schema.authUsers._id, id))
        .limit(1);
      return this.mapUser(result);
    }, "CREATE_USER_FAILED");
  }

  async updateUserAttributes(
    userId: string,
    userData: Partial<User>,
    _tenantId?: string | null,
  ): Promise<DatabaseResult<User>> {
    return this.core.wrap(async () => {
      const now = isoDateStringToDate(nowISODateString());
      const updateData: Partial<typeof schema.authUsers.$inferInsert> = {
        ...userData,
        updatedAt: now,
      } as any;

      // Handle role mapping if needed
      if (userData.role && !userData.roleIds) {
        updateData.roleIds = [userData.role];
      }

      await this.db
        .update(schema.authUsers)
        .set(updateData)
        .where(eq(schema.authUsers._id, userId as string));
      const [result] = await this.db
        .select()
        .from(schema.authUsers)
        .where(eq(schema.authUsers._id, userId as string))
        .limit(1);
      return this.mapUser(result);
    }, "UPDATE_USER_FAILED");
  }

  async deleteUser(userId: string, _tenantId?: string | null): Promise<DatabaseResult<void>> {
    return this.core.wrap(async () => {
      await this.db.delete(schema.authUsers).where(eq(schema.authUsers._id, userId as string));
    }, "DELETE_USER_FAILED");
  }

  async deleteUsers(
    userIds: string[],
    _tenantId?: string | null,
  ): Promise<DatabaseResult<{ deletedCount: number }>> {
    return this.core.wrap(async () => {
      await this.db.delete(schema.authUsers).where(inArray(schema.authUsers._id, userIds));
      return { deletedCount: userIds.length };
    }, "DELETE_USERS_FAILED");
  }

  async blockUsers(
    userIds: string[],
    _tenantId?: string | null,
  ): Promise<DatabaseResult<{ modifiedCount: number }>> {
    return this.core.wrap(async () => {
      await this.db
        .update(schema.authUsers)
        .set({ blocked: true })
        .where(inArray(schema.authUsers._id, userIds));
      return { modifiedCount: userIds.length };
    }, "BLOCK_USERS_FAILED");
  }

  async unblockUsers(
    userIds: string[],
    _tenantId?: string | null,
  ): Promise<DatabaseResult<{ modifiedCount: number }>> {
    return this.core.wrap(async () => {
      await this.db
        .update(schema.authUsers)
        .set({ blocked: false })
        .where(inArray(schema.authUsers._id, userIds));
      return { modifiedCount: userIds.length };
    }, "UNBLOCK_USERS_FAILED");
  }

  async getUserById(
    userId: string,
    _tenantId?: string | null,
  ): Promise<DatabaseResult<User | null>> {
    return this.core.wrap(async () => {
      const [result] = await this.db
        .select()
        .from(schema.authUsers)
        .where(eq(schema.authUsers._id, userId as string))
        .limit(1);
      return result ? this.mapUser(result) : null;
    }, "GET_USER_FAILED");
  }

  async getUserByEmail(criteria: {
    email: string;
    tenantId?: string | null;
  }): Promise<DatabaseResult<User | null>> {
    return this.core.wrap(async () => {
      const conditions = [eq(schema.authUsers.email, criteria.email)];
      if (criteria.tenantId) {
        conditions.push(eq(schema.authUsers.tenantId, criteria.tenantId));
      } else {
        conditions.push(isNull(schema.authUsers.tenantId));
      }

      const [result] = await this.db
        .select()
        .from(schema.authUsers)
        .where(and(...conditions))
        .limit(1);
      return result ? this.mapUser(result) : null;
    }, "GET_USER_BY_EMAIL_FAILED");
  }

  async getAllUsers(options?: PaginationOption): Promise<DatabaseResult<User[]>> {
    return this.core.wrap(async () => {
      const conditions = [];
      if (options?.filter?.tenantId) {
        conditions.push(eq(schema.authUsers.tenantId, options.filter.tenantId as string));
      }

      let q = this.db.select().from(schema.authUsers).$dynamic();
      if (conditions.length > 0) {
        q = q.where(and(...conditions));
      }
      if (options?.limit) q = q.limit(options.limit);
      if (options?.offset) q = q.offset(options.offset);

      const results = await q;
      return results.map((u) => this.mapUser(u));
    }, "GET_ALL_USERS_FAILED");
  }

  async getUserCount(_filter?: Record<string, unknown>): Promise<DatabaseResult<number>> {
    return this.core.wrap(async () => {
      const results = await this.db.select({ count: sql<number>`count(*)` }).from(schema.authUsers);
      return results[0]?.count || 0;
    }, "GET_USER_COUNT_FAILED");
  }

  async createUserAndSession(
    userData: Partial<User>,
    sessionData: { expires: ISODateString; tenantId?: string | null },
  ): Promise<DatabaseResult<{ user: User; session: Session }>> {
    return this.core.wrap(async () => {
      const userRes = await this.createUser(userData);
      if (!userRes.success) throw new Error(userRes.message);

      const sessionRes = await this.createSession({
        user_id: userRes.data._id,
        expires: sessionData.expires,
        tenantId: sessionData.tenantId,
      });
      if (!sessionRes.success) throw new Error(sessionRes.message);

      return { user: userRes.data, session: sessionRes.data };
    }, "CREATE_USER_AND_SESSION_FAILED");
  }

  async deleteUserAndSessions(
    userId: string,
    tenantId?: string | null,
  ): Promise<DatabaseResult<{ deletedUser: boolean; deletedSessionCount: number }>> {
    return this.core.wrap(async () => {
      await this.db.delete(schema.authSessions).where(eq(schema.authSessions.user_id, userId));
      await this.deleteUser(userId, tenantId);
      return { deletedUser: true, deletedSessionCount: 1 };
    }, "DELETE_USER_AND_SESSIONS_FAILED");
  }

  // Session methods
  async createSession(sessionData: {
    user_id: string;
    expires: ISODateString;
    tenantId?: string | null;
  }): Promise<DatabaseResult<Session>> {
    return this.core.wrap(async () => {
      const id = utils.generateId();
      const now = isoDateStringToDate(nowISODateString());
      const expires = isoDateStringToDate(sessionData.expires);

      const values = {
        ...sessionData,
        _id: id,
        expires: expires as Date,
        createdAt: now,
        updatedAt: now,
      };

      await this.db.insert(schema.authSessions).values(values);
      const [result] = await this.db
        .select()
        .from(schema.authSessions)
        .where(eq(schema.authSessions._id, id))
        .limit(1);
      return utils.convertDatesToISO(result) as unknown as Session;
    }, "CREATE_SESSION_FAILED");
  }

  async validateSession(sessionId: string): Promise<DatabaseResult<User | null>> {
    return this.core.wrap(async () => {
      const [session] = await this.db
        .select()
        .from(schema.authSessions)
        .where(eq(schema.authSessions._id, sessionId))
        .limit(1);

      if (!session || new Date(session.expires) < new Date()) {
        if (session) {
          await this.db.delete(schema.authSessions).where(eq(schema.authSessions._id, sessionId));
        }
        return null;
      }

      const [user] = await this.db
        .select()
        .from(schema.authUsers)
        .where(eq(schema.authUsers._id, session.user_id))
        .limit(1);
      return user ? this.mapUser(user) : null;
    }, "VALIDATE_SESSION_FAILED");
  }

  async deleteSession(sessionId: string): Promise<DatabaseResult<void>> {
    return this.core.wrap(async () => {
      await this.db.delete(schema.authSessions).where(eq(schema.authSessions._id, sessionId));
    }, "DELETE_SESSION_FAILED");
  }

  async deleteExpiredSessions(): Promise<DatabaseResult<number>> {
    return this.core.wrap(async () => {
      await this.db.delete(schema.authSessions).where(sql`expires < ${Date.now()}`);
      return 1;
    }, "DELETE_EXPIRED_SESSIONS_FAILED");
  }

  async updateSessionExpiry(
    sessionId: string,
    expires: ISODateString,
  ): Promise<DatabaseResult<Session>> {
    return this.core.wrap(async () => {
      await this.db
        .update(schema.authSessions)
        .set({ expires: isoDateStringToDate(expires) })
        .where(eq(schema.authSessions._id, sessionId));

      const [result] = await this.db
        .select()
        .from(schema.authSessions)
        .where(eq(schema.authSessions._id, sessionId))
        .limit(1);
      return utils.convertDatesToISO(result) as unknown as Session;
    }, "UPDATE_SESSION_EXPIRY_FAILED");
  }

  async invalidateAllUserSessions(
    userId: string,
    _tenantId?: string | null,
  ): Promise<DatabaseResult<void>> {
    return this.core.wrap(async () => {
      await this.db.delete(schema.authSessions).where(eq(schema.authSessions.user_id, userId));
    }, "INVALIDATE_USER_SESSIONS_FAILED");
  }

  async getActiveSessions(
    userId: string,
    _tenantId?: string | null,
  ): Promise<DatabaseResult<Session[]>> {
    return this.core.wrap(async () => {
      const results = await this.db
        .select()
        .from(schema.authSessions)
        .where(eq(schema.authSessions.user_id, userId));
      return results.map((s) => utils.convertDatesToISO(s) as unknown as Session);
    }, "GET_ACTIVE_SESSIONS_FAILED");
  }

  async getAllActiveSessions(_tenantId?: string | null): Promise<DatabaseResult<Session[]>> {
    return this.core.wrap(async () => {
      const results = await this.db.select().from(schema.authSessions);
      return results.map((s) => utils.convertDatesToISO(s) as unknown as Session);
    }, "GET_ALL_ACTIVE_SESSIONS_FAILED");
  }

  async getSessionTokenData(
    sessionId: string,
  ): Promise<DatabaseResult<{ expiresAt: ISODateString; user_id: string } | null>> {
    return this.core.wrap(async () => {
      const [session] = await this.db
        .select()
        .from(schema.authSessions)
        .where(eq(schema.authSessions._id, sessionId))
        .limit(1);
      if (!session) return null;
      const iso = utils.convertDatesToISO(session);
      return {
        expiresAt: (iso as any).expires as unknown as ISODateString,
        user_id: session.user_id,
      };
    }, "GET_SESSION_TOKEN_DATA_FAILED");
  }

  async getTokenById(
    tokenId: string,
    tenantId?: string | null,
  ): Promise<DatabaseResult<Token | null>> {
    return this.core.wrap(async () => {
      const conditions = [eq(schema.authTokens._id, tokenId as string)];
      if (tenantId) {
        conditions.push(eq(schema.authTokens.tenantId, tenantId));
      }
      const [t] = await this.db
        .select()
        .from(schema.authTokens)
        .where(and(...conditions))
        .limit(1);
      return t ? (utils.convertDatesToISO(t) as unknown as Token) : null;
    }, "GET_TOKEN_BY_ID_FAILED");
  }

  async createToken(tokenData: {
    user_id: string;
    email: string;
    expires: ISODateString;
    type: string;
    tenantId?: string | null;
  }): Promise<DatabaseResult<string>> {
    return this.core.wrap(async () => {
      const id = utils.generateId();
      const now = isoDateStringToDate(nowISODateString());
      const expires = isoDateStringToDate(tokenData.expires);
      const tokenValue = utils.generateId();

      const values = {
        ...tokenData,
        _id: id,
        token: tokenValue,
        expires: expires as Date,
        createdAt: now,
        updatedAt: now,
      };

      await this.db.insert(schema.authTokens).values(values);
      return tokenValue;
    }, "CREATE_TOKEN_FAILED");
  }

  async getTokenByValue(
    token: string,
    _tenantId?: string | null,
  ): Promise<DatabaseResult<Token | null>> {
    return this.core.wrap(async () => {
      const [result] = await this.db
        .select()
        .from(schema.authTokens)
        .where(eq(schema.authTokens.token, token))
        .limit(1);
      return result ? (utils.convertDatesToISO(result) as unknown as Token) : null;
    }, "GET_TOKEN_FAILED");
  }

  async getTokenData(
    token: string,
    _userId?: string,
    _type?: string,
    tenantId?: string | null,
  ): Promise<DatabaseResult<Token | null>> {
    return this.getTokenByValue(token, tenantId);
  }

  async validateToken(
    token: string,
    _userId?: string,
    type?: string,
    tenantId?: string | null,
  ): Promise<DatabaseResult<{ success: boolean; message: string; email?: string }>> {
    return this.core.wrap(async () => {
      const tokenRes = await this.getTokenByValue(token, tenantId);
      if (!tokenRes.success || !tokenRes.data) {
        return { success: false, message: "Token not found" };
      }
      const t = tokenRes.data;
      if (new Date(t.expires) < new Date()) {
        return { success: false, message: "Token expired" };
      }
      if (type && t.type !== type) {
        return { success: false, message: "Invalid token type" };
      }
      return { success: true, message: "Token valid", email: t.email };
    }, "VALIDATE_TOKEN_FAILED");
  }

  async consumeToken(
    token: string,
    userId?: string,
    type?: string,
    tenantId?: string | null,
  ): Promise<DatabaseResult<{ status: boolean; message: string }>> {
    return this.core.wrap(async () => {
      const val = await this.validateToken(token, userId, type, tenantId);
      if (!val.success || !val.data.success) {
        return {
          status: false,
          message: val.success ? val.data.message : val.error?.message || "Invalid token",
        };
      }
      const tokenRes = await this.getTokenByValue(token, tenantId);
      if (tokenRes.success && tokenRes.data) {
        await this.db.delete(schema.authTokens).where(eq(schema.authTokens._id, tokenRes.data._id));
      }
      return { status: true, message: "Token consumed" };
    }, "CONSUME_TOKEN_FAILED");
  }

  async deleteTokens(
    tokenIds: string[],
    _tenantId?: string | null,
  ): Promise<DatabaseResult<{ deletedCount: number }>> {
    return this.core.wrap(async () => {
      await this.db
        .delete(schema.authTokens)
        .where(
          or(inArray(schema.authTokens._id, tokenIds), inArray(schema.authTokens.token, tokenIds)),
        );
      return { deletedCount: tokenIds.length };
    }, "DELETE_TOKENS_FAILED");
  }

  async deleteExpiredTokens(): Promise<DatabaseResult<number>> {
    return this.core.wrap(async () => {
      await this.db.delete(schema.authTokens).where(sql`expires < ${Date.now()}`);
      return 1;
    }, "DELETE_EXPIRED_TOKENS_FAILED");
  }

  async blockTokens(
    tokenIds: string[],
    _tenantId?: string | null,
  ): Promise<DatabaseResult<{ modifiedCount: number }>> {
    return this.core.wrap(async () => {
      await this.db
        .update(schema.authTokens)
        .set({ blocked: true })
        .where(
          or(inArray(schema.authTokens._id, tokenIds), inArray(schema.authTokens.token, tokenIds)),
        );
      return { modifiedCount: tokenIds.length };
    }, "BLOCK_TOKENS_FAILED");
  }

  async unblockTokens(
    tokenIds: string[],
    _tenantId?: string | null,
  ): Promise<DatabaseResult<{ modifiedCount: number }>> {
    return this.core.wrap(async () => {
      await this.db
        .update(schema.authTokens)
        .set({ blocked: false })
        .where(
          or(inArray(schema.authTokens._id, tokenIds), inArray(schema.authTokens.token, tokenIds)),
        );
      return { modifiedCount: tokenIds.length };
    }, "UNBLOCK_TOKENS_FAILED");
  }

  async updateToken(
    tokenId: string,
    tokenData: Partial<Token>,
    _tenantId?: string | null,
  ): Promise<DatabaseResult<Token>> {
    return this.core.wrap(async () => {
      await this.db
        .update(schema.authTokens)
        .set(tokenData as any)
        .where(eq(schema.authTokens._id, tokenId));
      const [res] = await this.db
        .select()
        .from(schema.authTokens)
        .where(eq(schema.authTokens._id, tokenId))
        .limit(1);
      return utils.convertDatesToISO(res) as unknown as Token;
    }, "UPDATE_TOKEN_FAILED");
  }

  async rotateToken(oldToken: string, expires: ISODateString): Promise<DatabaseResult<string>> {
    return this.core.wrap(async () => {
      const tokenRes = await this.getTokenByValue(oldToken);
      if (!tokenRes.success || !tokenRes.data) throw new Error("Token not found");
      const newToken = utils.generateId();
      await this.db
        .update(schema.authTokens)
        .set({ token: newToken, expires: isoDateStringToDate(expires) })
        .where(eq(schema.authTokens.token, oldToken));
      return newToken;
    }, "ROTATE_TOKEN_FAILED");
  }

  async getAllTokens(_filter?: Record<string, unknown>): Promise<DatabaseResult<Token[]>> {
    return this.core.wrap(async () => {
      const results = await this.db.select().from(schema.authTokens);
      return results.map((t) => utils.convertDatesToISO(t) as unknown as Token);
    }, "GET_ALL_TOKENS_FAILED");
  }

  // Role methods
  async createRole(roleData: Role): Promise<DatabaseResult<Role>> {
    return this.core.wrap(async () => {
      const id = roleData._id || utils.generateId();
      const now = isoDateStringToDate(nowISODateString());

      const values: typeof schema.roles.$inferInsert = {
        ...roleData,
        _id: id,
        permissions: roleData.permissions || [],
        createdAt: now,
        updatedAt: now,
      };

      await this.db.insert(schema.roles).values(values);
      const [result] = await this.db
        .select()
        .from(schema.roles)
        .where(eq(schema.roles._id, id))
        .limit(1);
      return utils.convertDatesToISO(result) as unknown as Role;
    }, "CREATE_ROLE_FAILED");
  }

  async getRoleById(
    roleId: string,
    _tenantId?: string | null,
  ): Promise<DatabaseResult<Role | null>> {
    return this.core.wrap(async () => {
      const [result] = await this.db
        .select()
        .from(schema.roles)
        .where(eq(schema.roles._id, roleId as string))
        .limit(1);
      return result ? (utils.convertDatesToISO(result) as unknown as Role) : null;
    }, "GET_ROLE_FAILED");
  }

  async getAllRoles(_tenantId?: string | null): Promise<Role[]> {
    const res = await this.core.wrap(async () => {
      const results = await this.db.select().from(schema.roles);
      return results.map((r) => utils.convertDatesToISO(r) as unknown as Role);
    }, "GET_ALL_ROLES_FAILED");
    return res.success ? res.data : [];
  }

  async updateRole(
    roleId: string,
    roleData: Partial<Role>,
    _tenantId?: string | null,
  ): Promise<DatabaseResult<Role>> {
    return this.core.wrap(async () => {
      const now = isoDateStringToDate(nowISODateString());
      const updateData = {
        ...roleData,
        updatedAt: now,
      };

      await this.db
        .update(schema.roles)
        .set(updateData)
        .where(eq(schema.roles._id, roleId as string));
      const [result] = await this.db
        .select()
        .from(schema.roles)
        .where(eq(schema.roles._id, roleId as string))
        .limit(1);
      return utils.convertDatesToISO(result) as unknown as Role;
    }, "UPDATE_ROLE_FAILED");
  }

  async deleteRole(roleId: string, tenantId?: string | null): Promise<DatabaseResult<void>> {
    return this.core.wrap(async () => {
      const conditions = [eq(schema.roles._id, roleId as string)];
      if (tenantId) {
        conditions.push(eq(schema.roles.tenantId, tenantId));
      }
      await this.db.delete(schema.roles).where(and(...conditions));
    }, "DELETE_ROLE_FAILED");
  }
}
