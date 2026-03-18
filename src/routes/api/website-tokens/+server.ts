/**
 * @file src/routes/api/website-tokens/+server.ts
 * @description Handles GET (list) and POST (create) requests for website tokens.
 */

import crypto from 'node:crypto';
import { dbAdapter } from '@src/databases/db';
import type { DatabaseId } from '@src/databases/db-interface';
import { json } from '@sveltejs/kit';
// Unified Error Handling
import { apiHandler } from '@utils/api-handler';
import { AppError } from '@utils/error-handling';
import { logger } from '@utils/logger.server';
import { requireTenantContext } from '@utils/tenant-utils';
import { withTenant } from '@src/databases/db-adapter-wrapper';
import { auditLogService, AuditEventType } from '@src/services/audit-log-service';
import { nowISODateString } from '@utils/date-utils';

export const GET = apiHandler(async ({ locals, url }) => {
	if (!locals.user) {
		throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
	}

	if (!dbAdapter) {
		throw new AppError('Database not available', 500, 'DB_UNAVAILABLE');
	}

	// Resolve tenantId using shared utility
	const tenantId = requireTenantContext(locals, 'Website tokens retrieval');

	const page = Number(url.searchParams.get('page') ?? 1);
	const limit = Number(url.searchParams.get('limit') ?? 10);
	const sort = url.searchParams.get('sort') ?? 'createdAt';
	const order = url.searchParams.get('order') ?? 'desc';

	// The dbAdapter handles tenant isolation if tenantId is provided via withTenant wrapper
	const result = await withTenant(
		tenantId,
		async () => {
			return await dbAdapter!.system.websiteTokens.getAll({
				limit,
				skip: (page - 1) * limit,
				sort,
				order
			});
		},
		{ collection: 'websiteTokens' }
	);

	if (!result.success) {
		logger.error('Failed to fetch website tokens:', result.message);
		throw new AppError('Failed to fetch website tokens', 500, 'FETCH_TOKENS_FAILED');
	}

	return json({
		data: result.data.data,
		pagination: {
			totalItems: result.data.total
		}
	});
});

export const POST = apiHandler(async ({ locals, request }) => {
	if (!locals.user) {
		throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
	}

	if (!dbAdapter) {
		throw new AppError('Database not available', 500, 'DB_UNAVAILABLE');
	}

	// Resolve tenantId
	const tenantId = requireTenantContext(locals, 'Website token creation');

	const { name, permissions, expiresAt } = await request.json().catch(() => {
		throw new AppError('Invalid JSON payload', 400, 'INVALID_JSON');
	});

	if (!name) {
		throw new AppError('Token name is required', 400, 'MISSING_NAME');
	}

	// Check for existing token in this tenant
	const existingToken = await withTenant(
		tenantId,
		async () => {
			return await dbAdapter!.system.websiteTokens.getByName(name);
		},
		{ collection: 'websiteTokens' }
	);

	if (existingToken.success && existingToken.data) {
		throw new AppError('A token with this name already exists', 409, 'TOKEN_EXISTS');
	}

	const token = `sv_${crypto.randomBytes(24).toString('hex')}`;

	const result = await withTenant(
		tenantId,
		async () => {
			return await dbAdapter!.system.websiteTokens.create({
				name,
				token,
				updatedAt: nowISODateString(),
				createdBy: locals.user!._id,
				permissions: permissions || [],
				expiresAt: expiresAt || undefined
			});
		},
		{ collection: 'websiteTokens' }
	);

	if (!result.success) {
		logger.error('Failed to create website token:', result.message);
		throw new AppError('Failed to create website token', 500, 'CREATE_TOKEN_FAILED');
	}

	await auditLogService.logEvent({
		action: 'Created website token',
		actorId: locals.user._id as DatabaseId,
		actorEmail: locals.user.email,
		eventType: AuditEventType.TOKEN_CREATED,
		result: 'success',
		severity: 'medium',
		targetId: result.data._id as DatabaseId,
		targetType: 'token',
		details: { tokenName: name, permissionsCount: permissions?.length || 0 },
		tenantId: tenantId ?? undefined
	});

	return json(result.data, { status: 201 });
});
