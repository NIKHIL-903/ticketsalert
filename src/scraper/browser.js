const { chromium } = require('playwright');
const logger = require('../logger');

let browser = null;
let idleTimer = null;

/**
 * Launch a shared Playwright browser instance with stealth-like settings.
 */
async function launchBrowser() {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }

  if (browser && browser.isConnected()) {
    return browser;
  }

  logger.info('Launching browser...');

  browser = await chromium.launch({
    headless: true,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
    ],
  });

  browser.on('disconnected', () => {
    logger.warn('Browser disconnected');
    browser = null;
  });

  logger.info('Browser launched successfully');
  return browser;
}

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36'
];

const VIEWPORTS = [
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 1536, height: 864 }
];

/**
 * Create a new page (tab) in the shared browser with stealth settings.
 */
async function createPage() {
  if (!browser || !browser.isConnected()) {
    await launchBrowser();
  }

  const userAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
  const viewport = VIEWPORTS[Math.floor(Math.random() * VIEWPORTS.length)];

  const context = await browser.newContext({
    userAgent,
    viewport,
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
    extraHTTPHeaders: {
      'Accept-Language': 'en-IN,en-GB;q=0.9,en-US;q=0.8,en;q=0.7',
      'sec-ch-ua': '"Google Chrome";v="' + userAgent.match(/Chrome\/(\d+)/)[1] + '", "Chromium";v="' + userAgent.match(/Chrome\/(\d+)/)[1] + '", "Not_A Brand";v="24"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': userAgent.includes('Macintosh') ? '"macOS"' : '"Windows"',
      'Upgrade-Insecure-Requests': '1'
    }
  });

  context.on('close', () => {
    closeBrowserIfIdle();
  });

  // Remove webdriver flag to avoid detection
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    // Pass standard languages
    Object.defineProperty(navigator, 'languages', { get: () => ['en-IN', 'en-US', 'en'] });
    // Pass standard plugins list
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
  });

  const page = await context.newPage();
  return page;
}

/**
 * Close the shared browser instance.
 */
async function closeBrowser() {
  if (browser) {
    logger.info('Closing browser...');
    await browser.close();
    browser = null;
    logger.info('Browser closed');
  }
}

/**
 * Automatically close the shared browser if there are no active contexts left,
 * using a short debounce to handle rapid sequential/overlapping calls.
 */
async function closeBrowserIfIdle() {
  if (idleTimer) {
    clearTimeout(idleTimer);
  }

  idleTimer = setTimeout(async () => {
    idleTimer = null;
    if (browser && browser.isConnected()) {
      const contexts = browser.contexts();
      if (contexts.length === 0) {
        logger.info('No active pages/contexts, closing shared browser to save resources.');
        await closeBrowser();
      }
    }
  }, 5000); // 5 seconds debounce
}

module.exports = { launchBrowser, createPage, closeBrowser, closeBrowserIfIdle };
