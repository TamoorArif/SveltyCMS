import { contentService } from './src/content/content-service.server.ts';

// Mock $app/environment for standalone execution
globalThis.process = globalThis.process || { env: {} };
(globalThis as any).process.env.BUILDING = "false";

async function measure() {
    console.log('--- SveltyCMS Performance Baseline ---');
    try {
        const start = performance.now();
        // Since we can't easily wait for a full DB init in mockup mode without configs
        // We'll at least measure the scanning part
        const schemas = await (contentService as any).scanCompiledCollections();
        const endScan = performance.now();
        console.log('File Scanning duration:', (endScan - start).toFixed(2), 'ms');
        console.log('Number of collections found:', schemas.length);

        const startFull = performance.now();
        // Attempt full reload (might fail if DB not reachable, but we try)
        await (contentService as any).fullReload();
        const endFull = performance.now();
        console.log('Full Reload duration:', (endFull - startFull).toFixed(2), 'ms');
    } catch (e) {
        console.warn('Full measurement failed (likely due to DB/Env):', e.message);
    }
    process.exit(0);
}

measure();
