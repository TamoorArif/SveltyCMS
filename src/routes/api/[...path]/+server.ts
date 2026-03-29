/**
 * @file src/routes/api/[...path]/+server.ts
 * @description
 * Unified HTTP API Gatekeeper for SveltyCMS.
 * Dispatches all external API requests to the LocalCMS logic core.
 */

import { json } from "@sveltejs/kit";
import type { RequestEvent } from "@sveltejs/kit";
import { apiHandler } from "@utils/api-handler";
import { AppError } from "@utils/error-handling";
import { logger } from "@utils/logger.server";
import { dbAdapter, getDbInitPromise, getAuth } from "@src/databases/db";
import { LocalCMS } from "../cms";
import { SESSION_COOKIE_NAME } from "@src/databases/auth/constants";
import { getPrivateSettingSync } from "@src/services/settings-service";

/**
 * Main Dispatcher handles all HTTP methods (GET, POST, PATCH, DELETE)
 */
export const handler = async ({ request, url, params, locals, cookies }: RequestEvent) => {
  const { path } = params;
  const { user, tenantId } = locals;

  // Ensure DB is initialized
  await getDbInitPromise();

  // Dispatch logic based on path segments
  const segments = path.split("/");
  const namespace = segments[0];
  const method = segments[1]; // Note: for /api/collections/posts, method is 'posts'

  // SPECIAL CASE: Health check must work even without a DB to allow orchestrators to wait for boot
  if (namespace === "system" && method === "health") {
    const health = {
      status: dbAdapter ? "healthy" : "initializing",
      database: !!dbAdapter,
      uptime: process.uptime(),
      timestamp: Date.now(),
    };
    // Always return 200 during health check to let benchmark runner proceed
    return json({ success: true, data: health }, { status: 200 });
  }

  const adapter = (locals as any).dbAdapter || dbAdapter;
  if (!adapter) {
    throw new AppError("Database adapter not initialized. System may require setup.", 503);
  }

  const cms = new LocalCMS(adapter);

  try {
    // --- WAVE 1: AUTH, USER, 2FA, SAML ---
    if (namespace === "auth" || namespace === "user") {
      // 2FA Routes
      if (method === "2fa") {
        const action = segments[2];
        const { getDefaultTwoFactorAuthService } =
          await import("@src/databases/auth/two-factor-auth");
        const twoFactorService = getDefaultTwoFactorAuthService(adapter.auth);

        if (action === "setup" && request.method === "POST") {
          if (!user) throw new AppError("Authentication required", 401);
          const result = await twoFactorService.initiate2FASetup(user._id, user.email, tenantId);
          return json(result);
        }

        if (action === "verify-setup" && request.method === "POST") {
          if (!user) throw new AppError("Authentication required", 401);
          const { code, secret, backupCodes } = await request.json();
          const result = await twoFactorService.complete2FASetup(
            user._id,
            secret,
            code,
            backupCodes,
            tenantId,
          );
          return json({ success: result });
        }

        if (action === "verify" && request.method === "POST") {
          const { userId, code } = await request.json();
          if (getPrivateSettingSync("MULTI_TENANT") && !tenantId) {
            throw new AppError("Tenant context is required", 400);
          }
          const result = await twoFactorService.verify2FA(userId, code, tenantId || undefined);
          return json(result);
        }

        if (action === "disable" && request.method === "POST") {
          if (!user) throw new AppError("Authentication required", 401);
          const result = await twoFactorService.disable2FA(user._id, tenantId);
          return json({ success: result });
        }

        if (action === "backup-codes") {
          if (!user) throw new AppError("Authentication required", 401);
          if (request.method === "GET") {
            const result = await twoFactorService.get2FAStatus(user._id, tenantId);
            return json({ success: true, data: result });
          }
          if (request.method === "POST") {
            const result = await twoFactorService.regenerateBackupCodes(user._id, tenantId);
            return json({ success: true, backupCodes: result });
          }
        }
      }

      // SAML Routes
      if (method === "saml") {
        const action = segments[2];
        const samlModule = await import("@src/databases/auth/saml-auth");

        if (action === "config") {
          if (request.method === "GET") {
            const config = await samlModule.getJackson();
            return json({ success: true, data: config });
          }
          if (request.method === "POST") {
            const body = await request.json();
            const result = await samlModule.createSAMLConnection(body);
            return json({ success: true, data: result });
          }
        }
        if (action === "login" && request.method === "POST") {
          await request.json().catch(() => ({})); // Consume body safely
          const url = await samlModule.generateSAMLAuthUrl(tenantId || "default", "sveltycms");
          return json({ success: true, url });
        }
        if (action === "acs" && request.method === "POST") {
          const { handleSAMLResponse } = await import("@src/databases/auth/saml-auth-handler");
          return handleSAMLResponse({ request, url, params, locals, cookies } as any);
        }
      }

      // User routes (batch, update, avatar)
      if (namespace === "user") {
        if (method === "batch" && request.method === "POST") {
          const { userIds, action: batchAction } = await request.json();
          const result = await cms.auth.batchAction(userIds, batchAction, { user, tenantId });
          return json(result);
        }
        if (
          method === "update-user-attributes" &&
          (request.method === "PUT" || request.method === "PATCH")
        ) {
          const { user_id, newUserData } = await request.json();
          const result = await cms.auth.updateUserAttributes(user_id, newUserData, {
            user,
            tenantId,
          });
          return json(result);
        }
        if (method === "save-avatar" && request.method === "POST") {
          const formData = await request.formData();
          const result = await cms.auth.saveAvatar(formData, { user, tenantId });
          return json(result);
        }
        if (method === "delete-avatar" && request.method === "DELETE") {
          const { userId } = await request.json().catch(() => ({}));
          const result = await cms.auth.deleteAvatar(userId || user?._id, { user, tenantId });
          return json(result);
        }
        if (method && !segments[2] && request.method === "GET") {
          const result = await cms.auth.getUserById(method, { tenantId });
          return json({ success: true, data: result });
        }
      }

      // Standard Auth Routes
      if (method === "login" && request.method === "POST") {
        const credentials = await request.json();
        const { user: authedUser, session } = await cms.auth.login(credentials, { tenantId });

        const authInstance = getAuth();
        if (!authInstance) throw new AppError("Auth system not initialized", 500);
        const sessionCookie = authInstance.createSessionCookie(session._id);
        cookies.set(sessionCookie.name, sessionCookie.value, sessionCookie.attributes as any);

        return json({ success: true, data: { user: authedUser } });
      }

      if (method === "logout" && request.method === "POST") {
        const sessionCookie = cookies.get(SESSION_COOKIE_NAME);
        if (sessionCookie) {
          const authInstance = getAuth();
          if (authInstance) {
            await authInstance.logOut(sessionCookie);
          }
          cookies.delete(SESSION_COOKIE_NAME, { path: "/" });
        }
        return json({ success: true, message: "Logged out successfully" });
      }

      if (method === "me" && request.method === "GET") {
        return json({ success: true, data: user });
      }

      if (method === "update-roles" && request.method === "POST") {
        const { roles } = await request.json();
        const result = await cms.auth.updateRoles(roles, { user, tenantId });
        return json(result);
      }

      if (namespace === "user" && !method && request.method === "GET") {
        const data = await cms.auth.listUsers({ tenantId });
        return json({ success: true, data });
      }

      if (namespace === "user" && method === "save-avatar" && request.method === "POST") {
        const { userId, avatar } = await request.json();
        const result = await cms.auth.saveUserAvatar(userId, avatar, tenantId);
        return json(result);
      }

      if (namespace === "user" && method === "delete-avatar" && request.method === "POST") {
        const { userId } = await request.json();
        const result = await cms.auth.deleteUserAvatar(userId, tenantId);
        return json(result);
      }
    }

    if (namespace === "collections") {
      const collectionId = method;
      const entryId = segments[2];

      if (request.method === "GET" && collectionId === "search") {
        const query = url.searchParams.get("q") || "";
        const collectionsParam = url.searchParams.get("collections");
        const collections = collectionsParam
          ? collectionsParam.split(",").map((c: string) => c.trim())
          : undefined;
        const page = Number(url.searchParams.get("page") ?? 1);
        const limit = Number(url.searchParams.get("limit") ?? 25);
        const sortField = url.searchParams.get("sortField") || "updatedAt";
        const sortDirection = (url.searchParams.get("sortDirection") as "asc" | "desc") || "desc";
        const status = url.searchParams.get("status") || undefined;
        const filterParam = url.searchParams.get("filter");
        let filter = {};
        if (filterParam) {
          try {
            filter = JSON.parse(filterParam);
          } catch {
            /* ignore */
          }
        }

        const result = await cms.collections.search(query, {
          collections,
          tenantId,
          user,
          page,
          limit,
          sortField,
          sortDirection,
          filter,
          status,
          isAdmin: (locals as any).isAdmin,
        });
        return json({ success: true, data: result });
      }

      if (request.method === "GET" && collectionId && entryId === "revisions") {
        const result = await cms.collections.getRevisions(collectionId, segments[1], tenantId);
        return json({ success: true, data: result });
      }

      if (request.method === "GET") {
        if (!method) {
          const includeFields = url.searchParams.get("includeFields") === "true";
          const includeStats = url.searchParams.get("includeStats") === "true";
          const collections = await cms.collections.list({ tenantId, includeFields, includeStats });
          return json({ success: true, data: { collections, total: collections.length } });
        }

        if (entryId) {
          const data = await cms.collections.findById(collectionId, entryId, { tenantId });
          return json({ success: true, data });
        } else {
          const limit = Number(url.searchParams.get("limit")) || 50;
          const offset = Number(url.searchParams.get("offset")) || 0;
          const data = await cms.collections.find(collectionId, { tenantId, limit, offset });
          return json({ success: true, data });
        }
      }

      if (request.method === "POST") {
        const data = await request.json();
        const result = await cms.collections.create(collectionId, data, { user, tenantId });
        return json(result);
      }

      if (request.method === "PATCH" && entryId) {
        const data = await request.json();
        const result = await cms.collections.update(collectionId, entryId, data, {
          user,
          tenantId,
        });
        return json(result);
      }

      if (request.method === "DELETE" && entryId) {
        const permanent = url.searchParams.get("permanent") === "true";
        const result = await cms.collections.delete(collectionId, entryId, {
          user,
          tenantId,
          permanent,
        });
        return json(result);
      }
    }

    // --- WAVE 2: MEDIA, WIDGETS, SYSTEM, ETC ---
    if (namespace === "media") {
      const limit = Number(url.searchParams.get("limit")) || 100;
      const folderId = url.searchParams.get("folderId") || undefined;
      const recursive = url.searchParams.get("recursive") === "true";

      if (request.method === "GET") {
        const fileId = method;
        if (fileId && fileId !== "list") {
          const data = await cms.media.findById(fileId, { tenantId });
          return json({ success: true, data });
        }
        const result = await cms.media.find({ tenantId, limit, folderId, recursive });
        return json(result);
      }

      if (request.method === "POST") {
        if (method === "process") {
          const formData = await request.formData();
          const processType = formData.get("processType");

          if (processType === "save") {
            const files = formData.getAll("files");
            const results = [];
            for (const file of files) {
              if (file instanceof File) {
                const res = await cms.media.upload(file, {
                  userId: (user?._id as string) || "",
                  tenantId,
                });
                results.push({ fileName: file.name, success: true, data: res });
              }
            }
            return json({ success: true, data: results });
          }

          if (processType === "delete") {
            const mediaId = formData.get("mediaId") as string;
            await cms.media.delete(mediaId, { tenantId });
            return json({ success: true });
          }

          if (processType === "batch") {
            const mediaIds = JSON.parse(formData.get("mediaIds") as string);
            const options = JSON.parse(formData.get("options") as string);
            const result = await cms.media.batchProcess(
              mediaIds,
              options,
              (user?._id as string) || "",
              tenantId,
            );
            return json({ success: true, data: result });
          }
        }
      }

      if (request.method === "PATCH" && method) {
        const data = await request.json();
        const result = await cms.media.update(method, data, tenantId);
        return json(result);
      }

      if (request.method === "DELETE" && method) {
        const result = await cms.media.delete(method, { tenantId });
        return json(result);
      }
    }

    if (namespace === "widgets") {
      if (request.method === "GET" && method === "list") {
        const widgetList = await cms.widgets.list(tenantId as string);
        return json({
          success: true,
          data: {
            widgets: widgetList,
            summary: {
              total: widgetList.length,
              active: widgetList.filter((w: any) => w.isActive).length,
              core: widgetList.filter((w: any) => w.isCore).length,
              custom: widgetList.filter((w: any) => !w.isCore).length,
            },
            tenantId: tenantId || "default-tenant",
          },
          message: "Widget list retrieved successfully",
        });
      }

      if (request.method === "POST" && method === "activate" && segments[2]) {
        const result = await cms.widgets.activate(segments[2]);
        return json(result);
      }

      if (request.method === "POST" && method === "deactivate" && segments[2]) {
        const result = await cms.widgets.deactivate(segments[2]);
        return json(result);
      }
    }

    if (namespace === "system") {
      if (method === "health") {
        const data = cms.system.getHealth();
        return json({ success: true, data });
      }

      if (method === "reinitialize" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const result = await cms.system.reinitialize(body.force ?? true);
        return json(result);
      }
    }

    if (namespace === "token") {
      if (request.method === "GET") {
        const tokenId = method; // /api/token/[tokenId]
        if (tokenId && tokenId !== "list") {
          const result = await cms.auth.tokens.findById(tokenId, tenantId);
          return json(result);
        }
        const search = url.searchParams.get("search") || undefined;
        const page = Number(url.searchParams.get("page")) || 1;
        const limit = Number(url.searchParams.get("limit")) || 10;
        const result = await cms.auth.tokens.list({ tenantId, search, page, limit });
        return json({ success: true, data: result });
      }

      if (request.method === "PATCH" && method) {
        const data = await request.json();
        const result = await cms.auth.tokens.update(method, data, tenantId);
        return json(result);
      }

      if (request.method === "POST" && method === "create-token") {
        const data = await request.json();
        const result = await cms.auth.tokens.create({ ...data, tenantId });
        return json(result);
      }

      if (request.method === "POST" && method === "batch") {
        const body = await request.json();
        const result = await cms.auth.tokens.batchAction(body.tokenIds, body.action, tenantId);
        return json(result);
      }

      if (request.method === "POST" && method === "resolve") {
        const { text } = await request.json();
        const locale = (locals as any).locale || "en";
        const resolved = await cms.auth.tokens.resolve(text, user, tenantId, locale);
        return json({ resolved });
      }

      if (request.method === "DELETE" && method) {
        const result = await cms.auth.tokens.delete(method, tenantId);
        return json(result);
      }
    }

    if (namespace === "settings") {
      if (request.method === "GET" && method === "all") {
        const data = await cms.system.settings.getAll(tenantId as string);
        return json({ success: true, data });
      }

      if (request.method === "POST" && method === "import") {
        const snapshot = await request.json();
        const result = await cms.system.settings.updateFromSnapshot(snapshot);
        return json({ success: true, result });
      }
    }

    if (namespace === "system-settings") {
      if (request.method === "POST" && method === "import") {
        const body = await request.json();
        const result = await cms.system.importer.importData(body, tenantId);
        return json(result);
      }
    }

    if (namespace === "importer") {
      if (request.method === "POST" && method === "scaffold") {
        const body = await request.json();
        const result = await cms.system.importer.scaffold(body);
        return json(result);
      }

      if (request.method === "POST" && method === "external") {
        const body = await request.json();
        const result = await cms.system.importer.importExternal(body, user, tenantId);
        return json(result);
      }
    }

    if (namespace === "import-data" && request.method === "POST") {
      const body = await request.json();
      const result = await cms.system.importer.importData(body, tenantId);
      return json(result);
    }

    if (namespace === "ai") {
      if (method === "chat") {
        const body = await request.json();
        const result = await cms.ai.chat(body.userMessage, body.history);
        return json({ success: true, data: result });
      }
      if (method === "enrich") {
        const body = await request.json();
        const result = await cms.ai.enrichText(body.text, body.action, body.language);
        return json({ success: true, data: result });
      }
    }

    if (namespace === "automations") {
      if (request.method === "GET") {
        const result = await cms.automation.getFlows(tenantId || "default");
        return json({ success: true, data: result });
      }
    }

    if (namespace === "metrics") {
      const result = await cms.metrics.getReport();
      return json({ success: true, data: result });
    }

    if (namespace === "telemetry") {
      if (method === "stats") {
        const result = await cms.telemetry.checkUpdateStatus();
        return json({ success: true, data: result });
      }
    }

    if (namespace === "events") {
      const { eventBus } = await import("@src/services/automation/event-bus");
      const stream = new ReadableStream({
        start(controller) {
          const unsubscribe = eventBus.on("*", (event: any) => {
            controller.enqueue(`data: ${JSON.stringify(event)}\n\n`);
          });
          request.signal.addEventListener("abort", () => {
            unsubscribe();
            controller.close();
          });
        },
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }

    // --- FALLBACK ---
    throw new AppError(`Endpoint /api/${path} not implemented in dispatcher`, 404);
  } catch (err: any) {
    if (err instanceof AppError) throw err;
    logger.error(`Unified Dispatcher Error: ${err.message}`, { path, stack: err.stack });
    throw new AppError(err.message || "Internal Server Error", err.status || 500);
  }
};

export const fallback = apiHandler(handler);
