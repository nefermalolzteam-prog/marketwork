import TelegramBot from 'node-telegram-bot-api';

const MAX_TELEGRAM_MESSAGE_LENGTH = 4096;
const TELEGRAM_MESSAGE_DELAY_MS = 800;

function sanitizeText(text, maxLen = 4000) {
  if (!text) return '';
  // Remove control characters and trim
  let s = String(text).replace(/\p{C}/gu, ' ').trim();
  if (s.length > maxLen) s = s.slice(0, maxLen - 3) + '...';
  return s;
}

// Инициализация бота (токен из config)
export function initTelegramBot(token) {
  if (!token) {
    console.log('Telegram токен не указан, уведомления отключены');
    return null;
  }
  return new TelegramBot(token, { polling: false });
}

// Отправка отчёта о нарушениях (короткий свод)
export async function sendViolationReport(bot, chatId, results, mode) {
  if (!bot || !chatId || !Array.isArray(results)) return;

  const totalViolations = results.reduce((sum, item) => sum + (Array.isArray(item.violations) ? item.violations.length : 0), 0);
  let message = `📊 Отчёт о проверке (${sanitizeText(mode, 200)})\n`;
  message += `Всего объявлений: ${results.length}\n`;
  message += `Нарушений найдено: ${totalViolations}\n\n`;

  const top = results.slice(0, 5);
  if (top.length > 0) {
    message += 'Топ нарушений:\n';
    top.forEach((item, index) => {
      message += `${index + 1}. ${sanitizeText(item.title, 200)} - ${Array.isArray(item.violations) ? item.violations.length : 0} наруш.\n`;
    });
  }

  try {
    await bot.sendMessage(chatId, sanitizeText(message, MAX_TELEGRAM_MESSAGE_LENGTH), {
      disable_web_page_preview: true
    });
    console.log('Отчёт отправлен в Telegram');
  } catch (error) {
    console.error('Ошибка отправки в Telegram:', error?.message || error);
  }
}

// Отправка детального отчёта (с разбиением и throttling)
export async function sendDetailedReport(bot, chatId, results) {
  if (!bot || !chatId || !Array.isArray(results)) return;

  const chunks = [];
  let currentChunk = '📋 Детальный отчёт:\n\n';

  results.forEach((item, index) => {
    const violationsText = Array.isArray(item.violations)
      ? item.violations.map(v => v.name || v.keyword || v).join(', ')
      : String(item.violations || '');
    const itemText = `${index + 1}. ${sanitizeText(item.title, 200)}\nЦена: ${sanitizeText(item.price, 50)}\nНарушения: ${sanitizeText(violationsText, 300)}\nURL: ${sanitizeText(item.url, 200)}\n\n`;

    if ((currentChunk + itemText).length > 3800) {
      chunks.push(currentChunk);
      currentChunk = itemText;
    } else {
      currentChunk += itemText;
    }
  });

  if (currentChunk) chunks.push(currentChunk);

  for (const chunk of chunks) {
    try {
      await bot.sendMessage(chatId, sanitizeText(chunk, MAX_TELEGRAM_MESSAGE_LENGTH), {
        disable_web_page_preview: true
      });
      await new Promise(resolve => setTimeout(resolve, TELEGRAM_MESSAGE_DELAY_MS));
    } catch (error) {
      console.error('Ошибка отправки детального отчёта:', error?.message || error);
    }
  }
}