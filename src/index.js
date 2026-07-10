const config = require('./config');
const { launchBrowser, closeBrowser } = require('./scraper/browser');
const { startBot, stopBot } = require('./bot/bot');
const monitorManager = require('./monitor/manager');
const logger = require('./logger');

async function main() {
  logger.info('========================================');
  logger.info('  BMS Seat Alert Bot — Starting...');
  logger.info('========================================');
  logger.info(`Allowed users: ${config.allowedUsers.join(', ')}`);

  // Launch shared browser
  await launchBrowser();

  // Start Telegram bot
  const bot = startBot();

  // Load and resume monitors from storage
  await monitorManager.loadAndResumeMonitors(bot);

  logger.info('Bot is ready! Send /start on Telegram to begin.');
}

// ── Graceful shutdown ────────────────────────────────────────

async function shutdown(signal) {
  logger.info(`\n${signal} received. Shutting down gracefully...`);

  // Cleanup active monitor resources without clearing configuration from disk
  const count = await monitorManager.cleanup();
  logger.info(`Cleaned up ${count} active monitor resources`);

  // Stop bot
  stopBot();

  // Close browser
  await closeBrowser();

  logger.info('Goodbye!');
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Handle uncaught errors
process.on('uncaughtException', (err) => {
  logger.error(`Uncaught exception: ${err.message}`);
  logger.error(err.stack);
});

process.on('unhandledRejection', (err) => {
  logger.error(`Unhandled rejection: ${err.message || err}`);
});

// Start the application
main().catch((err) => {
  logger.error(`Fatal error: ${err.message}`);
  process.exit(1);
});
