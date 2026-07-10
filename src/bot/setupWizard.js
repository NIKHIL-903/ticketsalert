const { createPage } = require('../scraper/browser');
const { discoverLayout, getRowsForCategory } = require('../scraper/scraper');
const monitorManager = require('../monitor/manager');
const msg = require('./messages');
const config = require('../config');
const logger = require('../logger');

// Wizard states per chat
const wizardStates = new Map(); // chatId -> state

// Wizard step constants
const STEPS = {
  AWAITING_NAME: 'AWAITING_NAME',
  AWAITING_URL: 'AWAITING_URL',
  FETCHING_INFO: 'FETCHING_INFO',
  AWAITING_CATEGORY: 'AWAITING_CATEGORY',
  AWAITING_ROWS: 'AWAITING_ROWS',
  AWAITING_RANGE: 'AWAITING_RANGE',
  AWAITING_INTERVAL_UNIT: 'AWAITING_INTERVAL_UNIT',
  AWAITING_INTERVAL_VALUE: 'AWAITING_INTERVAL_VALUE',
  // Update flow
  UPDATE_MENU: 'UPDATE_MENU',
  UPDATE_ROWS: 'UPDATE_ROWS',
  UPDATE_RANGE: 'UPDATE_RANGE',
  UPDATE_INTERVAL: 'UPDATE_INTERVAL',
};

/**
 * Start a new monitor setup wizard for the given chat.
 */
function startWizard(bot, chatId) {
  wizardStates.set(chatId, {
    step: STEPS.AWAITING_NAME,
    data: {},
  });
  bot.sendMessage(chatId, '📝 *Step 1/6* — Enter a *custom name* for this monitor \\(e\\.g\\. Movie Name, Theater, Date\\):', { parse_mode: 'MarkdownV2' });
}

/**
 * Start the update wizard for a specific monitor.
 */
function startUpdateWizard(bot, chatId, monitorId) {
  const status = monitorManager.getStatus(monitorId);
  if (!status) {
    bot.sendMessage(chatId, msg.notFound(monitorId), { parse_mode: 'MarkdownV2' });
    return;
  }

  wizardStates.set(chatId, {
    step: STEPS.UPDATE_MENU,
    data: { monitorId, monitorStatus: status },
  });

  bot.sendMessage(chatId, msg.updatePrompt(status), { parse_mode: 'MarkdownV2' });
}

/**
 * Check if a chat has an active wizard.
 */
function hasActiveWizard(chatId) {
  return wizardStates.has(chatId);
}

/**
 * Cancel any active wizard for the chat.
 */
function cancelWizard(chatId) {
  const state = wizardStates.get(chatId);
  // Clean up temp page if it exists
  if (state && state.data && state.data.tempPage) {
    state.data.tempPage.context().close().catch(() => {});
  }
  wizardStates.delete(chatId);
}

/**
 * Handle an incoming text message for the active wizard.
 * Returns true if handled, false otherwise.
 */
async function handleWizardMessage(bot, chatId, text) {
  const state = wizardStates.get(chatId);
  if (!state) return false;

  try {
    switch (state.step) {
      case STEPS.AWAITING_NAME:
        await handleNameInput(bot, chatId, text, state);
        break;
      case STEPS.AWAITING_URL:
        await handleUrl(bot, chatId, text, state);
        break;
      case STEPS.AWAITING_CATEGORY:
        await handleCategorySelection(bot, chatId, text, state);
        break;
      case STEPS.AWAITING_ROWS:
        await handleRowSelection(bot, chatId, text, state);
        break;
      case STEPS.AWAITING_RANGE:
        await handleRangeInput(bot, chatId, text, state);
        break;
      case STEPS.AWAITING_INTERVAL_UNIT:
        bot.sendMessage(chatId, '⚠️ Please select Seconds or Minutes using the buttons below\\.', { parse_mode: 'MarkdownV2' });
        break;
      case STEPS.AWAITING_INTERVAL_VALUE:
        await handleIntervalValueInput(bot, chatId, text, state);
        break;
      case STEPS.UPDATE_MENU:
        await handleUpdateMenu(bot, chatId, text, state);
        break;
      case STEPS.UPDATE_ROWS:
        await handleUpdateRows(bot, chatId, text, state);
        break;
      case STEPS.UPDATE_RANGE:
        await handleUpdateRange(bot, chatId, text, state);
        break;
      case STEPS.UPDATE_INTERVAL:
        await handleUpdateInterval(bot, chatId, text, state);
        break;
      default:
        return false;
    }
  } catch (error) {
    logger.error(`Wizard error: ${error.message}`);
    bot.sendMessage(chatId, msg.invalidInput(`Something went wrong: ${error.message}`), {
      parse_mode: 'MarkdownV2',
    });
  }

  return true;
}

