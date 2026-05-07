import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const market = JSON.parse(fs.readFileSync(path.join(__dirname, 'market.json'), 'utf8'));
const paths = Object.keys(market.paths || {}).filter((p) => p.startsWith('/') && p !== '/');

if (paths.length === 0) {
  console.warn('⚠️  market.json is empty or paths not found');
} else {
  fs.writeFileSync(path.join(__dirname, 'path_names.txt'), paths.join('\n'), 'utf8');
  console.log(`✅ Wrote ${paths.length} paths to path_names.txt`);
}
