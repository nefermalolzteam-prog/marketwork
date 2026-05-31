/**
 * Выбор порядка сортировки результатов
 * @param {string} mode - Режим работы
 * @param {Object} modeMetadata - Метаданные режимов
 * @param {Function} ask - Функция для интерактивного ввода
 * @param {Object} config - Конфигурация с значением по умолчанию order_by
 * @returns {Promise<string>} Выбранный порядок сортировки
 */
export async function chooseOrderBy(mode, modeMetadata, ask, config) {
  const orderByOptions = [
    { num: '1', value: 'pdate_to_down', label: 'новые сначала' },
    { num: '2', value: 'pdate_to_up', label: 'старые сначала' },
    { num: '3', value: 'price_to_up', label: 'сначала дешевые' },
    { num: '4', value: 'price_to_down', label: 'сначала дорогие' },
    { num: '5', value: 'pdate_to_down_upload', label: 'новые загруженные' },
    { num: '6', value: 'pdate_to_up_upload', label: 'старые загруженные' },
    { num: '7', value: 'edate_to_up', label: 'недавно отредактированные' },
    { num: '8', value: 'edate_to_down', label: 'старые отредактированные' }
  ];

  // Для фиксированных режимов используем значение по умолчанию
  if (modeMetadata?.[mode]?.fixed) {
    console.log(`Сортировка фиксирована: ${orderByOptions[0].label}`);
    return 'pdate_to_down';
  }

  console.log('Выберите режим сортировки:');
  orderByOptions.forEach((opt) => console.log(` ${opt.num}. ${opt.label}`));

  const choice = await ask('Введите номер сортировки (1-8): ');
  const selected = orderByOptions.find(opt => opt.num === choice.trim());
  
  return selected?.value || config?.order_by || 'pdate_to_down';
}