/**
 * Handle the polling interval callback query (inline keyboard).
 */
/**
 * Handle the polling interval unit callback query (Seconds/Minutes).
 */
async function handleUnitCallback(bot, chatId, unit, state) {
  if (!state) {
    state = wizardStates.get(chatId);
  }
  if (!state || state.step !== STEPS.AWAITING_INTERVAL_UNIT) return;

  state.data.intervalUnit = unit; // 'seconds' or 'minutes'
  state.step = STEPS.AWAITING_INTERVAL_VALUE;

  if (unit === 'seconds') {
    bot.sendMessage(chatId, '⏱ Enter the polling interval in *seconds* \\(minimum 10s\\):', { parse_mode: 'MarkdownV2' });
  } else {
    bot.sendMessage(chatId, '⏱ Enter the polling interval in *minutes* \\(minimum 1m\\):', { parse_mode: 'MarkdownV2' });
  }
}

/**
 * Handle custom interval value text message.
 */
async function handleIntervalValueInput(bot, chatId, text, state) {
  const value = parseInt(text.trim(), 10);
  const unit = state.data.intervalUnit;

  if (isNaN(value) || value < 1) {
    bot.sendMessage(chatId, msg.invalidInput('Please enter a valid positive number.'), { parse_mode: 'MarkdownV2' });
    return;
  }

  if (unit === 'seconds' && value < 10) {
    bot.sendMessage(chatId, msg.invalidInput('Minimum polling interval is 10 seconds.'), { parse_mode: 'MarkdownV2' });
    return;
  }

  let intervalSeconds = value;
  if (unit === 'minutes') {
    intervalSeconds = value * 60;
  }

  state.data.pollingInterval = intervalSeconds;

  // Clean up temp page
  if (state.data.tempPage) {
    try { await state.data.tempPage.context().close(); } catch {}
    state.data.tempPage = null;
  }

  // Create the monitor
  const monitorId = await monitorManager.createMonitor({
    name: state.data.name,
    url: state.data.url,
    category: state.data.selectedCategory,
    rows: state.data.selectedRows,
    seatRange: state.data.seatRange,
    pollingInterval: state.data.pollingInterval,
    onAlert: (alertData) => {
      config.allowedUsers.forEach((targetChatId) => {
        bot.sendMessage(targetChatId, msg.seatAlert(alertData), { parse_mode: 'MarkdownV2' })
          .catch((err) => {
            logger.error(`Failed to send alert to ${targetChatId}: ${err.message}`);
          });
      });
    },
    onError: (errorData) => {
      config.allowedUsers.forEach((targetChatId) => {
        bot.sendMessage(targetChatId, msg.errorAlert(errorData.monitorId, errorData.name || errorData.monitorId, errorData.error), {
          parse_mode: 'MarkdownV2',
        }).then(() => {
          if (errorData.screenshotPath) {
            bot.sendPhoto(targetChatId, errorData.screenshotPath, {
              caption: `📸 Error screenshot for ${errorData.name || errorData.monitorId}`,
            }).catch((err) => {
              logger.error(`Failed to send error screenshot to ${targetChatId}: ${err.message}`);
            });
          }
        }).catch((err) => {
          logger.error(`Failed to send error alert to ${targetChatId}: ${err.message}`);
        });
      });
    },
  });

  // Send confirmation
  bot.sendMessage(
    chatId,
    msg.monitorStarted(
      monitorId,
      state.data.name,
      state.data.selectedCategory.label,
      state.data.selectedRows,
      state.data.seatRange,
      state.data.pollingInterval
    ),
    { parse_mode: 'MarkdownV2' }
  );

  // Clear wizard state
  wizardStates.delete(chatId);
  logger.info(`Wizard complete: ${monitorId} created for chat ${chatId}`);
}

// ── Step handlers ──────────────────────────────────────────────

async function handleNameInput(bot, chatId, text, state) {
  const name = text.trim();
  if (name.length < 2) {
    bot.sendMessage(chatId, msg.invalidInput('Please enter a descriptive name (at least 2 characters).'), {
      parse_mode: 'MarkdownV2',
    });
    return;
  }
  state.data.name = name;
  state.step = STEPS.AWAITING_URL;
  bot.sendMessage(chatId, msg.askUrl(), { parse_mode: 'MarkdownV2' });
}

