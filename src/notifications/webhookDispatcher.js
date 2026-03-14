const config = require('../config');
const db = require('../db/database');
const { formatDiscord, formatTelegram } = require('./formatters');
const logger = require('../utils/logger');

/**
 * Dispatch a signal to all configured and enabled webhooks.
 */
async function dispatch(signal) {
  const results = [];

  // Send to Discord if configured
  if (config.webhooks.discordUrl) {
    try {
      await sendDiscord(signal, config.webhooks.discordUrl);
      results.push({ platform: 'discord', success: true });
    } catch (err) {
      logger.error('Discord webhook failed', { error: err.message });
      results.push({ platform: 'discord', success: false, error: err.message });
    }
  }

  // Send to Telegram if configured
  if (config.webhooks.telegramBotToken && config.webhooks.telegramChatId) {
    try {
      await sendTelegram(signal, config.webhooks.telegramBotToken, config.webhooks.telegramChatId);
      results.push({ platform: 'telegram', success: true });
    } catch (err) {
      logger.error('Telegram webhook failed', { error: err.message });
      results.push({ platform: 'telegram', success: false, error: err.message });
    }
  }

  // Send to custom webhooks from DB
  const webhooks = db.getWebhookConfigs();
  for (const wh of webhooks) {
    if (wh.min_grade && signal.grade !== wh.min_grade) continue;

    try {
      if (wh.platform === 'discord') {
        await sendDiscord(signal, wh.url);
      } else if (wh.platform === 'telegram') {
        await sendCustomWebhook(signal, wh.url);
      } else {
        await sendCustomWebhook(signal, wh.url);
      }
      results.push({ platform: wh.platform, name: wh.name, success: true });
    } catch (err) {
      logger.error(`Webhook "${wh.name}" failed`, { error: err.message });
      results.push({ platform: wh.platform, name: wh.name, success: false, error: err.message });
    }
  }

  return results;
}

async function sendDiscord(signal, url) {
  const payload = formatDiscord(signal);
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Discord API error: ${response.status}`);
  }

  logger.info('Discord notification sent', { symbol: signal.symbol, direction: signal.direction });
}

async function sendTelegram(signal, botToken, chatId) {
  const payload = formatTelegram(signal);
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, ...payload }),
  });

  if (!response.ok) {
    throw new Error(`Telegram API error: ${response.status}`);
  }

  logger.info('Telegram notification sent', { symbol: signal.symbol, direction: signal.direction });
}

async function sendCustomWebhook(signal, url) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(signal),
  });

  if (!response.ok) {
    throw new Error(`Custom webhook error: ${response.status}`);
  }
}

module.exports = { dispatch };
