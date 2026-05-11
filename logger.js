import fs from 'fs';
import path from 'path';

let LOG_FILE = path.resolve('bot.log');
let ERROR_LOG_FILE = path.resolve('errors.log');

function appendLog(filePath, message) {
  try {
    fs.appendFileSync(filePath, `${message}\n`, 'utf8');
  } catch {
    // ignore logging failures
  }
}

export function initializeLogging(config) {
  if (config.logFile) {
    LOG_FILE = path.resolve(config.logFile);
  }
  if (config.errorLogFile) {
    ERROR_LOG_FILE = path.resolve(config.errorLogFile);
  }
  logInfo(`Запуск бота. log=${LOG_FILE}, errorLog=${ERROR_LOG_FILE}`);
}

export function logInfo(message) {
  appendLog(LOG_FILE, `[${new Date().toISOString()}] INFO: ${message}`);
}

export function logError(message) {
  appendLog(ERROR_LOG_FILE, `[${new Date().toISOString()}] ERROR: ${message}`);
}
