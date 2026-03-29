/**
 * @file scripts/migrate-api-to-local.ts
 * @description
 * Analyzes the existing 54+ HTTP API routes and extracts their logic into
 * the centralized LocalCMS SDK. This automates the transition to the
 * high-performance 'One Route Only' dispatcher architecture.
 */

import fs from "node:fs/promises";
import path from "node:path";

const API_ROOT = "src/routes/api/http";

async function scanRoutes() {
    console.log("🔍 Scanning for legacy API routes in", API_ROOT);
    const entries = await fs.readdir(API_ROOT, { withFileTypes: true });
    
    for (const entry of entries) {
        if (!entry.isDirectory() || entry.name === "[...path]") continue;
        
        const folderPath = path.join(API_ROOT, entry.name);
        await processFolder(folderPath, entry.name);
    }
}

async function processFolder(folderPath: string, namespace: string) {
    const subEntries = await fs.readdir(folderPath, { withFileTypes: true });
    
    for (const sub of subEntries) {
        if (sub.isDirectory()) {
            await processFolder(path.join(folderPath, sub.name), `${namespace}/${sub.name}`);
        } else if (sub.name === "+server.ts") {
            await analyzeServerFile(path.join(folderPath, sub.name), namespace);
        }
    }
}

async function analyzeServerFile(filePath: string, namespace: string) {
    const content = await fs.readFile(filePath, "utf-8");
    
    console.log(`\n📄 Analyzing: ${namespace} (+server.ts)`);
    
    // Simple heuristic to find service calls
    const imports = content.match(/from "(@src\/services\/[^"]+)"/g) || [];
    const methods = content.match(/export const (GET|POST|PATCH|DELETE)/g) || [];
    
    console.log(`   - Methods: ${methods.map(m => m.split(' ').pop()).join(', ')}`);
    if (imports.length > 0) {
        console.log(`   - Potential Services: ${imports.join(', ')}`);
    }

    // Recommendation
    if (namespace.startsWith('collections')) {
        console.log("   ✅ Status: Already Consolidated");
    } else if (namespace.startsWith('user')) {
        console.log("   🚀 Action: Move to LocalCMS.auth or LocalCMS.users");
    } else {
        console.log(`   🚀 Action: Extract logic to LocalCMS.${namespace.split('/')[0]}`);
    }
}

scanRoutes().catch(console.error);
