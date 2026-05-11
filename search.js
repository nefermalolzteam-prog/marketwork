import { buildSearchUrl, fetchJson, isParallelMode } from './api.js';
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

export function normalizePositiveInteger(value, defaultValue) {
  const num = Number(value);
  return Number.isInteger(num) && num > 0 ? num : defaultValue;
}

export function getOrderByName(orderBy) {
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

export function hasExplicitAgeOrDateNearKeyword(textLower, keywordLower) {
  const normalizedText = normalizeText(textLower).replace(/[ё]/g, 'е').replace(/[ъ]/g, '');
  const normalizedKeyword = keywordLower ? normalizeText(keywordLower).replace(/[ё]/g, 'е').replace(/[ъ]/g, '') : '';

  const dateOrAgePatterns = [
    /(?:^|[^0-9A-Za-zА-Яа-яЁё])\d{1,2}\s*(?:янв(?:ар[ья])?|фев(?:рал[ья])?|мар(?:та?)?|апр(?:ел[ья])?|ма[йя]|июн(?:я)?|июл(?:я)?|авг(?:уста?)?|сен(?:т(?:ябр[ья])?)?|окт(?:ябр[ья])?|ноя(?:бря)?|дек(?:абр[ья])?)(?:\s*\d{4}(?:\s*г\.?|\s*год(?:а|ов)?)?)?(?=$|[^0-9A-Za-zА-Яа-яЁё])/iu,
    /(?<![\p{L}\p{N}])(?:с|в|по|на протяжении)\s*(?:янв(?:ар[ья])?|фев(?:рал[ья])?|мар(?:та?)?|апр(?:ел[ья])?|ма[йя]|июн(?:я)?|июл(?:я)?|авг(?:уста?)?|сен(?:т(?:ябр[ья])?)?|окт(?:ябр[ья])?|ноя(?:бря)?|дек(?:абр[ья])?)(?:\s*\d{4}(?:\s*г\.?|\s*год(?:а|ов)?)?)?(?![\p{L}\p{N}])/iu,
    /(?:^|[^0-9A-Za-zА-Яа-яЁё])\d+\s*(?:[.,]?\s*\d+)?\+?\s*(?:г\.?|год(?:а|ов)?|лет|месяц(?:а|ев)?|недел(?:я|ь|и)?|дн(?:\.|я|ей)?|день|дня|дни|дней|час(?:а|ов)?|минут(?:а|ы)?|мин|day|days|month|months|year|years|yr|yrs)(?=$|[^0-9A-Za-zА-Яа-яЁё])/iu,
    /(?:^|[^0-9A-Za-zА-Яа-яЁё])\d+\+?\s*[а-яa-z](?=$|[^0-9A-Za-zА-Яа-яЁё])/iu,
    /(?<![\p{L}\p{N}])(?:от|за|в течение|через|по|с|на протяжении)\s+\d+\+?\s*[а-яa-z]+/iu,
    /(?<![\p{L}\p{N}])(?:больше|более|менее|свыше|около|примерно|почти)\s+\d+\+?\s*(?:г\.?|год(?:а|ов)?|лет|месяц(?:а|ев)?|недел(?:я|ь|и)?|дн(?:\.|я|ей)?|день|дня|дни|дней|час(?:а|ов)?|минут(?:а|ы)?|мин|day|days|month|months|year|years|yr|yrs)(?![\p{L}\p{N}])/iu,
    /(?<![\p{L}\p{N}])(?:больше|более|менее|свыше|около|примерно|почти|на протяжении)\s+(?:год(?:а|ов)?|лет|месяц(?:а|ев)?|недел(?:я|ь|и)?|дн(?:\.|я|ей)?|день|дня|дни|дней|час(?:а|ов)?|минут(?:а|ы)?|мин|day|days|month|months|year|years|yr|yrs)(?![\p{L}\p{N}])/iu,
    /(?<![\p{L}\p{N}])(?:год(?:а|ов)?|лет|месяц(?:а|ев)?|недел(?:я|ь|и)?|дн(?:\.|я|ей)?|день|дня|дни|дней|час(?:а|ов)?|минут(?:а|ы)?|мин|day|days|month|months|year|years|yr|yrs)(?![\p{L}\p{N}])/iu,
    /(?:^|[^0-9A-Za-zА-Яа-яЁё])(?:с|в)\s*\d{4}(?=$|[^0-9A-Za-zА-Яа-яЁё])/iu,
    /(?:^|[^0-9A-Za-zА-Яа-яЁё])\d{4}(?=$|[^0-9A-Za-zА-Яа-яЁё])/iu,
    /(?:^|[^0-9A-Za-zА-Яа-яЁё])\d+\s*[-/.]\s*\d+(?=$|[^0-9A-Za-zА-Яа-яЁё])/iu
  ];

  if (!normalizedKeyword) {
    return dateOrAgePatterns.some((re) => re.test(normalizedText));
  }

  const keywordIndex = normalizedText.indexOf(normalizedKeyword);
  if (keywordIndex === -1) return false;

  const searchStart = Math.max(0, keywordIndex - 80);
  const searchEnd = Math.min(normalizedText.length, keywordIndex + normalizedKeyword.length + 80);
  const contextWindow = normalizedText.substring(searchStart, searchEnd);

  return dateOrAgePatterns.some((re) => re.test(contextWindow));
}

function findViolations(title, description, rules, categoryId = null) {
  if (!rules.violations) return [];

  const titleLower = normalizeText(title || '');
  const descriptionLower = normalizeText(description || '');
  const combinedLower = `${titleLower} ${descriptionLower}`.trim();
  const foundViolations = [];
  const isVPN = String(categoryId) === '19';

  for (const [category, violation] of Object.entries(rules.violations)) {
    for (const keyword of violation.keywords) {
      if (!keyword) continue;
      if (isVPN && keyword === 'премиум аккаунт') continue;

      const keywordLower = normalizeText(keyword);
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
  const hasAutoregEmail = normalizeText(combinedText).includes('почта авторег');

  return { id, title, description, url, violations, origin, subOrigin, sellerLogin, hasAutoregEmail, ...extraProps };
}

export async function searchOnce(config, rules, page = 1) {
  const data = await fetchJson(buildSearchUrl(config, page, true), config.token, config.maxRetries ?? 3, config.retryDelayMs ?? 500)
    .catch(async (error) => {
      const categoryPath = Boolean(config.category) && Boolean(config.category);
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

export async function fetchWithConcurrencyLimit(pages, config, rules, maxConcurrent = 3) {
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
        if (config.runtimeState) {
          config.runtimeState.partialResults = results;
        }

        if (rawCount === 0) {
          stopFurther = true;
        }

        if (!stopFurther && nextPageIndex < pages.length && !config.runtimeState?.isInterrupted) {
          await new Promise(resolveDelay => setTimeout(resolveDelay, pageDelayMs));
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

export async function collectPages(config, rules, itemLabel = 'Поиск') {
  let allResults = [];
  if (config.runtimeState) {
    config.runtimeState.partialResults = allResults;
  }
  const maxPages = normalizePositiveInteger(config.maxPages, 1);
  const pageDelayMs = normalizePositiveInteger(config.pageDelayMs, 1000);
  const useParallel = config.parallelProcessing && isParallelMode(config.mode);

  console.log(`\n🔎 ${itemLabel}: страницы 1..${maxPages}`);

  if (useParallel) {
    const pages = Array.from({ length: maxPages }, (_, i) => i + 1);
    const maxConcurrent = normalizePositiveInteger(config.maxConcurrentRequests, DEFAULT_CONFIG.maxConcurrentRequests);
    console.log(`Параллельная обработка страниц: ${maxConcurrent} одновременных запросов.`);
    const pageResults = await fetchWithConcurrencyLimit(pages, config, rules, maxConcurrent);
    allResults = pageResults;
    if (config.runtimeState) {
      config.runtimeState.partialResults = allResults;
    }
    console.log(`\n✅ Параллельная обработка завершена: ${allResults.length} объявлений`);
  } else {
    let retryCount = 0;
    const maxRetries = 2;

    for (let page = 1; page <= maxPages && !config.runtimeState?.isInterrupted; page++) {
      try {
        console.log(`📄 Обработка страницы ${page}...`);
        const { results, rawCount } = await searchOnce(config, rules, page);
        console.log(`   ✅ Страница ${page}: ${results.length} объявлений`);
        allResults.push(...results);
        if (config.runtimeState) {
          config.runtimeState.partialResults = allResults;
        }
        retryCount = 0;

        if (rawCount === 0) {
          console.log(`   Страница ${page} пуста, остановка.`);
          break;
        }

        if (page < maxPages && !config.runtimeState?.isInterrupted) {
          await new Promise(resolve => setTimeout(resolve, pageDelayMs));
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
  }

  return allResults;
}

export function buildOtlegYearQueries() {
  const OTLEG_BASE_TERMS = ['отлега', 'отлёга', 'отлежка', 'отлёжка', 'inactive'];
  const OTLEG_YEAR_SUFFIXES = ['13 лет', '12 лет', '11 лет', '10 лет', '9 лет', '8 лет', '7 лет', '6 лет', '5 лет', '4 года', '3 года', '2 года'];
  return OTLEG_BASE_TERMS.flatMap((term) => OTLEG_YEAR_SUFFIXES.map((suffix) => `${term} ${suffix}`));
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
  return allResults;
}
