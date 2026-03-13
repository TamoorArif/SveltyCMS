
import { processModule } from './src/content/module-processor.server';
import { widgetRegistryService } from './src/services/widget-registry-service';
import fs from 'node:fs/promises';

async function test() {
    console.log('Starting verification test...');
    await widgetRegistryService.initialize();
    
    const postsPath = './config/collections/Posts.ts';
    const content = await fs.readFile(postsPath, 'utf-8');
    
    console.log('Processing module...');
    const result = await processModule(content);
    
    if (result && result.schema) {
        console.log('✅ Success! Schema processed.');
        console.log('Schema Name:', result.schema.name);
        console.log('Field count:', result.schema.fields.length);
        console.log('Fields:', result.schema.fields.map(f => f.label).join(', '));
    } else {
        console.log('❌ Failure! Schema not processed.');
    }
}

test().catch(console.error);
