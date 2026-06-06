import assert from 'assert';
import { chooseOrderBy } from '../input_helpers.js';

async function run() {
  const modeMetadata = {
    'search': { fixed: false },
    'fake-personal': { fixed: true }
  };

  // Для фиксированного режима должно вернуть значение по умолчанию
  const ask1 = async () => '';
  let res = await chooseOrderBy('fake-personal', modeMetadata, ask1, { order_by: 'price_to_up' });
  assert.strictEqual(res, 'pdate_to_down');

  // Для интерактивного режима выбираем опцию 3 -> price_to_up
  const answers2 = ['3'];
  const ask2 = async () => answers2.shift();
  res = await chooseOrderBy('search', modeMetadata, ask2, { order_by: 'pdate_to_down' });
  assert.strictEqual(res, 'price_to_up');

  // Неверный выбор возвращает config.order_by
  const answers3 = ['99'];
  const ask3 = async () => answers3.shift();
  res = await chooseOrderBy('search', modeMetadata, ask3, { order_by: 'edate_to_up' });
  assert.strictEqual(res, 'edate_to_up');

  console.log('Тесты order_parsing пройдены');
}

run();
