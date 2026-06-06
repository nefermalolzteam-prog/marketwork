import { setTimeout as delay } from 'timers/promises';
import https from 'https';
import http from 'http';
import { URL } from 'url';
import { logInfo, logError } from './logger.js';
import { CATEGORY_PATHS, PARALLEL_DISABLED_MODES } from './constants.js';

const GLOBAL_HTTPS_AGENT = new https.Agent({
  rejectUnauthorized: false
});

async function createProxyAgent(proxyUrl) {
  if (!proxyUrl) return null;
  try {
    const module = await import('https-proxy-agent');
    return new module.HttpsProxyAgent(proxyUrl);
  } catch (error) {
    const missingPackage = error?.code === 'ERR_MODULE_NOT_FOUND'
      || error?.code === 'MODULE_NOT_FOUND'
      || String(error?.message || '').includes("Cannot find package 'https-proxy-agent'");

    if (missingPackage) {
      throw new Error('Для поддержки HTTPS-прокси требуется пакет https-proxy-agent; установите его или снимите настройки HTTPS_PROXY/http_proxy.');
    }
    throw error;
  }
}

const DEFAULT_REQUEST_TIMEOUT_MS = 30000; // 30s
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY = 500;

function getUrlWithAlternateBase(url, alternateBase) {
  try {
    const original = new URL(url);
    const base = new URL(alternateBase);
    const basePath = base.pathname.replace(/\/+$/, '');
    const fullPath = `${basePath}${original.pathname}`.replace(/\/\/+/, '/');
    return new URL(`${fullPath}${original.search}`, `${base.protocol}//${base.hostname}${base.port ? `:${base.port}` : ''}`).toString();
  } catch {
    return null;
  }
}

/**
 * Проверяет, позволяет ли режим параллельную обработку
 * @param {string} mode - Режим работы
 * @returns {boolean} True если параллель разрешена
 */
export function isParallelMode(mode) {
  return !PARALLEL_DISABLED_MODES.has(mode);
}

/**
 * Собирает параметры для URL на основе конфигурации
 * @param {Object} config - Конфигурация поиска
 * @returns {URLSearchParams} Параметры запроса
 * @private
 */
function buildSearchParams(config) {
  const params = new URLSearchParams({
    page: String(config.page || 1),
    order_by: config.order_by || 'pdate_to_down'
  });

  // Добавляем опциональные параметры фильтра цены
  if (config.pmin) params.append('pmin', String(config.pmin));
  if (config.pmax) params.append('pmax', String(config.pmax));

  // Ключевые слова
  if (config.keywords && config.keywords.length > 0) {
    const titleQuery = Array.isArray(config.keywords)
      ? config.keywords.filter(Boolean).join(' ')
      : String(config.keywords).trim();
    if (titleQuery) params.append('title', titleQuery);
  }

  // Результаты на странице (парамет дублируется для совместимости API)
  if (config.resultsPerPage) {
    const perPage = String(config.resultsPerPage);
    params.append('perPage', perPage);
    params.append('resultsPerPage', perPage);
  }

  // Фильтры по происхождению
  if (Array.isArray(config.includeOrigins)) {
    config.includeOrigins.forEach(origin => params.append('origin[]', origin));
  }
  if (Array.isArray(config.excludeOrigins)) {
    config.excludeOrigins.forEach(origin => params.append('not_origin[]', origin));
  }

  // Категория (если не используется путь)
  if (config.category && !config.usePath) {
    params.append('category', String(config.category));
  }

  return params;
}

/**
 * Строит URL для поиска на LZT Market API
 * @param {Object} config - Конфигурация с полями: apiBaseUrl, keywords, category, resultsPerPage, order_by, includeOrigins, excludeOrigins
 * @param {number} page - Номер страницы
 * @param {boolean} usePath - Использовать путь категории (по умолчанию true)
 * @returns {string} Полный URL для запроса
 */
export function buildSearchUrl(config, page = 1, usePath = true) {
  const baseUrl = (config.apiBaseUrl || 'https://prod-api.lzt.market').replace(/\/+$/, '');
  
  const searchConfig = { ...config, page, usePath };
  const params = buildSearchParams(searchConfig);

  const categoryPath = CATEGORY_PATHS[String(config.category)];
  if (usePath && categoryPath) {
    return `${baseUrl}/${categoryPath}?${params}`;
  }

  return `${baseUrl}/?${params}`;
}

