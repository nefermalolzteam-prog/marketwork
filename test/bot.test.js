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
  assert.strictEqual(hasExplicitAgeOrDateNearKeyword('отлежка 3 месяца', 'отлежка'), true, 'Должен найти "3 месяца"');
  assert.strictEqual(hasExplicitAgeOrDateNearKeyword('есть отлежка', 'отлежка'), false, 'Не должен найти дату в "есть отлежка"');
  assert.strictEqual(hasExplicitAgeOrDateNearKeyword('отлега 2 года', 'отлега'), true, 'Должен найти "2 года"');
  assert.strictEqual(hasExplicitAgeOrDateNearKeyword('inactive 1 month', 'inactive'), true, 'Должен найти "1 month"');
  assert.strictEqual(hasExplicitAgeOrDateNearKeyword('2025 | Пробный режим Reels | 2FA|  Отлега 120 дней| 500 sab |  OLD', 'отлега'), true, 'Должен найти "120 дней" с разделителем "|"');
  assert.strictEqual(hasExplicitAgeOrDateNearKeyword('+1 США [авторег] | Любой вход | Не использован | Отлёжка месяц (30+ дней)', 'отлёжка'), true, 'Должен найти "30+ дней" внутри скобок');

  console.log('Все тесты пройдены.');
}

run();
