import assert from 'assert';
import { chooseCategories } from '../input.js';
import { TELEGRAM_CATEGORY_ID } from '../constants.js';

async function run() {
  const cats = { '1': 'Steam', '12': 'Epic Games', '24': 'Telegram', '2': 'Other' };

  // Case: telegram-years should return TELEGRAM_CATEGORY_ID
  let res = await chooseCategories('telegram-years', cats, async () => '', { category: '' });
  assert.deepStrictEqual(res, [TELEGRAM_CATEGORY_ID], 'telegram-years должен вернуть TELEGRAM_CATEGORY_ID');

  // Case: socialclub-search returns fixed pair
  res = await chooseCategories('socialclub-search', cats, async () => '', { category: '' });
  assert.deepStrictEqual(res, ['1', '12'], 'socialclub-search должен вернуть [1,12]');

  // Case: check-origins returns all keys
  res = await chooseCategories('check-origins', cats, async () => '', { category: '' });
  assert.deepStrictEqual(res.sort(), Object.keys(cats).sort(), 'check-origins должен вернуть все категории');

  // Case: check-categories with 'all'
  const answers1 = ['all'];
  const ask1 = async () => answers1.shift();
  res = await chooseCategories('check-categories', cats, ask1, { category: '' });
  assert.deepStrictEqual(res.sort(), Object.keys(cats).sort(), 'check-categories all должен вернуть все категории');

  // Case: check-categories with custom
  const answers2 = ['custom', '1,2'];
  const ask2 = async () => answers2.shift();
  res = await chooseCategories('check-categories', cats, ask2, { category: '' });
  assert.deepStrictEqual(res, ['1', '2']);

  // Default prompt: empty input -> returns config.category
  const ask3 = async () => '';
  res = await chooseCategories('default-mode', cats, ask3, { category: '2' });
  assert.deepStrictEqual(res, ['2']);

  console.log('input_parsing tests passed');
}

run();