async function handleUrl(bot, chatId, text, state) {
  const url = text.trim();

  // Basic URL validation
  if (!url.startsWith('http') || !url.includes('bookmyshow.com')) {
    bot.sendMessage(chatId, msg.invalidInput('Please send a valid BookMyShow URL.'), {
      parse_mode: 'MarkdownV2',
    });
    return;
  }

  state.data.url = url;
  state.step = STEPS.FETCHING_INFO;

  bot.sendMessage(chatId, msg.fetchingInfo(), { parse_mode: 'MarkdownV2' });

  // Create a temporary page for discovery
  const tempPage = await createPage();
  state.data.tempPage = tempPage;

  try {
    const categories = await discoverLayout(tempPage, url);

    if (categories.length === 0) {
      bot.sendMessage(chatId, msg.invalidInput('No seat categories found. Check the URL and try again.'), {
        parse_mode: 'MarkdownV2',
      });
      cancelWizard(chatId);
      return;
    }

    state.data.categories = categories;
    state.step = STEPS.AWAITING_CATEGORY;

    bot.sendMessage(chatId, msg.showCategories(categories), { parse_mode: 'MarkdownV2' });
  } catch (error) {
    logger.error(`Discovery error: ${error.message}`);
    bot.sendMessage(
      chatId,
      msg.invalidInput(`Could not scan the seat layout: ${error.message}`),
      { parse_mode: 'MarkdownV2' }
    );
    cancelWizard(chatId);
  }
}

async function handleCategorySelection(bot, chatId, text, state) {
  const num = parseInt(text.trim(), 10);

  if (isNaN(num) || num < 1 || num > state.data.categories.length) {
    bot.sendMessage(
      chatId,
      msg.invalidInput(`Enter a number between 1 and ${state.data.categories.length}.`),
      { parse_mode: 'MarkdownV2' }
    );
    return;
  }

  const selected = state.data.categories[num - 1];
  state.data.selectedCategory = selected;

  // The rows were already fetched during discovery
  if (selected.rows && selected.rows.length > 0) {
    state.data.availableRows = selected.rows;
    state.step = STEPS.AWAITING_ROWS;
    bot.sendMessage(chatId, msg.showRows(selected.rows), { parse_mode: 'MarkdownV2' });
  } else {
    bot.sendMessage(chatId, msg.invalidInput('No rows found for this category.'), {
      parse_mode: 'MarkdownV2',
    });
  }
}

async function handleRowSelection(bot, chatId, text, state) {
  const input = text.trim().toLowerCase();
  const available = state.data.availableRows;
  let selectedRows;

  if (input === 'all') {
    selectedRows = [...available];
  } else {
    const nums = input.split(',').map((s) => parseInt(s.trim(), 10));
    const invalid = nums.some((n) => isNaN(n) || n < 1 || n > available.length);

    if (invalid) {
      bot.sendMessage(
        chatId,
        msg.invalidInput(`Enter valid numbers between 1 and ${available.length}, comma-separated.`),
        { parse_mode: 'MarkdownV2' }
      );
      return;
    }

    selectedRows = nums.map((n) => available[n - 1]);
  }

  state.data.selectedRows = selectedRows;
  state.step = STEPS.AWAITING_RANGE;
  bot.sendMessage(chatId, msg.askRange(), { parse_mode: 'MarkdownV2' });
}

async function handleRangeInput(bot, chatId, text, state) {
  const input = text.trim().toLowerCase();

  if (input === 'all') {
    state.data.seatRange = null; // null means all seats
  } else {
    const match = input.match(/^(\d+)\s*[-–]\s*(\d+)$/);
    if (!match) {
      bot.sendMessage(chatId, msg.invalidInput('Use format: 12-24 or type "all".'), {
        parse_mode: 'MarkdownV2',
      });
      return;
    }

    const from = parseInt(match[1], 10);
    const to = parseInt(match[2], 10);

    if (from > to || from < 1) {
      bot.sendMessage(chatId, msg.invalidInput('Invalid range. "from" must be less than or equal to "to".'), {
        parse_mode: 'MarkdownV2',
      });
      return;
    }

    state.data.seatRange = { from, to };
  }

  state.step = STEPS.AWAITING_INTERVAL_UNIT;

  // Send interval selection with inline keyboard for unit selection
  bot.sendMessage(chatId, '⏱ *Step 6/6* — Do you want to enter the polling interval in *Seconds* or *Minutes*?', {
    parse_mode: 'MarkdownV2',
    reply_markup: {
      inline_keyboard: [
        [
          { text: '⏱ Seconds', callback_data: 'unit_seconds' },
          { text: '⏱ Minutes', callback_data: 'unit_minutes' },
        ],
      ],
    },
  });
}

// ── Update handlers ──────────────────────────────────────────

