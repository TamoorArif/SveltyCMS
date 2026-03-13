import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('__filename:', __filename);
console.log('__dirname:', __dirname);
console.log('Resolved setup path:', path.resolve(__dirname, 'tests/unit/setup.ts'));
console.log('Alternative setup path:', path.join(process.cwd(), 'tests/unit/setup.ts'));
