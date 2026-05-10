import TelegramBot from 'node-telegram-bot-api';

// Инициализация бота (токен из config)
export function initTelegramBot(token) {
  if (!token) {
    console.log('Telegram токен не указан, уведомления отключены');
    return null;
  }
  return new TelegramBot(token, { polling: false });
}

// Отправка отчёта о нарушениях
export async function sendViolationReport(bot, chatId, results, mode) {
  if (!bot || !chatId) return;

  const totalViolations = results.reduce((sum, item) => sum + item.violations.length, 0);
  let message = `📊 Отчёт о проверке (${mode})\n`;
  message += `Всего объявлений: ${results.length}\n`;
  message += `Нарушений найдено: ${totalViolations}\n\n`;

  if (results.length > 0) {
    message += 'Топ нарушений:\n';
    results.slice(0, 5).forEach((item, index) => {
      message += `${index + 1}. ${item.title} - ${item.violations.length} наруш.\n`;
    });
  }

  try {
    await bot.sendMessage(chatId, message);
    console.log('Отчёт отправлен в Telegram');
  } catch (error) {
    console.error('Ошибка отправки в Telegram:', error.message);
  }
}

// Отправка детального отчёта
export async function sendDetailedReport(bot, chatId, results) {
  if (!bot || !chatId) return;

  const chunks = [];
  let currentChunk = '📋 Детальный отчёт:\n\n';

  results.forEach((item, index) => {
    const itemText = `${index + 1}. ${item.title}\nЦена: ${item.price}\nНарушения: ${item.violations.map(v => v.name).join(', ')}\nURL: ${item.url}\n\n`;

    if ((currentChunk + itemText).length > 4000) {
      chunks.push(currentChunk);
      currentChunk = itemText;
    } else {
      currentChunk += itemText;
    }
  });

  if (currentChunk) chunks.push(currentChunk);

  for (const chunk of chunks) {
    try {
      await bot.sendMessage(chatId, chunk);
      await new Promise(resolve => setTimeout(resolve, 1000)); // Задержка между сообщениями
    } catch (error) {
      console.error('Ошибка отправки детального отчёта:', error.message);
    }
  }
}