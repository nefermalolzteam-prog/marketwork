import sqlite3 from 'sqlite3';
import path from 'path';
import { logInfo, logError } from './logger.js';

/**
 * Инициализация БД с настройками из config
 * @param {Object} config - Конфигурация со значением dbPath (опционально)
 * @returns {Database} sqlite3 Database instance
 */
export function initDatabase(config = {}) {
  const dbPath = config.dbPath ? path.resolve(config.dbPath) : path.resolve('bot_history.db');
  
  const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
      logError(`Ошибка подключения к БД: ${err.message}`);
    } else {
      logInfo(`Подключение к БД: ${dbPath}`);
    }
  });
  
  // Создание таблиц с использованием prepared statements
  db.serialize(() => {
    db.run(`
      CREATE TABLE IF NOT EXISTS checks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        mode TEXT NOT NULL,
        category TEXT,
        results TEXT,
        violations_count INTEGER DEFAULT 0
      )
    `, (err) => {
      if (err) logError(`Ошибка создания таблицы checks: ${err.message}`);
    });

    db.run(`
      CREATE TABLE IF NOT EXISTS listings (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        price TEXT,
        origin TEXT,
        violations TEXT,
        url TEXT,
        last_checked DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `, (err) => {
      if (err) logError(`Ошибка создания таблицы listings: ${err.message}`);
    });

    // Создание индексов для оптимизации запросов
    db.run('CREATE INDEX IF NOT EXISTS idx_checks_timestamp ON checks(timestamp)', (err) => {
      if (err) logError(`Ошибка создания индекса idx_checks_timestamp: ${err.message}`);
    });
    
    db.run('CREATE INDEX IF NOT EXISTS idx_listings_last_checked ON listings(last_checked)', (err) => {
      if (err) logError(`Ошибка создания индекса idx_listings_last_checked: ${err.message}`);
    });
  });

  return db;
}

/**
 * Очистка старых записей из БД (с использованием параметризованных запросов)
 * @param {Database} db - sqlite3 Database instance
 * @param {number} days - Количество дней хранения (по умолчанию 30)
 * @returns {Promise<void>}
 */
export function purgeOldRecords(db, days = 30) {
  return new Promise((resolve, reject) => {
    if (!db) return resolve();
    
    const safeDays = Math.max(1, Number.isInteger(days) && days > 0 ? days : 30);
    
    // Используем параметризованный запрос вместо string interpolation
    db.serialize(() => {
      db.run('BEGIN TRANSACTION');
      
      // Удаление старых checks
      db.run(
        `DELETE FROM checks WHERE timestamp < datetime('now', ?)`,
        [`-${safeDays} days`],
        function(err) {
          if (err) {
            logError(`Ошибка при очистке старых checks: ${err.message}`);
            db.run('ROLLBACK');
            return reject(err);
          }
          const deletedChecks = this.changes;
          
          // Удаление старых listings
          db.run(
            `DELETE FROM listings WHERE last_checked < datetime('now', ?)`,
            [`-${safeDays} days`],
            function(err2) {
              if (err2) {
                logError(`Ошибка при очистке старых listings: ${err2.message}`);
                db.run('ROLLBACK');
                return reject(err2);
              }
              const deletedListings = this.changes;
              
              db.run('COMMIT', (err3) => {
                if (err3) {
                  logError(`Ошибка при коммите транзакции: ${err3.message}`);
                  return reject(err3);
                }
                logInfo(`Очистка завершена: удалены ${deletedChecks} checks и ${deletedListings} listings старше ${safeDays} дней`);
                resolve();
              });
            }
          );
        }
      );
    });
  });
}

/**
 * Сохранение результатов проверки в БД
 * @param {Database} db - sqlite3 Database instance
 * @param {string} mode - Режим проверки
 * @param {string} category - ID категории
 * @param {Array} results - Массив результатов
 * @returns {Promise<void>}
 */
