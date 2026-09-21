import { setTimeout as delay } from 'timers/promises';
import { execFile } from 'node:child_process';
import https from 'https';
import http from 'http';
import { URL } from 'url';
import { logInfo, logError } from './logger.js';
import { CATEGORY_PATHS, PARALLEL_DISABLED_MODES } from './constants.js';

const GLOBAL_HTTPS_AGENT = new https.Agent({
  rejectUnauthorized: false,
  minVersion: 'TLSv1.2',
  maxVersion: 'TLSv1.3'
});

async function createProxyAgent(proxyUrl) {
  if (!proxyUrl) return null;

  const parsed = new URL(proxyUrl);
  const protocol = parsed.protocol.toLowerCase();

  if (protocol === 'https:' || protocol === 'http:') {
    try {
      const module = await import('https-proxy-agent');
      const AgentClass = module.HttpsProxyAgent || module.default || module;
      return new AgentClass(proxyUrl);
    } catch (error) {
      const missingPackage = error?.code === 'ERR_MODULE_NOT_FOUND'
        || error?.code === 'MODULE_NOT_FOUND'
        || String(error?.message || '').includes("Cannot find package 'https-proxy-agent'");

      if (missingPackage) {
        throw new Error('Для поддержки HTTPS-прокси требуется пакет https-proxy-agent; установите его или снимите настройки HTTPS_PROXY / https_proxy.');
      }
      throw error;
    }
  }

  if (protocol === 'socks4:' || protocol === 'socks4a:' || protocol === 'socks5:' || protocol === 'socks5h:') {
    try {
      const module = await import('socks-proxy-agent');
      const AgentClass = module.SocksProxyAgent || module.default || module;
      return new AgentClass(proxyUrl);
    } catch (error) {
      const missingPackage = error?.code === 'ERR_MODULE_NOT_FOUND'
        || error?.code === 'MODULE_NOT_FOUND'
        || String(error?.message || '').includes("Cannot find package 'socks-proxy-agent'");

      if (missingPackage) {
        throw new Error('Для поддержки SOCKS-прокси требуется пакет socks-proxy-agent; установите его или снимите настройки proxyUrl / HTTPS_PROXY / https_proxy.');
      }
      throw error;
    }
  }

  throw new Error(`Unsupported proxy protocol: ${protocol}. Поддерживаются https://, socks4://, socks4a://, socks5://, socks5h://.`);
}

async function makePowerShellRequest(url, token, timeoutMs, _maxBodyBytes = null, proxyUrl = null) {
  if (process.platform !== 'win32') {
    throw new Error('PowerShell fallback доступен только на Windows.');
  }

  const headers = { Accept: 'application/json' };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const headersLiteral = `@{${Object.entries(headers)
    .map(([name, value]) => `${name}='${String(value).replace(/'/g, "''")}'`)
    .join('; ')}}`;
  const proxyArg = proxyUrl ? `-Proxy '${String(proxyUrl).replace(/'/g, "''")}'` : '';
  const timeoutSec = Math.max(1, Math.ceil(timeoutMs / 1000));
  const script = `$headers = ${headersLiteral}; $response = Invoke-WebRequest -Uri '${String(url).replace(/'/g, "''")}' -Method GET -Headers $headers ${proxyArg} -TimeoutSec ${timeoutSec}; Write-Host $response.StatusCode; Write-Host '---BODY---'; Write-Output $response.Content`;

  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-Command', script], { timeout: timeoutMs + 5000, windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`PowerShell fallback failed: ${error.message}${stderr ? `: ${stderr.trim()}` : ''}`));
        return;
      }

      const parts = stdout.split(/\r?\n/);
      const separatorIndex = parts.findIndex(line => line === '---BODY---');
      if (separatorIndex < 0) {
        reject(new Error('PowerShell fallback вернул неожиданный вывод.'));
        return;
      }

      const statusText = parts[0].trim();
      const body = parts.slice(separatorIndex + 1).join('\n').trim();
      const statusCode = Number(statusText);

      if (!statusText || Number.isNaN(statusCode)) {
        reject(new Error(`PowerShell fallback вернул некорректный статус: ${statusText}`));
        return;
      }

      if (statusCode === 429) {
        reject(new Error('rate_limit'));
        return;
      }
      if (statusCode >= 500 && statusCode < 600) {
        reject(new Error(`HTTP ${statusCode}: ${body}`));
        return;
      }
      if (statusCode < 200 || statusCode >= 400) {
        reject(new Error(`HTTP ${statusCode}: ${body}`));
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch (parseError) {
        reject(new Error(`PowerShell fallback неверный JSON: ${parseError.message}`));
      }
    });
  });
}

