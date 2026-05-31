import { buildSearchUrl, fetchJson, isParallelMode } from './api.js';
import { setTimeout as delay } from 'timers/promises';
import { DEFAULT_CONFIG } from './constants.js';

export function normalizeText(text) {
  return String(text || '').trim().toLowerCase();
}

export function isAsciiString(value) {
  return String(value || '').split('').every((ch) => ch.charCodeAt(0) <= 0x7f);
}

export function getItemId(item) {
  return item?.item_id ?? item?.id ?? item?.uid;
}

export function mergeResults(existing, newResults) {
  return existing.concat(newResults);
}

export function uniqItemsById(items) {
  const seen = new Set();
  const unique = [];
  for (const item of items) {
    const id = getItemId(item);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    unique.push(item);
  }
  return unique;
}

export function normalizePositiveInteger(value, defaultValue) {
  const num = Number(value);
  return Number.isInteger(num) && num > 0 ? num : defaultValue;
}

const ORDER_BY_LABELS = {
  price_to_up: 'сначала дешевые',
  price_to_down: 'сначала дорогие',
  pdate_to_up: 'старые сначала',
  pdate_to_down_upload: 'новые загруженные',
  pdate_to_up_upload: 'старые загруженные',
  edate_to_up: 'недавно отредактированные',
  edate_to_down: 'старые отредактированные',
  pdate_to_down: 'новые сначала'
};

export function getOrderByName(orderBy) {
  return ORDER_BY_LABELS[orderBy] || ORDER_BY_LABELS.pdate_to_down;
}

const MONTH_NAMES = [
  'янв(?:ар[ья])?',
  'фев(?:рал[ья])?',
  'мар(?:та?)?',
  'апр(?:ел[ья])?',
  'ма[йя]',
  'июн(?:я)?',
  'июл(?:я)?',
  'авг(?:уста?)?',
  'сен(?:т(?:ябр[ья])?)?',
  'окт(?:ябр[ья])?',
  'ноя(?:бря)?',
  'дек(?:абр[ья])?'
];

const TIME_UNITS = [
  'г\\.?',
  'год(?:а|ов)?',
  'лет',
  'месяц(?:а|ев)?',
  'недел(?:я|ь|и)?',
  'дн(?:\\.|я|ей)?',
  'день',
  'дня',
  'дни',
  'дней',
  'час(?:а|ов)?',
  'минут(?:а|ы)?',
  'мин',
  'day',
  'days',
  'month',
  'months',
  'year',
  'years',
  'yr',
  'yrs'
];

const TIME_CONTEXT_WORDS = ['от', 'за', 'в течение', 'через', 'по', 'с', 'на протяжении'];
const COMPARISON_WORDS = ['больше', 'более', 'менее', 'свыше', 'около', 'примерно', 'почти'];

const EXCLUSION_MAP = {
  жир: ['пожиратель', 'пассажиров']
};

const ALPHANUMERIC_BOUNDARY = '(?:^|[^0-9A-Za-zА-Яа-яЁё])';
const NON_ALPHANUMERIC_LOOKBEHIND = '(?<![\\p{L}\\p{N}])';
const NON_ALPHANUMERIC_LOOKAHEAD = '(?![\\p{L}\\p{N}])';

