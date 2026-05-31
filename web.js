import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function startWebServer(results, port = 3000) {
  const app = express();

  // Статические файлы (если есть)
  const publicDir = path.join(__dirname, 'public');
  if (fs.existsSync(publicDir)) {
    app.use(express.static(publicDir));
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  app.get('/', (req, res) => {
    try {
      const list = Array.isArray(results) ? [...results] : [];
      const rows = list.map(item => `
      <tr>
        <td>${escapeHtml(item.id)}</td>
        <td>${escapeHtml(item.title)}</td>
        <td>${escapeHtml(item.price)}</td>
        <td>${escapeHtml(item.origin)}</td>
        <td class="violation">${escapeHtml(Array.isArray(item.violations) ? item.violations.map(v => v.name || v.keyword || v).join(', ') : String(item.violations || ''))}</td>
        <td><a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">Ссылка</a></td>
      </tr>
    `).join('');

      res.type('html');
      res.set('Content-Security-Policy', "default-src 'self'; style-src 'unsafe-inline';");
      res.send(`
      <!DOCTYPE html>
      <html lang="ru">
      <head>
        <meta charset="UTF-8">
        <title>LZT Market Bot - Результаты</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; }
          table { border-collapse: collapse; width: 100%; }
          th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
          th { background-color: #f2f2f2; }
          .violation { color: red; }
        </style>
      </head>
      <body>
        <h1>Результаты проверки LZT Market</h1>
        <p>Всего объявлений: ${list.length}</p>
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Название</th>
              <th>Цена</th>
              <th>Происхождение</th>
              <th>Нарушения</th>
              <th>Ссылка</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </body>
      </html>
    `);
    } catch (err) {
      console.error('Ошибка рендеринга веб-страницы:', err && err.message ? err.message : err);
      res.status(500).send('Внутренняя ошибка сервера');
    }
  });

  // API для получения результатов в JSON
  app.get('/api/results', (req, res) => {
    try {
      const safe = Array.isArray(results) ? results.map(r => ({ id: r.id, title: r.title, price: r.price, origin: r.origin, violations: r.violations, url: r.url })) : [];
      res.type('application/json');
      res.json(safe);
    } catch (err) {
      console.error('Ошибка при формировании /api/results:', err?.message || err);
      res.status(500).json({ error: 'internal_error' });
    }
  });

  const server = app.listen(port, () => {
    console.log(`Веб-сервер запущен на http://localhost:${port}`);
  });

  // Обработчик ошибок сервера
  server.on('error', (err) => console.error('Web server error:', err && err.message ? err.message : err));

  return server;
}