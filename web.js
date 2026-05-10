import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function startWebServer(results, port = 3000) {
  const app = express();

  // Статические файлы
  app.use(express.static(path.join(__dirname, 'public')));

  // Маршрут для главной страницы
  app.get('/', (req, res) => {
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
        <p>Всего объявлений: ${results.length}</p>
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
            ${results.map(item => `
              <tr>
                <td>${item.id}</td>
                <td>${item.title}</td>
                <td>${item.price}</td>
                <td>${item.origin}</td>
                <td class="violation">${item.violations.map(v => v.name).join(', ')}</td>
                <td><a href="${item.url}" target="_blank">Ссылка</a></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </body>
      </html>
    `);
  });

  // API для получения результатов в JSON
  app.get('/api/results', (req, res) => {
    res.json(results);
  });

  app.listen(port, () => {
    console.log(`Веб-сервер запущен на http://localhost:${port}`);
  });

  return app;
}