const DEFAULT_REQUEST_TIMEOUT_MS = 30000; // 30s
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY = 500;
const RATE_LIMIT_THRESHOLD = 290; // запросов до паузы
const RATE_LIMIT_PAUSE_MS = 60000; // 1 минута

// Глобальный счётчик запросов с временем окна
let requestCounter = { count: 0, windowStart: Date.now() };

function resetRequestCounterIfNeeded() {
  const now = Date.now();
  const elapsed = now - requestCounter.windowStart;
  if (elapsed >= 60000) { // Окно 1 минута
    requestCounter = { count: 0, windowStart: now };
  }
}

async function checkAndPauseIfRateLimitApproaching() {
  resetRequestCounterIfNeeded();
  if (requestCounter.count >= RATE_LIMIT_THRESHOLD) {
    const waitMs = Math.max(0, RATE_LIMIT_PAUSE_MS - (Date.now() - requestCounter.windowStart));
    if (waitMs > 0) {
      console.warn(`⚠️  Лимит запросов близко (${requestCounter.count}/${RATE_LIMIT_THRESHOLD}). Пауза на ${Math.ceil(waitMs / 1000)} сек...`);
      logInfo(`Проактивная пауза при лимите запросов: ${requestCounter.count}/${RATE_LIMIT_THRESHOLD}`);
      await delay(waitMs + 1000);
      requestCounter = { count: 0, windowStart: Date.now() };
    }
  }
}