const AGE_DATE_PATTERNS = [
  new RegExp(`${ALPHANUMERIC_BOUNDARY}\\d{1,2}\\s*(?:${MONTH_NAMES.join('|')})(?:\\s*\\d{4}(?:\\s*г\\.?|\\s*год(?:а|ов)?)?)?${NON_ALPHANUMERIC_LOOKAHEAD}`, 'iu'),
  new RegExp(`${NON_ALPHANUMERIC_LOOKBEHIND}(?:с|в|по|на протяжении)\\s*(?:${MONTH_NAMES.join('|')})(?:\\s*\\d{4}(?:\\s*г\\.?|\\s*год(?:а|ов)?)?)?${NON_ALPHANUMERIC_LOOKAHEAD}`, 'iu'),
  new RegExp(`${ALPHANUMERIC_BOUNDARY}\\d+\\s*(?:[.,]?\\s*\\d+)?\\+?\\s*(?:${TIME_UNITS.join('|')})${NON_ALPHANUMERIC_LOOKAHEAD}`, 'iu'),
  new RegExp(`${ALPHANUMERIC_BOUNDARY}\\d+\\+?\\s*[а-яa-z]${NON_ALPHANUMERIC_LOOKAHEAD}`, 'iu'),
  new RegExp(`${NON_ALPHANUMERIC_LOOKBEHIND}(?:${TIME_CONTEXT_WORDS.join('|')})\\s+\\d+\\+?\\s*[а-яa-z]+`, 'iu'),
  new RegExp(`${NON_ALPHANUMERIC_LOOKBEHIND}(?:${COMPARISON_WORDS.join('|')})\\s+\\d+\\+?\\s*(?:${TIME_UNITS.join('|')})${NON_ALPHANUMERIC_LOOKAHEAD}`, 'iu'),
  new RegExp(`${NON_ALPHANUMERIC_LOOKBEHIND}(?:${COMPARISON_WORDS.join('|')}|на протяжении)\\s+(?:${TIME_UNITS.join('|')})${NON_ALPHANUMERIC_LOOKAHEAD}`, 'iu'),
  new RegExp(`${NON_ALPHANUMERIC_LOOKBEHIND}(?:${TIME_UNITS.join('|')})${NON_ALPHANUMERIC_LOOKAHEAD}`, 'iu'),
  new RegExp(`${ALPHANUMERIC_BOUNDARY}(?:с|в)\\s*\\d{4}${NON_ALPHANUMERIC_LOOKAHEAD}`, 'iu'),
  new RegExp(`${ALPHANUMERIC_BOUNDARY}\\d{4}${NON_ALPHANUMERIC_LOOKAHEAD}`, 'iu'),
  new RegExp(`${ALPHANUMERIC_BOUNDARY}\\d+\\s*[-/.]\\s*\\d+${NON_ALPHANUMERIC_LOOKAHEAD}`, 'iu')
];

function normalizeKeyword(value) {
  return normalizeText(value).replace(/[ё]/g, 'е').replace(/[ъ]/g, '');
}

export function hasExplicitAgeOrDateNearKeyword(textLower, keywordLower) {
  const normalizedText = normalizeKeyword(textLower);
  const normalizedKeyword = keywordLower ? normalizeKeyword(keywordLower) : '';

  if (!normalizedKeyword) {
    return AGE_DATE_PATTERNS.some((re) => re.test(normalizedText));
  }

  const keywordIndex = normalizedText.indexOf(normalizedKeyword);
  if (keywordIndex === -1) return false;

  const searchStart = Math.max(0, keywordIndex - 80);
  const searchEnd = Math.min(normalizedText.length, keywordIndex + normalizedKeyword.length + 80);
  const contextWindow = normalizedText.substring(searchStart, searchEnd);

  return AGE_DATE_PATTERNS.some((re) => re.test(contextWindow));
}

