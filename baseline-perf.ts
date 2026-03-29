import { contentService } from './src/content/content-service.server.ts';
import { dbInitPromise } from './src/databases/db.ts';

async function measure() {
    console.log('--- SveltyCMS Performance Baseline ---');
    
    // Wait for DB initialization
    const dbStart = performance.now();
    await dbInitPromise;
    const dbEnd = performance.now();
    console.log('DB Initialization:', (dbEnd - dbStart).toFixed(2), 'ms');

    // Measure full reload (scans files + reconcile)
    const start = performance.now();
    await contentService.fullReload();
    const end = performance.now();
    console.log('Total Full Reload (Scan + Reconcile):', (end - start).toFixed(2), 'ms');

    // Trigger second reload to see if any natural caching is happening implicitly
    const start2 = performance.now();
    await contentService.fullReload();
    const end2 = performance.now();
    console.log('Subsequent Full Reload:', (end2 - start2).toFixed(2), 'ms');

    process.exit(0);
}

measure().catch(err => {
    console.error('Measurement failed:', err);
    process.exit(1);
});
