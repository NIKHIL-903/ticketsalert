const TelegramBot = require('node-telegram-bot-api');
const config = require('../config');
const monitorManager = require('../monitor/manager');
const msg = require('./messages');
const wizard = require('./setupWizard');
const logger = require('../logger');

let bot = null;

/**
 * Initialize and start the Telegram bot.
 */
function startBot() {
  bot = new TelegramBot(config.botToken, { polling: true });

  logger.info('Telegram bot started (polling mode)');

  // ── Auth middleware ──────────────────────────────────────────
  function isAuthorized(userId) {
    return config.allowedUsers.includes(userId);
  }

  // ── Commands ─────────────────────────────────────────────────

  bot.onText(/\/start/, (message) => {
    if (!isAuthorized(message.from.id)) {
      return bot.sendMessage(message.chat.id, msg.unauthorized(), { parse_mode: 'MarkdownV2' });
    }
    bot.sendMessage(message.chat.id, msg.welcomeMessage(), { parse_mode: 'MarkdownV2' });
  });

  bot.onText(/\/help/, (message) => {
    if (!isAuthorized(message.from.id)) {
      return bot.sendMessage(message.chat.id, msg.unauthorized(), { parse_mode: 'MarkdownV2' });
    }
    bot.sendMessage(message.chat.id, msg.welcomeMessage(), { parse_mode: 'MarkdownV2' });
  });

  bot.onText(/\/monitor/, (message) => {
    if (!isAuthorized(message.from.id)) {
      return bot.sendMessage(message.chat.id, msg.unauthorized(), { parse_mode: 'MarkdownV2' });
    }
    // Cancel any existing wizard for this chat
    wizard.cancelWizard(message.chat.id);
    wizard.startWizard(bot, message.chat.id);
  });

  bot.onText(/\/list/, (message) => {
    if (!isAuthorized(message.from.id)) {
      return bot.sendMessage(message.chat.id, msg.unauthorized(), { parse_mode: 'MarkdownV2' });
    }
    const monitors = monitorManager.listMonitors();
    bot.sendMessage(message.chat.id, msg.monitorList(monitors), { parse_mode: 'MarkdownV2' });
  });

  bot.onText(/\/status\s+(\S+)/, (message, match) => {
    if (!isAuthorized(message.from.id)) {
      return bot.sendMessage(message.chat.id, msg.unauthorized(), { parse_mode: 'MarkdownV2' });
    }
    const id = match[1].toUpperCase();
    const status = monitorManager.getStatus(id);
    if (!status) {
      return bot.sendMessage(message.chat.id, msg.notFound(id), { parse_mode: 'MarkdownV2' });
    }
    bot.sendMessage(message.chat.id, msg.monitorStatus(status), { parse_mode: 'MarkdownV2' });
  });

  bot.onText(/\/stop\s+(\S+)/, async (message, match) => {
    if (!isAuthorized(message.from.id)) {
      return bot.sendMessage(message.chat.id, msg.unauthorized(), { parse_mode: 'MarkdownV2' });
    }
    const id = match[1].toUpperCase();
    const stopped = await monitorManager.stopMonitor(id);
    if (stopped) {
      bot.sendMessage(message.chat.id, msg.monitorStopped(id), { parse_mode: 'MarkdownV2' });
    } else {
      bot.sendMessage(message.chat.id, msg.notFound(id), { parse_mode: 'MarkdownV2' });
    }
  });

  bot.onText(/\/stopall/, async (message) => {
    if (!isAuthorized(message.from.id)) {
      return bot.sendMessage(message.chat.id, msg.unauthorized(), { parse_mode: 'MarkdownV2' });
    }
    const count = await monitorManager.stopAll();
    bot.sendMessage(message.chat.id, msg.allStopped(count), { parse_mode: 'MarkdownV2' });
  });

  bot.onText(/\/update\s+(\S+)/, (message, match) => {
    if (!isAuthorized(message.from.id)) {
      return bot.sendMessage(message.chat.id, msg.unauthorized(), { parse_mode: 'MarkdownV2' });
    }
    const id = match[1].toUpperCase();
    wizard.cancelWizard(message.chat.id);
    wizard.startUpdateWizard(bot, message.chat.id, id);
  });

  bot.onText(/\/cancel/, (message) => {
    if (!isAuthorized(message.from.id)) return;
    if (wizard.hasActiveWizard(message.chat.id)) {
      wizard.cancelWizard(message.chat.id);
      bot.sendMessage(message.chat.id, `❌ Wizard cancelled\\.`, { parse_mode: 'MarkdownV2' });
    }
  });

  // ── Callback queries (inline keyboard) ──────────────────────

  bot.on('callback_query', async (query) => {
    if (!isAuthorized(query.from.id)) return;

    const chatId = query.message.chat.id;
    const data = query.data;

    // Handle interval unit selection
    if (data.startsWith('unit_')) {
      const unit = data.split('_')[1];
      await bot.answerCallbackQuery(query.id, { text: `Selected: ${unit}` });

      const state = wizard.wizardStates.get(chatId);
      await wizard.handleUnitCallback(bot, chatId, unit, state);
    }
  });

  // ── Text message handler (wizard routing) ───────────────────

  bot.on('message', async (message) => {
    // Skip commands (they're handled by onText)
    if (!message.text || message.text.startsWith('/')) return;
    if (!isAuthorized(message.from.id)) return;

    // Route to wizard if active
    if (wizard.hasActiveWizard(message.chat.id)) {
      await wizard.handleWizardMessage(bot, message.chat.id, message.text);
    }
  });

  // ── Error handling ──────────────────────────────────────────

  bot.on('polling_error', (error) => {
    logger.error(`Bot polling error: ${error.message}`);
  });

  return bot;
}

/**
 * Stop the bot.
 */
function stopBot() {
  if (bot) {
    bot.stopPolling();
    logger.info('Telegram bot stopped');
  }
}

/**
 * Get the current bot instance.
 */
function getBot() {
  return bot;
}

module.exports = { startBot, stopBot, getBot };
