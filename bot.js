import readline from 'readline';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { exportToExcel } from './export.js';
import { initDatabase, closeDatabase, saveCheckResults, getStatistics, purgeOldRecords } from './database.js';
import { initTelegramBot, sendViolationReport } from './telegram.js';
import { startWebServer } from './web.js';
import { initI18n, t, setMissingKeyLogger } from './i18n.js';
import { initializeLogging, logError } from './logger.js';
import {
  normalizeText,
  checkViolations,
  getItemId,
  hasExplicitAgeOrDateNearKeyword,
  isAsciiString,
  searchOnce,
  getOrderByName
} from './search.js';
import { chooseCategories } from './input.js';
import { chooseOrderBy } from './input_helpers.js';
import {
  displayResults,
  displayViolationsOnly
} from './display.js';
import {
  searchByKeywords,
  searchFakePersonal,
  checkAllOrigins,
  searchTelegramOtlegYears,
  searchSocialClubAccounts,
  checkAllCategories,
  autoCheckAllListings,
  askOriginFilters
} from './modes.js';
import { DEFAULT_CONFIG, ALLOWED_ORDER_BY, MAX_CONCURRENT_REQUESTS_LIMIT, DEFAULT_RESULTS_PER_PAGE, DEFAULT_MAX_PAGES, DEFAULT_PAGE_DELAY_MS, DEFAULT_CATEGORY_DELAY_MS } from './constants.js';

const configPath = path.resolve('config.json');
const rulesPath = path.resolve('rules.json');

let currentResults = [];
let currentMode = '';
let startTime = null;

function sortByViolationsFirst(items) {
  return Array.isArray(items)
    ? [...items].sort((a, b) => (b.violations?.length || 0) - (a.violations?.length || 0))
    : items;
}

const SCRIPT_PATH = fileURLToPath(import.meta.url);