function incrementRequestCounter() {
  resetRequestCounterIfNeeded();
  requestCounter.count += 1;
}

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

  // Категория поддерживается только через путь категории.
  // Корневой путь API не документирует параметр category_id.
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
    proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy || null;
  }

  // Валидируем параметры
  maxRetries = Math.max(0, Number.isInteger(maxRetries) ? maxRetries : DEFAULT_MAX_RETRIES);
  baseDelay = Math.max(0, Number.isInteger(baseDelay) ? baseDelay : DEFAULT_BASE_DELAY);
  timeoutMs = Math.max(1, Number.isInteger(timeoutMs) ? timeoutMs : DEFAULT_REQUEST_TIMEOUT_MS);

  let windowsFallbackTried = false;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Проверяем и делаем паузу если близко к лимиту
      if (attempt === 0) {
        await checkAndPauseIfRateLimitApproaching();
        incrementRequestCounter();
      }

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

        if (isTlsProtocolError && process.platform === 'win32' && !windowsFallbackTried) {
          windowsFallbackTried = true;
          try {
            return await makePowerShellRequest(url, token, timeoutMs, maxBodyBytes, proxyUrl);
          } catch (fallbackError) {
            const fallbackMsg = `PowerShell TLS fallback не сработал: ${fallbackError.message}`;
            console.warn(fallbackMsg);
            logInfo(fallbackMsg);
          }
        }
        // HTTP fallback отключён, все запросы к API должны оставаться по HTTPS.
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

    if (proxyUrl) {
      options.agent = await createProxyAgent(proxyUrl);
      if (isHttps) {
        options.rejectUnauthorized = false; // Отключаем проверку сертификата для Windows
      }
    } else if (isHttps) {
      options.rejectUnauthorized = false; // Отключаем проверку сертификата для Windows
      options.agent = GLOBAL_HTTPS_AGENT;
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

/**
 * Выполняет батч-запрос: несколько операций в одном HTTP запросе
 * Максимум 10 операций на батч. Результаты объединяются.
 * @param {string[]} urls - Массив URL для запроса (абсолютные)
 * @param {string|Object} arg2 - Токен (строка) или объект конфигурации {token, retries, retryDelayMs, timeoutMs, proxyUrl, alternateUrl}
 * @param {number} arg3 - maxRetries (для обратной совместимости)
 * @param {number} arg4 - baseDelay (для обратной совместимости)
 * @returns {Promise<Array>} Массив результатов запросов в том же порядке
 */
export async function fetchJsonBatch(urls, arg2 = {}, arg3 = undefined, arg4 = undefined) {
  // Парсим параметры как в fetchJson
  let token;
  let maxRetries = DEFAULT_MAX_RETRIES;
  let baseDelay = DEFAULT_BASE_DELAY;
  let timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS;
  let proxyUrl = null;

  if (typeof arg2 === 'string') {
    token = arg2;
    if (Number.isInteger(arg3)) maxRetries = arg3;
    if (Number.isInteger(arg4)) baseDelay = arg4;
  } else if (typeof arg2 === 'object' && arg2 !== null) {
    token = arg2.token || arg2.auth || arg2.bearer;
    if (Number.isInteger(arg2.retries)) maxRetries = arg2.retries;
    if (Number.isInteger(arg2.retryDelayMs)) baseDelay = arg2.retryDelayMs;
    if (Number.isInteger(arg2.timeoutMs)) timeoutMs = arg2.timeoutMs;
    if (typeof arg2.proxyUrl === 'string') proxyUrl = arg2.proxyUrl;
    if (typeof arg2.proxy === 'string' && !proxyUrl) proxyUrl = arg2.proxy;
  }

  if (!proxyUrl) {
    proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy || null;
  }

  // Валидируем параметры
  maxRetries = Math.max(0, Number.isInteger(maxRetries) ? maxRetries : DEFAULT_MAX_RETRIES);
  baseDelay = Math.max(0, Number.isInteger(baseDelay) ? baseDelay : DEFAULT_BASE_DELAY);
  timeoutMs = Math.max(1, Number.isInteger(timeoutMs) ? timeoutMs : DEFAULT_REQUEST_TIMEOUT_MS);

  // Валидируем URLs
  if (!Array.isArray(urls) || urls.length === 0) {
    return [];
  }

  const validUrls = urls.filter(url => typeof url === 'string' && url.length > 0);
  if (validUrls.length === 0) {
    return [];
  }

  // Разбиваем на чанки по 10 (максимум батч-операций)
  const chunks = [];
  for (let i = 0; i < validUrls.length; i += 10) {
    chunks.push(validUrls.slice(i, i + 10));
  }

  const allResults = [];

  // Отправляем каждый чанк отдельным батч-запросом
  for (const chunk of chunks) {
    // Извлекаем путь и параметры из полного URL
    const batchOps = chunk.map(fullUrl => {
      try {
        const parsed = new URL(fullUrl);
        const uri = parsed.pathname + parsed.search; // /path?params
        return { method: 'GET', uri };
      } catch {
        return null;
      }
    }).filter(op => op !== null);

    if (batchOps.length === 0) {
      continue;
    }

    try {
      let batchUrl = null;
      let batchResponse = null;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          await checkAndPauseIfRateLimitApproaching();
          incrementRequestCounter();
          // Выбираем базовый хост и префикс для батч-эндпоинта на основе первого URL в чанке
          const firstFull = chunk[0];
          batchUrl = 'https://prod-api.lzt.market/batch';
          try {
            const p = new URL(firstFull);
            // Сохраняем префикс пути (например /api/v1) и заменяем последний сегмент на /batch
            const pathname = p.pathname || '/';
            const batchPath = pathname.replace(/\/?[^/]*$/, '/batch');
            batchUrl = `${p.protocol}//${p.hostname}${p.port ? `:${p.port}` : ''}${batchPath}`;
          } catch {
            // fallback к prod-api
          }
          batchResponse = await makeBatchHttpRequest(batchUrl, batchOps, token, timeoutMs, proxyUrl);
          break;
        } catch (error) {
          const isLastAttempt = attempt >= maxRetries;
          if (!isLastAttempt) {
            const wait = baseDelay * Math.pow(2, attempt);
            logInfo(`Ошибка батч-запроса (${attempt + 1}/${maxRetries}). Повтор через ${wait} мс: ${error?.message || String(error)}`);
            await delay(wait);
            continue;
          }
          throw error;
        }
      }

      if (Array.isArray(batchResponse) && batchResponse.length > 0) {
        // Debug: покажем пример первого элемента батча, чтобы понять формат
        try {
          const sample = batchResponse[0];
          console.log('DEBUG batch sample keys:', Array.isArray(batchResponse) ? (sample && typeof sample === 'object' ? Object.keys(sample) : typeof sample) : null);
        } catch {
          // ignore
        }
        allResults.push(...batchResponse);
      }

      // Если батч вернул пустой или null ответ — попробуем повторно с полем `url` (полный абсолютный URL)
      if ((!Array.isArray(batchResponse) || batchResponse.length === 0) && batchOps.length > 0) {
        try {
          const altOps = chunk.map(fullUrl => ({ method: 'GET', url: fullUrl }));
          console.log('DEBUG: retrying batch using full `url` fields...');
          await checkAndPauseIfRateLimitApproaching();
          incrementRequestCounter();
          const altResponse = await makeBatchHttpRequest(batchUrl, altOps, token, timeoutMs, proxyUrl);
          if (Array.isArray(altResponse) && altResponse.length > 0) {
            try { console.log('DEBUG batch (url) sample keys:', altResponse[0] && typeof altResponse[0] === 'object' ? Object.keys(altResponse[0]) : typeof altResponse[0]); } catch {}
            allResults.push(...altResponse);
            batchResponse = altResponse;
          }
        } catch (err) {
          // игнорируем — у нас есть фоллбек в search.js для индивидуальных запросов
          logInfo(`Повтор батча с url не удался: ${err?.message || err}`);
        }
      }

      logInfo(`Батч-запрос: отправлено ${batchOps.length} операций, получено ${batchResponse?.length || 0} результатов`);
    } catch (error) {
      logError(`Ошибка батч-запроса: ${error?.message || String(error)}`);
      throw error;
    }
  }

  return allResults;
}

