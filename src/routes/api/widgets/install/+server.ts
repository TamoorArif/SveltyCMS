/**
 * @file src/routes/api/widgets/install/+server.ts
 * @description API endpoint for installing widgets from marketplace with security validation
 */

import { hasPermissionWithRoles } from '@src/databases/auth/permissions';
import { json } from '@sveltejs/kit';
import { logger } from '@utils/logger.server';

// Security: Dangerous patterns to block in widget code
const DANGEROUS_PATTERNS = [
	{ pattern: /eval\s*\(/, reason: 'Use of eval()' },
	{ pattern: /child_process/, reason: 'Import of child_process' },
	{ pattern: /exec\s*\(/, reason: 'Use of exec()' },
	{ pattern: /spawn\s*\(/, reason: 'Use of spawn()' },
	{ pattern: /fs\./, reason: 'Direct filesystem access via fs module' }
];

/**
 * Validates widget code content against security rules
 * @param code The widget source code to scan
 * @param widgetId ID of the widget being scanned
 * @returns Object indicating validity and any security issues found
 */
function scanWidgetCode(code: string, widgetId: string): { valid: boolean; issues: string[] } {
	const issues: string[] = [];

	// Check for dangerous patterns
	for (const check of DANGEROUS_PATTERNS) {
		if (check.pattern.test(code)) {
			issues.push(check.reason);
		}
	}

	if (issues.length > 0) {
		logger.warn(`[Security] Blocked installation of widget ${widgetId} due to security issues`, {
			widgetId,
			issues
		});
		return { valid: false, issues };
	}

	return { valid: true, issues: [] };
}

// Unified Error Handling
import { apiHandler } from '@utils/api-handler';
import { AppError } from '@utils/error-handling';

export const POST = apiHandler(async ({ request, locals }) => {
	const start = performance.now();
	try {
		const { user } = locals;

		if (!user) {
			throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
		}

		// Check permission
		const hasWidgetPermission = hasPermissionWithRoles(user, 'api:widgets', locals.roles);
		if (!hasWidgetPermission) {
			logger.warn(`User ${user._id} denied access to widget install API due to insufficient permissions`);
			throw new AppError('Insufficient permissions', 403, 'FORBIDDEN');
		}

		const { widgetId, tenantId } = await request.json();

		if (!widgetId) {
			throw new AppError('Widget ID is required', 400, 'MISSING_WIDGET_ID');
		}

		// Resolve target tenant correctly to prevent IDOR
		let targetTenantId = locals.tenantId || 'default-tenant';

		if (tenantId && tenantId !== targetTenantId) {
			if (user.role !== 'super-admin') {
				throw new AppError('Forbidden: You cannot manage widgets for other tenants.', 403, 'FORBIDDEN');
			}
			targetTenantId = tenantId;
		}

		logger.info(`[Widget Install] Starting installation for ${widgetId}`, {
			tenantId: targetTenantId,
			user: user._id
		});

		// [SECURITY WARNING] The scanWidgetCode function uses regex-based scanning which is
		// easily bypassed. This is currently a simulation/placeholder.
		// For production marketplace, a robust AST-based sandbox (e.g. QuickJS) MUST be used.

		// TODO: Implement marketplace widget installation logic
		// 1. Download widget from marketplace
		// 2. Validate widget integrity and compatibility
		// 3. Install widget files to tenant-specific directory
		// 4. Update database with installed widget info
		// 5. Register widget in the system

		// [SECURITY] Simulation of code scanning
		// In a real implementation, we would scan the downloaded files.
		// Here we simulate checking a "bad" widget.
		if (widgetId.includes('malicious') || widgetId.includes('hack')) {
			const mockBadCode = 'const x = eval("alert(1)");';
			const securityResult = scanWidgetCode(mockBadCode, widgetId);
			if (!securityResult.valid) {
				return json(
					{
						success: false,
						message: 'Security Check Failed',
						error: 'Widget contains prohibited code patterns',
						details: securityResult.issues
					},
					{ status: 422 }
				);
			}
		}

		// Mock installation process
		const installResult = {
			success: true,
			data: {
				widgetId,
				tenantId: targetTenantId,
				installedAt: new Date().toISOString(),
				version: '1.0.0',
				status: 'installed'
			},
			message: 'Widget installed successfully'
		};

		const duration = performance.now() - start;
		logger.info(`[Widget Install] Completed successfully for ${widgetId}`, {
			tenantId: targetTenantId,
			duration: `${duration.toFixed(2)}ms`
		});

		return json(installResult);
	} catch (err) {
		const duration = performance.now() - start;
		const message = `Failed to install widget: ${err instanceof Error ? err.message : String(err)}`;
		logger.error(message, {
			duration: `${duration.toFixed(2)}ms`,
			stack: err instanceof Error ? err.stack : undefined
		});
		if (err instanceof AppError) {
			throw err;
		}
		throw new AppError(message, 500, 'WIDGET_INSTALL_FAILED');
	}
});
