/**
 * @file src/routes/api/cms.ts
 * @description
 * High-performance, server-side Local API for SveltyCMS.
 * Facilitates 0ms internal communication between CMS components while mirroring 
 * the HTTP API for external consumers.
 */

import { contentManager } from "@src/content";
import { modifyRequest } from "@src/routes/api/http/collections/modify-request";
import { cacheService } from "@src/databases/cache/cache-service";
import { logger } from "@utils/logger.server";
import { AppError } from "@utils/error-handling";
import { verifyPassword } from "@utils/password";
import { parseSessionDuration } from "@utils/auth-utils";
import { getPrivateSettingSync } from "@src/services/settings-service";
import type { DatabaseId, IDBAdapter, ISODateString } from "@src/databases/db-interface";
import type { Schema, FieldInstance } from "@src/content/types";

export interface LocalApiOptions {
    user?: any;
    tenantId?: string | null;
    permanent?: boolean;
    bypassCache?: boolean;
}

/**
 * LocalCMS SDK
 * The single source of truth for all CMS operations.
 */
export class LocalCMS {
    public auth: AuthNamespace;
    public collections: CollectionsNamespace;

    constructor(private dbAdapter: IDBAdapter) {
        if (!dbAdapter) throw new Error("LocalCMS: DB Adapter is required");
        this.auth = new AuthNamespace(dbAdapter);
        this.collections = new CollectionsNamespace(dbAdapter);
    }
}

/**
 * Authentication Namespace
 */
class AuthNamespace {
    constructor(private dbAdapter: IDBAdapter) { }

    private async getAuth() {
        // We use the dbAdapter passed to the namespace, which should have auth methods
        return this.dbAdapter.auth;
    }

    /**
     * Authenticates a user and returns a session.
     */
    async login(credentials: { email: string; password?: string }, options: LocalApiOptions = {}) {
        const { tenantId } = options;
        const { email, password } = credentials;

        const auth = await this.getAuth();
        if (!auth) throw new AppError("Authentication system not initialized", 500);

        // Multi-tenant check
        if (getPrivateSettingSync("MULTI_TENANT") && !tenantId) {
            throw new AppError("Tenant ID required for login", 400);
        }

        const userLookup: { email: string; tenantId?: string | null } = { email };
        if (getPrivateSettingSync("MULTI_TENANT")) userLookup.tenantId = tenantId;

        const result = await auth.getUserByEmail(userLookup);
        if (!result.success || !result.data) {
            throw new AppError("Invalid credentials", 401);
        }

        const user = result.data;
        if (user.blocked || !user.password) {
            throw new AppError("Account suspended or incomplete", 401);
        }

        if (password) {
            const isValid = await verifyPassword(user.password, password);
            if (!isValid) throw new AppError("Invalid credentials", 401);
        }

        // Create Session
        const sessionResult = await auth.createSession({
            user_id: user._id as string,
            ...(getPrivateSettingSync("MULTI_TENANT") && { tenantId }),
            expires: new Date(Date.now() + parseSessionDuration("1d")).toISOString() as ISODateString,
        });

        if (!sessionResult.success) {
            throw new AppError("Failed to create session", 500);
        }

        return { user, session: sessionResult.data };
    }

    /**
     * Terminates a session.
     */
    async logout(sessionId: string) {
        const auth = await this.getAuth();
        if (!auth) throw new AppError("Authentication system not initialized", 500);
        return auth.deleteSession(sessionId);
    }
}

/**
 * Collections Namespace
 */
class CollectionsNamespace {
    constructor(private dbAdapter: IDBAdapter) { }

    private getCollectionName(schemaId: string): string {
        return `collection_${schemaId.replace(/-/g, "")}`;
    }

    private async getSchema(collectionId: string, tenantId?: string | null): Promise<Schema> {
        const schema = await contentManager.getCollectionById(collectionId, tenantId);
        if (!schema?._id) throw new AppError(`Collection "${collectionId}" not found`, 404);
        return schema;
    }

