import assert from 'assert';
import { normalizeText, checkViolations, getItemId, validateConfig, hasExplicitAgeOrDateNearKeyword } from '../bot.js';

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
    excludeOrigins: []
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

  console.log('Все тесты пройдены.');
}

run();