function loadProjectVersion() {
  try {
    const packageContent = fs.readFileSync(path.resolve('package.json'), 'utf8');
    const packageData = JSON.parse(packageContent);
    return packageData.version || 'unknown';
  } catch {
    return 'unknown';
  }
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
  const allowedOrders = ALLOWED_ORDER_BY;

  if (!config.token || typeof config.token !== 'string' || !config.token.trim()) {
    throw new Error('Ошибка: token не задан в config.json. Заполните поле token.');
  }

  if (!isAsciiString(config.token)) {
    throw new Error('Ошибка: token содержит недопустимые символы. Убедитесь, что в config.json используется корректный токен без кириллицы и пробелов.');
  }

  if (!config.apiBaseUrl || typeof config.apiBaseUrl !== 'string') {
    throw new Error('Ошибка: apiBaseUrl должен быть указан в config.json.');
  }

  if (config.order_by === undefined) {
    config.order_by = 'pdate_to_down';
  }
  if (!allowedOrders.has(config.order_by)) {
    throw new Error(`Ошибка: order_by должен быть одним из ${[...allowedOrders].join(', ')}.`);
  }

  if (config.resultsPerPage === undefined) {
    config.resultsPerPage = DEFAULT_RESULTS_PER_PAGE;
  }
  if (!Number.isInteger(config.resultsPerPage) || config.resultsPerPage <= 0 || config.resultsPerPage > 1000) {
    throw new Error('Ошибка: resultsPerPage должен быть числом от 1 до 1000.');
  }

  if (config.maxPages === undefined) {
    config.maxPages = DEFAULT_MAX_PAGES;
  }
  if (!Number.isInteger(config.maxPages) || config.maxPages <= 0) {
    throw new Error('Ошибка: maxPages должен быть положительным целым числом.');
  }

  if (config.pageDelayMs === undefined) {
    config.pageDelayMs = DEFAULT_PAGE_DELAY_MS;
  }
  if (!Number.isInteger(config.pageDelayMs) || config.pageDelayMs < 0) {
    throw new Error('Ошибка: pageDelayMs должен быть положительным целым числом или 0.');
  }

  if (config.categoryDelayMs === undefined) {
    config.categoryDelayMs = DEFAULT_CATEGORY_DELAY_MS;
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

  if (config.parallelProcessing !== undefined && typeof config.parallelProcessing !== 'boolean') {
    throw new Error('Ошибка: parallelProcessing должен быть boolean (true/false).');
  }

  if (config.parallelProcessing === undefined) {
    config.parallelProcessing = DEFAULT_CONFIG.parallelProcessing;
  }

  if (config.deduplicateResults !== undefined && typeof config.deduplicateResults !== 'boolean') {
    throw new Error('Ошибка: deduplicateResults должен быть boolean (true/false).');
  }

  if (config.deduplicateResults === undefined) {
    config.deduplicateResults = false;
  }

  if (config.maxConcurrentRequests !== undefined) {
    if (!Number.isInteger(config.maxConcurrentRequests) || config.maxConcurrentRequests <= 0 || config.maxConcurrentRequests > MAX_CONCURRENT_REQUESTS_LIMIT) {
      throw new Error(`Ошибка: maxConcurrentRequests должен быть числом от 1 до ${MAX_CONCURRENT_REQUESTS_LIMIT}.`);
    }
  } else {
    config.maxConcurrentRequests = DEFAULT_CONFIG.maxConcurrentRequests;
  }

  if (config.maxRetries === undefined) {
    config.maxRetries = 3;
  }
  if (!Number.isInteger(config.maxRetries) || config.maxRetries < 0) {
    throw new Error('Ошибка: maxRetries должен быть неотрицательным целым числом.');
  }

  if (config.retryDelayMs === undefined) {
    config.retryDelayMs = 500;
  }
  if (!Number.isInteger(config.retryDelayMs) || config.retryDelayMs < 0) {
    throw new Error('Ошибка: retryDelayMs должен быть положительным целым числом или 0.');
  }
}

function loadRules() {
  if (!fs.existsSync(rulesPath)) {
    console.warn('⚠️  Файл rules.json не найден. Проверка нарушений отключена.');
    return { violations: {} };
  }
  const raw = fs.readFileSync(rulesPath, 'utf8');
  try {
    const data = JSON.parse(raw);
    if (data.violations) {
      for (const violation of Object.values(data.violations)) {
        violation.keywords = [...new Set((violation.keywords || []).map((keyword) => String(keyword).trim().toLowerCase()).filter(Boolean))];
      }
    }
    return data;
  } catch (error) {
    console.error('Неверный JSON в rules.json:', error.message);
    return { violations: {} };
  }
}

function setupGracefulShutdown(runtimeState) {
  process.on('SIGINT', () => {
    runtimeState.isInterrupted = true;
    console.log('\n\n⚠️  Получен сигнал прерывания (Ctrl+C)...');
    console.log('📊 Выведу результаты, которые уже найдены...\n');

    const interruptedResults = runtimeState.partialResults || [];
    const resultsToShow = currentResults.length > 0 ? currentResults : interruptedResults;
    if (resultsToShow.length > 0) {
      if (['telegram-years', 'fake-personal', 'check-origins', 'socialclub-search'].includes(currentMode)) {
        displayResults(resultsToShow, 1000, null, { mode: currentMode });
      } else {
        displayViolationsOnly(resultsToShow, 1000, null, { mode: currentMode });
      }
      const totalViolations = resultsToShow.reduce((sum, item) => sum + (Array.isArray(item.violations) ? item.violations.length : 0), 0);
      const endTime = Date.now();
      const duration = (endTime - startTime) / 1000;
      console.log(`\n${'='.repeat(80)}`);
      console.log(`📊 Результаты до прерывания: ${resultsToShow.length} объявлений, ${totalViolations} нарушений`);
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
  const runtimeState = { isInterrupted: false, partialResults: [] };
  config.runtimeState = runtimeState;
  setupGracefulShutdown(runtimeState);

  const db = initDatabase(config);
  if (config.dbRetentionDays && Number(config.dbRetentionDays) > 0) {
    try {
      await purgeOldRecords(db, Number(config.dbRetentionDays));
    } catch (err) {
      console.error('Ошибка при очистке старых записей БД:', err && err.message ? err.message : err);
    }
  }

  try {
    await initI18n(config.language || 'ru');
    // register i18n missing-key logger to route to application error logs
    try {
      setMissingKeyLogger(logError);
    } catch (_) {
      // ignore if logger is not available
    }
    const telegramBot = initTelegramBot(config.telegramToken);
    let webServer = null;

    const version = loadProjectVersion();
    console.log(`LZT Market Bot v${version}`);
    console.log(t('welcome'));
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

    const modeMap = {
      '1': 'search', '2': 'auto-check', '3': 'check-categories', '4': 'check-origins',
      '5': 'fake-personal', '6': 'telegram-years', '7': 'socialclub-search'
    };
    const modeMetadata = {
      'search': { label: 'поиск по словам', fixed: false, needsOrigins: true },
      'auto-check': { label: 'автоматическая проверка', fixed: false, needsOrigins: true },
      'check-categories': { label: 'проверка разделов', fixed: false, needsOrigins: true },
      'check-origins': { label: 'проверка неверного происхождения', fixed: true, needsOrigins: false },
      'fake-personal': { label: 'поиск поддельных личных аккаунтов', fixed: true, needsOrigins: false },
      'telegram-years': { label: 'поиск отлеги по годам в Telegram', fixed: true, needsOrigins: false },
      'socialclub-search': { label: 'поиск Social Club в Steam и Epic Games', fixed: true, needsOrigins: false }
    };

    let continueLoop = true;
    while (continueLoop) {
      startTime = Date.now();
      console.log('Выберите режим работы:');
      console.log('1. Поиск по ключевым словам');
      console.log('2. Автоматическая проверка всех объявлений');
      console.log('3. Проверка всех разделов (категорий) по правилам');
      console.log('4. Проверка неверного происхождения (ищет названия с одним происхождением, исключая это происхождение)');
      console.log('5. Поиск "личных" аккаунтов');
      console.log('6. Поиск отлеги по годам в Telegram');
      console.log('7. Поиск Social Club в Steam и Epic');
      const modeChoice = await ask('Введите номер режима (1-7): ');
      const mode = modeMap[modeChoice];
      if (!mode) {
        console.log('❌ Неверный выбор. Выход.');
        rl.close();
        return;
      }

      // Выбор сортировки делегируется helper'у
      const orderBy = await chooseOrderBy(mode, modeMetadata, ask, config);
      if (!orderBy) {
        console.log('❌ Неверный выбор сортировки. Выход.');
        rl.close();
        return;
      }

      let keywords = [];
      if (mode === 'search') {
        const keywordsInput = await ask('Введите ключевые слова через запятую (или Enter для значений из config): ');
        if (keywordsInput.trim()) {
          keywords = keywordsInput.split(',').map(k => k.trim()).filter(k => k);
        } else {
          keywords = config.keywords || [];
        }
      }

      const cats = config.categories || {};
      const categories = (await chooseCategories(mode, cats, ask, config)) || [];

      if (mode === 'check-categories' && categories.length === 0) {
        console.log('❌ Не выбраны категории. Выход.');
        rl.close();
        return;
      }

      let includeOrigins = [];
      let excludeOrigins = [];
      if (modeMetadata[mode].needsOrigins) {
        const originFilters = await askOriginFilters(ask);
        includeOrigins = originFilters.includeOrigins;
        excludeOrigins = originFilters.excludeOrigins;
      }

      let maxPages;
      if (['fake-personal', 'telegram-years', 'socialclub-search', 'check-origins'].includes(mode)) {
        maxPages = 1;
      } else {
        const defaultMaxPages = config.maxPages || 20;
        const maxPagesInput = await ask(`Введите максимальное количество страниц (Enter для значения из config, по умолчанию ${defaultMaxPages}): `);
        maxPages = parseInt(maxPagesInput, 10) || defaultMaxPages;
      }

      let resultsPerPage;
      if (mode === 'check-origins' || ['fake-personal', 'telegram-years', 'socialclub-search'].includes(mode)) {
        resultsPerPage = 500;
      } else {
        const defaultResultsPerPage = config.resultsPerPage || 1000;
        const resultsPerPageInput = await ask(`Введите результатов на страницу (Enter для значения из config, по умолчанию ${defaultResultsPerPage}): `);
        resultsPerPage = parseInt(resultsPerPageInput, 10) || defaultResultsPerPage;
      }

      // orderBy определяется в chooseOrderBy (включая фиксированные режимы)

      const searchConfig = {
        ...config,
        mode,
        order_by: orderBy,
        keywords,
        category: ['check-categories', 'check-origins', 'fake-personal', 'telegram-years', 'socialclub-search'].includes(mode) ? '' : (categories[0] || config.category || ''),
        checkCategories: ['check-categories', 'check-origins', 'fake-personal'].includes(mode) ? categories : config.checkCategories,
        includeOrigins,
        excludeOrigins,
        maxPages,
        resultsPerPage,
        runtimeState
      };
      currentMode = mode;

      const modeDisplayName = modeMetadata[mode]?.label || 'неизвестный режим';
      console.log(`\nРежим: ${modeDisplayName}`);
      console.log(`Сортировка: ${getOrderByName(orderBy)}`);
      console.log(`Дедупликация: ${searchConfig && searchConfig.deduplicateResults ? 'включена' : (config.deduplicateResults ? 'включена' : 'выключена')}`);
      if (mode === 'search') {
        console.log(`Ключевые слова: ${keywords.join(', ')}`);
      }
      if (mode === 'check-categories') {
        const catNames = categories.map(id => cats[id] || `ID:${id}`).join(', ');
        console.log(`Категории: ${catNames}`);
      } else if (mode === 'check-origins' || mode === 'fake-personal') {
        const catNames = (config.checkCategories || Object.keys(cats)).map(id => cats[id] || `ID:${id}`).join(', ');
        console.log(`Категории: ${catNames}`);
      } else if (mode === 'telegram-years') {
        console.log('Категория: Telegram (24)');
        console.log('Поисковые слова: отлега, отлёга, отлежка, отлёжка, inactive + годы 13..2');
      } else if (mode === 'socialclub-search') {
        console.log('Категории: Steam (1), Epic Games (12)');
        console.log('Поисковые слова: grand, rdr, gta + БЕЗ ДОСТУПА К SOCIAL CLUB');
      } else {
        const catName = categories[0] ? (cats[categories[0]] || `ID:${categories[0]}`) : 'все';
        console.log(`Категория: ${catName}`);
      }
      if (includeOrigins.length > 0) {
        console.log(`Фильтр origin[]: ${includeOrigins.join(', ')}`);
      }
      if (excludeOrigins.length > 0) {
        console.log(`Фильтр not_origin[]: ${excludeOrigins.join(', ')}`);
      }
      console.log(`Максимум страниц: ${maxPages}`);
      console.log(`Результатов на страницу: ${resultsPerPage}\n`);

      const modeHandlers = {
        'check-categories': async () => {
          const result = await checkAllCategories(searchConfig, rules, ask);
          return result.results;
        },
        'fake-personal': async () => {
          return await searchFakePersonal(searchConfig, rules);
        },
        'check-origins': async () => {
          return await checkAllOrigins(searchConfig, rules);
        },
        'socialclub-search': async () => {
          return await searchSocialClubAccounts(searchConfig, rules);
        },
        'auto-check': async () => {
          const result = await autoCheckAllListings({ ...searchConfig, category: categories[0] || config.category }, rules);
          return result.items || result.violations || [];
        },
        'telegram-years': async () => {
          return await searchTelegramOtlegYears(searchConfig, rules);
        },
        'search': async () => {
          return await searchByKeywords(searchConfig, rules);
        }
      };

      try {
        const handler = modeHandlers[mode] || modeHandlers.search;
        const results = await handler();
        currentResults = results || [];

        if (mode === 'search') {
          currentResults = sortByViolationsFirst(currentResults);
          await displayResults(currentResults, searchConfig.resultsPerPage || 1000, ask, { mode });
        } else if (mode === 'check-categories') {
          // Режим проверки категорий уже выводит результаты внутри своей функции.
        } else {
          await displayViolationsOnly(currentResults, searchConfig.resultsPerPage || 1000, ask, { mode });
        }

        finalizeResults(currentResults, startTime);

        await saveCheckResults(db, mode, searchConfig.category || 'all', results);
        const stats = await getStatistics(db);
        console.log(`📈 Статистика: проверок ${stats.total_checks}, нарушений ${stats.total_violations}, среднее ${Number(stats.avg_violations_per_check || 0).toFixed(2)}`);

        if (config.enableWebServer && !webServer) {
          webServer = startWebServer(results, config.webPort || 3000);
        }

        if (telegramBot && config.telegramChatId) {
          await sendViolationReport(telegramBot, config.telegramChatId, results, mode);
        }

        if (results.length > 0) {
          const exportChoice = await ask('Экспортировать результаты? (excel/no): ');
          const exportType = exportChoice.toLowerCase();
          if (['excel', 'yes', 'y', 'да', 'д'].includes(exportType)) {
            await exportToExcel(results, `results_${Date.now()}.xlsx`);
          }
        }
      } catch (error) {
        if (error.message !== 'rate_limit' && !runtimeState.isInterrupted) {
          console.error('❌ Ошибка при выполнении:', error.message);
          logError(`Ошибка при выполнении: ${error.message}`);
        }
      }

      console.log('');
      const restartChoice = await ask('Запустить бота заново с другим режимом? (y/n или да/нет): ');
      const choice = restartChoice.toLowerCase();
      if (choice !== 'y' && choice !== 'yes' && choice !== 'да' && choice !== 'д') {
        continueLoop = false;
      }
      console.log('');
    }
  } finally {
    try {
      await closeDatabase(db);
    } catch (dbError) {
      console.error('Ошибка при закрытии БД:', dbError.message);
    }
  }
}

function finalizeResults(results, startTimeValue) {
  if (!Array.isArray(results) || results.length === 0) {
    console.log('❌ Результаты не найдены.');
    return;
  }

  const totalViolations = results.reduce((sum, item) => sum + (Array.isArray(item.violations) ? item.violations.length : 0), 0);
  const endTime = Date.now();
  const duration = (endTime - startTimeValue) / 1000;

  console.log(`\n${'='.repeat(80)}`);
  console.log(`📊 Всего найдено: ${results.length} объявлений, ${totalViolations} нарушений`);
  console.log(`⏱️  Время выполнения: ${duration.toFixed(2)} секунд`);
  console.log(`${'='.repeat(80)}`);
}

if (SCRIPT_PATH === process.argv[1]) {
  runBot().catch(err => {
    console.error('Непредвиденная ошибка:', err.message);
    logError(`Непредвиденная ошибка: ${err.message}`);
    process.exit(1);
  });
}

export {
  normalizeText,
  checkViolations,
  getItemId,
  validateConfig,
  hasExplicitAgeOrDateNearKeyword,
  searchOnce
};
