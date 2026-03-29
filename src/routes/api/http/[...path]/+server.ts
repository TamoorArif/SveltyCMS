/**
 * @file src/routes/api/http/[...path]/+server.ts
 * @description
 * Unified HTTP API Gatekeeper for SveltyCMS.
 * Dispatches all external API requests to the LocalCMS logic core.
 */

import { json } from "@sveltejs/kit";
import { apiHandler } from "@utils/api-handler";
import { AppError } from "@utils/error-handling";
import { logger } from "@utils/logger.server";
import { dbAdapter, getDbInitPromise } from "@src/databases/db";
import { LocalCMS } from "../../cms";

/**
 * Main Dispatcher handles all HTTP methods (GET, POST, PATCH, DELETE)
 */
export const fallback = apiHandler(async ({ request, params, locals, cookies }) => {
    const { path } = params;
    const { user, tenantId } = locals;
    
    // Ensure DB is initialized
    await getDbInitPromise();

    if (!dbAdapter) {
        throw new AppError("Database adapter not initialized", 500);
    }

    logger.info(`API Request: [${request.method}] ${path}`, { tenantId, userId: user?._id });

    const cms = new LocalCMS(dbAdapter);
    
    // Dispatch logic based on path segments
    const segments = path.split('/');
    const namespace = segments[0] as keyof LocalCMS;
    const method = segments[1];

    try {
        // --- WAVE 1: AUTH & COLLECTIONS ---
        if (namespace === 'auth') {
            const authAdapter = dbAdapter.auth;
            if (!authAdapter) throw new AppError("Auth adapter not initialized", 500);

            if (method === 'login' && request.method === 'POST') {
                const credentials = await request.json();
                const { user: authedUser, session } = await cms.auth.login(credentials, { tenantId });
                
                const sessionCookie = authAdapter.createSessionCookie(session._id);
                cookies.set(sessionCookie.name, sessionCookie.value, sessionCookie.attributes as any);

                return json({ success: true, data: { user: authedUser } });
            }
            
            if (method === 'logout' && request.method === 'POST') {
                const sessionCookie = cookies.get('auth_session');
                if (sessionCookie) {
                    await cms.auth.logout(sessionCookie);
                    cookies.delete('auth_session', { path: '/' });
                }
                return json({ success: true, message: "Logged out successfully" });
            }
        }

        if (namespace === 'collections') {
            const collectionId = method; // e.g. /api/http/collections/posts
            const entryId = segments[2];

            if (request.method === 'GET') {
                if (entryId) {
                    const data = await cms.collections.findById(collectionId, entryId, { tenantId });
                    return json({ success: true, data });
                } else {
                    const url = new URL(request.url);
                    const limit = Number(url.searchParams.get('limit')) || 50;
                    const offset = Number(url.searchParams.get('offset')) || 0;
                    const data = await cms.collections.find(collectionId, { tenantId, limit, offset });
                    return json({ success: true, data });
                }
            }
            
            if (request.method === 'POST') {
                const data = await request.json();
                const result = await cms.collections.create(collectionId, data, { user, tenantId });
                return json(result);
            }

            if (request.method === 'PATCH' && entryId) {
                const data = await request.json();
                const result = await cms.collections.update(collectionId, entryId, data, { user, tenantId });
                return json(result);
            }

            if (request.method === 'DELETE' && entryId) {
                const url = new URL(request.url);
                const permanent = url.searchParams.get('permanent') === 'true';
                const result = await cms.collections.delete(collectionId, entryId, { user, tenantId, permanent });
                return json(result);
            }
        }

        // --- FALLBACK ---
        throw new AppError(`Endpoint /api/http/${path} not implemented in dispatcher`, 404);

    } catch (err: any) {
        if (err instanceof AppError) throw err;
        logger.error(`Unified Dispatcher Error: ${err.message}`, { path, stack: err.stack });
        throw new AppError(err.message || "Internal Server Error", err.status || 500);
    }
});
