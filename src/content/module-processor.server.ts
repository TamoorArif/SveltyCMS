/**
 * @file src/content/module-processor.server.ts
 * @description
 * High-performance module processor for content collection definitions.
 * Marked as .server.ts to ensure it never leaks to the client bundle.
 */
import { widgetRegistryService } from '@src/services/widget-registry-service';
import { logger } from '@utils/logger.server';
import type { Schema } from './types';

/**
 * Safely parses a compiled collection JS module string.
 * Uses a Function constructor sandbox to extract the schema object.
 */
export async function processModule(content: string): Promise<{ schema?: Schema } | null> {
	try {
		// Support both 'export const schema =' and 'export default'
		const schemaMatch = content.match(/export\s+const\s+schema\s*=\s*/);
		const defaultMatch = content.match(/export\s+default\s+/);

		const match = schemaMatch || defaultMatch;
		if (!match) {
			logger.warn('No schema or default export found in module');
			return null;
		}

		const startIdx = match.index! + match[0].length;
		// Find the schema object by brace matching (so semicolons in strings don't truncate)
		const firstBrace = content.indexOf('{', startIdx);
		let endIdx: number;
		if (firstBrace === -1) {
			const semi = content.indexOf(';', startIdx);
			endIdx = semi === -1 ? content.length : semi;
		} else {
			endIdx = content.length;
			let depth = 0;
			let inString: string | null = null;
			for (let i = firstBrace; i < content.length; i++) {
				const c = content[i];
				if (inString) {
					if (c === inString && content[i - 1] !== '\\') inString = null;
					continue;
				}
				if (c === '"' || c === "'" || c === '`') {
					inString = c;
					continue;
				}
				if (c === '{') depth++;
				else if (c === '}') {
					depth--;
					if (depth === 0) {
						endIdx = i + 1;
						break;
					}
				}
			}
		}

		let schemaContent = content.substring(startIdx, endIdx).trim();
		if (!schemaContent || schemaContent === '') {
			logger.warn('Could not extract schema content');
			return null;
		}

		// If the extracted content is a variable name (like 'Clients'), we need to find its definition.
		if (/^[a-zA-Z0-9_]+$/.test(schemaContent)) {
			const varName = schemaContent;
			const varMatch = content.match(new RegExp(`(?:const|let|var)\\s+${varName}\\s*=\\s*`));
			if (varMatch) {
				const varStartIdx = varMatch.index! + varMatch[0].length;
				let braceCount = 0;
				let vEndIdx = varStartIdx;
				for (let i = varStartIdx; i < content.length; i++) {
					if (content[i] === '{') braceCount++;
					if (content[i] === '}') {
						braceCount--;
						if (braceCount === 0) {
							vEndIdx = i + 1;
							break;
						}
					}
				}
				schemaContent = content.substring(varStartIdx, vEndIdx);
			}
		}

		const widgetsMap = widgetRegistryService.getAllWidgets();
		const widgetsObject = Object.fromEntries(widgetsMap.entries());

		// Ensure globalThis.widgets is available for the module evaluation
		const globalObj = globalThis as any;
		const originalWidgets = globalObj.widgets;
		globalObj.widgets = widgetsObject;

		let result: any = null;
		try {
			const moduleContent = `return (function() { const widgets = globalThis.widgets; return ${schemaContent}; })();`;
			const moduleFunc = new Function(moduleContent);
			result = moduleFunc();

			if (result && typeof result === 'object' && 'fields' in result && '_id' in result) {
				return { schema: result as Schema };
			}
		} finally {
			// Restore globalThis state
			globalObj.widgets = originalWidgets;
		}

		logger.warn(`Module processed but no valid fields or _id found. Result type: ${typeof result}`);
		return null;
	} catch (err) {
		const errorMessage = err instanceof Error ? err.message : String(err);
		logger.error('Failed to process module:', { error: errorMessage });
		return null;
	}
}
