/**
 * @file src/content/utils.ts
 * @description
 * Legacy redirect layer for content utilities.
 * Re-exports from split modules to maintain backward compatibility while resolving build warnings.
 */

export * from "./content-utils";
export { processModule } from "./module-processor.server";
