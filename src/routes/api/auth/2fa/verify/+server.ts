/**
 * @file src/routes/api/auth/2fa/verify/+server.ts
 * @description
 * API endpoint for verifying 2FA codes during the login flow.
 * Supports both standard TOTP codes and recovery backup codes to
 * ensure secure access even if the primary device is lost.
 *
 * features:
 * - standard OTP verification
 * - backup code recovery support
 * - seamless login flow integration
 * - tenant-aware security isolation
 */

import { auth } from '@databases/db';
import { getDefaultTwoFactorAuthService } from '@src/databases/auth/two-factor-auth';
import { json, type RequestEvent } from '@sveltejs/kit';
// Unified Error Handling
import { apiHandler } from '@utils/api-handler';
import { AppError } from '@utils/error-handling';
import { logger } from '@utils/logger.server';
import { requireTenantContext } from '@utils/tenant-utils';
import { RateLimiter } from 'sveltekit-rate-limiter/server';
import { object, parse, string } from 'valibot';

// Request body schema
const verifySchema = object({
	userId: string('User ID is required'),
	code: string('Verification code is required')
});

// Stricter limiter for 2FA verification to prevent brute-forcing backup codes
const verifyLimiter = new RateLimiter({
	// 5 attempts per 5 minutes per IP or IP+UA
	IP: [5, '5m'],
	IPUA: [5, '5m']
});

export const POST = apiHandler(async (event: RequestEvent) => {
	const { request, locals } = event;

	// Rate Limiting Check
	if (await verifyLimiter.isLimited(event)) {
		logger.warn('2FA verification rate limit exceeded', {
			ip: event.getClientAddress(),
			path: event.url.pathname
		});
		throw new AppError('Too many verification attempts. Please try again in 5 minutes.', 429, 'RATE_LIMIT_EXCEEDED');
	}

	// This endpoint can be used during login flow, so user might not be fully authenticated yet
	// The userId will be provided in the request body for verification

	// Parse and validate request body (Valibot error caught by apiHandler)
	const body = await request.json().catch(() => {
		throw new AppError('Invalid JSON', 400, 'INVALID_JSON');
	});
	const validatedBody = parse(verifySchema, body);

	// Resolve tenantId using shared utility
	const tenantId = requireTenantContext(locals, '2FA verification');

	// Verify 2FA code
	if (!auth) {
		throw new AppError('Auth service not available', 500, 'DB_AUTH_MISSING');
	}

	const twoFactorService = getDefaultTwoFactorAuthService(auth.authInterface);
	const result = await twoFactorService.verify2FA(validatedBody.userId, validatedBody.code, tenantId);

	if (!result.success) {
		logger.warn('2FA verification failed', {
			userId: validatedBody.userId,
			tenantId,
			reason: result.message
		});

		// Return 200 with success: false to handle gracefully
		return json({
			success: false,
			message: result.message || 'Invalid verification code'
		});
	}

	logger.info('2FA verification successful', {
		userId: validatedBody.userId,
		tenantId,
		method: result.method,
		backupCodeUsed: result.backupCodeUsed
	});

	return json({
		success: true,
		message: result.message,
		method: result.method,
		backupCodeUsed: result.backupCodeUsed
	});
});