    async find(collectionId: string, options: any = {}) {
        const { tenantId, filter = {}, limit = 50, offset = 0 } = options;
        const schema = await this.getSchema(collectionId, tenantId);
        const query = { ...filter, ...(tenantId && { tenantId }) };

        return this.dbAdapter.crud.findMany(this.getCollectionName(schema._id as string), query, {
            limit,
            offset,
            tenantId: tenantId || null,
        });
    }

    async findById(collectionId: string, entryId: string, options: LocalApiOptions = {}) {
        const { tenantId } = options;
        const schema = await this.getSchema(collectionId, tenantId);
        const query: any = { _id: entryId as DatabaseId, ...(tenantId && { tenantId }) };

        return this.dbAdapter.crud.findOne(this.getCollectionName(schema._id as string), query, {
            tenantId: tenantId || null,
        });
    }

    async create(collectionId: string, data: any, options: LocalApiOptions = {}) {
        const { user, tenantId } = options;
        const schema = await this.getSchema(collectionId, tenantId);

        const entryData = {
            ...data,
            tenantId,
            createdBy: user?._id,
            createdAt: new Date().toISOString(),
        };

        const collectionModel = await this.dbAdapter.collection.getModel(schema._id as string);

        await modifyRequest({
            data: [entryData],
            fields: schema.fields as FieldInstance[],
            collection: collectionModel,
            user,
            type: "POST",
            tenantId,
            collectionName: schema.name,
        });

        const result = await this.dbAdapter.crud.insert(
            this.getCollectionName(schema._id as string),
            entryData,
            tenantId || null,
        );

        if (result.success && result.data) {
            await this.afterMutation(schema, tenantId, "create", result.data._id as string, result.data, user);
        }

        return result;
    }

    async update(collectionId: string, entryId: string, data: any, options: LocalApiOptions = {}) {
        const { user, tenantId } = options;
        const schema = await this.getSchema(collectionId, tenantId);

        const updateData = {
            ...data,
            updatedBy: user?._id,
            updatedAt: new Date().toISOString(),
        };

        const collectionModel = await this.dbAdapter.collection.getModel(schema._id as string);

        await modifyRequest({
            data: [updateData],
            fields: schema.fields as FieldInstance[],
            collection: collectionModel,
            user,
            type: "PATCH",
            tenantId,
            collectionName: schema.name,
        });

        const result = await this.dbAdapter.crud.update(
            this.getCollectionName(schema._id as string),
            entryId as DatabaseId,
            updateData,
            tenantId || null,
        );

        if (result.success && result.data) {
            await this.afterMutation(schema, tenantId, "update", entryId, result.data, user);
        }

        return result;
    }

    async delete(collectionId: string, entryId: string, options: LocalApiOptions = {}) {
        const { user, tenantId, permanent = false } = options;
        const schema = await this.getSchema(collectionId, tenantId);

        const result = await this.dbAdapter.crud.delete(
            this.getCollectionName(schema._id as string),
            entryId as DatabaseId,
            { tenantId: tenantId || null, permanent, userId: user?._id },
        );

        if (result.success) {
            await this.afterMutation(schema, tenantId, permanent ? "delete" : "trash", entryId, { _id: entryId }, user);
        }

        return result;
    }

    private async afterMutation(schema: Schema, tenantId: string | null | undefined, action: string, id: string, data: any, user: any) {
        await this.invalidateCache(schema, tenantId);
        try {
            const { contentStore } = await import("@src/stores/content-store.svelte");
            contentStore.updateVersion();
        } catch (e) { }

        try {
            const { pubSub } = await import("@src/services/pub-sub");
            pubSub.publish("entryUpdated", {
                collection: schema.name || (schema._id as string),
                id, action, data, timestamp: new Date().toISOString(), user
            });
        } catch (e) { }
    }

    private async invalidateCache(schema: Schema, tenantId?: string | null) {
        const patterns = [`collection:${schema._id}:*`, `cms:content_structure:${tenantId || "global"}`, `cms:content_structure:${tenantId || "global"}:${schema._id}`];
        for (const pattern of patterns) {
            await cacheService.clearByPattern(pattern, tenantId || undefined).catch(() => { });
        }
    }
}
