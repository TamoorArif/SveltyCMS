/**
 * @file src/routes/api/auth/saml/acs/+server.ts
 * @description SAML 2.0 Assertion Consumer Service (ACS) Callback Endpoint
 *
 * Features:
 * - SAML 2.0 Assertion Consumer Service (ACS) Callback Endpoint
 * - Processes SAML responses from Identity Providers
 * - Supports Just-In-Time (JIT) provisioning
 * - Rate limiting to prevent abuse
 * - Multi-tenant support
 */

import { getJackson } from '@src/databases/auth/saml-auth';
import { getPrivateSettingSync } from '@src/services/settings-service';
import { AppError } from '@utils/error-handling';
import { logger } from '@utils/logger.server';
import { redirect } from '@sveltejs/kit';
import type { ISODateString } from '@src/content/types';
import { apiHandler } from '@utils/api-handler';
import { auth, dbInitPromise } from '@src/databases/db';

import { cacheService, CacheCategory } from '@src/databases/cache-service';
const RATE_LIMIT_WINDOW_S = 60; // 1 minute
const MAX_ATTEMPTS = 10;

export const POST = apiHandler(async (event) => {
	const { request, cookies, getClientAddress } = event;
	const ip = getClientAddress();
	const cacheKey = `rate_limit:saml_acs:${ip}`;

	// Persistent Rate Limiting Logic via cacheService
	const currentCount = (await cacheService.get<number>(cacheKey, CacheCategory.API)) || 0;

	if (currentCount >= MAX_ATTEMPTS) {
		logger.warn(`Rate limit exceeded for SAML ACS from IP: ${ip}`);
		throw new AppError('Too many authentication attempts. Please try again later.', 429, 'RATE_LIMIT_EXCEEDED');
	}

	// Increment attempt count (expires in 1 minute)
	await cacheService.set(cacheKey, currentCount + 1, RATE_LIMIT_WINDOW_S, null, CacheCategory.API);

	await dbInitPromise;
	if (!auth) {
		throw new AppError('Authentication service not initialized', 500, 'AUTH_NOT_INITIALIZED');
	}

	const formData = await request.formData();
	const relayState = formData.get('RelayState')?.toString() || '';
	const samlResponse = formData.get('SAMLResponse')?.toString();

	if (!samlResponse) {
		throw new AppError('Missing SAMLResponse', 400, 'SAML_MISSING_RESPONSE');
	}

	const j = await getJackson();
	const body = {
		SAMLResponse: samlResponse,
		RelayState: relayState
	};

	// 1. Process SAML Response (Jackson validates signature, audience, expiration, etc.)
	const { profile } = await j.oauthController.samlResponse(body);

	const email = profile.email?.toLowerCase();
	const samlId = profile.id;
	const isMultiTenant = getPrivateSettingSync('MULTI_TENANT');
	const tenantId = isMultiTenant ? profile.requested.tenant || 'default' : 'default';
	const firstName = profile.firstName || '';
	const lastName = profile.lastName || '';

	if (!email || !samlId) {
		throw new AppError('SAML response missing critical profile data (email or ID)', 400, 'SAML_INVALID_PROFILE');
	}

	if (isMultiTenant && tenantId === 'default') {
		throw new AppError('SAML response missing tenant context in multi-tenant mode', 400, 'SAML_TENANT_MISSING');
	}

	logger.info(`SAML SSO successful for identity: ${email}, tenant: ${tenantId}`);

	let user = await auth.getUserBySamlId(samlId, tenantId);

	// Fallback to searching by email if SAML ID not linked yet
	if (!user) {
		user = await auth.getUserByEmail({ email, tenantId });

		// If user exists but is not linked to SAML, reject to prevent hijacking unless explicitly allowed
		if (user && user.samlId && user.samlId !== samlId) {
			logger.error(`SAML email collision attempt detected for email: ${email}`);
			throw new AppError('Account linked to another identity provider', 403, 'SAML_IDENTITY_COLLISION');
		}
	}

	// 2. Just-In-Time (JIT) Provisioning
	if (!user) {
		// Check if JIT is enabled
		const jitEnabled = getPrivateSettingSync('SAML_JIT_PROVISIONING') ?? false;
		if (!jitEnabled) {
			logger.warn(`SAML user auto-provisioning is disabled. Access denied for: ${email}`);
			throw new AppError('Account not found and auto-provisioning is disabled', 403, 'SAML_JIT_DISABLED');
		}

		logger.info(`Provisioning new user via SAML JIT: ${email}, tenant: ${tenantId}`);
		user = await auth.createUser(
			{
				email,
				firstName,
				lastName,
				role: 'VIEWER', // Default role.
				samlId,
				samlProvider: 'saml-jackson',
				tenantId
			},
			true
		);
	}

	if (user.blocked) {
		logger.warn(`Blocked user attempted SAML login: ${email}`);
		throw new AppError('Your account has been suspended', 403, 'USER_BLOCKED');
	}

	// 3. Create Session
	const session = await auth.createSession({
		user_id: user._id,
		tenantId,
		expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() as ISODateString
	});

	const sessionCookie = auth.createSessionCookie(session._id);

	cookies.set(sessionCookie.name, sessionCookie.value, {
		...(sessionCookie.attributes || {}),
		httpOnly: true,
		secure: process.env.NODE_ENV === 'production',
		sameSite: 'lax',
		path: '/'
	});

	throw redirect(302, '/admin');
});
