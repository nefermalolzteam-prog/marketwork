import { logInfo, logError } from './logger.js';

const ACCOUNT_ORIGINS = {
  personal: 'Личный',
  brute: 'Брут',
  phishing: 'Фишинг',
  stealer: 'Стилер',
  resale: 'Перепродажа',
  autoreg: 'Авторег',
  dummy: 'Пустышка',
  self_registration: 'Саморег',
  retrieve_via_support: 'Восстановление через поддержку'
};

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  white: '\x1b[37m',
  redBackground: '\x1b[41m',
  greenBackground: '\x1b[42m'
};

const ROW_SEPARATOR = '-'.repeat(80);
const PAGE_LINE = '='.repeat(80);
const NEXT_COMMANDS = new Set(['next', 'n', 'далее', 'вперед']);
const PREV_COMMANDS = new Set(['prev', 'p', 'назад']);
const EXIT_COMMANDS = new Set(['exit', 'quit', 'q', 'выход', 'exit']);

function getOriginName(originCode, subOriginCode = null) {
  if (!originCode) return 'неизвестно';
  const code = String(originCode).toLowerCase();
  let name = ACCOUNT_ORIGINS[code] || originCode;
  if (code === 'resale' && subOriginCode) {
    const subName = ACCOUNT_ORIGINS[String(subOriginCode).toLowerCase()] || subOriginCode;
    name = `${name} (${subName})`;
  }
  return name;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function applyHighlight(text, terms, style) {
  if (!Array.isArray(terms) || terms.length === 0) return String(text);
  return terms.filter(Boolean).reduce((result, term) => {
    const regex = new RegExp(`(${escapeRegExp(term)})`, 'gi');
    return result.replace(regex, `${style}$1${ANSI.reset}`);
  }, String(text));
}

export function highlightViolations(text, violations) {
  if (!Array.isArray(violations) || violations.length === 0) return String(text);
  const terms = violations
    .filter((violation) => violation && violation.keyword)
    .map((violation) => violation.keyword);
  return applyHighlight(text, terms, `${ANSI.redBackground}${ANSI.white}`);
}

export function highlightKeywords(text, keywords) {
  return applyHighlight(text, keywords, ANSI.bold);
}

export function highlightTitle(text, violations, keywords) {
  return highlightKeywords(highlightViolations(text, violations), keywords);
}

export function highlightOrigin(text, isChecked = false) {
  const color = isChecked ? '\x1b[42m\x1b[37m' : '\x1b[41m\x1b[37m';
  return `${color}${text}\x1b[0m`;
}

function formatPagingFooter(displayedCount, totalCount, pageIndex, pageCount, interactive) {
  if (!interactive) {
    return `\n⚠️  Показано ${displayedCount} из ${totalCount} объявлений на странице.`;
  }
  return `\n⚠️  Показано ${displayedCount} из ${totalCount} объявлений (страница ${pageIndex + 1}/${pageCount}).`;
}

async function renderPagedItems(items, pageSize, ask, renderItem) {
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  let pageIndex = 0;
  const interactive = Boolean(ask);
  let pageActive = true;

  while (pageActive) {
    const start = pageIndex * pageSize;
    const pageItems = items.slice(start, start + pageSize);
    pageItems.forEach((item, index) => renderItem(item, start + index + 1));

    if (pageCount === 1) {
      if (!interactive && items.length > pageSize) {
        console.log(formatPagingFooter(pageItems.length, items.length, pageIndex, pageCount, false));
      }
      return;
    }

    console.log(formatPagingFooter(pageItems.length, items.length, pageIndex, pageCount, interactive));
    if (!interactive) {
      console.log('   ▶ Результаты выведены по первой странице. Для постраничного просмотра передайте функцию ask.');
      return;
    }

    const command = String(await ask('Введите команду (next/prev/exit): ')).trim().toLowerCase();
    if (!command || EXIT_COMMANDS.has(command)) {
      pageActive = false;
      continue;
    }

    if (NEXT_COMMANDS.has(command)) {
      if (pageIndex < pageCount - 1) {
        pageIndex += 1;
      } else {
        console.log('Это последняя страница результатов.');
      }
      continue;
    }

    if (PREV_COMMANDS.has(command)) {
      if (pageIndex > 0) {
        pageIndex -= 1;
      } else {
        console.log('Это первая страница результатов.');
      }
      continue;
    }

    console.log('Неизвестная команда. Введите next, prev или exit.');
  }
}

function printResultItem(item, index) {
  console.log(`\n📋 Объявление #${index}`);
  if (item.category) {
    console.log(`   Раздел: ${item.category}`);
  }
  if (item.checkedOrigin) {
    const currentOrigin = item.origin ? getOriginName(item.origin, item.subOrigin) : 'неизвестно';
    console.log(`   Проверка происхождения: ${highlightOrigin(item.checkedOrigin, true)} (сейчас: ${highlightOrigin(currentOrigin, false)})`);
  } else if (item.origin) {
    console.log(`   Происхождение: ${highlightOrigin(getOriginName(item.origin, item.subOrigin))}`);
  }
  console.log(`   Название: ${highlightTitle(item.title, item.violations, item.matchedKeywords)}`);
  console.log(`   Продавец: ${item.sellerLogin}`);
  console.log(`   Ссылка: ${item.url}`);
  if (item.violations?.length > 0) {
    console.log('   ⚠️  НАРУШЕНИЯ НАЙДЕНЫ:');
    item.violations.forEach((v) => {
      console.log(`      ${v.name}: "${v.keyword}" ${v.location}`);
    });
  }
  console.log(ROW_SEPARATOR);
}

function printViolationItem(item, index) {
  console.log(`\n📋 Объявление #${index}`);
  console.log(`   ID: ${item.id}`);
  if (item.category) {
    console.log(`   Раздел: ${item.category}`);
  }
  console.log(`   Название: ${highlightTitle(item.title, item.violations, item.matchedKeywords)}`);
  console.log(`   Продавец: ${item.sellerLogin}`);
  console.log(`   Ссылка: ${item.url}`);
  console.log('   ⚠️  Нарушения:');
  item.violations.forEach((v) => {
    console.log(`      ${v.name}: "${v.keyword}" ${v.location}`);
  });
  console.log(ROW_SEPARATOR);
}

function printHeader(title, totalCount, maxDisplay) {
  console.log(`\n${PAGE_LINE}`);
  console.log(`📅 [${new Date().toLocaleString()}] ${title}`);
  console.log(`📊 Найдено объявлений: ${totalCount}`);
  console.log(`📄 На странице показано: ${maxDisplay}`);
  console.log(PAGE_LINE);
}

async function displayItems(title, items, maxDisplay = 1000, ask, renderItem, logMessage, emptyMessage, mode = 'search') {
  const safeItems = Array.isArray(items) ? items : [];
  logInfo(`${logMessage}: найдено ${safeItems.length} объявлений, режим=${mode}`);

  printHeader(title, safeItems.length, maxDisplay);

  if (safeItems.length === 0) {
    console.log(`${emptyMessage}\n`);
    return;
  }

  try {
    await renderPagedItems(safeItems, maxDisplay, ask, renderItem);
  } catch (err) {
    logError(`displayItems render failed: ${err && err.message ? err.message : err}`);
    console.error('Ошибка при отображении результатов:', err && err.message ? err.message : err);
  }
  console.log();
}

export async function displayResults(results, maxDisplay = 1000, ask, options = {}) {
  const mode = options.mode || 'search';
  await displayItems('Результаты поиска', results, maxDisplay, ask, printResultItem, 'Результаты поиска', '❌ Результаты отсутствуют.', mode);
}

export async function displayViolationsOnly(results, maxDisplay = 1000, ask, options = {}) {
  const problematic = Array.isArray(results) ? results.filter(item => Array.isArray(item.violations) && item.violations.length > 0) : [];
  const mode = options.mode || 'search';
  await displayItems('Нарушения', problematic, maxDisplay, ask, printViolationItem, 'Нарушения', '✅ Нарушений не найдено.', mode);
}

