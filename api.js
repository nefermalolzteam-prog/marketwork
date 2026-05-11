import { setTimeout as delay } from 'timers/promises';
import { logInfo, logError } from './logger.js';
import { CATEGORY_PATHS, PARALLEL_DISABLED_MODES } from './constants.js';

export function isParallelMode(mode) {
  return !PARALLEL_DISABLED_MODES.has(mode);
}

export function buildSearchUrl(config, page, usePath = true) {
  const baseUrl = config.apiBaseUrl || 'https://prod-api.lzt.market';
  const titleQuery = Array.isArray(config.keywords)
    ? config.keywords.filter(Boolean).join(' ')
    : String(config.keywords || '').trim();

  const params = new URLSearchParams({
    page: String(page),
    ...(config.pmin ? { pmin: String(config.pmin) } : {}),
    ...(config.pmax ? { pmax: String(config.pmax) } : {}),
    order_by: config.order_by || 'pdate_to_down'
  });

  if (titleQuery) {
    params.append('title', titleQuery);
  }

  if (config.resultsPerPage) {
    params.append('perPage', String(config.resultsPerPage));
    params.append('resultsPerPage', String(config.resultsPerPage));
  }

  if (config.includeOrigins && Array.isArray(config.includeOrigins)) {
    config.includeOrigins.forEach(origin => params.append('origin[]', origin));
  }

  if (config.excludeOrigins && Array.isArray(config.excludeOrigins)) {
    config.excludeOrigins.forEach(origin => params.append('not_origin[]', origin));
  }

  const categoryPath = CATEGORY_PATHS[String(config.category)];
  if (usePath && categoryPath) {
    return `${baseUrl}/${categoryPath}?${params}`;
  }

  if (config.category) {
    params.append('category', String(config.category));
  }

  return `${baseUrl}/?${params}`;
}

export async function fetchJson(url, token, retries = 3, retryDelayMs = 500) {
  const maxRetries = Number(retries) >= 0 ? retries : 3;
  const baseDelay = Number(retryDelayMs) >= 0 ? retryDelayMs : 500;
  let attempt = 0;

  while (attempt <= maxRetries + 1) {
    attempt += 1;
    try {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json'
        }
      });

      if (response.status === 429) {
        if (attempt <= maxRetries) {
          const wait = baseDelay * Math.pow(2, attempt - 1);
          logInfo(`429 rate limit, retry ${attempt}/${maxRetries} after ${wait} ms: ${url}`);
          await delay(wait);
          continue;
        }
        throw new Error('rate_limit');
      }

      if (response.status >= 500 && response.status < 600) {
        if (attempt <= maxRetries) {
          const wait = baseDelay * Math.pow(2, attempt - 1);
          logInfo(`Server error ${response.status}, retry ${attempt}/${maxRetries} after ${wait} ms: ${url}`);
          await delay(wait);
          continue;
        }
      }

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`HTTP ${response.status}: ${text}`);
      }

      return response.json();
    } catch (error) {
      if (error instanceof TypeError && String(error.message).includes('ByteString')) {
        logError(`Request error: ${url} — invalid Authorization header or non-ASCII token.`);
        throw new Error('Invalid token or Authorization header: check token in config.json.');
      }
      const transient = ['ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED'].includes(error.code);
      if (transient && attempt <= maxRetries) {
        const wait = baseDelay * Math.pow(2, attempt - 1);
        logInfo(`Network error ${error.code}, retry ${attempt}/${maxRetries} after ${wait} ms: ${url}`);
        await delay(wait);
        continue;
      }
      logError(`Request error: ${url} — ${error.message}`);
      throw error;
    }
  }
}
