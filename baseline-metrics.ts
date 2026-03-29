import { metricsService } from './src/services/metrics-service.ts';
import { contentService } from './src/content/content-service.server.ts';
import { dbInitPromise } from './src/databases/db.ts';

async function run() {
    console.log('--- SveltyCMS Performance Baseline ---');
    
    // 1. Measure Reconciliation Performance
    await dbInitPromise;
    const start = performance.now();
    await contentService.fullReload();
    const end = performance.now();
    const reconcileTime = (end - start).toFixed(2);
    
    // 2. Get Metrics Report
    const report = metricsService.getReport();
    
    const baseline = {
        timestamp: new Date().toISOString(),
        reconcile_time_ms: reconcileTime,
        api_cache_hit_rate: report.api.cacheHitRate,
        auth_cache_hit_rate: report.authentication.cacheHitRate,
        avg_hook_execution_time: report.performance.avgHookExecutionTime,
        uptime_ms: report.uptime
    };
    
    console.log(JSON.stringify(baseline, null, 2));
    process.exit(0);
}

run().catch(err => {
    console.error('Baseline failed:', err);
    process.exit(1);
});
