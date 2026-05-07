import readline from 'readline';
import { setTimeout as delay } from 'timers/promises';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const configPath = path.resolve('config.json');
const rulesPath = path.resolve('rules.json');

let currentResults = [];
let currentMode = '';
let isInterrupted = false;
let startTime = null;

const TELEGRAM_CATEGORY_ID = '24';
const OTLEG_BASE_TERMS = ['отлега', 'отлёга', 'отлежка', 'отлёжка', 'inactive'];
const OTLEG_YEAR_SUFFIXES = ['13 лет', '12 лет', '11 лет', '10 лет', '9 лет', '8 лет', '7 лет', '6 лет', '5 лет', '4 года', '3 года', '2 года'];

// Происхождения аккаунтов (origins)
const ACCOUNT_ORIGINS = {
  'personal': { name: 'Личный', searchTerms: ['личный', 'personal'] },
  'brute': { name: 'Брут', searchTerms: ['брут', 'brute'] },
  'phishing': { name: 'Фишинг', searchTerms: ['фишинг', 'phishing'] },
  'stealer': { name: 'Стилер', searchTerms: ['стилер', 'stealer'] },
  'resale': { name: 'Перепродажа', searchTerms: ['перепродажа', 'resale'] },
  'autoreg': { name: 'Авторег', searchTerms: ['авторег', 'авторег'] },
  'dummy': { name: 'Пустышка', searchTerms: ['пустышка', 'dummy'] },
  'self_registration': { name: 'Саморег', searchTerms: ['саморег', 'self_registration'] },
  'retrieve_via_support': { name: 'Восстановление через поддержку', searchTerms: ['восстановление через поддержку', 'retrieve_via_support'] }
};

const CATEGORY_PATHS = {
  '1': 'steam',
  '3': 'ea',
  '4': 'warface',
  '5': 'uplay',
  '6': 'llm',
  '7': 'socialclub',
  '8': 'hytale',
  '9': 'fortnite',
  '10': 'instagram',
  '11': 'battlenet',
  '12': 'epicgames',
  '13': 'riot',
  '14': 'wot-1',
  '15': 'supercell',
  '16': 'wotblitz-1',
  '17': 'mihoyo-1',
  '18': 'escapefromtarkov',
  '19': 'vpn',
  '20': 'tiktok',
  '22': 'discord',
  '24': 'telegram',
  '28': 'minecraft',
  '30': 'gifts',
  '31': 'roblox'
};

let LOG_FILE = path.resolve('bot.log');
let ERROR_LOG_FILE = path.resolve('errors.log');
const SCRIPT_PATH = fileURLToPath(import.meta.url);

function appendLog(filePath, message) {
  try {
    fs.appendFileSync(filePath, `${message}\n`, 'utf8');
  } catch {
    // ignore logging failures
  }
}

function logInfo(message) {
  appendLog(LOG_FILE, `[${new Date().toISOString()}] INFO: ${message}`);
}

function logError(message) {
  appendLog(ERROR_LOG_FILE, `[${new Date().toISOString()}] ERROR: ${message}`);
}

function initializeLogging(config) {
  if (config.logFile) {
    LOG_FILE = path.resolve(config.logFile);
  }
  if (config.errorLogFile) {
    ERROR_LOG_FILE = path.resolve(config.errorLogFile);
  }
  logInfo(`Запуск бота. log=${LOG_FILE}, errorLog=${ERROR_LOG_FILE}`);
}

function loadConfig() {
  if (!fs.existsSync(configPath)) {
    console.error('Файл config.json не найден. Скопируйте config.example.json в config.json и заполните токен.');
    process.exit(1);
  }

  const raw = fs.readFileSync(configPath, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (error) {
    console.error('Неверный JSON в config.json:', error.message);
    process.exit(1);
  }
}

function validateConfig(config) {
  const allowedOrders = new Set([
    'price_to_up',
    'price_to_down',
    'pdate_to_down',
    'pdate_to_up',
    'pdate_to_down_upload',
    'pdate_to_up_upload',
    'edate_to_up',
    'edate_to_down'
  ]);

  if (!config.token || typeof config.token !== 'string' || !config.token.trim()) {
    throw new Error('Ошибка: token не задан в config.json. Заполните поле token.');
  }

  if (!isAsciiString(config.token)) {
    throw new Error('Ошибка: token содержит недопустимые символы. Убедитесь, что в config.json используется корректный токен без кириллицы и пробелов.');
  }

  if (!config.apiBaseUrl || typeof config.apiBaseUrl !== 'string') {
    throw new Error('Ошибка: apiBaseUrl должен быть указан в config.json.');
  }

  if (!allowedOrders.has(config.order_by)) {
    throw new Error(`Ошибка: order_by должен быть одним из ${[...allowedOrders].join(', ')}.`);
  }

  if (!Number.isInteger(config.resultsPerPage) || config.resultsPerPage <= 0 || config.resultsPerPage > 400) {
    throw new Error('Ошибка: resultsPerPage должен быть числом от 1 до 400.');
  }

  if (!Number.isInteger(config.maxPages) || config.maxPages <= 0) {
    throw new Error('Ошибка: maxPages должен быть положительным целым числом.');
  }

  if (!Number.isInteger(config.pageDelayMs) || config.pageDelayMs < 0) {
    throw new Error('Ошибка: pageDelayMs должен быть положительным целым числом или 0.');
  }

  if (!Number.isInteger(config.categoryDelayMs) || config.categoryDelayMs < 0) {
    throw new Error('Ошибка: categoryDelayMs должен быть положительным целым числом или 0.');
  }

  if (config.checkCategories && !Array.isArray(config.checkCategories)) {
    throw new Error('Ошибка: checkCategories должен быть массивом ID категорий.');
  }

  if (config.includeOrigins && !Array.isArray(config.includeOrigins)) {
    throw new Error('Ошибка: includeOrigins должен быть массивом кодов origin.');
  }

  if (config.excludeOrigins && !Array.isArray(config.excludeOrigins)) {
    throw new Error('Ошибка: excludeOrigins должен быть массивом кодов origin.');
  }

  if (config.maxRetries !== undefined && (!Number.isInteger(config.maxRetries) || config.maxRetries < 0)) {
    throw new Error('Ошибка: maxRetries должен быть неотрицательным целым числом.');
  }

  if (config.retryDelayMs !== undefined && (!Number.isInteger(config.retryDelayMs) || config.retryDelayMs < 0)) {
    throw new Error('Ошибка: retryDelayMs должен быть неотрицательным целым числом.');
  }
}

function loadRules() {
  if (!fs.existsSync(rulesPath)) {
    console.warn('⚠️  Файл rules.json не найден. Проверка нарушений отключена.');
    return { violations: {} };
  }
  const raw = fs.readFileSync(rulesPath, 'utf8');
  let data;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    console.error('Неверный JSON в rules.json:', error.message);
    return { violations: {} };
  }

  if (data.violations) {
    for (const violation of Object.values(data.violations)) {
      violation.keywords = [
        ...new Set(
          (violation.keywords || [])
            .map((keyword) => String(keyword).trim().toLowerCase())
            .filter(Boolean)
        )
      ];
    }
  }

  return data;
}

