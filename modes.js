import { collectPages, collectPhraseSearches, mergeResults, normalizeText, getOrderByName } from './search.js';
import { displayViolationsOnly } from './display.js';
import { logError } from './logger.js';
import { setTimeout as delay } from 'timers/promises';
import {
  ACCOUNT_ORIGINS,
  TELEGRAM_CATEGORY_ID,
  DEFAULT_CONFIG,
  DEFAULT_MAX_PAGES,
  DEFAULT_RESULTS_PER_PAGE,
  DEFAULT_PAGE_DELAY_MS,
  DEFAULT_CATEGORY_DELAY_MS
} from './constants.js';

const OTLEG_BASE_TERMS = ['отлега', 'отлёга', 'отлежка', 'отлёжка', 'inactive'];
const OTLEG_YEAR_SUFFIXES = ['13 лет', '12 лет', '11 лет', '10 лет', '9 лет', '8 лет', '7 лет', '6 лет', '5 лет', '4 года', '3 года', '2 года'];
const OTLEG_YEAR_QUERIES = OTLEG_BASE_TERMS.flatMap((term) => OTLEG_YEAR_SUFFIXES.map((suffix) => `${term} ${suffix}`));

/**
 * Преобразует ввод origin[] в массив нормализованных значений
 * @param {string|undefined|null} input
 * @returns {Array<string>}
 */
function parseOriginInput(input) {
  return String(input || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Возвращает значение целого числа или дефолт, если значение некорректно
 * @param {unknown} value
 * @param {number} defaultValue
 * @returns {number}
 */
function getConfiguredNumber(value, defaultValue) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : defaultValue;
}

/**
 * Возвращает положительное целое число или дефолтное значение
 * @param {unknown} value
 * @param {number} defaultValue
 * @returns {number}
 */
function getConfiguredPositiveNumber(value, defaultValue) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : defaultValue;
}

/**
 * Форматирует отображаемое имя категории по конфигурации
 * @param {Object} config
 * @param {string} category
 * @returns {string}
 */
function formatCategoryName(config, category) {
  return config.categories?.[category] || `ID:${category}`;
}

function getPageDelay(config) {
  return getConfiguredNumber(config.pageDelayMs, DEFAULT_PAGE_DELAY_MS);
}

function formatResultsPerPage(config) {
  return config.resultsPerPage === undefined ? 'по умолчанию API' : getConfiguredPositiveNumber(config.resultsPerPage, DEFAULT_RESULTS_PER_PAGE);
}

function logModeHeader(title, description, config, extraLines = [], pageLabel = 'Максимум страниц', perPageLabel = 'Результатов на страницу') {
  console.log(title);
  if (description) {
    console.log(`Описание: ${description}`);
  }
  console.log(`Сортировка: ${getOrderByName(config.order_by)}`);
  console.log(`${pageLabel}: ${getMaxPages(config)}`);
  console.log(`${perPageLabel}: ${formatResultsPerPage(config)}`);
  console.log(`Задержка между страницами: ${getPageDelay(config)} мс`);
  extraLines.forEach((line) => console.log(line));
  console.log();
}

function getResultsPerPage(config) {
  return getConfiguredPositiveNumber(config.resultsPerPage, DEFAULT_RESULTS_PER_PAGE);
}

function getMaxPages(config) {
  return getConfiguredPositiveNumber(config.maxPages, DEFAULT_MAX_PAGES);
}

function getMaxConcurrent(config) {
  return Math.max(1, getConfiguredPositiveNumber(config.maxConcurrentRequests, DEFAULT_CONFIG.maxConcurrentRequests));
}

function filterValidOrigins(origins) {
  const knownOrigins = new Set(Object.keys(ACCOUNT_ORIGINS));
  const valid = origins.filter((value) => knownOrigins.has(value));
  const invalid = origins.filter((value) => !knownOrigins.has(value));
  if (invalid.length > 0) {
    console.warn(`⚠️  Игнорируются неизвестные origin: ${invalid.join(', ')}`);
  }
  return [...new Set(valid)];
}

