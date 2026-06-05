import fs from 'fs';
import path from 'path';
import { buildSearchUrl, fetchJson } from './api.js';

const configPath = path.resolve('config.json');
if (!fs.existsSync(configPath)) {
  console.error('config.json not found');
  process.exit(1);
}
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

async function run() {
  const url = buildSearchUrl({ ...config, category: '24', resultsPerPage: 1 }, 1, true);
  console.log('Test URL:', url);
  try {
    const res = await fetchJson(url, { token: config.token, alternateUrl: config.apiAlternateUrl, retries: 2, timeoutMs: 15000 });
    console.log('Response keys:', Object.keys(res));
  } catch (e) {
    console.error('Fetch error:', e.code || '', e.message);
    console.error(e);
    process.exit(1);
  }
}

run();
