/**
 * @file src/databases/db-adapter-wrapper.ts
 * @description Central wrapper to enforce strict tenant isolation across database calls.
 */

import { AppError } from '@utils/error-handling';
import { logger } from '@utils/logger.server';
import { getPrivateEnv, loadPrivateConfig } from './db';

export async function withTenant<T>(
	tenantId: string | null | undefined,
	operation: () => Promise<T>,
	options: { allowGlobal?: boolean; collection?: string } = {}
): Promise<T> {
	// If tenantId is provided, we always allow (tenant context is active)
	if (tenantId) {
		return operation();
	}

	// Check if multi-tenancy is enabled in the system
	let config = getPrivateEnv();

	// If config is not loaded yet, try to load it
	if (!config) {
		config = await loadPrivateConfig();
	}

	const isMultiTenant = config?.MULTI_TENANT === true;

	// If multi-tenancy is disabled, we don't require a tenantId
	if (!isMultiTenant) {
		logger.debug(`Single-tenant mode: allowing operation on ${options.collection || 'unknown'}`);
		return operation();
	}

	// If multi-tenancy is enabled but no tenantId provided, check if global access is allowed
	if (options.allowGlobal) {
		logger.debug(`Global/system context allowed for ${options.collection || 'unknown'}`);
		return operation();
	}

	throw new AppError(`Tenant context required for this operation (collection: ${options.collection || 'unknown'})`, 403, 'TENANT_REQUIRED');
}