/**
 * Выполняет HTTP запрос с автоматическим повтором и обработкой ошибок
 * Использует встроенный https модуль вместо fetch для совместимости с Windows
 * @param {string} url - URL для запроса
 * @param {string|Object} arg2 - Токен (строка) или объект конфигурации {token, retries, retryDelayMs, timeoutMs, maxBodyBytes}
 * @returns {Promise<Object>} Распарсенный JSON ответ
 */
export async function fetchJson(url, arg2 = {}, arg3 = undefined, arg4 = undefined) {
  // Парсим параметры с обратной совместимостью
  let token;
  let maxRetries = DEFAULT_MAX_RETRIES;
  let baseDelay = DEFAULT_BASE_DELAY;
  let timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS;
  let maxBodyBytes = null;
  let alternateUrl = null;
  let proxyUrl = null;

  if (typeof arg2 === 'string') {
    token = arg2;
    if (Number.isInteger(arg3)) {
      maxRetries = arg3;
    }
    if (Number.isInteger(arg4)) {
      baseDelay = arg4;
    }
  } else if (typeof arg2 === 'number') {
    maxRetries = arg2;
    if (Number.isInteger(arg3)) {
      baseDelay = arg3;
    }
  } else if (typeof arg2 === 'object' && arg2 !== null) {
    token = arg2.token || arg2.auth || arg2.bearer;
    if (Number.isInteger(arg2.retries)) maxRetries = arg2.retries;
    if (Number.isInteger(arg2.retryDelayMs)) baseDelay = arg2.retryDelayMs;
    if (Number.isInteger(arg2.timeoutMs)) timeoutMs = arg2.timeoutMs;
    if (Number.isInteger(arg2.maxBodyBytes)) maxBodyBytes = arg2.maxBodyBytes;
    if (typeof arg2.alternateUrl === 'string') alternateUrl = arg2.alternateUrl;
    if (typeof arg2.proxyUrl === 'string') proxyUrl = arg2.proxyUrl;
    if (typeof arg2.proxy === 'string' && !proxyUrl) proxyUrl = arg2.proxy;
  }

  if (!proxyUrl) {
    proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy || null;
  }

  // Валидируем параметры
  maxRetries = Math.max(0, Number.isInteger(maxRetries) ? maxRetries : DEFAULT_MAX_RETRIES);
  baseDelay = Math.max(0, Number.isInteger(baseDelay) ? baseDelay : DEFAULT_BASE_DELAY);
  timeoutMs = Math.max(1, Number.isInteger(timeoutMs) ? timeoutMs : DEFAULT_REQUEST_TIMEOUT_MS);

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await makeHttpRequest(url, token, timeoutMs, maxBodyBytes, proxyUrl);
      return response;
    } catch (error) {
      const isLastAttempt = attempt >= maxRetries;
      const shouldRetry = !isLastAttempt;

      // Незамедлительный fallback при ошибке TLS/EPROTO: если при попытке соединения получены ошибки
      // связанные с TLS, сначала попробуем alternateUrl (если задан), затем HTTP.
      try {
        const errMsgLower = String(error?.message || '').toLowerCase();
        const isTlsProtocolError = error?.code === 'EPROTO' || errMsgLower.includes('wrong version number') || errMsgLower.includes('tls_validate_record_header') || errMsgLower.includes('write eproto');
        if (isTlsProtocolError && alternateUrl) {
          const fallbackUrl = getUrlWithAlternateBase(url, alternateUrl);
          if (fallbackUrl) {
            const msg = `Ошибка TLS ${error?.code || ''}; немедленно переключаемся на альтернативный API: ${fallbackUrl}`;
            console.warn(msg);
            logInfo(msg);
            url = fallbackUrl;
            alternateUrl = null;
            continue;
          }
        }
        // HTTP-fallback отключён, остаёмся на HTTPS; если alternateUrl задан, попробуем его.
      } catch {
        // Игнорируем неожиданные ошибки при проверке условий fallback
      }

      // Обработка лимита запросов (429)
      if (error?.message === 'rate_limit') {
        if (shouldRetry) {
          const wait = baseDelay * Math.pow(2, attempt);
          logInfo(`Лимит запросов 429, повтор ${attempt + 1}/${maxRetries} через ${wait} мс: ${url}`);
          await delay(wait);
          continue;
        }
        throw error;
      }

      // Обработка ошибок сервера (5xx)
      if (error?.message?.startsWith('HTTP 5')) {
        if (shouldRetry) {
          const wait = baseDelay * Math.pow(2, attempt);
          logInfo(`Ошибка сервера, повтор ${attempt + 1}/${maxRetries} через ${wait} мс: ${url}`);
          await delay(wait);
          continue;
        }
        throw error;
      }

      // Обработка timeout
      if (error?.code === 'ETIMEDOUT' || error?.message?.includes('timeout')) {
        if (shouldRetry) {
          const wait = baseDelay * Math.pow(2, attempt);
          logInfo(`Таймаут запроса, повтор ${attempt + 1}/${maxRetries} через ${wait} мс: ${url}`);
          await delay(wait);
          continue;
        }
        throw new Error('timeout');
      }

      // Обработка ошибок сети (транзиторные)
      const transientErrors = ['ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'EPROTO'];
      const transientMessages = ['fetch failed', 'tls_validate_record_header', 'wrong version number', 'SSL routines'];
      const messageText = String(error?.message || '').toLowerCase();
      const isNetworkError = transientErrors.includes(error?.code) || transientMessages.some(msg => messageText.includes(msg));
      if (isNetworkError) {
        if (shouldRetry && alternateUrl) {
          const fallbackUrl = getUrlWithAlternateBase(url, alternateUrl);
          if (fallbackUrl) {
            const msg = `Сетевая ошибка ${error?.code || error?.message}; переключаемся на альтернативный API и повторяем ${attempt + 1}/${maxRetries}: ${fallbackUrl}`;
            console.warn(msg);
            logInfo(msg);
            url = fallbackUrl;
            alternateUrl = null;
            continue;
          }
        }

        if (shouldRetry) {
          const wait = baseDelay * Math.pow(2, attempt);
          logInfo(`Сетевая ошибка ${error?.code || error?.message}, повтор ${attempt + 1}/${maxRetries} через ${wait} мс: ${url}`);
          await delay(wait);
          continue;
        }
      }

      // Логирование и выброс последней ошибки
      logError(`Ошибка запроса: ${url} — ${error?.message || String(error)}${error?.code ? ` (${error.code})` : ''}`);
      throw error;
    }
  }
}