export function saveCheckResults(db, mode, category, results) {
  return new Promise((resolve, reject) => {
    try {
      if (!db) return resolve();
      if (!Array.isArray(results) || results.length === 0) return resolve();
      
      const violationsCount = results.reduce((sum, item) => {
        if (Array.isArray(item.violations)) return sum + item.violations.length;
        return sum + (item.violations ? 1 : 0);
      }, 0);

      db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        db.run(
          `INSERT INTO checks (mode, category, results, violations_count, timestamp)
           VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
          [String(mode), String(category), JSON.stringify(results), violationsCount],
          function(err) {
            if (err) {
              logError(`Ошибка сохранения результатов checks: ${err.message}`);
              db.run('ROLLBACK');
              return reject(err);
            }

            const stmt = db.prepare(`
              INSERT OR REPLACE INTO listings (id, title, price, origin, violations, url, last_checked)
              VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            `);

            let savedCount = 0;
            let skippedCount = 0;
            const processResultsSequentially = (index) => {
              if (index >= results.length) {
                stmt.finalize((err) => {
                  if (err) {
                    logError(`Ошибка finalizing statement: ${err.message}`);
                    db.run('ROLLBACK');
                    return reject(err);
                  }
                  db.run('COMMIT', (err) => {
                    if (err) {
                      logError(`Ошибка коммита транзакции: ${err.message}`);
                      return reject(err);
                    }
                    logInfo(`Сохранено listings: ${savedCount} объявлений, пропущено: ${skippedCount}`);
                    resolve();
                  });
                });
                return;
              }

              const item = results[index];
              const id = item?.id || item?.uid || item?.item_id;
              
              if (!id) {
                skippedCount++;
                return processResultsSequentially(index + 1);
              }

              try {
                stmt.run([
                  String(id),
                  item.title || '',
                  item.price || '',
                  item.origin || '',
                  JSON.stringify(
                    Array.isArray(item.violations) 
                      ? item.violations 
                      : (item.violations ? [item.violations] : [])
                  ),
                  item.url || ''
                ], (err) => {
                  if (err) {
                    logError(`Ошибка сохранения объявления ${id}: ${err.message}`);
                    skippedCount++;
                  } else {
                    savedCount++;
                  }
                  processResultsSequentially(index + 1);
                });
              } catch (err) {
                logError(`Exception при сохранении объявления ${id}: ${err && err.message ? err.message : err}`);
                skippedCount++;
                processResultsSequentially(index + 1);
              }
            };
            
            processResultsSequentially(0);
          }
        );
      });
    } catch (err) {
      logError(`Ошибка в saveCheckResults: ${err && err.message ? err.message : err}`);
      reject(err);
    }
  });
}

// Закрытие БД
export function closeDatabase(db) {
  return new Promise((resolve, reject) => {
    if (!db) return resolve();
    db.close((err) => {
      if (err) {
        logError(`Ошибка закрытия БД: ${err.message}`);
        reject(err);
      } else {
        logInfo('БД закрыта успешно');
        resolve();
      }
    });
  });
}

/**
 * Загрузка истории проверок
 * @param {Database} db - sqlite3 Database instance
 * @param {number} limit - Максимальное количество записей
 * @returns {Promise<Array>} Массив записей checks
 */
export function loadCheckHistory(db, limit = 10) {
  return new Promise((resolve, reject) => {
    if (!db) return resolve([]);
    
    const safeLimit = Math.max(1, Number.isInteger(limit) ? limit : 10);
    db.all(
      `SELECT * FROM checks ORDER BY timestamp DESC LIMIT ?`,
      [safeLimit],
      (err, rows) => {
        if (err) {
          logError(`Ошибка загрузки истории проверок: ${err.message}`);
          reject(err);
        } else {
          resolve(rows || []);
        }
      }
    );
  });
}

/**
 * Поиск объявления по ID
 * @param {Database} db - sqlite3 Database instance
 * @param {string} id - ID объявления
 * @returns {Promise<Object|null>} Найденное объявление или null
 */
export function findListingById(db, id) {
  return new Promise((resolve, reject) => {
    if (!db || !id) return resolve(null);
    
    db.get(
      `SELECT * FROM listings WHERE id = ?`,
      [String(id)],
      (err, row) => {
        if (err) {
          logError(`Ошибка поиска объявления ${id}: ${err.message}`);
          reject(err);
        } else {
          resolve(row || null);
        }
      }
    );
  });
}

/**
 * Получение статистики по проверкам
 * @param {Database} db - sqlite3 Database instance
 * @returns {Promise<Object>} Объект со статистикой
 */
export function getStatistics(db) {
  return new Promise((resolve, reject) => {
    if (!db) return resolve({});
    
    db.get(
      `
      SELECT
        COUNT(*) as total_checks,
        SUM(violations_count) as total_violations,
        AVG(violations_count) as avg_violations_per_check
      FROM checks
      `,
      [],
      (err, stats) => {
        if (err) {
          logError(`Ошибка получения статистики checks: ${err.message}`);
          return reject(err);
        }
        
        db.get(
          `SELECT COUNT(*) as recent_listings FROM listings WHERE last_checked > datetime('now', '-1 day')`,
          [],
          (err2, recent) => {
            if (err2) {
              logError(`Ошибка получения последних listings: ${err2.message}`);
              return reject(err2);
            }
            
            resolve({
              total_checks: stats?.total_checks || 0,
              total_violations: stats?.total_violations || 0,
              avg_violations_per_check: stats?.avg_violations_per_check || 0,
              recent_listings: recent?.recent_listings || 0
            });
          }
        );
      }
    );
  });
}