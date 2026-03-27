/**
 * @file src/routes/setup/error-classifier.ts
 * @description Helper functions to classify and format database connection errors for the setup wizard UI.
 */

import { logger } from '@utils/logger.server';
import type { ClassifiedError, DbErrorClassification } from './setup-database-error';

export interface ClassifyContext {
	isSrv?: boolean;
	host?: string;
	name?: string;
}

/**
 * Pure function that inspects a raw error and returns a structured ClassifiedError.
 * No side effects, easy to test.
 */
export function classifyDatabaseError(err: unknown, context: ClassifyContext = {}): ClassifiedError {
	const raw = err instanceof Error ? err.message : String(err);
	const lower = raw.toLowerCase();
	const code = (err as { code?: string | number })?.code ?? '';

	// Log for server-side troubleshooting
	logger.error('🔍 Classifying database error:', {
		code,
		message: raw,
		context
	});

	// 1. Connection Refused / Host Unreachable
	if (
		code === 'ECONNREFUSED' ||
		lower.includes('connection refused') ||
		lower.includes('failed to connect to server')
	) {
		const hostHint = context.host === 'localhost' || context.host === '127.0.0.1'
			? 'Check if your database service is running locally. If using Docker, ensure the container is up and you are using the correct network gateway.'
			: `Check if host "${context.host}" is correct and reachable through your network/firewall.`;

		return {
			classification: 'CONNECTION_REFUSED',
			userFriendly: 'The database server refused the connection.',
			hint: `1. Verify the database service is running.\n2. ${hostHint}\n3. Check if the port matches the database configuration.`
		};
	}

	if (code === 'ENOTFOUND' || lower.includes('getaddrinfo enotfound')) {
		return {
			classification: 'HOST_UNREACHABLE',
			userFriendly: 'Database host could not be found.',
			hint: `1. Check your hostname for typos: "${context.host}".\n2. Verify your DNS settings or internet connection.\n3. If using MongoDB Atlas, ensure you are using the full cluster URI.`
		};
	}

	// 2. Authentication Failures
	if (
		lower.includes('auth failed') ||
		lower.includes('authentication failed') ||
		lower.includes('bad auth') ||
		code === 18 || // MongoDB Auth failed
		code === '28P01' // Postgres invalid_password
	) {
		const srvNote = context.isSrv
			? 'Note: SRV connections often require the "admin" database as the auth source.'
			: '';
		return {
			classification: 'AUTH_FAILED',
			userFriendly: 'Database authentication failed.',
			hint: `1. Double-check your username and password.\n2. Verify if the user has permissions for the "${context.name}" database.\n3. ${srvNote}`
		};
	}

	// 3. Database Not Found
	if (
		lower.includes('database not found') ||
		lower.includes('unknown database') ||
		lower.includes('database "') && lower.includes('" does not exist') ||
		code === '3D000' // Postgres database_does_not_exist
	) {
		return {
			classification: 'DB_NOT_FOUND',
			userFriendly: `The database "${context.name}" was not found.`,
			hint: `1. Check for typos in the database name.\n2. SveltyCMS can attempt to create it for you—would you like to try?`
		};
	}

	// 4. Missing Drivers / Dependencies
	if (lower.includes('cannot find module') || lower.includes('driver not found')) {
		return {
			classification: 'DRIVER_MISSING',
			userFriendly: 'Required database driver is not installed.',
			hint: '1. Click "Install Missing Drivers" in the UI.\n2. Or run `npm install <driver-name>` in your terminal.\n3. Restart the development server.'
		};
	}

	// 5. Permission Denied
	if (
		lower.includes('permission denied') ||
		lower.includes('eacces') ||
		code === 'EACCES'
	) {
		return {
			classification: 'PERMISSION_DENIED',
			userFriendly: 'Access to the database was denied by the OS.',
			hint: '1. Check file permissions if using SQLite.\n2. Ensure the system user running SveltyCMS has read/write access to the database folder.'
		};
	}

	// 6. SQLite Specifics
	if (lower.includes('sqlite_cantopen')) {
		return {
			classification: 'INVALID_CONFIG',
			userFriendly: 'Cannot open SQLite database file.',
			hint: '1. Ensure the directory path exists.\n2. Check if the path is absolute or relative to the project root.'
		};
	}

	// Fallback for everything else
	return {
		classification: 'UNKNOWN',
		userFriendly: `Unexpected Database Error: ${raw}`,
		hint: 'Check the server logs for the full stack trace and technical details.'
	};
}

/**
 * Maps a generic DbErrorClassification to a short UI banner message.
 */
export function getBannerForClassification(classification: DbErrorClassification): string {
	const banners: Record<DbErrorClassification, string> = {
		CONNECTION_REFUSED: 'Server unreachable',
		AUTH_FAILED: 'Invalid credentials',
		DB_NOT_FOUND: 'Database missing',
		HOST_UNREACHABLE: 'Host not found',
		INVALID_CONFIG: 'Configuration error',
		DRIVER_MISSING: 'Drivers required',
		PERMISSION_DENIED: 'Permission denied',
		UNKNOWN: 'Connection error'
	};
	return banners[classification] || banners.UNKNOWN;
}
