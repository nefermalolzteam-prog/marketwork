import i18next from 'i18next';

// Ресурсы переводов
const resources = {
  ru: {
    translation: {
      welcome: 'Добро пожаловать в LZT Market Bot',
      mode1: 'Поиск по ключевым словам',
      mode2: 'Автоматическая проверка всех объявлений',
      mode3: 'Проверка разделов по правилам',
      mode4: 'Проверка неверного происхождения',
      mode5: 'Поддельные личные аккаунты',
      mode6: 'Отлеги в Telegram',
      mode7: 'Social Club поиск',
      results: 'Результаты',
      violations: 'Нарушения',
      export: 'Экспорт',
      history: 'История',
      settings: 'Настройки'
    }
  },
  en: {
    translation: {
      welcome: 'Welcome to LZT Market Bot',
      mode1: 'Keyword search',
      mode2: 'Automatic check all listings',
      mode3: 'Check categories by rules',
      mode4: 'Check wrong origin',
      mode5: 'Fake personal accounts',
      mode6: 'Telegram otleg by years',
      mode7: 'Social Club search',
      results: 'Results',
      violations: 'Violations',
      export: 'Export',
      history: 'History',
      settings: 'Settings'
    }
  }
};

// Инициализация i18next
export async function initI18n(language = 'ru') {
  // fallback: missingLogger can be registered later via options
  await i18next.init({
    lng: language,
    resources,
    missingKeyHandler: function(lng, ns, key) {
      // default behavior: warn to console; if an external logger is set it will be called via t()
      console.warn(`[i18n] Missing translation key: ${key} (lang=${lng})`);
    }
  });
  return i18next;
}

// Функция для получения перевода
let _missingLogger = null;

export function setMissingKeyLogger(fn) {
  if (typeof fn === 'function') _missingLogger = fn;
}

export function t(key, options = {}) {
  const res = i18next.t(key, options);
  // Если перевод отсутствует и вернулся ключ — уведомим логгер (если есть)
  if (res === key && _missingLogger) {
    try {
      _missingLogger(`[i18n] Missing translation key: ${key}`);
    } catch {
      // ignore logging errors
    }
  }
  return res;
}

// Смена языка
export function changeLanguage(lang) {
  return i18next.changeLanguage(lang);
}