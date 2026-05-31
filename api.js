import { setTimeout as delay } from 'timers/promises';
import { logInfo, logError } from './logger.js';
import { CATEGORY_PATHS, PARALLEL_DISABLED_MODES } from './constants.js';

const DEFAULT_REQUEST_TIMEOUT_MS = 30000; // 30s
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY = 500;

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
 * Обрабатывает HTTP ошибки с логированием
 * @param {Response} response - Response объект
 * @param {string} url - URL запроса
 * @returns {Promise<Object>} JSON ответ если успех, иначе throw
 * @private
 */
async function handleHttpResponse(response, url) {
  if (response.status === 429) {
    throw new Error('rate_limit');
  }

  if (response.status >= 500 && response.status < 600) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }

  // Parse JSON safely
  try {
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      logInfo(`Non-JSON Content-Type: ${contentType} for ${url}`);
    }
    return await response.json();
  } catch (jsonError) {
    throw new Error(`Invalid JSON response: ${jsonError.message}`);
  }
}

/**
 * Выполняет HTTP запрос с автоматическим retry и обработкой ошибок
 * @param {string} url - URL для запроса
 * @param {string|Object} arg2 - Токен (строка) или объект конфигурации {token, retries, retryDelayMs, timeoutMs, maxBodyBytes}
 * @returns {Promise<Object>} Распарсенный JSON ответ
 */
export async function fetchJson(url, arg2 = {}) {
  // Парсим параметры с обратной совместимостью
  let token;
  let maxRetries = DEFAULT_MAX_RETRIES;
  let baseDelay = DEFAULT_BASE_DELAY;
  let timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS;
  let maxBodyBytes = null;

  if (typeof arg2 === 'string') {
    token = arg2;
  } else if (typeof arg2 === 'number') {
    maxRetries = arg2;
  } else if (typeof arg2 === 'object' && arg2 !== null) {
    token = arg2.token || arg2.auth || arg2.bearer;
    if (Number.isInteger(arg2.retries)) maxRetries = arg2.retries;
    if (Number.isInteger(arg2.retryDelayMs)) baseDelay = arg2.retryDelayMs;
    if (Number.isInteger(arg2.timeoutMs)) timeoutMs = arg2.timeoutMs;
    if (Number.isInteger(arg2.maxBodyBytes)) maxBodyBytes = arg2.maxBodyBytes;
  }

  // Валидируем параметры
  maxRetries = Math.max(0, Number.isInteger(maxRetries) ? maxRetries : DEFAULT_MAX_RETRIES);
  baseDelay = Math.max(0, Number.isInteger(baseDelay) ? baseDelay : DEFAULT_BASE_DELAY);
  timeoutMs = Math.max(1, Number.isInteger(timeoutMs) ? timeoutMs : DEFAULT_REQUEST_TIMEOUT_MS);

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      
      const headers = { Accept: 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;

      const response = await fetch(url, { headers, signal: controller.signal }).finally(() => clearTimeout(timeoutId));

      // Проверяем размер ответа (опционально)
      try {
        const contentLength = response.headers.get('content-length');
        if (contentLength && maxBodyBytes && Number(contentLength) > maxBodyBytes) {
          throw new Error(`Response too large: ${contentLength} bytes`);
        }
      } catch (hdrErr) {
        // Игнорируем ошибки парсинга заголовков
      }

      // Обработка ответа и ошибок HTTP
      return await handleHttpResponse(response, url);
      
    } catch (error) {
      const isLastAttempt = attempt >= maxRetries;
      const shouldRetry = !isLastAttempt;
      
      // Обработка timeout
      if (error?.name === 'AbortError') {
        if (shouldRetry) {
          const wait = baseDelay * Math.pow(2, attempt);
          logInfo(`Request timeout, retry ${attempt + 1}/${maxRetries} after ${wait} ms: ${url}`);
          await delay(wait);
          continue;
        }
        throw new Error('timeout');
      }

      // Обработка rate limit (429)
      if (error?.message === 'rate_limit') {
        if (shouldRetry) {
          const wait = baseDelay * Math.pow(2, attempt);
          logInfo(`429 rate limit, retry ${attempt + 1}/${maxRetries} after ${wait} ms: ${url}`);
          await delay(wait);
          continue;
        }
        throw error;
      }

      // Обработка ошибок сервера (5xx)
      if (error?.message?.startsWith('HTTP 5')) {
        if (shouldRetry) {
          const wait = baseDelay * Math.pow(2, attempt);
          logInfo(`Server error, retry ${attempt + 1}/${maxRetries} after ${wait} ms: ${url}`);
          await delay(wait);
          continue;
        }
        throw error;
      }

      // Обработка ошибок токена
      if (error instanceof TypeError && String(error.message).includes('ByteString')) {
        logError(`Request error: ${url} — invalid Authorization header or non-ASCII token.`);
        throw new Error('Invalid token or Authorization header: check token in config.json.');
      }

      // Обработка сетевых ошибок (транзиторные)
      const transientErrors = ['ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED'];
      if (transientErrors.includes(error?.code)) {
        if (shouldRetry) {
          const wait = baseDelay * Math.pow(2, attempt);
          logInfo(`Network error ${error.code}, retry ${attempt + 1}/${maxRetries} after ${wait} ms: ${url}`);
          await delay(wait);
          continue;
        }
      }

      // Логирование и выброс последней ошибки
      logError(`Request error: ${url} — ${error?.message || String(error)}`);
      throw error;
    }
  }
}
