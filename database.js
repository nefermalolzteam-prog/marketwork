import sqlite3 from 'sqlite3';
import path from 'path';

const dbPath = path.resolve('bot_history.db');

// Инициализация БД
export function initDatabase() {
  const db = new sqlite3.Database(dbPath);
  
  // Создание таблиц
  db.serialize(() => {
    db.run(`
      CREATE TABLE IF NOT EXISTS checks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        mode TEXT,
        category TEXT,
        results TEXT,
        violations_count INTEGER
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS listings (
        id TEXT PRIMARY KEY,
        title TEXT,
        price TEXT,
        origin TEXT,
        violations TEXT,
        url TEXT,
        last_checked DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  });

  return db;
}

// Сохранение результатов проверки
export function saveCheckResults(db, mode, category, results) {
  return new Promise((resolve, reject) => {
    const violationsCount = results.reduce((sum, item) => sum + item.violations.length, 0);
    db.run(`
      INSERT INTO checks (mode, category, results, violations_count, timestamp)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    `, [mode, category, JSON.stringify(results), violationsCount], function(err) {
      if (err) reject(err);
      else {
        // Сохранить объявления
        const stmt = db.prepare(`
          INSERT OR REPLACE INTO listings (id, title, price, origin, violations, url, last_checked)
          VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `);
        
        let completed = 0;
        results.forEach(item => {
          stmt.run([
            item.id,
            item.title,
            item.price,
            item.origin,
            JSON.stringify(item.violations),
            item.url
          ], (err) => {
            if (err) console.error('Ошибка сохранения объявления:', err);
            completed++;
            if (completed === results.length) {
              stmt.finalize();
              resolve();
            }
          });
        });
      }
    });
  });
}

// Загрузка истории проверок
export function loadCheckHistory(db, limit = 10) {
  return new Promise((resolve, reject) => {
    db.all(`
      SELECT * FROM checks ORDER BY timestamp DESC LIMIT ?
    `, [limit], (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

// Поиск объявлений по ID
export function findListingById(db, id) {
  return new Promise((resolve, reject) => {
    db.get(`
      SELECT * FROM listings WHERE id = ?
    `, [id], (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

// Получение статистики
export function getStatistics(db) {
  return new Promise((resolve, reject) => {
    db.get(`
      SELECT
        COUNT(*) as total_checks,
        SUM(violations_count) as total_violations,
        AVG(violations_count) as avg_violations_per_check
      FROM checks
    `, [], (err, stats) => {
      if (err) reject(err);
      else {
        db.get(`
          SELECT COUNT(*) as recent_listings
          FROM listings
          WHERE last_checked > datetime('now', '-1 day')
        `, [], (err, recent) => {
          if (err) reject(err);
          else resolve({ ...stats, ...recent });
        });
      }
    });
  });
}