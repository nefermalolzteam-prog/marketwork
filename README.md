# LZT Market Search Bot

Консольный бот для поиска объявлений и проверки нарушений на LZT Market. Работает на Node.js 26.3.0 и поддерживает 7 режимов поиска, локальную историю в SQLite, Telegram-уведомления, веб-просмотр и экспорт в Excel.

Текущая версия: **3.2.0**

## ⚡ Основные возможности

- 7 режимов поиска и проверки
- Проверка 40+ шаблонов нарушений
- Поиск поддельных "личных" аккаунтов и несоответствий происхождения
- Локальная история проверок в SQLite (bot_history.db)
- Веб-интерфейс на Express для просмотра результатов
- Отправка уведомлений в Telegram
- Параллельная обработка страниц в режимах 1-3
- Поддержка batch API для групповых запросов страниц
- Экспорт результатов в Excel (results_*.xlsx)
- Корректное завершение (graceful shutdown) при Ctrl+C
- apiDocs и rulesDocs в конфиге

## Установка

1. Установите Node.js 26.3.0.
2. Скопируйте шаблон конфигурации:
    cp config.example.json config.json
    # На Windows используйте: copy config.example.json config.json
3. Заполните token и другие параметры в config.json.
4. config.json уже добавлен в .gitignore.

## Запуск

### NPM-команды

    npm start              # Запустить бот
    npm test               # Запустить тесты
    npm run check-syntax   # Проверить синтаксис JavaScript
    npm run lint           # Проверить синтаксис и запустить ESLint

### Прямой запуск

    node bot.js

## Режимы работы

- 1 — Поиск по ключевым словам
- 2 — Автоматическая проверка всех объявлений
- 3 — Проверка разделов (категорий) по правилам
- 4 — Проверка неверного происхождения
- 5 — Поиск поддельных личных аккаунтов
- 6 — Поиск отлеги по годам в Telegram
- 7 — Поиск Social Club в Steam и Epic Games

> При Ctrl+C бот выводит уже найденные результаты и завершает работу.

## Как работают режимы

| Режим | Описание |
|------|----------|
| **1** | Поиск объявлений по ключевым словам с проверкой нарушений |
| **2** | Автоматическая проверка объявлений в одной категории |
| **3** | Проверка выбранных категорий на нарушения |
| **4** | Ищет заголовки с упоминанием происхождения, но с другим origin |
| **5** | Ищет объявления с "личный" в названии, origin != personal |
| **6** | Поиск отлежки/inactive с указанием лет в Telegram |
| **7** | Поиск GTA/RDR без доступа к Social Club в Steam/Epic |

### Режимы 4-7: фиксированные настройки

- maxPages — 1
- resultsPerPage — 500
- Сортировка — новые сначала
- Категории:
    режим 6: Telegram (24)
    режим 7: Steam (1) и Epic Games (12)

## Конфигурация

### Полезные ссылки API и документации

- Документация API LZT Market: https://lzt-market.readme.io/reference/information
- Документация API LolzTeam: https://lolzteam.readme.io/reference/information
- Схема market.json: https://raw.githubusercontent.com/AS7RIDENIED/LOLZTEAM/main/Official%20Documentation/market.json

### Основные параметры config.json

В `config.json` можно указать `proxyUrl` для HTTPS-прокси и `apiAlternateUrl` для запасного API-хоста на случай сетевых ошибок или недоступности основного сервера.

    {
      "token": "ВАШ_JWT_ТОКЕН",
      "apiBaseUrl": "https://prod-api.lzt.market",
      "proxyUrl": "",
      "apiAlternateUrl": "",
      "apiDocs": [
        "https://lolzteam.readme.io/reference/information",
        "https://lzt-market.readme.io/reference/information"
      ],
      "rulesDocs": [
        "https://lzt.market/rules",
        "https://lolz.live/threads/7421809/",
        "https://lolz.live/threads/9679111/"
      ],
      "keywords": ["отлега", "отлёга", "отлежка", "отлёжка", "inactive"],
      "category": "",
      "checkCategories": ["1", "24"],
      "order_by": "pdate_to_down",
      "deduplicateResults": false,
      "maxPages": 1000,
      "resultsPerPage": 500,
      "pageDelayMs": 300,
      "categoryDelayMs": 1000,
      "includeOrigins": [],
      "excludeOrigins": [],
      "language": "ru",
      "parallelProcessing": false,
      "maxConcurrentRequests": 4,
      "enableWebServer": false,
      "webPort": 3000,
      "telegramToken": "",
      "telegramChatId": "",
      "pmin": 0,
      "pmax": 0
    }

### Дополнительные настройки

- dbPath — путь к файлу SQLite (по умолчанию bot_history.db)
- dbRetentionDays — срок хранения старых записей для очистки
- useBatch — `true` или `false`; если `true`, бот использует batch API для групповых запросов страниц, что снижает количество отдельных запросов.

### Сортировка (order_by)

- pdate_to_down — новые сначала
- pdate_to_up — старые сначала
- price_to_up — дешёвые сначала
- price_to_down — дорогие сначала
- edate_to_up — недавно редактированные сначала

### Параллельная обработка

- Работает только в режимах 1, 2, 3.
- В режимах 4, 5, 6, 7 используется последовательная обработка.
- Включается parallelProcessing: true.
- maxConcurrentRequests задаёт количество одновременных запросов.

### Удаление дублей

- deduplicateResults: true удаляет повторяющиеся объявления по ID
- deduplicateResults: false сохраняет все результаты страниц

## Веб-интерфейс

Если enableWebServer включён, бот запускает веб-сервер и отображает результаты на http://localhost:<webPort>.

## Telegram-уведомления

Если заданы telegramToken и telegramChatId, бот отправляет отчёты после завершения проверки.

## Категории

| ID | Название |
|----|----------|
| 1  | Steam |
| 3  | EA |
| 4  | Warface |
| 5  | Ubisoft Connect (Uplay) |
| 6  | LLM |
| 7  | Social Club |
| 8  | Hytale |
| 9  | Fortnite |
| 10 | Instagram |
| 11 | Battle.net |
| 12 | Epic Games |
| 13 | Riot Games |
| 14 | World of Tanks |
| 15 | Supercell |
| 16 | World of Tanks Blitz |
| 17 | miHoYo |
| 18 | Escape from Tarkov |
| 19 | VPN |
| 20 | TikTok |
| 22 | Discord |
| 24 | Telegram |
| 28 | Minecraft |
| 30 | Gifts |
| 31 | Roblox |

## Примеры использования

**Режим 5 — поиск поддельных личных аккаунтов**

1. Запустите node bot.js
2. Выберите режим 5
3. Выберите категории или нажмите Enter для всех
4. В конце подтвердите экспорт в Excel, если нужно

**Режим 6 — отлеги в Telegram**

- Выберите режим 6
- Категория Telegram фиксирована автоматически

**Режим 3 — проверка нескольких категорий**

- Выберите режим 3
- Введите all для всех категорий или custom для конкретных ID

## Советы

- Увеличьте pageDelayMs до 500–1000 для снижения числа 429
- Включите deduplicateResults, если находите много повторов
- Включите enableWebServer для быстрого просмотра результатов
- Настройте Telegram-уведомления для автоматических отчётов

## Полезные ссылки

- Документация API: https://lzt-market.readme.io/
- Документация API LolzTeam: https://lolzteam.readme.io/reference/information
- Правила LZT Market: https://lzt.market/rules
- Гайд: https://lolz.live/threads/7421809/
- Второй гайд: https://lolz.live/threads/9679111/

## Лицензия

MIT