export function hasExplicitAccountAgeOrRegistration(text) {
  const normalized = normalizeText(text).replace(/[ё]/g, 'е');
  const accountAgeRegex = /(?:аккаунт(?:у|а|ы|е)?|акк(?:а|у|и)?|акки?)\s*(?:[:\-–—]?\s*)?(?:\(?\s*)?\d{1,2}\s*(?:лет|года|год|месяцев|месяц|мес(?:\.|яц)?|дн(?:\.|я|ей)?|дней|час(?:а|ов)?|ч)(?:\s*\d{1,2}\s*(?:месяцев|мес(?:\.|яц)?))?/iu;
  const registrationDateRegex = /(?:зарегистр(?:ирован|ова|уется|ано|ан)|зарегестр(?:ирован|ова|уется|ано|ан)|регистрац(?:ия|ион)|регист(?:раци|ровано)|рег\.)\s*(?:в\s*)?(?:\d{1,2}[./]\d{4}|\d{4}|(?:янв(?:ар[ья])?|фев(?:рал[ья])?|мар(?:та?)?|апр(?:ел[ья])?|ма[йя]|июн(?:я)?|июл(?:я)?|авг(?:уста?)?|сен(?:т(?:ябр[ья])?)?|окт(?:ябр[ья])?|ноя(?:бря)?|дек(?:абр[ья])?)(?:\s*\d{4})?)/iu;
  return accountAgeRegex.test(normalized) || registrationDateRegex.test(normalized);
}

export function hasAutoregEmailMention(text) {
  const normalized = normalizeText(text);
  const patterns = [
    /почт[аеыу]?\s*[-–—:]?\s*(?:\(|\[)?\s*авторег(?:\)|\])?/, 
    /авторег\s*[-–—:]?\s*(?:\(|\[)?\s*почт[аеыу]?(?:\)|\])?/, 
    /доступ к почт[аеыу]?\s*[-–—:]?\s*авторег/, 
    /авторег\s*[-–—:]?\s*доступ к почте/
  ];
  return patterns.some((re) => re.test(normalized));
}

function keywordExclusionMatch(keywordLower, combinedLower) {
  const exclusions = EXCLUSION_MAP[keywordLower];
  if (!Array.isArray(exclusions) || exclusions.length === 0) {
    return false;
  }
  return exclusions.some((value) => combinedLower.includes(value));
}

function findViolations(title, description, rules, categoryId = null) {
  if (!rules.violations) return [];

  const titleLower = normalizeText(title || '');
  const descriptionLower = normalizeText(description || '');
  const combinedLower = `${titleLower} ${descriptionLower}`.trim();
  const foundViolations = [];
  const isVPN = String(categoryId) === '19';

  for (const [category, violation] of Object.entries(rules.violations)) {
    const keywords = Array.isArray(violation.keywords) ? violation.keywords : [];
    for (const keyword of keywords) {
      const keywordLower = String(keyword || '').trim().toLowerCase();
      if (!keywordLower) continue;
      if (isVPN && keywordLower === 'премиум аккаунт') continue;
      if (keywordExclusionMatch(keywordLower, combinedLower)) continue;

      const foundInTitle = titleLower.includes(keywordLower);
      const foundInDescription = descriptionLower.includes(keywordLower);
      if (!foundInTitle && !foundInDescription) continue;
      if (category === 'vague_aging' && hasExplicitAgeOrDateNearKeyword(combinedLower, keywordLower)) continue;

      const location = foundInTitle && foundInDescription
        ? 'в названии и описании'
        : foundInDescription
          ? 'в описании'
          : 'в названии';

      foundViolations.push({
        category,
        name: violation.name,
        keyword,
        location
      });
    }
  }

  return foundViolations;
}

export function checkViolations(text, rules) {
  if (!text || !rules.violations) return [];
  return findViolations(text, '', rules);
}

export function formatItem(item, rules, extraProps = {}) {
  const id = getItemId(item);
  const title = item.title || item.name || 'Без названия';
  const description = item.description || item.desc || item.text || '';
  const url = `https://lzt.market/${id}`;
  const sellerLogin = item.seller?.username || item.seller_login || item.seller || item.login || 'неизвестно';
  const categoryId = item.category_id || item.category || null;

  const violations = findViolations(title, description, rules, categoryId);
  const origin = item.item_origin || item.origin || item.account_origin || item.resale_item_origin || item.itemOriginPhrase || null;
  const subOrigin = item.resale_item_origin || null;
  const combinedText = `${title} ${description}`.trim();
  const hasAutoregEmail = hasAutoregEmailMention(combinedText);
  const hasAccountAgeOrRegistration = hasExplicitAccountAgeOrRegistration(combinedText);

  return { id, title, description, url, violations, origin, subOrigin, sellerLogin, hasAutoregEmail, hasExplicitAccountAgeOrRegistration: hasAccountAgeOrRegistration, ...extraProps };
}

export async function searchOnce(config, rules, page = 1) {
  const data = await fetchJson(buildSearchUrl(config, page, true), config.token, config.maxRetries ?? 3, config.retryDelayMs ?? 500)
    .catch(async (error) => {
      const categoryPath = Boolean(config.category);
      if (error.message.includes('HTTP 404') && categoryPath) {
        return fetchJson(buildSearchUrl(config, page, false), config.token, config.maxRetries ?? 3, config.retryDelayMs ?? 500);
      }
      throw error;
    });

  const items = data.items || data.list || data.data || [];
  if (!Array.isArray(items)) {
    console.log('Непредвиденный формат ответа от API:', items);
    return { results: [], rawCount: 0 };
  }

  let filteredItems = items;
  if (config.category) {
    filteredItems = items.filter(item => String(item.category_id || item.category) === String(config.category));
  }

  const parsed = filteredItems.map(item => formatItem(item, rules)).filter(item => !item.hasAutoregEmail);
  return { results: parsed, rawCount: items.length };
}

function updateRuntimePartialResults(runtimeState, results, selector) {
  if (!runtimeState) return;
  runtimeState.partialResults = typeof selector === 'function' ? selector(results) : results;
}

export async function fetchWithConcurrencyLimit(pages, config, rules, maxConcurrent = 3, partialResultSelector = null) {
  const results = [];
  const pageDelayMs = normalizePositiveInteger(config.pageDelayMs, 500);
  let nextPageIndex = 0;
  let activeCount = 0;
  let stopFurther = false;

  return new Promise((resolve) => {
    const launchNextTask = async () => {
      if (stopFurther || config.runtimeState?.isInterrupted) {
        if (activeCount === 0) resolve(results);
        return;
      }

      if (nextPageIndex >= pages.length) {
        if (activeCount === 0) resolve(results);
        return;
      }

      const page = pages[nextPageIndex++];
      activeCount++;
      console.log(`📄 Обработка страницы ${page}... (одновременно: ${activeCount}/${maxConcurrent})`);

      try {
        const { results: pageResults, rawCount } = await searchOnce(config, rules, page);
        console.log(`   ✅ Страница ${page}: ${pageResults.length} объявлений`);
        results.push(...pageResults);
        updateRuntimePartialResults(config.runtimeState, results, partialResultSelector);

        if (rawCount === 0) {
          stopFurther = true;
        }

        if (!stopFurther && nextPageIndex < pages.length && !config.runtimeState?.isInterrupted) {
          await delay(pageDelayMs);
        }
      } catch (error) {
        console.error(`   ❌ Ошибка на странице ${page}: ${error.message}`);
      } finally {
        activeCount--;
        launchNextTask();
      }
    };

    const initialWorkers = Math.min(maxConcurrent, pages.length);
    for (let i = 0; i < initialWorkers; i++) {
      launchNextTask();
    }
  });
}

export async function collectPages(config, rules, itemLabel = 'Поиск', partialResultSelector = null) {
  let allResults = [];
  updateRuntimePartialResults(config.runtimeState, allResults, partialResultSelector);
  const maxPages = normalizePositiveInteger(config.maxPages, 1);
  const pageDelayMs = normalizePositiveInteger(config.pageDelayMs, 1000);
  const useParallel = config.parallelProcessing && isParallelMode(config.mode);

  console.log(`\n🔎 ${itemLabel}: страницы 1..${maxPages}`);

  if (useParallel) {
    const pages = Array.from({ length: maxPages }, (_, i) => i + 1);
    const maxConcurrent = normalizePositiveInteger(config.maxConcurrentRequests, DEFAULT_CONFIG.maxConcurrentRequests);
    console.log(`Параллельная обработка страниц: ${maxConcurrent} одновременных запросов.`);
    const pageResults = await fetchWithConcurrencyLimit(pages, config, rules, maxConcurrent, partialResultSelector);
    allResults = pageResults;
    updateRuntimePartialResults(config.runtimeState, allResults, partialResultSelector);
    if (config.deduplicateResults) {
      const uniqueResults = uniqItemsById(allResults);
      console.log(`\n✅ Параллельная обработка завершена: ${allResults.length} объявлений (${uniqueResults.length} уникальных)`);
      allResults = uniqueResults;
      updateRuntimePartialResults(config.runtimeState, allResults, partialResultSelector);
    } else {
      console.log(`\n✅ Параллельная обработка завершена: ${allResults.length} объявлений`);
    }
  } else {
    let retryCount = 0;
    const maxRetries = 2;

    for (let page = 1; page <= maxPages && !config.runtimeState?.isInterrupted; page++) {
      try {
        console.log(`📄 Обработка страницы ${page}...`);
        const { results, rawCount } = await searchOnce(config, rules, page);
        console.log(`   ✅ Страница ${page}: ${results.length} объявлений`);
        allResults.push(...results);
        updateRuntimePartialResults(config.runtimeState, allResults, partialResultSelector);
        retryCount = 0;

        if (rawCount === 0) {
          console.log(`   Страница ${page} пуста, остановка.`);
          break;
        }

        if (page < maxPages && !config.runtimeState?.isInterrupted) {
          await delay(pageDelayMs);
        }
      } catch (error) {
        if (error.message === 'rate_limit') {
          if (retryCount < maxRetries) {
            retryCount += 1;
            console.warn(`⚠️  Лимит запросов 429, повтор ${retryCount}/${maxRetries} после 10 сек...`);
            await new Promise(resolve => setTimeout(resolve, 10000));
            page--;
            continue;
          }
          console.error('❌ Превышено максимальное количество повторов при rate limit.');
          break;
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

    if (config.deduplicateResults) {
      const uniqueResults = uniqItemsById(allResults);
      console.log(`\n✅ Последовательная обработка завершена: ${allResults.length} объявлений (${uniqueResults.length} уникальных)`);
      allResults = uniqueResults;
      updateRuntimePartialResults(config.runtimeState, allResults, partialResultSelector);
    }
  }

  return allResults;
}

const OTLEG_BASE_TERMS = ['отлега', 'отлёга', 'отлежка', 'отлёжка', 'inactive'];
const OTLEG_YEAR_SUFFIXES = ['13 лет', '12 лет', '11 лет', '10 лет', '9 лет', '8 лет', '7 лет', '6 лет', '5 лет', '4 года', '3 года', '2 года'];
const OTLEG_YEAR_QUERIES = OTLEG_BASE_TERMS.flatMap((term) => OTLEG_YEAR_SUFFIXES.map((suffix) => `${term} ${suffix}`));

export function buildOtlegYearQueries() {
  return OTLEG_YEAR_QUERIES;
}

export async function collectPhraseSearches(config, rules, phrases, itemLabel = 'Поиск') {
  let allResults = [];
  if (config.runtimeState) {
    config.runtimeState.partialResults = allResults;
  }
  for (const phrase of phrases) {
    if (config.runtimeState?.isInterrupted) break;
    const phraseConfig = { ...config, keywords: [phrase] };
    console.log(`\n🔎 Поиск фразы: ${phrase}`);
    const results = await collectPages(phraseConfig, rules, itemLabel);
    allResults = mergeResults(allResults, results);
    if (config.runtimeState) {
      config.runtimeState.partialResults = allResults;
    }
  }

  if (config.deduplicateResults) {
    allResults = uniqItemsById(allResults);
    console.log(`\n✅ Объединение фраз завершено: ${allResults.length} уникальных объявлений.`);
  }

  return allResults;
}