/**
 * Выполняет HTTP батч-запрос через встроенный https модуль
 * @private
 * @param {string} url - URL батч-эндпоинта
 * @param {Array} operations - Массив операций {method, uri}
 * @param {string} token - JWT токен
 * @param {number} timeoutMs - Таймаут
 * @param {string} proxyUrl - URL прокси
 * @returns {Promise<Array>} Результаты операций
 */
async function makeBatchHttpRequest(url, operations, token, timeoutMs, proxyUrl) {
  return new Promise(async (resolve, reject) => {
    const parsedUrl = new URL(url);
    const isHttps = parsedUrl.protocol === 'https:';
    const defaultPort = isHttps ? 443 : 80;
    const body = JSON.stringify(operations);

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || defaultPort,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Content-Length': globalThis.Buffer.byteLength(body)
      },
      timeout: timeoutMs,
      agent: isHttps ? GLOBAL_HTTPS_AGENT : null
    };

    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }

    // Применяем прокси если задан
    if (proxyUrl) {
      try {
        const agent = await createProxyAgent(proxyUrl);
        if (agent) options.agent = agent;
      } catch (proxyError) {
        reject(proxyError);
        return;
      }
    }

    const protocol = isHttps ? https : http;
    let data = '';

    const req = protocol.request(options, (res) => {
      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          if (res.statusCode === 429) {
            reject(new Error('rate_limit'));
            return;
          }

          if (res.statusCode >= 500 && res.statusCode < 600) {
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
            return;
          }

          if (res.statusCode < 200 || res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
            return;
          }

          const result = JSON.parse(data);
          resolve(Array.isArray(result) ? result : []);
        } catch (error) {
          reject(new Error(`Неверный JSON ответ батча: ${error.message}`));
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

    req.write(body);
    req.end();
  });
}
