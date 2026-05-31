import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function generatePathNames(inputFile = path.join(__dirname, 'market.json'), outputFile = path.join(__dirname, 'path_names.txt')) {
  if (!fs.existsSync(inputFile)) {
    throw new Error(`Input file not found: ${inputFile}`);
  }

  const market = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
  const paths = Object.keys(market.paths || {}).filter((p) => p.startsWith('/') && p !== '/');

  if (paths.length === 0) {
    console.warn('⚠️  market.json is empty or paths not found');
    return 0;
  }

  fs.writeFileSync(outputFile, paths.join('\n'), 'utf8');
  console.log(`✅ Wrote ${paths.length} paths to ${outputFile}`);
  return paths.length;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    generatePathNames();
  } catch (err) {
    console.error('Ошибка при генерации путей:', err && err.message ? err.message : err);
    process.exit(1);
  }
}
