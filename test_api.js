import fs from 'fs';
import path from 'path';
import https from 'https';
import crypto from 'crypto';

const configPath = path.resolve('config.json');
if (!fs.existsSync(configPath)) {
  console.error('config.json not found');
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const base = (config.apiBaseUrl || 'https://prod-api.lzt.market').replace(/\/+$/, '');
const url = `${base}/?page=1`;
const token = config.token;

const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
  secureOptions: crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT,
  minVersion: 'TLSv1',
  maxVersion: 'TLSv1.3',
  honorCipherOrder: true,
  ciphers: 'ALL'
});

console.log('Request URL:', url);

(async () => {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    const headers = { Accept: 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(url, { headers, signal: controller.signal, agent: httpsAgent });
    clearTimeout(timeoutId);

    console.log('Status:', res.status, res.statusText);
    console.log('Content-Type:', res.headers.get('content-type'));

    const text = await res.text();
    try {
      const json = JSON.parse(text);
      console.log('Body (JSON):', JSON.stringify(json, null, 2));
    } catch {
      console.log('Body (text):', text.slice(0, 2000));
    }
  } catch (err) {
    console.error('Request error:', err && err.message ? err.message : err);
    console.error(err);
    if (err?.name === 'AbortError') console.error('Timeout or aborted');
  }
})();