/**
 * Выполняет HTTPS запрос через встроенный https модуль
 * @private
 * @param {string} url - URL для запроса
 * @param {string} token - JWT токен
 * @param {number} timeoutMs - Таймаут в миллисекундах
 * @returns {Promise<Object>} Распарсенный JSON ответ
 */
async function makeHttpRequest(url, token, timeoutMs, maxBodyBytes = null, proxyUrl = null) {
    const parsedUrl = new URL(url);
    const isHttps = parsedUrl.protocol === 'https:';
    const defaultPort = isHttps ? 443 : 80;
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || defaultPort,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Connection': 'close',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: timeoutMs
    };

    if (isHttps) {
      options.rejectUnauthorized = false; // Отключаем проверку сертификата для Windows
      options.agent = proxyUrl ? await createProxyAgent(proxyUrl) : GLOBAL_HTTPS_AGENT;
    }

    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }

    return new Promise((resolve, reject) => {
      const client = isHttps ? https : http;
      const req = client.get(options, (res) => {
      let data = '';
      let receivedBytes = 0;

      res.on('data', (chunk) => {
        receivedBytes += chunk.length;
        if (maxBodyBytes !== null && receivedBytes > maxBodyBytes) {
          req.destroy(new Error('response_too_large'));
          return;
        }
        data += chunk;
      });

      res.on('end', () => {
        try {
          // Обработка лимита запросов
          if (res.statusCode === 429) {
            reject(new Error('rate_limit'));
            return;
          }

          // Обработка ошибок сервера
          if (res.statusCode >= 500 && res.statusCode < 600) {
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
            return;
          }

          // Обработка прочих HTTP ошибок
          if (res.statusCode < 200 || res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
            return;
          }

          // Парсим JSON
          const result = JSON.parse(data);
          resolve(result);
        } catch (error) {
          reject(new Error(`Неверный JSON ответ: ${error.message}`));
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
  });
}
