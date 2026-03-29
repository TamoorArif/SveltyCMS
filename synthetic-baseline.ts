import fs from 'node:fs/promises';
import path from 'node:path';

const DUMMY_DIR = path.resolve(process.cwd(), '.dummyCollections');

async function setupDummyCollections(count: number) {
    if (await fs.stat(DUMMY_DIR).catch(() => null)) {
        await fs.rm(DUMMY_DIR, { recursive: true });
    }
    await fs.mkdir(DUMMY_DIR);
    
    for (let i = 0; i < count; i++) {
        const content = `export const schema = { name: "Collection ${i}", fields: [] };`;
        await fs.writeFile(path.join(DUMMY_DIR, `collection-${i}.js`), content);
    }
}

async function measureBaseline() {
    console.log('--- Synthetic Baseline Measurement ---');
    const count = 100;
    await setupDummyCollections(count);
    
    const start = performance.now();
    // Simulate current scan logic (full scan every time)
    const entries = await fs.readdir(DUMMY_DIR);
    const results = await Promise.all(entries.map(async (file) => {
        const content = await fs.readFile(path.join(DUMMY_DIR, file), 'utf-8');
        // Simulate processing (regex + Function constructor)
        return { name: file, content }; 
    }));
    const end = performance.now();
    
    console.log('Baseline (100 Collections Full Scan):', (end - start).toFixed(2), 'ms');
    console.log('Collections processed:', results.length);
    
    // Clean up
    await fs.rm(DUMMY_DIR, { recursive: true });
    process.exit(0);
}

measureBaseline();