async function handleUpdateMenu(bot, chatId, text, state) {
  const choice = parseInt(text.trim(), 10);

  switch (choice) {
    case 1:
      // Show current rows and ask for new selection
      // We need to re-fetch rows for the category
      state.step = STEPS.UPDATE_ROWS;
      try {
        const tempPage = await createPage();
        state.data.tempPage = tempPage;
        const categories = await discoverLayout(tempPage, monitorManager.getMonitor(state.data.monitorId).url);
        const cat = categories.find(c => c.label === state.data.monitorStatus.category);
        if (cat && cat.rows) {
          state.data.availableRows = cat.rows;
          bot.sendMessage(chatId, msg.showRows(cat.rows), { parse_mode: 'MarkdownV2' });
        } else {
          bot.sendMessage(chatId, msg.invalidInput('Could not fetch rows.'), { parse_mode: 'MarkdownV2' });
          cancelWizard(chatId);
        }
      } catch (err) {
        bot.sendMessage(chatId, msg.invalidInput(`Error: ${err.message}`), { parse_mode: 'MarkdownV2' });
        cancelWizard(chatId);
      }
      break;
    case 2:
      state.step = STEPS.UPDATE_RANGE;
      bot.sendMessage(chatId, msg.askRange(), { parse_mode: 'MarkdownV2' });
      break;
    case 3:
      state.step = STEPS.UPDATE_INTERVAL;
      bot.sendMessage(
        chatId,
        `⏱ Enter new polling interval in seconds \\(e\\.g\\. 30, 60, 120\\):`,
        { parse_mode: 'MarkdownV2' }
      );
      break;
    case 4:
      cancelWizard(chatId);
      bot.sendMessage(chatId, `Update cancelled\\.`, { parse_mode: 'MarkdownV2' });
      break;
    default:
      bot.sendMessage(chatId, msg.invalidInput('Enter 1, 2, 3, or 4.'), { parse_mode: 'MarkdownV2' });
  }
}

async function handleUpdateRows(bot, chatId, text, state) {
  const input = text.trim().toLowerCase();
  const available = state.data.availableRows;
  let selectedRows;

  if (input === 'all') {
    selectedRows = [...available];
  } else {
    const nums = input.split(',').map((s) => parseInt(s.trim(), 10));
    const invalid = nums.some((n) => isNaN(n) || n < 1 || n > available.length);
    if (invalid) {
      bot.sendMessage(chatId, msg.invalidInput(`Enter numbers 1-${available.length}.`), {
        parse_mode: 'MarkdownV2',
      });
      return;
    }
    selectedRows = nums.map((n) => available[n - 1]);
  }

  monitorManager.updateMonitor(state.data.monitorId, { rows: selectedRows });

  // Cleanup temp page
  if (state.data.tempPage) {
    try { await state.data.tempPage.context().close(); } catch {}
  }

  cancelWizard(chatId);
  bot.sendMessage(
    chatId,
    `✅ *${msg.escapeMarkdown(state.data.monitorId)}* rows updated\\!`,
    { parse_mode: 'MarkdownV2' }
  );
}

async function handleUpdateRange(bot, chatId, text, state) {
  const input = text.trim().toLowerCase();
  let seatRange;

  if (input === 'all') {
    seatRange = null;
  } else {
    const match = input.match(/^(\d+)\s*[-–]\s*(\d+)$/);
    if (!match) {
      bot.sendMessage(chatId, msg.invalidInput('Use format: 12-24 or "all".'), { parse_mode: 'MarkdownV2' });
      return;
    }
    seatRange = { from: parseInt(match[1], 10), to: parseInt(match[2], 10) };
  }

  monitorManager.updateMonitor(state.data.monitorId, { seatRange });
  cancelWizard(chatId);
  bot.sendMessage(
    chatId,
    `✅ *${msg.escapeMarkdown(state.data.monitorId)}* seat range updated\\!`,
    { parse_mode: 'MarkdownV2' }
  );
}

async function handleUpdateInterval(bot, chatId, text, state) {
  const interval = parseInt(text.trim(), 10);
  if (isNaN(interval) || interval < 10) {
    bot.sendMessage(chatId, msg.invalidInput('Enter a number >= 10 seconds.'), { parse_mode: 'MarkdownV2' });
    return;
  }

  monitorManager.updateMonitor(state.data.monitorId, { pollingInterval: interval });
  cancelWizard(chatId);
  bot.sendMessage(
    chatId,
    `✅ *${msg.escapeMarkdown(state.data.monitorId)}* interval updated to ${interval}s\\!`,
    { parse_mode: 'MarkdownV2' }
  );
}

module.exports = {
  startWizard,
  startUpdateWizard,
  hasActiveWizard,
  cancelWizard,
  handleWizardMessage,
  handleUnitCallback,
  wizardStates,
};
