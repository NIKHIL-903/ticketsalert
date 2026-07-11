/**
 * All Telegram message templates.
 * Uses Markdown formatting for rich display.
 */

function welcomeMessage() {
  return (
    `🎬 *BMS Seat Alert Bot*\n\n` +
    `Monitor BookMyShow seat availability and get instant alerts when seats open up\\!\n\n` +
    `*Commands:*\n` +
    `/monitor — Start a new seat monitor\n` +
    `/list — List all active monitors\n` +
    `/status \\<id\\> — Status of a specific monitor\n` +
    `/update \\<id\\> — Update monitor preferences\n` +
    `/stop \\<id\\> — Stop a specific monitor\n` +
    `/stopall — Stop all monitors\n` +
    `/help — Show this help message`
  );
}

function askUrl() {
  return `📎 *Step 2/6* — Paste the BookMyShow *seat layout URL*:`;
}

function fetchingInfo() {
  return `🔍 Scanning seat layout\\.\\.\\. Please wait\\.`;
}

function showCategories(categories) {
  let msg = `📂 *Step 3/6* — Select a *seat category*:\n\n`;
  categories.forEach((cat, i) => {
    msg += `*${i + 1}\\.* ${escapeMarkdown(cat.label)}\n`;
  });
  msg += `\nReply with the *number*:`;
  return msg;
}

function showRows(rows) {
  let msg = `🪑 *Step 4/6* — Select *rows* to monitor:\n\n`;
  rows.forEach((row, i) => {
    msg += `*${i + 1}\\.* ${escapeMarkdown(row.label)}\n`;
  });
  msg += `\nReply with numbers \\(comma\\-separated\\), letters, a range \\(e\\.g\\. M\\-P or 1\\-3\\), or *all*\nExample: \`1,2,3\`, \`M\\-P\`, or \`all\``;
  return msg;
}

function askRange() {
  return (
    `📍 *Step 5/6* — Enter *seat range* \\(inclusive\\):\n\n` +
    `Example: \`12\\-24\` for seats 12 to 24\n` +
    `Or type \`all\` for all seats in the row\\.`
  );
}

function askInterval() {
  return `⏱ *Step 6/6* — Select *polling interval*:`;
}

function monitorStarted(monitorId, name, category, rows, seatRange, interval) {
  const rowNames = rows.map((r) => {
    const letter = r.label.split('Row ').pop() || r.label;
    return letter;
  });
  const rangeStr = seatRange
    ? `${seatRange.from}–${seatRange.to}`
    : 'All seats';

  return (
    `✅ *Monitor ${escapeMarkdown(name)} \\(${escapeMarkdown(monitorId)}\\) started\\!*\n\n` +
    `📂 Category: ${escapeMarkdown(category)}\n` +
    `🪑 Rows: ${escapeMarkdown(rowNames.join(', '))}\n` +
    `📍 Range: ${escapeMarkdown(rangeStr)}\n` +
    `⏱ Interval: ${interval}s\n\n` +
    `_Monitoring is active\\. You'll receive alerts when new seats open up\\._`
  );
}

function seatAlert(data) {
  const { monitorId, name, url, category, seatRange, alerts, timestamp } = data;
  const rangeStr = seatRange
    ? `${seatRange.from}–${seatRange.to}`
    : 'All';
  const time = timestamp.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });

  let msg =
    `🚨 *SEAT ALERT — ${escapeMarkdown(name || monitorId)} \\(${escapeMarkdown(monitorId)}\\)*\n\n` +
    `📂 ${escapeMarkdown(category)}\n` +
    `📍 Range: ${escapeMarkdown(rangeStr)}\n\n`;

  for (const alert of alerts) {
    const seatList = alert.newSeats.join(', ');
    msg += `🟢 *Row ${escapeMarkdown(alert.rowLabel)}* — ${alert.newSeats.length} new seat\\(s\\): ${escapeMarkdown(seatList)}\n`;
    msg += `   Total available: ${alert.totalAvailable}\n\n`;
  }

  msg += `🔗 [Open Seat Layout](${url})\n`;
  msg += `⏱ _${escapeMarkdown(time)}_`;

  return msg;
}

