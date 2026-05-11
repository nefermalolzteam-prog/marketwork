import { logInfo } from './logger.js';

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

export function highlightViolations(text, violations) {
  if (!Array.isArray(violations) || violations.length === 0) return text;
  let highlighted = text;
  for (const violation of violations) {
    const regex = new RegExp(`(${escapeRegExp(violation.keyword)})`, 'gi');
    highlighted = highlighted.replace(regex, '\x1b[41m\x1b[37m$1\x1b[0m');
  }
  return highlighted;
}

export function highlightKeywords(text, keywords) {
  if (!Array.isArray(keywords) || keywords.length === 0) return text;
  let highlighted = text;
  for (const keyword of keywords.filter(Boolean)) {
    const regex = new RegExp(`(${escapeRegExp(keyword)})`, 'gi');
    highlighted = highlighted.replace(regex, '\x1b[1m$1\x1b[0m');
  }
  return highlighted;
}

export function highlightTitle(text, violations, keywords) {
  let highlighted = highlightViolations(text, violations);
  highlighted = highlightKeywords(highlighted, keywords);
  return highlighted;
}

export function highlightOrigin(text, isChecked = false) {
  if (isChecked) {
    return `\x1b[42m\x1b[37m${text}\x1b[0m`;
  }
  return `\x1b[41m\x1b[37m${text}\x1b[0m`;
}

export async function displayResults(results, maxDisplay = 1000, ask, options = {}) {
  const mode = options.mode || 'search';
  logInfo(`Результаты поиска: найдено ${results.length} объявлений, режим=${mode}`);

  console.log(`\n${'='.repeat(80)}`);
  console.log(`📅 [${new Date().toLocaleString()}] Результаты поиска`);
  console.log(`📊 Найдено объявлений: ${results.length}`);
  console.log(`📄 На странице показано: ${maxDisplay}`);
  console.log(`${'='.repeat(80)}`);

  if (results.length === 0) {
    console.log('❌ Результаты отсутствуют.\n');
    return;
  }

  const pageSize = maxDisplay;
  let pageIndex = 0;
  const pageCount = Math.max(1, Math.ceil(results.length / pageSize));
  let pageActive = true;

  while (pageActive) {
    const start = pageIndex * pageSize;
    const pageItems = results.slice(start, start + pageSize);

    pageItems.forEach((item, index) => {
      console.log(`\n📋 Объявление #${start + index + 1}`);
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
        console.log(`   ⚠️  НАРУШЕНИЯ НАЙДЕНЫ:`);
        item.violations.forEach(v => {
          console.log(`      ${v.name} (${v.keyword})`);
        });
      }
      console.log(`${'-'.repeat(80)}`);
    });

    if (pageCount > 1) {
      console.log(`\n⚠️  Показано ${pageItems.length} из ${results.length} объявлений (страница ${pageIndex + 1}/${pageCount}).`);
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
      console.log(`\n⚠️  Показано ${pageItems.length} из ${results.length} объявлений на странице.`);
      if (!ask) {
        console.log('   ▶ Введите next для следующей страницы, prev для предыдущей страницы.');
      }
    }
    pageActive = false;
  }

  console.log();
}

export async function displayViolationsOnly(results, maxDisplay = 1000, ask, options = {}) {
  const problematic = results.filter(item => item.violations.length > 0);
  const mode = options.mode || 'search';
  logInfo(`Нарушения: найдено ${problematic.length} объявлений с нарушениями, режим=${mode}`);

  console.log(`\n${'='.repeat(80)}`);
  console.log(`📅 [${new Date().toLocaleString()}] Нарушения`);
  console.log(`📊 Найдено объявлений с нарушениями: ${problematic.length}`);
  console.log(`📄 На странице показано: ${maxDisplay}`);
  console.log(`${'='.repeat(80)}`);

  if (problematic.length === 0) {
    console.log('✅ Нарушений не найдено.\n');
    return;
  }

  const pageSize = maxDisplay;
  let pageIndex = 0;
  const pageCount = Math.max(1, Math.ceil(problematic.length / pageSize));
  let pageActive = true;

  while (pageActive) {
    const start = pageIndex * pageSize;
    const pageItems = problematic.slice(start, start + pageSize);

    pageItems.forEach((item, index) => {
      console.log(`\n📋 Объявление #${start + index + 1}`);
      console.log(`   ID: ${item.id}`);
      if (item.category) {
        console.log(`   Раздел: ${item.category}`);
      }
      console.log(`   Название: ${highlightTitle(item.title, item.violations, item.matchedKeywords)}`);
      console.log(`   Продавец: ${item.sellerLogin}`);
      console.log(`   Ссылка: ${item.url}`);
      console.log('   ⚠️  Нарушения:');
      item.violations.forEach(v => {
        console.log(`      ${v.name}`);
      });
      console.log(`${'-'.repeat(80)}`);
    });

    if (pageCount > 1) {
      console.log(`\n⚠️  Показано ${pageItems.length} из ${problematic.length} объявлений (страница ${pageIndex + 1}/${pageCount}).`);
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
      console.log(`\n⚠️  Показано ${pageItems.length} из ${problematic.length} объявлений на странице.`);
      if (!ask) {
        console.log('   ▶ Введите next для следующей страницы, prev для предыдущей страницы.');
      }
    }
    pageActive = false;
  }

  console.log();
}
