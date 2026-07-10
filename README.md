# BMS Seat Alert Bot

Monitor BookMyShow seat availability and get instant Telegram alerts when new seats open up.

## How It Works

1. Paste a BMS seat layout URL
2. The bot opens the **Accessibility Seat Selection** modal via Playwright
3. It reads seat statuses (Available/Booked) for your selected rows and range
4. When new seats become available, you get an instant Telegram alert

## Prerequisites

- **Node.js** v18 or higher
- **Telegram Bot Token** — get one from [@BotFather](https://t.me/BotFather)
- **Your Telegram User ID** — get it from [@userinfobot](https://t.me/userinfobot)

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Install Playwright browsers

```bash
npx playwright install chromium
```

### 3. Configure environment

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

Edit `.env`:
```
BOT_TOKEN=your_telegram_bot_token_here
ALLOWED_USERS=123456789,987654321
```

### 4. Start the bot

```bash
npm start
```

## Telegram Commands

| Command | Description |
|---|---|
| `/start` | Welcome message + help |
| `/monitor` | Start new monitor setup wizard |
| `/list` | List all active monitors |
| `/status MON-1` | Detailed status of a monitor |
| `/update MON-1` | Update monitor preferences |
| `/stop MON-1` | Stop a specific monitor |
| `/stopall` | Stop all monitors |
| `/cancel` | Cancel current setup wizard |
| `/help` | Show help message |

## Monitor Setup Flow

1. `/monitor` — starts the wizard
2. Paste the BMS seat layout URL
3. Select seat category (e.g., GOLD, SILVER)
4. Select rows to monitor (comma-separated or "all")
5. Enter seat range (e.g., `12-24`) or "all"
6. Select polling interval (30s / 60s / 120s / 300s)

## Alert Example

When new seats open up, you'll receive:
```
🚨 SEAT ALERT — MON-1

📂 GOLD. - ₹295.00
📍 Range: 12–24

🟢 Row P — 3 new seat(s): 14, 18, 22
   Total available: 5

🟢 Row Q — 2 new seat(s): 12, 15
   Total available: 2

🔗 Open Seat Layout
⏱ 6:45:30 PM
```

## Project Structure

```
src/
├── index.js              # Entry point
├── config.js             # Environment config
├── logger.js             # Winston logger
├── bot/
│   ├── bot.js            # Telegram bot + command routing
│   ├── setupWizard.js    # Conversational setup wizard
│   └── messages.js       # Message templates
├── scraper/
│   ├── browser.js        # Playwright browser management
│   ├── scraper.js        # Core scraping logic
│   └── selectors.js      # BMS DOM selectors
└── monitor/
    ├── monitor.js        # Single monitor (poll loop + diff)
    └── manager.js        # Monitor manager (create/stop/list)
```
