import { TELEGRAM_CATEGORY_ID } from './constants.js';

/**
 * Выбор категорий на основе режима работы
 * @param {string} mode - Режим работы (search, check-categories, check-origins и т.д.)
 * @param {Object} cats - Объект категорий {id: name}
 * @param {Function} ask - Функция для интерактивного ввода
 * @param {Object} config - Конфигурация с категориями по умолчанию
 * @returns {Promise<Array<string>>} Массив выбранных ID категорий
 */
export async function chooseCategories(mode, cats, ask, config) {
  // Обработчики для разных режимов
  const categoryHandlers = {
    /**
     * Режим выбора нескольких категорий для проверки
     */
    'check-categories': async () => {
      console.log('Доступные категории:');
      Object.entries(cats).forEach(([id, name]) => console.log(`  ${id}. ${name}`));
      console.log('  all. Все категории');
      console.log('  custom. Ввести свои ID через запятую');
      
      const catChoice = await ask('Выберите категории (номера через запятую, all или custom): ');
      if (!catChoice?.trim()) return [];
      
      const choice = catChoice.toLowerCase().trim();
      if (choice === 'all') {
        return Object.keys(cats);
      }
      if (choice === 'custom') {
        const customCats = await ask('Введите ID категорий через запятую: ');
        return customCats.split(',').map(c => c.trim()).filter(Boolean);
      }
      
      return catChoice.split(',').map(c => c.trim()).filter(c => cats[c] || c);
    },

    /**
     * Режимы, использующие все категории
     */
    'check-origins': () => Object.keys(cats),
    'fake-personal': () => Object.keys(cats),

    /**
     * Режимы с фиксированными категориями
     */
    'telegram-years': () => [TELEGRAM_CATEGORY_ID],
    'socialclub-search': () => ['1', '9'],

    /**
     * Режим поиска по словам - одна категория или все
     */
    'default': async () => {
      console.log('Доступные категории:');
      Object.entries(cats).forEach(([id, name]) => console.log(`  ${id}. ${name}`));
      
      const categoryInput = await ask('Введите ID категории (или Enter для всех): ');
      const val = (categoryInput?.trim() || config?.category || '').trim();
      return val ? [val] : [];
    }
  };

  const handler = categoryHandlers[mode] || categoryHandlers.default;
  return await handler();
}
