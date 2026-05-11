import { collectPages, collectPhraseSearches, mergeResults, normalizeText, getOrderByName } from './search.js';
import { displayViolationsOnly } from './display.js';
import {
  ACCOUNT_ORIGINS,
  TELEGRAM_CATEGORY_ID,
  DEFAULT_CONFIG,
  DEFAULT_MAX_PAGES,
  DEFAULT_RESULTS_PER_PAGE,
  DEFAULT_PAGE_DELAY_MS,
  DEFAULT_CATEGORY_DELAY_MS
} from './constants.js';

function parseOriginInput(input) {
  return String(input || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
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

function buildOtlegYearQueries() {
  const OTLEG_BASE_TERMS = ['отлега', 'отлёга', 'отлежка', 'отлёжка', 'inactive'];
  const OTLEG_YEAR_SUFFIXES = ['13 лет', '12 лет', '11 лет', '10 лет', '9 лет', '8 лет', '7 лет', '6 лет', '5 лет', '4 года', '3 года', '2 года'];
  return OTLEG_BASE_TERMS.flatMap((term) => OTLEG_YEAR_SUFFIXES.map((suffix) => `${term} ${suffix}`));
}

async function processItemsInBatches(items, maxConcurrent, taskFn, runtimeState) {
  const results = [];
  let index = 0;

  const worker = async () => {
    while (index < items.length && !runtimeState?.isInterrupted) {
      const currentIndex = index;
      index += 1;
      const item = items[currentIndex];
      try {
        const itemResults = await taskFn(item);
        if (Array.isArray(itemResults)) {
          results.push(...itemResults);
        }
      } catch (error) {
        console.error(`   ❌ Ошибка при обработке ${item}: ${error.message}`);
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(maxConcurrent, items.length) }, () => worker()));
  return results;
}

export async function searchByKeywords(config, rules) {
  console.log('🔍 Режим поиска по ключевым словам');
  console.log(`Ключевые слова: ${Array.isArray(config.keywords) ? config.keywords.join(', ') : config.keywords}`);
  console.log(`Категория: ${config.category || 'все'}`);
  console.log(`Сортировка: ${getOrderByName(config.order_by)}`);
  console.log(`Дедупликация: выключена`);
  console.log(`Максимум страниц: ${config.maxPages || DEFAULT_MAX_PAGES}`);
  console.log(`Результатов на страницу: ${config.resultsPerPage || 'по умолчанию API'}`);
  console.log(`Задержка между страницами: ${config.pageDelayMs ?? DEFAULT_PAGE_DELAY_MS} мс\n`);

  const results = await collectPages(config, rules, 'Поиск');
  console.log(`\n📊 Всего найдено объявлений: ${results.length}`);
  return results;
}

export async function searchFakePersonal(config, rules) {
  console.log('🔍 Режим поиска личных аккаунтов по названию');
  console.log('Описание: поиск аккаунтов, где в названии содержится "личный" и при этом происхождение исключает личный.');
  console.log(`Сортировка: ${getOrderByName(config.order_by)}`);
  console.log(`Максимум страниц на категорию: ${config.maxPages || DEFAULT_MAX_PAGES}`);
  console.log(`Результатов на страницу: ${config.resultsPerPage || DEFAULT_RESULTS_PER_PAGE}`);
  console.log(`Задержка между страницами: ${config.pageDelayMs ?? DEFAULT_PAGE_DELAY_MS} мс`);
  console.log(`Параллельная проверка категорий: ${config.maxConcurrentRequests || DEFAULT_CONFIG.maxConcurrentRequests} одновременно\n`);

  const categories = config.checkCategories || [];
  const maxConcurrent = Math.max(1, Number(config.maxConcurrentRequests) || DEFAULT_CONFIG.maxConcurrentRequests);

  const results = await processItemsInBatches(categories, maxConcurrent, async (category) => {
    if (config.runtimeState?.isInterrupted) return [];
    const catName = config.categories?.[category] || `ID:${category}`;
    console.log(`\n📂 Проверка категории ${catName} (${category})...`);

    const categoryConfig = {
      ...config,
      category,
      keywords: ['личный'],
      excludeOrigins: ['personal']
    };
    const pageResults = await collectPages(categoryConfig, rules, `Поиск личного в ${catName}`);
    const titleMatched = pageResults.filter(item => normalizeText(item.title).includes('личный'));
    return titleMatched.map(item => ({ ...item, category: catName, checkedOrigin: 'Личный', excludedOrigin: 'Личный' }));
  }, config.runtimeState);

  console.log(`\n📊 Всего найдено объявлений: ${results.length}`);
  return results;
}

export async function checkAllOrigins(config, rules) {
  console.log('🔍 Режим проверки неверного происхождения');
  console.log('Описание: отображение товаров, где название содержит происхождение, а фактическое происхождение отличается. Основные правила нарушений не учитываются.');
  console.log(`Сортировка: ${getOrderByName(config.order_by)}`);
  console.log(`Максимум страниц на категорию: ${config.maxPages || DEFAULT_MAX_PAGES}`);
  console.log(`Результатов на страницу: ${config.resultsPerPage || DEFAULT_RESULTS_PER_PAGE}`);
  console.log(`Задержка между страницами: ${config.pageDelayMs ?? DEFAULT_PAGE_DELAY_MS} мс`);
  console.log(`Параллельная проверка категорий: ${config.maxConcurrentRequests || DEFAULT_CONFIG.maxConcurrentRequests} одновременно\n`);

  const origins = Object.keys(ACCOUNT_ORIGINS);
  const categories = config.checkCategories || [];
  const maxConcurrent = Math.max(1, Number(config.maxConcurrentRequests) || DEFAULT_CONFIG.maxConcurrentRequests);
  let totalResults = [];

  for (const origin of origins) {
    if (config.runtimeState?.isInterrupted) break;
    const originInfo = ACCOUNT_ORIGINS[origin];
    console.log(`\n${'='.repeat(80)}`);
    console.log(`🔎 Проверка происхождения: ${originInfo.name} (${origin})`);
    console.log(`${'='.repeat(80)}`);

    const originResults = await processItemsInBatches(categories, maxConcurrent, async (category) => {
      if (config.runtimeState?.isInterrupted) return [];
      const catName = config.categories?.[category] || `ID:${category}`;
      console.log(`\n📂 Категория ${catName} (${category})...`);

      const categoryConfig = {
        ...config,
        category,
        keywords: originInfo.searchTerms,
        excludeOrigins: [origin]
      };
      const pageResults = await collectPages(categoryConfig, rules, `Проверка ${originInfo.name} в ${catName}`);
      return pageResults.map(item => ({ ...item, category: catName, checkedOrigin: originInfo.name, excludedOrigin: originInfo.name }));
    }, config.runtimeState);

    totalResults = mergeResults(totalResults, originResults);
  }

  console.log(`\n📊 Всего найдено объявлений: ${totalResults.length}`);
  return totalResults;
}

export async function searchTelegramOtlegYears(config, rules) {
  const queries = buildOtlegYearQueries();
  console.log('🔍 Режим поиска по годам отлеги в Telegram');
  console.log(`Категория: Telegram (${TELEGRAM_CATEGORY_ID})`);
  console.log(`Поисковые фразы: ${queries.length}`);
  console.log(`Сортировка: ${getOrderByName(config.order_by)}`);
  console.log(`Дедупликация: выключена`);
  console.log(`Максимум страниц: ${config.maxPages || DEFAULT_MAX_PAGES}`);
  console.log(`Результатов на страницу: ${config.resultsPerPage || 'по умолчанию API'}`);
  console.log(`Задержка между страницами: ${config.pageDelayMs ?? DEFAULT_PAGE_DELAY_MS} мс\n`);

  const results = await collectPhraseSearches({ ...config, category: TELEGRAM_CATEGORY_ID, maxPages: config.maxPages }, rules, queries, 'Отлеги Telegram');
  console.log(`\n📊 Всего найдено объявлений: ${results.length}`);
  return results;
}

export async function searchSocialClubAccounts(config, rules) {
  const queries = [
    'grand (БЕЗ ДОСТУПА К SOCIAL CLUB)',
    'rdr (БЕЗ ДОСТУПА К SOCIAL CLUB)',
    'gta (БЕЗ ДОСТУПА К SOCIAL CLUB)'
  ];
  const categories = ['1', '12'];
  const sectionNames = { '1': 'Steam', '12': 'Epic Games' };

  console.log('🔍 Режим поиска Social Club в Steam и Epic Games');
  console.log(`Категории: Steam (1), Epic Games (12)`);
  console.log(`Поисковые фразы: ${queries.length}`);
  console.log(`Сортировка: ${getOrderByName(config.order_by)}`);
  console.log(`Максимум страниц: ${config.maxPages || DEFAULT_MAX_PAGES}`);
  console.log(`Результатов на страницу: ${config.resultsPerPage || 'по умолчанию API'}`);
  console.log(`Задержка между страницами: ${config.pageDelayMs ?? DEFAULT_PAGE_DELAY_MS} мс\n`);

  let allResults = [];

  for (const category of categories) {
    if (config.runtimeState?.isInterrupted) break;
    const catName = sectionNames[category] || `ID:${category}`;
    console.log(`\n📂 Поиск в категории ${catName} (${category})...`);
    const results = await collectPhraseSearches({ ...config, category, maxPages: config.maxPages }, rules, queries, `Поиск Social Club в ${catName}`);
    allResults = mergeResults(allResults, results.map(item => ({ ...item, category: catName })));
  }

  console.log(`\n📊 Всего найдено объявлений: ${allResults.length}`);
  return allResults;
}

export async function checkAllCategories(config, rules, ask) {
  const checkStartTime = Date.now();
  console.log('🔍 Режим проверки всех разделов (категорий)');
  const cats = config.categories || {};
  const catNames = config.checkCategories.map(id => cats[id] || `ID:${id}`).join(', ');
  console.log(`Категории: ${catNames}`);
  console.log(`Сортировка: ${getOrderByName(config.order_by)}`);
  console.log(`Максимум страниц на категорию: ${config.maxPages || DEFAULT_MAX_PAGES}`);
  console.log(`Результатов на страницу: ${config.resultsPerPage || DEFAULT_RESULTS_PER_PAGE}`);
  console.log(`Задержка между страницами: ${config.pageDelayMs ?? DEFAULT_PAGE_DELAY_MS} мс`);
  console.log(`Задержка между категориями: ${config.categoryDelayMs ?? DEFAULT_CATEGORY_DELAY_MS} мс\n`);

  let totalResults = [];
  let totalChecked = 0;

  for (const category of config.checkCategories) {
    if (config.runtimeState?.isInterrupted) break;
    const catName = cats[category] || `ID:${category}`;
    console.log(`\n📂 Проверка категории ${catName} (${category})...`);

    try {
      const result = await autoCheckAllListings({ ...config, category, verbose: false }, rules);
      const violations = Array.isArray(result) ? result : result.violations || [];
      const totalCheckedInCategory = Array.isArray(result) ? violations.length : result.totalChecked || violations.length;
      const resultsWithCategory = violations.map(item => ({ ...item, category: catName }));
      console.log(`   ✅ Проверено: ${totalCheckedInCategory}, нарушений: ${violations.length}`);
      totalResults = mergeResults(totalResults, resultsWithCategory);
      totalChecked += totalCheckedInCategory;
    } catch (error) {
      console.error(`   ❌ Ошибка: ${error.message}`);
    }

    if (config.checkCategories.indexOf(category) < config.checkCategories.length - 1 && !config.runtimeState?.isInterrupted) {
      const categoryDelayMs = Number(config.categoryDelayMs) >= 0 ? Number(config.categoryDelayMs) : 2000;
      await new Promise(resolve => setTimeout(resolve, categoryDelayMs));
    }
  }

  await displayViolationsOnly(totalResults, config.resultsPerPage || 1000, ask, { mode: 'check-categories' });

  const endTime = Date.now();
  const duration = (endTime - checkStartTime) / 1000;
  return { results: totalResults, totalChecked, duration };
}

export async function autoCheckAllListings(config, rules) {
  if (config.verbose !== false) {
    console.log('🔍 Режим автоматической проверки всех объявлений');
    console.log(`Категория: ${config.category || 'все'}`);
    console.log(`Сортировка: ${getOrderByName(config.order_by)}`);
    console.log(`Дедупликация: выключена`);
    console.log(`Максимум страниц: ${config.maxPages || 1}`);
    console.log(`Результатов на страницу: ${config.resultsPerPage || 'по умолчанию API'}`);
    console.log(`Задержка между страницами: ${config.pageDelayMs ?? 1000} мс\n`);
  }

  const results = await collectPages({ ...config, keywords: '' }, rules, 'Проверка');
  const filteredResults = results.filter(item => item.violations.length > 0);
  if (config.verbose !== false) {
    console.log(`\n📊 Всего проверено объявлений: ${results.length}, с нарушениями: ${filteredResults.length}`);
  }
  return {
    violations: filteredResults,
    totalChecked: results.length
  };
}
