// === Конфигурация параллельной обработки ===
export const DEFAULT_CONFIG = {
  parallelProcessing: false,
  maxConcurrentRequests: 4,
  useBatch: false
};

// === Значения по умолчанию для параметров ===
export const DEFAULT_MAX_PAGES = 1;
export const DEFAULT_RESULTS_PER_PAGE = 1000;
export const DEFAULT_PAGE_DELAY_MS = 1000;
export const DEFAULT_CATEGORY_DELAY_MS = 2000;
export const DEFAULT_CATEGORY_CONCURRENCY = 2;

// === Ограничения ===
export const MAX_CONCURRENT_REQUESTS_LIMIT = 20;

// === API конфигурация ===
export const DEFAULT_API_BASE_URL = 'https://prod-api.lzt.market';

// === Допустимые варианты сортировки ===
export const ALLOWED_ORDER_BY = new Set([
  'price_to_up',
  'price_to_down',
  'pdate_to_down',
  'pdate_to_up',
  'pdate_to_down_upload',
  'pdate_to_up_upload',
  'edate_to_up',
  'edate_to_down'
]);

// === Пути категорий в API ===
export const CATEGORY_PATHS = {
  '1': 'steam',
  '3': 'ea',
  '4': 'warface',
  '5': 'uplay',
  '6': 'llm',
  '7': 'socialclub',
  '8': 'hytale',
  // Начиная с API 1.1.103 Fortnite объединён с Epic Games: категория 9 = epicgames,
  // отдельного пути /fortnite больше нет.
  '9': 'epicgames',
  '10': 'instagram',
  '11': 'battlenet',
  '12': 'epicgames', // устаревший ID Epic Games (до API 1.1.103), оставлен как алиас для старых конфигов
  '13': 'riot',
  '14': 'world-of-tanks',
  '15': 'supercell',
  '16': 'wot-blitz',
  '17': 'mihoyo',
  '18': 'escape-from-tarkov',
  '19': 'vpn',
  '20': 'tiktok',
  '22': 'discord',
  '24': 'telegram',
  '28': 'minecraft',
  '30': 'gifts',
  '31': 'roblox'
};

// === Режимы без параллельной обработки ===
export const PARALLEL_DISABLED_MODES = new Set([
  'check-origins',
  'fake-personal',
  'telegram-years',
  'socialclub-search'
]);

// === Типы происхождения аккаунтов ===
export const ACCOUNT_ORIGINS = {
  personal: { name: 'Личный', searchTerms: ['личный', 'personal'] },
  brute: { name: 'Брут', searchTerms: ['брут', 'brute'] },
  phishing: { name: 'Фишинг', searchTerms: ['фишинг', 'phishing'] },
  stealer: { name: 'Стилер', searchTerms: ['стилер', 'stealer'] },
  resale: { name: 'Перепродажа', searchTerms: ['перепродажа', 'resale'] },
  autoreg: { name: 'Авторег', searchTerms: ['авторег', 'авторег'] },
  dummy: { name: 'Пустышка', searchTerms: ['пустышка', 'dummy'] },
  self_registration: { name: 'Саморег', searchTerms: ['саморег', 'self_registration'] },
  retrieve_via_support: { name: 'Восстановление через поддержку', searchTerms: ['восстановление через поддержку', 'retrieve_via_support'] }
};

// === ID специальных категорий ===
export const TELEGRAM_CATEGORY_ID = '24';

// === Дополнительные утилиты ===
export const CATEGORY_IDS = Object.keys(CATEGORY_PATHS);
export const SUPPORTED_CATEGORY_IDS = CATEGORY_IDS;

export function getCategoryPath(categoryId) {
  return CATEGORY_PATHS[String(categoryId)] || null;
}

export function isParallelDisabledMode(mode) {
  return PARALLEL_DISABLED_MODES.has(String(mode));
}