/**
 * Запрашивает origin-фильтры у пользователя и валидирует введённые значения
 * @param {Function} ask - Функция для интерактивного ввода
 * @returns {Promise<{includeOrigins: Array<string>, excludeOrigins: Array<string>}>}
 */
export async function askOriginFilters(ask) {
  const options = Object.entries(ACCOUNT_ORIGINS)
    .map(([code, info]) => `${code} (${info.name})`)
    .join(', ');

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

/**
 * Обрабатывает элементы в параллельных воркерах с сохранением порядка
 * @param {Array<unknown>} items
 * @param {number} maxConcurrent
 * @param {(item: unknown) => Promise<Array<unknown>>} taskFn
 * @param {{isInterrupted?: boolean}|undefined} runtimeState
 * @returns {Promise<Array<unknown>>}
 */
async function processItemsInBatches(items, maxConcurrent, taskFn, runtimeState) {
  const orderedResults = new Array(items.length);
  let index = 0;

  const worker = async () => {
    while (index < items.length && !runtimeState?.isInterrupted) {
      const currentIndex = index;
      index += 1;
      const item = items[currentIndex];
      try {
        const itemResults = await taskFn(item);
        orderedResults[currentIndex] = Array.isArray(itemResults) ? itemResults : [];
      } catch (error) {
        console.error(`   ❌ Ошибка при обработке ${item}: ${error?.message || error}`);
        orderedResults[currentIndex] = [];
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(maxConcurrent, items.length) }, () => worker()));
  return orderedResults.flat();
}

export async function searchByKeywords(config, rules) {
  try {
    logModeHeader('🔍 Режим поиска по ключевым словам', null, config, [`Ключевые слова: ${Array.isArray(config.keywords) ? config.keywords.join(', ') : config.keywords}`, `Категория: ${config.category || 'все'}`]);
    const results = await collectPages(config, rules, 'Поиск');
    console.log(`\n📊 Всего найдено объявлений: ${Array.isArray(results) ? results.length : 0}`);
    return Array.isArray(results) ? results : [];
  } catch (err) {
    logError(`searchByKeywords не выполнен: ${err && err.message ? err.message : err}`);
    return [];
  }
}

export async function searchFakePersonal(config, rules) {
  const maxConcurrent = getMaxConcurrent(config);

  logModeHeader('🔍 Режим поиска личных аккаунтов по названию', 'Поиск аккаунтов, где в названии содержится "личный" и при этом происхождение исключает личный.', config, [`Параллельная проверка категорий: ${maxConcurrent} одновременно`], 'Максимум страниц на категорию');

  const categories = config.checkCategories || [];

  try {
    const results = await processItemsInBatches(categories, maxConcurrent, async (category) => {
    if (config.runtimeState?.isInterrupted) return [];
    const catName = formatCategoryName(config, category);
    console.log(`\n📂 Проверка категории ${catName} (${category})...`);

    const categoryConfig = {
      ...config,
      category,
      keywords: ['личный'],
      excludeOrigins: ['personal']
    };
    const pageResults = await collectPages(categoryConfig, rules, `Поиск личного в ${catName}`);
    const titleMatched = pageResults.filter(item => {
      const normalizedTitle = normalizeText(item.title);
      if (!normalizedTitle.includes('личный')) return false;
      if (/личный\s*траф(?:ик)?/.test(normalizedTitle)) return false;
      return true;
    });
    return titleMatched.map(item => ({
      ...item,
      category: catName,
      checkedOrigin: 'Личный',
      excludedOrigin: 'Личный',
      matchedKeywords: ['личный']
    }));
  }, config.runtimeState);
    console.log(`\n📊 Всего найдено объявлений: ${results.length}`);
    return results;
  } catch (err) {
    logError(`searchFakePersonal не выполнен: ${err && err.message ? err.message : err}`);
    return [];
  }
}

export async function checkAllOrigins(config, rules) {
  const maxConcurrent = getMaxConcurrent(config);

  logModeHeader('🔍 Режим проверки неверного происхождения', 'Отображение товаров, где название содержит происхождение, а фактическое происхождение отличается. Основные правила нарушений не учитываются.', config, [`Параллельная проверка категорий: ${maxConcurrent} одновременно`], 'Максимум страниц на категорию');

  const origins = Object.keys(ACCOUNT_ORIGINS);
  const categories = config.checkCategories || [];
  let totalResults = [];

  try {
    for (const origin of origins) {
      if (config.runtimeState?.isInterrupted) break;
    const originInfo = ACCOUNT_ORIGINS[origin];
    console.log(`\n${'='.repeat(80)}`);
    console.log(`🔎 Проверка происхождения: ${originInfo.name} (${origin})`);
    console.log(`${'='.repeat(80)}`);

    const originResults = await processItemsInBatches(categories, maxConcurrent, async (category) => {
      if (config.runtimeState?.isInterrupted) return [];
      const catName = formatCategoryName(config, category);
      const categoryConfig = {
        ...config,
        category,
        keywords: originInfo.searchTerms,
        excludeOrigins: [origin]
      };
      const pageResults = await collectPages(categoryConfig, rules, `Проверка ${originInfo.name} в ${catName}`);
      return pageResults.map(item => {
        const normalizedTitle = normalizeText(item.title);
        const matchedKeywords = originInfo.searchTerms.filter(term => normalizedTitle.includes(normalizeText(term)));
        return {
          ...item,
          category: catName,
          checkedOrigin: originInfo.name,
          excludedOrigin: originInfo.name,
          matchedKeywords
        };
      });
    }, config.runtimeState);

      totalResults = mergeResults(totalResults, originResults);
    }
    console.log(`\n📊 Всего найдено объявлений: ${totalResults.length}`);
    return totalResults;
  } catch (err) {
    logError(`checkAllOrigins не выполнен: ${err && err.message ? err.message : err}`);
    return [];
  }
}

export async function searchTelegramOtlegYears(config, rules) {
  const queries = OTLEG_YEAR_QUERIES;
  try {
    logModeHeader('🔍 Режим поиска по годам отлеги в Telegram', null, config, [`Категория: Telegram (${TELEGRAM_CATEGORY_ID})`, `Поисковые фразы: ${queries.length}`]);
    const results = await collectPhraseSearches({ ...config, category: TELEGRAM_CATEGORY_ID, maxPages: getMaxPages(config) }, rules, queries, 'Отлеги Telegram');
    const filteredResults = Array.isArray(results) ? results.filter(item => !item.hasExplicitAccountAgeOrRegistration) : [];
    if (config.runtimeState) config.runtimeState.partialResults = filteredResults;
    console.log(`\n📊 Всего найдено объявлений: ${filteredResults.length}`);
    return filteredResults;
  } catch (err) {
    logError(`searchTelegramOtlegYears не выполнен: ${err && err.message ? err.message : err}`);
    return [];
  }
}

export async function searchSocialClubAccounts(config, rules) {
  const queries = [
    'grand (БЕЗ ДОСТУПА К SOCIAL CLUB)',
    'rdr (БЕЗ ДОСТУПА К SOCIAL CLUB)',
    'gta (БЕЗ ДОСТУПА К SOCIAL CLUB)'
  ];
  const categories = ['1', '12'];
  const sectionNames = { '1': 'Steam', '12': 'Epic Games' };

  logModeHeader('🔍 Режим поиска Social Club в Steam и Epic Games', null, config, [`Категории: Steam (1), Epic Games (12)`, `Поисковые фразы: ${queries.length}`]);

  let allResults = [];

  try {
    for (const category of categories) {
      if (config.runtimeState?.isInterrupted) break;
      const catName = sectionNames[category] || `ID:${category}`;
      console.log(`\n📂 Поиск в категории ${catName} (${category})...`);
      const results = await collectPhraseSearches({ ...config, category, maxPages: getMaxPages(config) }, rules, queries, `Поиск Social Club в ${catName}`);
      allResults = mergeResults(allResults, Array.isArray(results) ? results.map(item => ({ ...item, category: catName })) : []);
      if (config.runtimeState) config.runtimeState.partialResults = allResults;
    }
    console.log(`\n📊 Всего найдено объявлений: ${allResults.length}`);
    return allResults;
  } catch (err) {
    logError(`searchSocialClubAccounts не выполнен: ${err && err.message ? err.message : err}`);
    return [];
  }
}

export async function checkAllCategories(config, rules, ask) {
  const checkStartTime = Date.now();
  const cats = config.categories || {};
  const categories = Array.isArray(config.checkCategories) ? config.checkCategories : [];
  const catNames = categories.map(id => cats[id] || `ID:${id}`).join(', ');
  const categoryDelayMs = getConfiguredNumber(config.categoryDelayMs, DEFAULT_CATEGORY_DELAY_MS);

  logModeHeader('🔍 Режим проверки всех разделов (категорий)', null, config, [`Категории: ${catNames}`, `Задержка между категориями: ${categoryDelayMs} мс`], 'Максимум страниц на категорию');

  let totalResults = [];
  let totalChecked = 0;

  try {
    for (const category of categories) {
      if (config.runtimeState?.isInterrupted) break;
    const catName = cats[category] || `ID:${category}`;
    console.log(`\n📂 Проверка категории ${catName} (${category})...`);

    try {
      const modeResult = await autoCheckAllListings({ ...config, category, verbose: false }, rules);
      const violations = Array.isArray(modeResult) ? modeResult : modeResult.violations || [];
      const checkedCount = Array.isArray(modeResult) ? violations.length : Number(modeResult.totalChecked ?? violations.length);
      const resultsWithCategory = violations.map(item => ({ ...item, category: catName }));
      console.log(`   ✅ Проверено: ${checkedCount}, нарушений: ${violations.length}`);
      totalResults = mergeResults(totalResults, resultsWithCategory);
      totalChecked += checkedCount;
      if (config.runtimeState) {
        config.runtimeState.partialResults = totalResults;
      }
    } catch (error) {
      console.error(`   ❌ Ошибка: ${error.message}`);
    }

      if (categories.indexOf(category) < categories.length - 1 && !config.runtimeState?.isInterrupted) {
        await delay(categoryDelayMs);
      }
    }

    await displayViolationsOnly(totalResults, getResultsPerPage(config), ask, { mode: 'check-categories' });

    const endTime = Date.now();
    const duration = (endTime - checkStartTime) / 1000;
    return { results: totalResults, totalChecked, duration };
  } catch (err) {
    logError(`checkAllCategories не выполнен: ${err && err.message ? err.message : err}`);
    return { results: [], totalChecked: 0, duration: 0 };
  }
}

export async function autoCheckAllListings(config, rules) {
  try {
    if (config.verbose !== false) {
      console.log('🔍 Режим автоматической проверки всех объявлений');
      console.log(`Категория: ${config.category || 'все'}`);
      console.log(`Сортировка: ${getOrderByName(config.order_by)}`);
      console.log(`Дедупликация: ${config.deduplicateResults ? 'включена' : 'выключена'}`);
      console.log(`Максимум страниц: ${getMaxPages(config)}`);
      console.log(`Результатов на страницу: ${config.resultsPerPage === undefined ? 'по умолчанию API' : getResultsPerPage(config)}`);
      console.log(`Задержка между страницами: ${getPageDelay(config)} мс\n`);
    }

    const results = await collectPages(
      { ...config, keywords: '' },
      rules,
      'Проверка',
      (allResults) => allResults.filter(item => item.violations && item.violations.length > 0)
    );
    const filteredResults = Array.isArray(results) ? results.filter(item => item.violations && item.violations.length > 0) : [];
    if (config.verbose !== false) {
      console.log(`\n📊 Всего проверено объявлений: ${Array.isArray(results) ? results.length : 0}, с нарушениями: ${filteredResults.length}`);
    }
    return {
      items: Array.isArray(results) ? results : [],
      violations: filteredResults,
      totalChecked: Array.isArray(results) ? results.length : 0
    };
  } catch (err) {
    logError(`autoCheckAllListings не выполнен: ${err && err.message ? err.message : err}`);
    return { violations: [], totalChecked: 0 };
  }
}
