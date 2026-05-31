import assert from 'assert';
import { normalizeText, checkViolations, getItemId, validateConfig, hasExplicitAgeOrDateNearKeyword } from '../bot.js';
import { uniqItemsById, hasExplicitAccountAgeOrRegistration, hasAutoregEmailMention } from '../search.js';
import { buildSearchUrl } from '../api.js';
import { DEFAULT_MAX_PAGES, DEFAULT_RESULTS_PER_PAGE } from '../constants.js';

const sampleRules = {
  violations: {
    test_violation: {
      name: 'Test violation',
      keywords: ['foo', 'bar']
    }
  }
};

function run() {
  assert.strictEqual(normalizeText(' TeSt '), 'test');
  assert.strictEqual(normalizeText('123ABC'), '123abc');

  const violations = checkViolations('Foo bar', sampleRules);
  assert.strictEqual(violations.length, 2);
  assert.strictEqual(violations[0].category, 'test_violation');
  assert.strictEqual(violations[0].keyword, 'foo');

  assert.strictEqual(getItemId({ item_id: '10' }), '10');
  assert.strictEqual(getItemId({ id: '20' }), '20');
  assert.strictEqual(getItemId({ uid: '30' }), '30');

  assert.deepStrictEqual(uniqItemsById([
    { item_id: '1', title: 'a' },
    { item_id: '2', title: 'b' },
    { item_id: '1', title: 'a' }
  ]), [
    { item_id: '1', title: 'a' },
    { item_id: '2', title: 'b' }
  ]);

  validateConfig({
    token: 'abc',
    apiBaseUrl: 'https://prod-api.lzt.market',
    order_by: 'pdate_to_down',
    resultsPerPage: 100,
    maxPages: 5,
    pageDelayMs: 100,
    categoryDelayMs: 200,
    checkCategories: ['1', '24'],
    maxRetries: 3,
    retryDelayMs: 500,
    includeOrigins: [],
    excludeOrigins: [],
    deduplicateResults: true
  });

  let errorThrown = false;
  try {
    validateConfig({
      token: '',
      apiBaseUrl: 'https://prod-api.lzt.market',
      order_by: 'pdate_to_down',
      resultsPerPage: 100,
      maxPages: 1,
      pageDelayMs: 100,
      categoryDelayMs: 100,
      checkCategories: ['1']
    });
  } catch (error) {
    errorThrown = true;
  }
  assert.strictEqual(errorThrown, true, 'validateConfig должен выбросить ошибку для пустого token');

  // Тесты для hasExplicitAgeOrDateNearKeyword
  assert.strictEqual(hasExplicitAgeOrDateNearKeyword('отлега 14 дней', 'отлега'), true, 'Должен найти "14 дней"');
  assert.strictEqual(hasExplicitAgeOrDateNearKeyword('7+ дней отлежка', 'отлежка'), true, 'Должен найти "7+ дней"');
  assert.strictEqual(hasExplicitAgeOrDateNearKeyword('отлега 3 месяца', 'отлега'), true, 'Должен найти "3 месяца"');
  assert.strictEqual(hasExplicitAgeOrDateNearKeyword('есть отлежка', 'отлежка'), false, 'Не должен найти дату в "есть отлежка"');
  assert.strictEqual(hasExplicitAgeOrDateNearKeyword('отлега 2 года', 'отлега'), true, 'Должен найти "2 года"');
  assert.strictEqual(hasExplicitAgeOrDateNearKeyword('отлега месяц', 'отлега'), true, 'Должен найти "месяц" без цифр');
  assert.strictEqual(hasExplicitAgeOrDateNearKeyword('отлега больше года', 'отлега'), true, 'Должен найти "больше года"');
  assert.strictEqual(hasExplicitAgeOrDateNearKeyword('отлега с марта', 'отлега'), true, 'Должен найти "с марта"');
  assert.strictEqual(hasExplicitAgeOrDateNearKeyword('inactive 1 month', 'inactive'), true, 'Должен найти "1 month"');

  const searchUrl = buildSearchUrl({
    apiBaseUrl: 'https://prod-api.lzt.market',
    category: '24',
    keywords: ['отлега'],
    resultsPerPage: 50,
    order_by: 'price_to_up'
  }, 1, true);
  assert.ok(searchUrl.startsWith('https://prod-api.lzt.market/telegram?'), 'URL должен содержать путь категории Telegram');
  assert.ok(searchUrl.includes('title=%D0%BE%D1%82%D0%BB%D0%B5%D0%B3%D0%B0'), 'URL должен содержать keyword title');
  assert.ok(searchUrl.includes('resultsPerPage=50') || searchUrl.includes('perPage=50'), 'URL должен содержать параметр страницы');

  const configWithDefaults = { token: 'abc', apiBaseUrl: 'https://prod-api.lzt.market', order_by: 'pdate_to_down' };
  validateConfig(configWithDefaults);
  assert.strictEqual(configWithDefaults.maxPages, DEFAULT_MAX_PAGES, 'maxPages должен устанавливать значение по умолчанию');
  assert.strictEqual(configWithDefaults.resultsPerPage, DEFAULT_RESULTS_PER_PAGE, 'resultsPerPage должен устанавливать значение по умолчанию');
  assert.strictEqual(configWithDefaults.pageDelayMs, 1000, 'pageDelayMs должен устанавливать значение по умолчанию');
  assert.strictEqual(configWithDefaults.categoryDelayMs, 2000, 'categoryDelayMs должен устанавливать значение по умолчанию');
  assert.strictEqual(configWithDefaults.maxRetries, 3, 'maxRetries должен устанавливать значение по умолчанию');
  assert.strictEqual(configWithDefaults.retryDelayMs, 500, 'retryDelayMs должен устанавливать значение по умолчанию');

  assert.strictEqual(hasExplicitAccountAgeOrRegistration('Аккаунту 6 лет 9 месяцев'), true, 'Должен найти явный возраст аккаунта');
  assert.strictEqual(hasExplicitAccountAgeOrRegistration('Зарегистрирован 07.2019'), true, 'Должен найти дату регистрации');
  assert.strictEqual(hasExplicitAccountAgeOrRegistration('отлега 12 лет'), false, 'Не должен считать отлегу за явный возраст аккаунта');
  assert.strictEqual(hasAutoregEmailMention('Доступ к почте (авторег)'), true, 'Должен найти доступ к почте авторег');
  assert.strictEqual(hasAutoregEmailMention('Почта авторег'), true, 'Должен найти почта авторег');
  assert.strictEqual(hasAutoregEmailMention('Авторег почта'), true, 'Должен найти авторег почта');
  assert.strictEqual(hasAutoregEmailMention('Только личный трафик'), false, 'Не должен считать личный трафик за авторег почту');
  assert.strictEqual(/личный\s*траф(?:ик)?/.test(normalizeText('Тг акки личный траф')), true, 'Шаблон должен матчить личный траф');
  assert.strictEqual(hasExplicitAgeOrDateNearKeyword('inactive 1 year', 'inactive'), true, 'Должен найти "1 year"');
  assert.strictEqual(hasExplicitAgeOrDateNearKeyword('inactive 1,5 years', 'inactive'), true, 'Должен найти "1,5 years"');
  assert.strictEqual(hasExplicitAgeOrDateNearKeyword('отлега от 30д', 'отлега'), true, 'Должен найти сокращение "30д"');
  assert.strictEqual(hasExplicitAgeOrDateNearKeyword('отлега 90d+', 'отлега'), true, 'Должен найти сокращение "90d+"');
  assert.strictEqual(hasExplicitAgeOrDateNearKeyword('отлега от 7d', 'отлега'), true, 'Должен найти сокращение "7d"');
  assert.strictEqual(hasExplicitAgeOrDateNearKeyword('отлега от 120d', 'отлега'), true, 'Должен найти "120d"');
  assert.strictEqual(hasExplicitAgeOrDateNearKeyword('отлега 2m', 'отлега'), true, 'Должен найти сокращение "2m" (месяцы)');
  assert.strictEqual(hasExplicitAgeOrDateNearKeyword('отлега 3y', 'отлега'), true, 'Должен найти сокращение "3y" (года)');
  assert.strictEqual(hasExplicitAgeOrDateNearKeyword('inactive за 10d', 'inactive'), true, 'Должен найти "за 10d"');
  assert.strictEqual(hasExplicitAgeOrDateNearKeyword('последняя активность в 2023', 'последняя активность'), true, 'Должен найти год "2023" после слова "в"');
  assert.strictEqual(hasExplicitAgeOrDateNearKeyword('5 мар 2012 Последняя активность', 'последняя активность'), true, 'Должен найти дату в сокращенном формате "5 мар 2012"');
  assert.strictEqual(hasExplicitAgeOrDateNearKeyword('9 марта 2026 г. Последняя активность', 'последняя активность'), true, 'Должен найти дату в формате "9 марта 2026 г."');
  assert.strictEqual(hasExplicitAgeOrDateNearKeyword('26 мая 2024 / Отлега', 'отлега'), true, 'Должен найти дату в формате "26 мая 2024"');
  assert.strictEqual(hasExplicitAgeOrDateNearKeyword('2025 | Пробный режим Reels | 2FA|  Отлега 120 дней| 500 sab |  OLD', 'отлега'), true, 'Должен найти "120 дней" с разделителем "|"');
  assert.strictEqual(hasExplicitAgeOrDateNearKeyword('+1 США [авторег] | Любой вход | Не использован | Отлёжка месяц (30+ дней)', 'отлёжка'), true, 'Должен найти "30+ дней" внутри скобок');

  const exclusionRules = {
    violations: {
      overhype: {
        name: 'Overhype',
        keywords: ['жир']
      }
    }
  };

  const exclusions = checkViolations('Пожиратель жира', exclusionRules);
  assert.strictEqual(exclusions.length, 0, 'Не должен срабатывать жир для слова "пожиратель"');

  console.log('Все тесты пройдены.');
}

run();
