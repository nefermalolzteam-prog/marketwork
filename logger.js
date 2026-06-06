import fs from 'fs';
import path from 'path';

/**
 * Путь к основному файлу логов
 * @type {string}
 */
let LOG_FILE = path.resolve('bot.log');

/**
 * Путь к файлу логов ошибок
 * @type {string}
 */
let ERROR_LOG_FILE = path.resolve('errors.log');

/**
 * Максимальный размер логов перед ротацией (10 MB по умолчанию)
 * @type {number}
 */
let MAX_LOG_SIZE = 10 * 1024 * 1024;

/**
 * Произвести ротацию логов если они превышают максимальный размер
 * @param {string} filePath - Путь к файлу логов
 * @param {number} maxBytes - Максимальный размер в байтах
 */
function rotateLogIfNeeded(filePath, maxBytes) {
  try {
    if (!fs.existsSync(filePath)) return;
    const stats = fs.statSync(filePath);
    if (stats.size <= maxBytes) return;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const archiveName = `${filePath}.${timestamp}.bak`;
    try {
      fs.renameSync(filePath, archiveName);
    } catch {
      // В резервном режиме: копируем и обнуляем файл
      try {
        const data = fs.readFileSync(filePath);
        fs.writeFileSync(archiveName, data);
        fs.truncateSync(filePath, 0);
      } catch (inner) {
        // если ротация полностью не удалась, выводим ошибку в консоль
        console.error('Не удалось произвести ротацию логов:', inner?.message || inner);
      }
    }
  } catch (err) {
    console.error('Ошибка при проверке размера лога:', err?.message || err);
  }
}

/**
 * Добавить сообщение в файл лога
 * @param {string} filePath - Путь к файлу логов
 * @param {string} message - Сообщение для логирования
 */
function appendLog(filePath, message) {
  try {
    const dir = path.dirname(filePath);
    if (dir && !fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    rotateLogIfNeeded(filePath, MAX_LOG_SIZE);
    fs.appendFileSync(filePath, `${message}\n`, 'utf8');
  } catch (err) {
    // Если запись лога не удалась, выводим ошибку в консоль в крайнем случае
    try {
      console.error('Ошибка записи лога:', err?.message || err);
    } catch {
      // Игнорируем последующие ошибки
    }
  }
}

export function initializeLogging(config = {}) {
  if (config.logFile) {
    LOG_FILE = path.resolve(config.logFile);
  }
  if (config.errorLogFile) {
    ERROR_LOG_FILE = path.resolve(config.errorLogFile);
  }
  if (config.maxLogSizeBytes && Number.isInteger(config.maxLogSizeBytes) && config.maxLogSizeBytes > 0) {
    MAX_LOG_SIZE = config.maxLogSizeBytes;
  }
  logInfo(`Запуск бота. log=${LOG_FILE}, errorLog=${ERROR_LOG_FILE}, maxLogSize=${MAX_LOG_SIZE}`);
}

export function logInfo(message) {
  appendLog(LOG_FILE, `[${new Date().toISOString()}] INFO: ${message}`);
}

export function logError(message) {
  appendLog(ERROR_LOG_FILE, `[${new Date().toISOString()}] ERROR: ${message}`);
}

export function getLogFilesInfo() {
  try {
    const info = [];
    [LOG_FILE, ERROR_LOG_FILE].forEach((file) => {
      try {
        const stats = fs.existsSync(file) ? fs.statSync(file) : null;
        info.push({ path: file, size: stats ? stats.size : 0 });
      } catch (err) {
        info.push({ path: file, size: 0, error: err.message });
      }
    });
    return info;
  } catch {
    return [];
  }
}
