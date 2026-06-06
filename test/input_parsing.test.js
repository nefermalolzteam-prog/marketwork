import assert from 'assert';
import { chooseCategories } from '../input.js';
import { TELEGRAM_CATEGORY_ID } from '../constants.js';

async function run() {
  const cats = { '1': 'Steam', '12': 'Epic Games', '24': 'Telegram', '2': 'Other' };

  // Случай: telegram-years должен вернуть TELEGRAM_CATEGORY_ID
  let res = await chooseCategories('telegram-years', cats, async () => '', { category: '' });
  assert.deepStrictEqual(res, [TELEGRAM_CATEGORY_ID], 'telegram-years должен вернуть TELEGRAM_CATEGORY_ID');

  // Случай: socialclub-search возвращает фиксированную пару
  res = await chooseCategories('socialclub-search', cats, async () => '', { category: '' });
  assert.deepStrictEqual(res, ['1', '12'], 'socialclub-search должен вернуть [1,12]');

  // Случай: check-origins возвращает все ключи
  res = await chooseCategories('check-origins', cats, async () => '', { category: '' });
  assert.deepStrictEqual(res.sort(), Object.keys(cats).sort(), 'check-origins должен вернуть все категории');

  // Случай: check-categories с custom
  const answers1 = ['all'];
  const ask1 = async () => answers1.shift();
  res = await chooseCategories('check-categories', cats, ask1, { category: '' });
  assert.deepStrictEqual(res.sort(), Object.keys(cats).sort(), 'check-categories all должен вернуть все категории');

  // Случай: check-categories с custom вводом
  const answers2 = ['custom', '1,2'];
  const ask2 = async () => answers2.shift();
  res = await chooseCategories('check-categories', cats, ask2, { category: '' });
  assert.deepStrictEqual(res, ['1', '2']);

  // По умолчанию: пустой ввод -> возвращает config.category
  const ask3 = async () => '';
  res = await chooseCategories('default-mode', cats, ask3, { category: '2' });
  assert.deepStrictEqual(res, ['2']);

  console.log('Тесты input_parsing пройдены');
}

run();