function normalizeText(text) {
  return String(text || '').trim().toLowerCase();
}

function isAsciiString(value) {
  return /^[\x00-\x7F]*$/.test(String(value || ''));
}

function getItemId(item) {
  return item?.item_id ?? item?.id ?? item?.uid;
}

function uniqItemsById(items) {
  const seen = new Set();
  return items.filter((item) => {
    const id = getItemId(item);
    if (!id) return false;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function mergeResults(existing, newResults) {
  return existing.concat(newResults);
}

function getOrderByName(orderBy) {
  switch (orderBy) {
    case 'price_to_up':
      return 'сначала дешевые';
    case 'price_to_down':
      return 'сначала дорогие';
    case 'pdate_to_up':
      return 'старые сначала';
    case 'pdate_to_down_upload':
      return 'новые загруженные';
    case 'pdate_to_up_upload':
      return 'старые загруженные';
    case 'edate_to_up':
      return 'недавно отредактированные';
    case 'edate_to_down':
      return 'старые отредактированные';
    case 'pdate_to_down':
    default:
      return 'новые сначала';
  }
}

function getOriginName(originCode) {
  if (!originCode) return 'неизвестно';
  const originInfo = ACCOUNT_ORIGINS[originCode.toLowerCase()];
  return originInfo ? originInfo.name : originCode;
}

async function fetchJson(url, token, retries = 3, retryDelayMs = 500) {
  const maxRetries = Number(retries) >= 0 ? retries : 3;
  const baseDelay = Number(retryDelayMs) >= 0 ? retryDelayMs : 500;
  let attempt = 0;

  while (true) {
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
          logInfo(`429 rate limit, retry ${attempt}/${maxRetries} после ${wait} мс: ${url}`);
          await delay(wait);
          continue;
        }
        throw new Error('rate_limit');
      }

      if (response.status >= 500 && response.status < 600) {
        if (attempt <= maxRetries) {
          const wait = baseDelay * Math.pow(2, attempt - 1);
          logInfo(`Серверная ошибка ${response.status}, retry ${attempt}/${maxRetries} после ${wait} мс: ${url}`);
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
        logError(`Ошибка запроса: ${url} — некорректный заголовок Authorization или токен содержит не-ASCII символы.`);
        throw new Error('Некорректный токен или заголовок Authorization: проверьте token в config.json.');
      }
      const transient = ['ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED'].includes(error.code);
      if (transient && attempt <= maxRetries) {
        const wait = baseDelay * Math.pow(2, attempt - 1);
        logInfo(`Сетевая ошибка ${error.code}, retry ${attempt}/${maxRetries} после ${wait} мс: ${url}`);
        await delay(wait);
        continue;
      }
      logError(`Ошибка запроса: ${url} — ${error.message}`);
      throw error;
    }
  }
}

function hasExplicitAgeOrDateNearKeyword(textLower, keywordLower) {
  // Упрощенная логика: если в тексте есть паттерн даты/периода, считаем отлежку явной
  const dateOrAgePatterns = [
    /\b\d{1,2}\s*(?:янв|фев|мар|апр|май|июн|июл|авг|сен|окт|ноя|дек)/iu,
    /(?:^|\s)\d+\+?\s*(?:day|days|d|дн|дн\.|день|дня|дни|дней|недел|нед|нед\.|месяц|месяца|месяцев|год|года|лет|час|часа|часов|минут|минуты|мин)(?=\s|$|[.,!?:;])/iu,
    /\b\d+\s*[-\/\.]\s*\d+\b/
  ];

  return dateOrAgePatterns.some(re => re.test(textLower));
}

function checkViolations(text, rules) {
  if (!text || !rules.violations) return [];
  
  const textLower = normalizeText(text);
  const foundViolations = [];
  
  for (const [category, violation] of Object.entries(rules.violations)) {
    for (const keyword of violation.keywords) {
      if (!keyword) continue;
      const keywordLower = normalizeText(keyword);
      if (!textLower.includes(keywordLower)) continue;
      if (category === 'vague_aging' && hasExplicitAgeOrDateNearKeyword(textLower, keywordLower)) continue;
      foundViolations.push({
        category,
        name: violation.name,
        keyword
      });
    }
  }
  
  return foundViolations;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function highlightViolations(text, violations) {
  if (violations.length === 0) return text;
  
  let highlighted = text;
  for (const violation of violations) {
    const regex = new RegExp(`(${escapeRegExp(violation.keyword)})`, 'gi');
    highlighted = highlighted.replace(regex, '\x1b[41m\x1b[37m$1\x1b[0m');
  }
  return highlighted;
}

function highlightOrigin(text) {
  return `\x1b[41m\x1b[37m${text}\x1b[0m`;
}

function printScrollHint(resultsLength, displayCount) {
  if (resultsLength > displayCount) {
    console.log('   ▶ Чтобы пролистать дальше, увеличьте maxPages или resultsPerPage и запустите бота снова.');
  }
}

function finalizeResults(results, startTime, showViolationsOnly = false) {
  if (results.length === 0) {
    console.log('❌ Результаты не найдены.');
    return;
  }
  
  const totalViolations = results.reduce((sum, item) => sum + item.violations.length, 0);
  const endTime = Date.now();
  const duration = (endTime - startTime) / 1000;
  
  console.log(`\n${'='.repeat(80)}`);
  console.log(`📊 Всего найдено: ${results.length} объявлений, ${totalViolations} нарушений`);
  console.log(`⏱️  Время выполнения: ${duration.toFixed(2)} секунд`);
  console.log(`${'='.repeat(80)}`);
}

function formatItem(item, rules, extraProps = {}) {
  const id = getItemId(item);
  const title = item.title || item.name || 'Без названия';
  const description = item.description || item.desc || item.text || '';
  const url = `https://lzt.market/${id}`;

  const textToCheck = `${title} ${description}`.trim();
  const violations = checkViolations(textToCheck, rules);
  const origin = item.item_origin || item.origin || item.account_origin || item.resale_item_origin || item.itemOriginPhrase || null;
  
  return { id, title, description, url, violations, origin, ...extraProps };
}

async function searchOnce(config, rules, page = 1) {
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

  // Добавляем поддержку фильтров origin[] и not_origin[]
  if (config.includeOrigins && Array.isArray(config.includeOrigins)) {
    config.includeOrigins.forEach(origin => {
      params.append('origin[]', origin);
    });
  }

  if (config.excludeOrigins && Array.isArray(config.excludeOrigins)) {
    config.excludeOrigins.forEach(origin => {
      params.append('not_origin[]', origin);
    });
  }

  // Добавляем категорию как параметр, если она указана
  if (config.category) {
    params.append('category[]', String(config.category));
  }

  const categoryPath = CATEGORY_PATHS[String(config.category)];

  const buildUrl = (usePath) => {
    if (usePath && categoryPath) {
      return `${baseUrl}/${categoryPath}?${params}`;
    }
    return `${baseUrl}/?${params}`;
  };

  let data;
  try {
    data = await fetchJson(buildUrl(true), config.token, config.maxRetries ?? 3, config.retryDelayMs ?? 500);
  } catch (error) {
    if (error.message.includes('HTTP 404') && categoryPath) {
      console.warn('⚠️  Категория не поддерживается по специализированному пути, пробую общий поиск через root...');
      data = await fetchJson(buildUrl(false), config.token, config.maxRetries ?? 3, config.retryDelayMs ?? 500);
    } else {
      throw error;
    }
  }

  const items = data.items || data.list || data.data || [];
  if (!Array.isArray(items)) {
    console.log('Непредвиденный формат ответа от API:', items);
    return { results: [], rawCount: 0 };
  }

  // Фильтрация по категории, если указана
  let filteredItems = items;
  if (config.category) {
    filteredItems = items.filter(item => String(item.category_id || item.category) === String(config.category));
  }

  const parsed = filteredItems.map(item => formatItem(item, rules));
  return { results: parsed, rawCount: items.length };
}

async function collectPages(config, rules, itemLabel = 'Поиск') {
  let allResults = [];
  const maxPages = Number(config.maxPages) || 1;
  const pageDelayMs = Number(config.pageDelayMs) >= 0 ? Number(config.pageDelayMs) : 1000;
  let retryCount = 0;
  const maxRetries = 2;

  for (let page = 1; page <= maxPages; page++) {
    if (isInterrupted) break;

    try {
      console.log(`📄 ${itemLabel} на странице ${page}...`);
      const { results, rawCount } = await searchOnce(config, rules, page);
      console.log(`   Найдено ${results.length} объявлений на странице ${page}`);
      allResults = config.deduplicateResults
        ? uniqItemsById(mergeResults(allResults, results))
        : mergeResults(allResults, results);

      currentResults = allResults;
      retryCount = 0; // Сброс счётчика при успешном запросе

      if (rawCount === 0) {
        console.log(`   Страница ${page} пуста, остановка.`);
        break;
      }

      if (page < maxPages && !isInterrupted) {
        await delay(pageDelayMs);
      }
    } catch (error) {
      if (error.message === 'rate_limit') {
        if (retryCount < maxRetries) {
          retryCount++;
          console.warn(`⚠️  Лимит запросов 429, повтор ${retryCount}/${maxRetries} после 10 сек...`);
          await delay(10000);
          page--; // Повторить ту же страницу
          continue;
        } else {
          console.error('❌ Превышено максимальное количество повторов при rate limit.');
          break;
        }
      }
      if (error.message.includes('HTTP 404')) {
        console.error(`❌ Ошибка на странице ${page}:`, error.message);
        console.warn('⚠️  Возможно, категория не поддерживается на этом эндпоинте или неверно указана.');
      } else {
        console.error(`❌ Ошибка на странице ${page}:`, error.message);
      }
      break;
    }
  }

  return allResults;
}

async function displayViolationsOnly(results, maxDisplay = 200, ask) {
  const problematic = results.filter(item => item.violations.length > 0);

  console.log(`\n${'='.repeat(80)}`);
  console.log(`📅 [${new Date().toLocaleString()}] Нарушения`);
  console.log(`📊 Найдено объявлений с нарушениями: ${problematic.length}`);
  console.log(`${'='.repeat(80)}`);

  if (problematic.length === 0) {
    console.log('✅ Нарушений не найдено.\n');
    logInfo(`Нарушений не найдено, режим=${currentMode}`);
    return;
  }

  const pageSize = maxDisplay;
  let pageIndex = 0;
  const pageCount = Math.max(1, Math.ceil(problematic.length / pageSize));

  while (true) {
    const start = pageIndex * pageSize;
    const pageItems = problematic.slice(start, start + pageSize);

    pageItems.forEach((item, index) => {
      console.log(`\n📋 Объявление #${start + index + 1}`);
      console.log(`   ID: ${item.id}`);
      if (item.category) {
        console.log(`   Раздел: ${item.category}`);
      }
      console.log(`   Название: ${highlightViolations(item.title, item.violations)}`);
      console.log(`   Ссылка: ${item.url}`);
      console.log(`   ⚠️  Нарушения:`);
      item.violations.forEach(v => {
        console.log(`      ${v.name} (${v.keyword})`);
      });
      console.log(`${'-'.repeat(80)}`);
    });

    if (pageCount > 1) {
      console.log(`\n⚠️  Показано ${pageItems.length} из ${problematic.length} объявлений с нарушениями. Страница ${pageIndex + 1}/${pageCount}.`);
      if (!ask) {
        console.log('   ▶ Введите next для следующей страницы, prev для предыдущей страницы.');
        break;
      }

      const command = (await ask('Введите команду (next/prev/exit): ')).trim().toLowerCase();
      if (command === 'next') {
        if (pageIndex < pageCount - 1) {
          pageIndex += 1;
          continue;
        }
        console.log('Это последняя страница результатов.');
        continue;
      }
      if (command === 'prev') {
        if (pageIndex > 0) {
          pageIndex -= 1;
          continue;
        }
        console.log('Это первая страница результатов.');
        continue;
      }
      break;
    }

    if (problematic.length > pageSize) {
      console.log(`\n⚠️  Показано ${pageItems.length} из ${problematic.length} объявлений с нарушениями.`);
      if (!ask) {
        console.log('   ▶ Введите next для следующей страницы, prev для предыдущей страницы.');
      }
    }
    break;
  }

  console.log();
}

function buildOtlegYearQueries() {
  const yearQueries = OTLEG_BASE_TERMS.flatMap((term) =>
    OTLEG_YEAR_SUFFIXES.map((suffix) => `${term} ${suffix}`)
  );
  return yearQueries;
}

async function collectPhraseSearches(config, rules, phrases, itemLabel = 'Поиск') {
  let allResults = [];
  for (const phrase of phrases) {
    if (isInterrupted) break;
    const phraseConfig = { ...config, keywords: [phrase] };
    console.log(`\n🔎 Поиск фразы: ${phrase}`);
    const results = await collectPages(phraseConfig, rules, itemLabel);
    allResults = uniqItemsById(mergeResults(allResults, results));
  }
  return allResults;
}

async function searchByKeywords(config, rules) {
  console.log('🔍 Режим поиска по ключевым словам');
  console.log(`Ключевые слова: ${Array.isArray(config.keywords) ? config.keywords.join(', ') : config.keywords}`);
  console.log(`Категория: ${config.category || 'все'}`);
  console.log(`Сортировка: ${getOrderByName(config.order_by)}`);
  console.log(`Дедупликация: ${config.deduplicateResults ? 'включена' : 'выключена'}`);
  console.log(`Максимум страниц: ${config.maxPages || 1}`);
  console.log(`Результатов на страницу: ${config.resultsPerPage || 'по умолчанию API'}`);
  console.log(`Задержка между страницами: ${config.pageDelayMs ?? 1000} мс`);
  console.log('');

  const results = await collectPages(config, rules, 'Поиск');
  console.log(`\n📊 Всего найдено объявлений: ${results.length}`);
  return results;
}

async function searchFakePersonal(config, rules, ask) {
  console.log('🔍 Режим поиска личных аккаунтов по названию');
  console.log('Описание: поиск аккаунтов, где в названии содержится "личный" и при этом происхождение исключает личный.');
  console.log('(это показывает объявления с "личный" в названии, где фактическое происхождение не личный)');
  console.log(`Сортировка: ${getOrderByName(config.order_by)}`);
  console.log(`Максимум страниц на категорию: ${config.maxPages || 1}`);
  console.log(`Результатов на страницу: ${config.resultsPerPage || 100}`);
  console.log(`Задержка между страницами: ${config.pageDelayMs ?? 1000} мс`);
  console.log(`Задержка между категориями: ${config.categoryDelayMs ?? 2000} мс\n`);

  let totalResults = [];

  for (const category of config.checkCategories) {
    if (isInterrupted) break;

    const catName = config.categories?.[category] || `ID:${category}`;
    console.log(`\n📂 Проверка категории ${catName} (${category})...`);

    try {
      const categoryConfig = {
        ...config,
        category,
        keywords: ['личный'],
        excludeOrigins: ['personal']
      };
      const results = await collectPages(categoryConfig, { violations: {} }, `Поиск личного в ${catName}`);
      const titleMatched = results.filter(item => normalizeText(item.title).includes('личный'));
      const resultsWithCategory = titleMatched.map(item => ({ ...item, category: catName, checkedOrigin: 'Личный', excludedOrigin: 'Личный' }));
      
      console.log(`   ✅ ${resultsWithCategory.length} объявлений`);
      
      totalResults = mergeResults(totalResults, resultsWithCategory);
      currentResults = totalResults;
      
      if (config.checkCategories.indexOf(category) < config.checkCategories.length - 1 && !isInterrupted) {
        const categoryDelayMs = Number(config.categoryDelayMs) >= 0 ? Number(config.categoryDelayMs) : 2000;
        await delay(categoryDelayMs);
      }
    } catch (error) {
      if (error.message === 'rate_limit' || isInterrupted) {
        console.warn(`   ⚠️  Прерывание при проверке категории ${catName}`);
      } else {
        console.error(`   ❌ Ошибка: ${error.message}`);
      }
    }
  }

  await displayResults(totalResults, 200, ask);

  console.log(`\n${'='.repeat(80)}`);
  console.log(`📊 ИТОГО: ${totalResults.length} объявлений проверено`);
  console.log(`${'='.repeat(80)}`);
  
  return totalResults;
}

async function checkAllOrigins(config, rules, ask) {
  console.log('🔍 Режим проверки неверного происхождения');
  console.log('Описание: отображение товаров, где название содержит происхождение, а фактическое происхождение отличается. Основные правила нарушений не учитываются.');
  console.log(`Сортировка: ${getOrderByName(config.order_by)}`);
  console.log(`Максимум страниц на категорию: ${config.maxPages || 1}`);
  console.log(`Результатов на страницу: ${config.resultsPerPage || 100}`);
  console.log(`Задержка между страницами: ${config.pageDelayMs ?? 1000} мс`);
  console.log(`Задержка между категориями: ${config.categoryDelayMs ?? 2000} мс\n`);

  let totalResults = [];

  const origins = Object.keys(ACCOUNT_ORIGINS);

  for (const origin of origins) {
    if (isInterrupted) break;

    const originInfo = ACCOUNT_ORIGINS[origin];
    console.log(`\n${'='.repeat(80)}`);
    console.log(`🔎 Проверка происхождения: ${originInfo.name} (${origin})`);
    console.log(`${'='.repeat(80)}`);

    for (const category of config.checkCategories) {
      if (isInterrupted) break;

      const catName = config.categories?.[category] || `ID:${category}`;
      console.log(`\n📂 Категория ${catName} (${category})...`);

      try {
        // Ищем названия, содержащие поисковые термины этого происхождения, но исключаем это происхождение
        const categoryConfig = {
          ...config,
          category,
          keywords: originInfo.searchTerms,
          excludeOrigins: [origin]
        };
        const results = await collectPages(categoryConfig, { violations: {} }, `Проверка ${originInfo.name} в ${catName}`);
        const resultsWithCategory = results.map(item => ({ 
          ...item, 
          category: catName,
          checkedOrigin: originInfo.name,
          excludedOrigin: originInfo.name
        }));
        
        console.log(`   ✅ ${results.length} объявлений найдено`);
        
        totalResults = mergeResults(totalResults, resultsWithCategory);
        currentResults = totalResults;
        
        if (config.checkCategories.indexOf(category) < config.checkCategories.length - 1 && !isInterrupted) {
          const categoryDelayMs = Number(config.categoryDelayMs) >= 0 ? Number(config.categoryDelayMs) : 2000;
          await delay(categoryDelayMs);
        }
      } catch (error) {
        if (error.message === 'rate_limit' || isInterrupted) {
          console.warn(`   ⚠️  Прерывание при проверке категории ${catName}`);
        } else {
          console.error(`   ❌ Ошибка: ${error.message}`);
        }
      }
    }
  }

  await displayResults(totalResults, 200, ask);

  console.log(`\n${'='.repeat(80)}`);
  console.log(`📊 ИТОГО: ${totalResults.length} объявлений найдено по несовпадению происхождения и названия`);
  console.log(`${'='.repeat(80)}`);
  
  return totalResults;
}

async function searchTelegramOtlegYears(config, rules) {
  const queries = buildOtlegYearQueries();
  console.log('🔍 Режим поиска по годам отлеги в Telegram');
  console.log(`Категория: Telegram (${TELEGRAM_CATEGORY_ID})`);
  console.log(`Поисковые фразы: ${queries.length}`);
  console.log(`Сортировка: ${getOrderByName(config.order_by)}`);
  console.log(`Дедупликация: ${config.deduplicateResults ? 'включена' : 'выключена'}`);
  console.log(`Максимум страниц: ${config.maxPages || 1}`);
  console.log(`Результатов на страницу: ${config.resultsPerPage || 'по умолчанию API'}`);
  console.log(`Задержка между страницами: ${config.pageDelayMs ?? 1000} мс\n`);

  const results = await collectPhraseSearches({ ...config, category: TELEGRAM_CATEGORY_ID, maxPages: config.maxPages }, rules, queries, 'Отлеги Telegram');
  console.log(`\n📊 Всего найдено объявлений: ${results.length}`);
  return results;
}

async function searchSocialClubAccounts(config, rules) {
  const queries = [
    'grand (БЕЗ ДОСТУПА К SOCIAL CLUB)',
    'rdr (БЕЗ ДОСТУПА К SOCIAL CLUB)',
    'gta (БЕЗ ДОСТУПА К SOCIAL CLUB)'
  ];
  const categories = ['1', '12'];
  const sectionNames = {
    '1': 'Steam',
    '12': 'Epic Games'
  };

  console.log('🔍 Режим поиска Social Club в Steam и Epic Games');
  console.log(`Категории: Steam (1), Epic Games (12)`);
  console.log(`Поисковые фразы: ${queries.length}`);
  console.log(`Сортировка: ${getOrderByName(config.order_by)}`);
  console.log(`Дедупликация: ${config.deduplicateResults ? 'включена' : 'выключена'}`);
  console.log(`Максимум страниц: ${config.maxPages || 1}`);
  console.log(`Результатов на страницу: ${config.resultsPerPage || 'по умолчанию API'}`);
  console.log(`Задержка между страницами: ${config.pageDelayMs ?? 1000} мс\n`);

  let allResults = [];

  for (const category of categories) {
    if (isInterrupted) break;
    const catName = sectionNames[category] || `ID:${category}`;
    console.log(`\n📂 Поиск в категории ${catName} (${category})...`);

    const results = await collectPhraseSearches({ ...config, category, maxPages: config.maxPages }, rules, queries, `Поиск Social Club в ${catName}`);
    const resultsWithCategory = results.map(item => ({ ...item, category: catName }));
    allResults = uniqItemsById(mergeResults(allResults, resultsWithCategory));
  }

  console.log(`\n📊 Всего найдено объявлений: ${allResults.length}`);
  return allResults;
}

function parseOriginInput(input) {
  return String(input || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function formatOriginOptions() {
  return Object.entries(ACCOUNT_ORIGINS)
    .map(([code, info]) => `${code} (${info.name})`)
    .join(', ');
}

function filterValidOrigins(origins) {
  const knownOrigins = new Set(Object.keys(ACCOUNT_ORIGINS));
  const valid = origins.filter((value) => knownOrigins.has(value));
  const invalid = origins.filter((value) => !knownOrigins.has(value));
  if (invalid.length > 0) {
    console.warn(`⚠️  Игнорируются неизвестные origin: ${invalid.join(', ')}`);
    logError(`Неизвестные origin: ${invalid.join(', ')}`);
  }
  return [...new Set(valid)];
}

async function askOriginFilters(ask) {
  const options = formatOriginOptions();
  const includeInput = await ask(
    `Введите origin[] для включения через запятую (Enter чтобы не фильтровать)\nДоступно: ${options}\n> `
  );
  const excludeInput = await ask(
    `Введите not_origin[] для исключения через запятую (Enter чтобы не фильтровать)\nДоступно: ${options}\n> `
  );

  return {
    includeOrigins: filterValidOrigins(parseOriginInput(includeInput)),
    excludeOrigins: filterValidOrigins(parseOriginInput(excludeInput))
  };
}

async function checkAllCategories(config, rules, ask) {
  const checkStartTime = Date.now();
  console.log('🔍 Режим проверки всех разделов (категорий)');
  const cats = config.categories || {};
  const catNames = config.checkCategories.map(id => cats[id] || `ID:${id}`).join(', ');
  console.log(`Категории: ${catNames}`);
  console.log(`Сортировка: ${getOrderByName(config.order_by)}`);
  console.log(`Максимум страниц на категорию: ${config.maxPages || 1}`);
  console.log(`Результатов на страницу: ${config.resultsPerPage || 200}`);
  console.log(`Задержка между страницами: ${config.pageDelayMs ?? 1000} мс`);
  console.log(`Задержка между категориями: ${config.categoryDelayMs ?? 2000} мс\n`);

  let totalResults = [];
  let totalViolations = 0;

  for (const category of config.checkCategories) {
    if (isInterrupted) break;

    const catName = cats[category] || `ID:${category}`;
    console.log(`\n📂 Проверка категории ${catName} (${category})...`);

    try {
      const results = await autoCheckAllListings({...config, category, verbose: false}, rules);
      const resultsWithCategory = results.map(item => ({ ...item, category: catName }));
      const violationsCount = resultsWithCategory.filter(item => item.violations.length > 0).length;
      
      console.log(`   ✅ ${results.length} объявлений, ${violationsCount} с нарушениями`);
      
      totalResults = mergeResults(totalResults, resultsWithCategory);
      totalViolations += violationsCount;
      currentResults = totalResults;
      
      if (config.checkCategories.indexOf(category) < config.checkCategories.length - 1 && !isInterrupted) {
        const categoryDelayMs = Number(config.categoryDelayMs) >= 0 ? Number(config.categoryDelayMs) : 2000;
        await delay(categoryDelayMs);
      }
    } catch (error) {
      if (error.message === 'rate_limit' || isInterrupted) {
        console.warn(`   ⚠️  Прерывание при проверке категории ${catName}`);
      } else {
        console.error(`   ❌ Ошибка: ${error.message}`);
      }
    }
  }

  await displayViolationsOnly(totalResults, 200, ask);

  console.log(`\n${'='.repeat(80)}`);
  console.log(`📊 ИТОГО: ${totalResults.length} объявлений проверено, ${totalViolations} с нарушениями`);
  console.log(`${'='.repeat(80)}`);
  const endTime = Date.now();
  const duration = (endTime - checkStartTime) / 1000;
  console.log(`⏱️  Время выполнения: ${duration.toFixed(2)} секунд`);
  
  return totalResults;
}

async function autoCheckAllListings(config, rules) {
  const verbose = config.verbose !== false;
  if (verbose) {
    console.log('🔍 Режим автоматической проверки всех объявлений');
    console.log(`Категория: ${config.category || 'все'}`);
    console.log(`Сортировка: ${getOrderByName(config.order_by)}`);
    console.log(`Дедупликация: ${config.deduplicateResults ? 'включена' : 'выключена'}`);
    console.log(`Максимум страниц: ${config.maxPages || 1}`);
    console.log(`Результатов на страницу: ${config.resultsPerPage || 'по умолчанию API'}`);
    console.log(`Задержка между страницами: ${config.pageDelayMs ?? 1000} мс\n`);
  }

  const results = await collectPages({ ...config, keywords: '' }, rules, 'Проверка');
  if (verbose) {
    console.log(`\n📊 Всего проверено объявлений: ${results.length}`);
  }
  return results;
}

async function displayResults(results, maxDisplay = 200, ask) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`📅 [${new Date().toLocaleString()}] Результаты поиска`);
  console.log(`📊 Найдено объявлений: ${results.length}`);
  console.log(`${'='.repeat(80)}`);
  logInfo(`Результаты поиска: найдено ${results.length} объявлений, режим=${currentMode}`);
  
  if (results.length === 0) {
    console.log('❌ Результаты отсутствуют.\n');
    return;
  }

  const pageSize = maxDisplay;
  let pageIndex = 0;
  const pageCount = Math.max(1, Math.ceil(results.length / pageSize));

  while (true) {
    const start = pageIndex * pageSize;
    const pageItems = results.slice(start, start + pageSize);

    pageItems.forEach((item, index) => {
      console.log(`\n📋 Объявление #${start + index + 1}`);
      if (item.category) {
        console.log(`   Раздел: ${item.category}`);
      }
      if (item.checkedOrigin) {
        const currentOrigin = item.origin ? getOriginName(item.origin) : 'неизвестно';
        console.log(`   Проверка происхождения: ${highlightOrigin(item.checkedOrigin)} (сейчас: ${highlightOrigin(currentOrigin)})`);
      } else if (item.origin) {
        console.log(`   Происхождение: ${highlightOrigin(getOriginName(item.origin))}`);
      }
      console.log(`   Название: ${highlightViolations(item.title, item.violations)}`);
      console.log(`   Ссылка: ${item.url}`);
      
      if (item.violations.length > 0) {
        console.log(`   ⚠️  НАРУШЕНИЯ НАЙДЕНЫ:`);
        item.violations.forEach(v => {
          console.log(`      ${v.name} (${v.keyword})`);
        });
      }
      console.log(`${'-'.repeat(80)}`);
    });

    if (pageCount > 1) {
      console.log(`\n⚠️  Показано ${pageItems.length} из ${results.length} объявлений. Страница ${pageIndex + 1}/${pageCount}.`);
      if (!ask) {
        console.log('   ▶ Введите next для следующей страницы, prev для предыдущей страницы.');
        break;
      }

      const command = (await ask('Введите команду (next/prev/exit): ')).trim().toLowerCase();
      if (command === 'next') {
        if (pageIndex < pageCount - 1) {
          pageIndex += 1;
          continue;
        }
        console.log('Это последняя страница результатов.');
        continue;
      }
      if (command === 'prev') {
        if (pageIndex > 0) {
          pageIndex -= 1;
          continue;
        }
        console.log('Это первая страница результатов.');
        continue;
      }
      break;
    }

    if (results.length > pageSize) {
      console.log(`\n⚠️  Показано ${pageItems.length} из ${results.length} объявлений.`);
      if (!ask) {
        console.log('   ▶ Введите next для следующей страницы, prev для предыдущей страницы.');
      }
    }
    break;
  }

  console.log();
}

function setupGracefulShutdown() {
  process.on('SIGINT', () => {
    isInterrupted = true;
    console.log('\n\n⚠️  Получен сигнал прерывания (Ctrl+C)...');
    console.log('📊 Выведу результаты, которые уже найдены...\n');
    
    if (currentResults.length > 0) {
      if (['search', 'auto-check', 'telegram-years', 'fake-personal', 'check-origins', 'check-categories', 'socialclub-search'].includes(currentMode)) {
        displayResults(currentResults);
      } else {
        displayViolationsOnly(currentResults);
      }
      const totalViolations = currentResults.reduce((sum, item) => sum + item.violations.length, 0);
      const endTime = Date.now();
      const duration = (endTime - startTime) / 1000;
      console.log(`\n${'='.repeat(80)}`);
      console.log(`📊 Результаты до прерывания: ${currentResults.length} объявлений, ${totalViolations} нарушений`);
      console.log(`⏱️  Время выполнения: ${duration.toFixed(2)} секунд`);
      console.log(`${'='.repeat(80)}`);
      console.log('💡 Для перезапуска бота с другим режимом запустите: npm start');
    } else {
      console.log('✅ Результаты не найдены.');
    }
    
    process.exit(0);
  });
}

async function runBot() {
  startTime = Date.now();
  const config = loadConfig();
  validateConfig(config);
  initializeLogging(config);
  const rules = loadRules();
  setupGracefulShutdown();

  console.log('🚀 Запуск LZT Market bot...');
  console.log('✅ Проверка нарушений правил включена\n');
  if (config.apiDocs) {
    console.log(`🔗 API docs: ${Array.isArray(config.apiDocs) ? config.apiDocs.join(' | ') : config.apiDocs}`);
  }
  if (config.rulesDocs) {
    const rulesLinks = Array.isArray(config.rulesDocs) ? config.rulesDocs.join(' | ') : config.rulesDocs;
    console.log(`🔗 Rules docs: ${rulesLinks}`);
  }
  console.log();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const ask = (question) => new Promise((resolve) => rl.question(question, resolve));

  // Главный цикл для перезапуска бота
  let continueLoop = true;
  while (continueLoop) {
    startTime = Date.now();
    // Выбор режима
    console.log('Выберите режим работы:');
    console.log('1. Поиск по ключевым словам');
    console.log('2. Автоматическая проверка всех объявлений');
    console.log('3. Проверка всех разделов (категорий) по правилам');
    console.log('4. Проверка неверного происхождения (ищет названия с одним происхождением, исключая это происхождение)');
    console.log('5. Поиск "личных" аккаунтов');
    console.log('6. Поиск отлеги по годам в Telegram');
    console.log('7. Поиск Social Club в Steam и Epic');
    const modeChoice = await ask('Введите номер режима (1-7): ');

    let mode;
    if (modeChoice === '1') {
      mode = 'search';
    } else if (modeChoice === '2') {
      mode = 'auto-check';
    } else if (modeChoice === '3') {
      mode = 'check-categories';
    } else if (modeChoice === '4') {
      mode = 'check-origins';
    } else if (modeChoice === '5') {
      mode = 'fake-personal';
    } else if (modeChoice === '6') {
      mode = 'telegram-years';
    } else if (modeChoice === '7') {
      mode = 'socialclub-search';
    } else {
      console.log('❌ Неверный выбор. Выход.');
      rl.close();
      return;
    }

    // Пропускаем выбор сортировки для режимов 4, 5, 6, 7 (фиксированные настройки)
    let orderByChoice;
    if (['check-origins', 'fake-personal', 'telegram-years', 'socialclub-search'].includes(mode)) {
      orderByChoice = '1'; // Новые сначала
    } else {
      console.log('\nВыберите сортировку результатов:');
      console.log('1. Новые сначала');
      console.log('2. Старые сначала');
      console.log('3. Дешевые сначала');
      console.log('4. Дорогие сначала');
      console.log('5. Новые загруженные');
      console.log('6. Старые загруженные');
      console.log('7. Недавно отредактированные');
      console.log('8. Старые отредактированные');
      orderByChoice = await ask('Введите номер сортировки (1-8): ');
    }

    let orderBy;
    if (orderByChoice === '1') {
      orderBy = 'pdate_to_down';
    } else if (orderByChoice === '2') {
      orderBy = 'pdate_to_up';
    } else if (orderByChoice === '3') {
      orderBy = 'price_to_up';
    } else if (orderByChoice === '4') {
      orderBy = 'price_to_down';
    } else if (orderByChoice === '5') {
      orderBy = 'pdate_to_down_upload';
    } else if (orderByChoice === '6') {
      orderBy = 'pdate_to_up_upload';
    } else if (orderByChoice === '7') {
      orderBy = 'edate_to_up';
    } else if (orderByChoice === '8') {
      orderBy = 'edate_to_down';
    } else {
      console.log('❌ Неверный выбор сортировки. Выход.');
      rl.close();
      return;
    }

    // Ввод ключевых слов для режима поиска
    let keywords = [];
    if (mode === 'search') {
      const keywordsInput = await ask('Введите ключевые слова через запятую (или Enter для значений из config): ');
      if (keywordsInput.trim()) {
        keywords = keywordsInput.split(',').map(k => k.trim()).filter(k => k);
      } else {
        keywords = config.keywords || [];
      }
    }

    // Ввод списка категорий для режима проверки разделов
    let categories = [];
    if (mode === 'check-categories') {
      console.log('Доступные категории:');
      const cats = config.categories || {};
      Object.entries(cats).forEach(([id, name]) => {
        console.log(`${id}. ${name}`);
      });
      console.log('all. Все категории');
      console.log('custom. Ввести свои ID через запятую');
      
      const catChoice = await ask('Выберите категории (номера через запятую, all или custom): ');
      
      if (catChoice.toLowerCase() === 'all') {
        categories = Object.keys(cats);
      } else if (catChoice.toLowerCase() === 'custom') {
        const customCats = await ask('Введите ID категорий через запятую: ');
        categories = customCats.split(',').map(c => c.trim()).filter(c => c);
      } else {
        categories = catChoice.split(',').map(c => c.trim()).filter(c => c);
        // Проверить, что введены числа или ключи из списка
        categories = categories.map(c => {
          if (cats[c]) return c; // Если ключ существует
          if (!isNaN(c)) return c; // Если число
          return null;
        }).filter(c => c);
      }
      
      if (categories.length === 0) {
        console.log('❌ Не выбраны категории. Выход.');
        rl.close();
        return;
      }
    } else if (mode === 'check-origins') {
      // Автоматически выбираем все категории для режима 4
      const cats = config.categories || {};
      categories = Object.keys(cats);
    } else if (mode === 'fake-personal') {
      // Автоматически выбираем все категории для режима 5
      const cats = config.categories || {};
      categories = Object.keys(cats);
    } else if (mode === 'telegram-years') {
      categories = [TELEGRAM_CATEGORY_ID];
    } else if (mode === 'socialclub-search') {
      categories = ['1', '12'];
    } else {
      // Ввод категории для других режимов
      console.log('Доступные категории:');
      const cats = config.categories || {};
      Object.entries(cats).forEach(([id, name]) => {
        console.log(`${id}. ${name}`);
      });
      const categoryInput = await ask('Введите ID категории (или Enter для всех): ');
      const category = categoryInput.trim() || config.category || '';
      categories = [category]; // Для совместимости
    }

    let includeOrigins = [];
    let excludeOrigins = [];
    if (['search', 'auto-check', 'check-categories'].includes(mode)) {
      const originFilters = await askOriginFilters(ask);
      includeOrigins = originFilters.includeOrigins;
      excludeOrigins = originFilters.excludeOrigins;
    }

    // Ввод количества страниц
    let maxPages;
    if (['fake-personal', 'telegram-years', 'socialclub-search', 'check-origins'].includes(mode)) {
      maxPages = 1; // Фиксированное значение для режимов 4, 5, 6, 7
    } else {
      const maxPagesInput = await ask('Введите максимальное количество страниц (Enter для значения из config, по умолчанию 20): ');
      maxPages = parseInt(maxPagesInput) || config.maxPages || 20;
    }

    // Ввод результатов на страницу
    let resultsPerPage;
    if (mode === 'check-origins') {
      resultsPerPage = 400; // Фиксированное значение для режима 4
    } else if (['fake-personal', 'telegram-years', 'socialclub-search'].includes(mode)) {
      resultsPerPage = 200; // Фиксированное значение для режимов 5, 6, 7
    } else {
      const resultsPerPageInput = await ask('Введите результатов на страницу (Enter для значения из config, по умолчанию 200): ');
      resultsPerPage = parseInt(resultsPerPageInput) || config.resultsPerPage || 200;
    }

    // Фиксированная сортировка для режимов 4, 5, 6, 7
    if (['fake-personal', 'telegram-years', 'socialclub-search', 'check-origins'].includes(mode)) {
      orderBy = 'pdate_to_down'; // Новые сначала
    }

    // Создаем конфиг для поиска
    const searchConfig = {
      ...config,
      mode,
      order_by: orderBy,
      keywords,
      ...(mode === 'check-categories' || mode === 'fake-personal' || mode === 'check-origins' ? { checkCategories: categories } : { category: categories[0] }),
      includeOrigins,
      excludeOrigins,
      maxPages,
      resultsPerPage
    };
    currentMode = mode;

    const modeDisplayName = mode === 'auto-check' ? 'автоматическая проверка' 
      : mode === 'search' ? 'поиск по словам' 
      : mode === 'check-origins' ? 'проверка неверного происхождения'
      : mode === 'fake-personal' ? 'поиск поддельных личных аккаунтов'
      : mode === 'telegram-years' ? 'поиск отлеги по годам в Telegram'
      : mode === 'socialclub-search' ? 'поиск Social Club в Steam и Epic Games'
      : 'проверка разделов';
    console.log(`\nРежим: ${modeDisplayName}`);
    console.log(`Сортировка: ${getOrderByName(orderBy)}`);
    console.log(`Дедупликация: ${searchConfig.deduplicateResults ? 'включена' : 'выключена'}`);
    if (mode === 'search') {
      console.log(`Ключевые слова: ${keywords.join(', ')}`);
    }
    if (mode === 'check-categories') {
      const cats = config.categories || {};
      const catNames = categories.map(id => cats[id] || `ID:${id}`).join(', ');
      console.log(`Категории: ${catNames}`);
    } else if (mode === 'check-origins') {
      const catNames = Object.values(config.categories || {}).join(', ');
      console.log(`Все разделы: ${catNames}`);
    } else if (mode === 'fake-personal') {
      const catNames = Object.values(config.categories || {}).join(', ');
      console.log(`Все разделы: ${catNames}`);
    } else if (mode === 'telegram-years') {
      console.log('Категория: Telegram (24)');
      console.log('Поисковые слова: отлега, отлёга, отлежка, отлёжка, inactive + годы 13..2');
    } else if (mode === 'socialclub-search') {
      console.log('Категории: Steam (1), Epic Games (12)');
      console.log('Поисковые слова: grand, rdr, gta + БЕЗ ДОСТУПА К SOCIAL CLUB');
    } else {
      const cats = config.categories || {};
      const catName = categories[0] ? (cats[categories[0]] || `ID:${categories[0]}`) : 'все';
      console.log(`Категория: ${catName}`);
    }
    if (includeOrigins.length > 0 && ['search', 'auto-check', 'check-categories'].includes(mode)) {
      console.log(`Фильтр origin[]: ${includeOrigins.join(', ')}`);
    }
    if (excludeOrigins.length > 0 && ['search', 'auto-check', 'check-categories'].includes(mode)) {
      console.log(`Фильтр not_origin[]: ${excludeOrigins.join(', ')}`);
    }
    console.log(`Максимум страниц: ${maxPages}`);
    console.log(`Результатов на страницу: ${resultsPerPage}\n`);

    // Обработчики режимов
    const modeHandlers = {
      'check-categories': async () => {
        const results = await checkAllCategories(searchConfig, rules, ask);
        return results;
      },
      'fake-personal': async () => {
        const results = await searchFakePersonal(searchConfig, rules, ask);
        await displayResults(results, 200, ask);
        return results;
      },
      'check-origins': async () => {
        const results = await checkAllOrigins(searchConfig, rules, ask);
        await displayResults(results, 200, ask);
        return results;
      },
      'socialclub-search': async () => {
        const results = await searchSocialClubAccounts(searchConfig, rules);
        await displayResults(results, 200, ask);
        return results;
      },
      'auto-check': async () => {
        const results = await autoCheckAllListings({...searchConfig, category: categories[0]}, rules);
        await displayViolationsOnly(results, 200, ask);
        return results;
      },
      'telegram-years': async () => {
        const results = await searchTelegramOtlegYears(searchConfig, rules);
        await displayResults(results, 200, ask);
        return results;
      },
      'search': async () => {
        const results = await searchByKeywords(searchConfig, rules);
        await displayResults(results, 200, ask);
        return results;
      }
    };

    try {
      const handler = modeHandlers[mode] || modeHandlers['search'];
      const results = await handler();
      currentResults = results;
      finalizeResults(results, startTime);
    } catch (error) {
      if (error.message !== 'rate_limit' && !isInterrupted) {
        console.error('❌ Ошибка при выполнении:', error.message);
        logError(`Ошибка при выполнении: ${error.message}`);
      }
    }

    // Вопрос о перезапуске
    console.log('');
    const restartChoice = await ask('Запустить бота заново с другим режимом? (y/n или да/нет): ');
    const choice = restartChoice.toLowerCase();
    if (choice !== 'y' && choice !== 'yes' && choice !== 'да' && choice !== 'д') {
      continueLoop = false;
    }
    console.log('');
  }

  rl.close();
}

export {
  normalizeText,
  checkViolations,
  getItemId,
  validateConfig,
  hasExplicitAgeOrDateNearKeyword
};

if (SCRIPT_PATH === process.argv[1]) {
  runBot().catch(err => {
    console.error('Непредвиденная ошибка:', err.message);
    logError(`Непредвиденная ошибка: ${err.message}`);
    process.exit(1);
  });
}
