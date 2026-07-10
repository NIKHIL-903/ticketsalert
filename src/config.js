require('dotenv').config();

const config = {
  botToken: process.env.BOT_TOKEN,
  allowedUsers: (process.env.ALLOWED_USERS || '')
    .split(',')
    .map(id => id.replace(/\D/g, '').trim())
    .filter(Boolean)
    .map(Number),
};

// Validate required config
if (!config.botToken || config.botToken === 'your_telegram_bot_token_here') {
  console.error('ERROR: BOT_TOKEN is not set in .env file');
  process.exit(1);
}

if (config.allowedUsers.length === 0) {
  console.error('ERROR: ALLOWED_USERS is not set in .env file');
  process.exit(1);
}

module.exports = config;