function monitorList(monitors) {
  if (monitors.length === 0) {
    return `📋 No active monitors\\. Use /monitor to create one\\.`;
  }

  let msg = `📋 *Active Monitors \\(${monitors.length}\\)*\n\n`;

  for (const m of monitors) {
    const rowNames = m.rows.map((r) => {
      if (typeof r === 'string') return r;
      const letter = r.split('Row ').pop() || r;
      return letter;
    });
    const rangeStr = m.seatRange
      ? `${m.seatRange.from}–${m.seatRange.to}`
      : 'All';

    msg +=
      `*${escapeMarkdown(m.id)}* \\- *${escapeMarkdown(m.name || m.id)}* ${m.isRunning ? '🟢' : '🔴'}\n` +
      `  📂 ${escapeMarkdown(m.category)}\n` +
      `  🪑 Rows: ${escapeMarkdown(rowNames.join(', '))}\n` +
      `  📍 Range: ${escapeMarkdown(rangeStr)}\n` +
      `  ⏱ Every ${m.pollingInterval}s \\| ${m.pollCount} polls\n\n`;
  }

  return msg;
}

function monitorStatus(m) {
  const rowNames = m.rows.map((r) => {
    if (typeof r === 'string') return r;
    const letter = r.split('Row ').pop() || r;
    return letter;
  });
  const rangeStr = m.seatRange
    ? `${m.seatRange.from}–${m.seatRange.to}`
    : 'All';
  const lastPoll = m.lastPollTime
    ? m.lastPollTime.toLocaleTimeString('en-IN')
    : 'Never';
  const created = m.createdAt.toLocaleTimeString('en-IN');

  return (
    `📊 *Monitor ${escapeMarkdown(m.name || m.id)} \\(${escapeMarkdown(m.id)}\\)* ${m.isRunning ? '🟢 Running' : '🔴 Stopped'}\n\n` +
    `📂 Category: ${escapeMarkdown(m.category)}\n` +
    `🪑 Rows: ${escapeMarkdown(rowNames.join(', '))}\n` +
    `📍 Range: ${escapeMarkdown(rangeStr)}\n` +
    `⏱ Interval: ${m.pollingInterval}s\n` +
    `📈 Polls completed: ${m.pollCount}\n` +
    `🕐 Last poll: ${escapeMarkdown(lastPoll)}\n` +
    `⚠️ Consecutive errors: ${m.consecutiveErrors}\n` +
    `📅 Created: ${escapeMarkdown(created)}`
  );
}

function monitorStopped(id) {
  return `🛑 Monitor *${escapeMarkdown(id)}* stopped and removed\\.`;
}

function allStopped(count) {
  return `🛑 Stopped *${count}* monitor\\(s\\)\\.`;
}

function errorAlert(monitorId, name, errorMsg) {
  return (
    `⚠️ *Error in ${escapeMarkdown(name || monitorId)} \\(${escapeMarkdown(monitorId)}\\)*\n\n` +
    `${escapeMarkdown(errorMsg)}\n\n` +
    `_Monitor will keep retrying\\. Use /stop ${escapeMarkdown(monitorId)} to stop it\\._`
  );
}


function notFound(id) {
  return `❌ Monitor *${escapeMarkdown(id)}* not found\\. Use /list to see active monitors\\.`;
}

function unauthorized() {
  return `🚫 You are not authorized to use this bot\\.`;
}

function invalidInput(hint) {
  return `❌ Invalid input\\. ${escapeMarkdown(hint)}`;
}

function updatePrompt(m) {
  return (
    `🔧 *Update ${escapeMarkdown(m.id)}*\n\n` +
    `What do you want to change?\n\n` +
    `1\\. Rows\n` +
    `2\\. Seat range\n` +
    `3\\. Polling interval\n` +
    `4\\. Cancel\n\n` +
    `Reply with the *number*:`
  );
}

/**
 * Escape special MarkdownV2 characters.
 */
function escapeMarkdown(text) {
  if (typeof text !== 'string') text = String(text);
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

module.exports = {
  welcomeMessage,
  askUrl,
  fetchingInfo,
  showCategories,
  showRows,
  askRange,
  askInterval,
  monitorStarted,
  seatAlert,
  monitorList,
  monitorStatus,
  monitorStopped,
  allStopped,
  errorAlert,
  notFound,
  unauthorized,
  invalidInput,
  updatePrompt,
  escapeMarkdown,
};
