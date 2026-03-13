
import { processModule } from './src/content/module-processor.server';
import fs from 'node:fs/promises';

async function test() {
    console.log('Starting simplified verification test...');
    
    // We don't initialize the whole registry, we just rely on the proxy
    // to find widgets if we populate it in the test or if it's already populated.
    // Actually, processModule gets widgets from widgetRegistryService.getAllWidgets().
    
    // Let's mock the service or just trust the code.
    // Given the environment, I'll just try to read the file and see if I can detect the issue.
    
    const postsPath = './config/collections/Posts.ts';
    const content = await fs.readFile(postsPath, 'utf-8');
    
    console.log('Processing module...');
    const result = await processModule(content);
    
    if (result && result.schema) {
        console.log('✅ Success! Schema processed.');
        console.log('Schema Name:', result.schema.name);
    } else {
        console.log('❌ Failure! Schema not processed.');
    }
}

test().catch(console.error);
