import https from 'https';

const MAX_TELEGRAM_MESSAGE_LENGTH = 4096;
const TELEGRAM_MESSAGE_DELAY_MS = 800;
let telegramAgent = null;

const TELEGRAM_HTTPS_AGENT = new https.Agent({
  rejectUnauthorized: false
});

async function getTelegramAgent() {
  if (telegramAgent) return telegramAgent;
  telegramAgent = TELEGRAM_HTTPS_AGENT;
  return telegramAgent;
}

function sanitizeText(text, maxLen = 4000) {
  if (!text) return '';
  let s = String(text).replace(/\p{C}/gu, ' ').trim();
  if (s.length > maxLen) s = s.slice(0, maxLen - 3) + '...';
  return s;
}

function buildTelegramUrl(token, method) {
  return `https://api.telegram.org/bot${token}/${method}`;
}

async function sendTelegramMessage(bot, chatId, text) {
  if (!bot || !bot.token || !chatId || !text) return;

  const response = await fetch(buildTelegramUrl(bot.token, 'sendMessage'), {
    method: 'POST',
    agent: await getTelegramAgent(),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: String(chatId),
      text,
      disable_web_page_preview: true
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Ошибка Telegram API ${response.status}: ${body}`);
  }

  return response.json();
}

export function initTelegramBot(token) {
  if (!token) {
    console.log('Telegram токен не указан, уведомления отключены');
    return null;
  }
  return { token };
}

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
    await sendTelegramMessage(bot, chatId, sanitizeText(message, MAX_TELEGRAM_MESSAGE_LENGTH));
    console.log('Отчёт отправлен в Telegram');
  } catch (error) {
    console.error('Ошибка отправки в Telegram:', error?.message || error);
  }
}

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
      await sendTelegramMessage(bot, chatId, sanitizeText(chunk, MAX_TELEGRAM_MESSAGE_LENGTH));
      await new Promise(resolve => setTimeout(resolve, TELEGRAM_MESSAGE_DELAY_MS));
    } catch (error) {
      console.error('Ошибка отправки детального отчёта:', error?.message || error);
    }
  }
}
