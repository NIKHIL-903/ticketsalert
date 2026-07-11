const SELECTORS = require('./selectors');
const logger = require('../logger');

/**
 * Sleep helper for human-like pauses.
 * @param {number} min - Minimum ms
 * @param {number} max - Maximum ms
 */
async function delay(min = 500, max = 1500) {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Click an element simulating human mouse hover and delay.
 * Falls back immediately to JS click if blocked/timed out.
 * @param {import('playwright').Page} page
 * @param {string|import('playwright').ElementHandle} selectorOrElement
 */
async function humanClick(page, selectorOrElement) {
  const element = typeof selectorOrElement === 'string'
    ? await page.waitForSelector(selectorOrElement, { state: 'visible', timeout: 4000 })
    : selectorOrElement;

  if (!element) throw new Error(`Element not found: ${selectorOrElement}`);

  try {
    // Hover first to simulate mouse cursor tracking
    await element.hover({ timeout: 1000 });
    await delay(80, 180);

    // Perform click
    await element.click({ timeout: 1500 });
    await delay(100, 250);
  } catch (err) {
    logger.debug(`Playwright human click failed/timed out: ${err.message}. Falling back to JS click.`);
    await page.evaluate((el) => {
      if (el) el.click();
    }, element);
    await delay(100, 250);
  }
}

/**
 * Select an option in a dropdown simulating human hover.
 * Falls back to JS select on timeout.
 * @param {import('playwright').Page} page
 * @param {string} selector
 * @param {string} value
 */
async function humanSelectOption(page, selector, value) {
  const select = await page.waitForSelector(selector, { state: 'visible', timeout: 5000 });
  if (!select) throw new Error(`Dropdown not found: ${selector}`);

  try {
    await select.hover({ timeout: 1000 });
    await delay(50, 150);
    await page.selectOption(selector, value, { timeout: 1500 });
    await delay(150, 400);
  } catch (err) {
    logger.debug(`Playwright select option failed/timed out: ${err.message}. Falling back to JS selection.`);
    await page.evaluate(({ sel, val }) => {
      const el = document.querySelector(sel);
      if (el) {
        el.value = val;
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }, { sel: selector, val: value });
    await delay(100, 250);
  }
}

/**
 * Dismiss the "How many seats?" popup that appears on page load.
 * Uses multiple strategies to ensure the popup is fully dismissed.
 *
 * @param {import('playwright').Page} page
 */
async function dismissSeatCountPopup(page) {
  try {
    // Wait for the "Select Seats" button — the clearest indicator the popup is showing
    const selectBtn = await page.waitForSelector(SELECTORS.SELECT_SEATS_BTN, { timeout: 5000 });
    if (!selectBtn) return;

    logger.info('Seat count popup detected');
    await delay(200, 500);

    // Try clicking the highest quantity button using force (slider can intercept normal clicks)
    for (let q = 6; q >= 1; q--) {
      const btn = await page.$(`${SELECTORS.SEAT_COUNT_BUTTON_PREFIX}${q}`);
      if (btn) {
        try {
          await humanClick(page, btn);
          logger.info(`Selected ${q} seat(s) in popup`);
        } catch {
          // Use JS click as fallback
          await page.evaluate((sel) => {
            const el = document.querySelector(sel);
            if (el) el.click();
          }, `${SELECTORS.SEAT_COUNT_BUTTON_PREFIX}${q}`);
          logger.info(`Selected ${q} seat(s) via JS click`);
          await delay(200, 400);
        }
        break;
      }
    }

    await delay(150, 400);

    // Click "Select Seats" button
    try {
      await humanClick(page, SELECTORS.SELECT_SEATS_BTN);
      logger.info('Clicked "Select Seats" button');
    } catch {
      // Fallback: JS click
      await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (el) el.click();
      }, SELECTORS.SELECT_SEATS_BTN);
      logger.info('Clicked "Select Seats" via JS click');
      await delay(200, 500);
    }

    // Wait for the popup to actually disappear
    try {
      await page.waitForSelector(SELECTORS.SELECT_SEATS_BTN, {
        state: 'hidden',
        timeout: 10000,
      });
      logger.info('Seat count popup dismissed');
    } catch {
      logger.warn('Popup may still be visible — continuing anyway');
    }

    await delay(400, 800);
  } catch (err) {
    // Popup might not appear (e.g., on subsequent loads) — safe to continue
    logger.info(`Seat count popup not found or already dismissed: ${err.message}`);
  }
}

/**
 * Dismiss any overlay/bottom-sheet that might be blocking clicks.
 *
 * @param {import('playwright').Page} page
 */
async function dismissOverlays(page) {
  try {
    // Try clicking the bottom sheet close overlay
    const bottomSheet = await page.$(SELECTORS.BOTTOM_SHEET_CLOSE);
    if (bottomSheet) {
      const isVisible = await bottomSheet.isVisible();
      if (isVisible) {
        await humanClick(page, bottomSheet);
        logger.info('Dismissed bottom sheet overlay');
      }
    }
  } catch {
    // Ignore — overlay may not exist
  }
}

/**
 * Navigate to the BMS seat layout URL and open the accessibility modal.
 * Handles the initial seat count popup, then opens accessibility panel.
 *
 * @param {import('playwright').Page} page
 * @param {string} url - BMS seat layout URL
 */
async function openModalAndSetup(page, url) {
  // Initial human delay before navigation (anti-bot protection)
  await delay(200, 800);

  logger.info(`Navigating to: ${url}`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

  // Handle the "How many seats?" popup first
  await dismissSeatCountPopup(page);

  // Dismiss any overlays/bottom sheets that might block clicks
  await dismissOverlays(page);

  // Wait for the accessibility button to appear
  await page.waitForSelector(SELECTORS.OPEN_MODAL, { timeout: 20000 });
  await delay(200, 500);

  // Click the accessibility button
  try {
    await humanClick(page, SELECTORS.OPEN_MODAL);
  } catch {
    logger.warn('Normal click failed, trying force click');
    await page.click(SELECTORS.OPEN_MODAL, { force: true });
    await delay(200, 500);
  }
  logger.info('Clicked accessibility button');

  // Wait for the modal's quantity dropdown to appear
  await page.waitForSelector(SELECTORS.QUANTITY_SELECT, { timeout: 20000 });
  await delay(150, 400);

  // Select 6 tickets (maximum) to see all seats
  await humanSelectOption(page, SELECTORS.QUANTITY_SELECT, '6');
  logger.info('Selected 6 tickets in accessibility modal');
}

/**
 * Read all available seat categories from the category dropdown.
 *
 * @param {import('playwright').Page} page
 * @returns {Promise<Array<{value: string, label: string}>>}
 */
async function getCategories(page) {
  const categories = await page.$$eval(
    `${SELECTORS.CATEGORY_SELECT} option`,
    (options) =>
      options
        .filter((opt) => opt.value !== '')
        .map((opt) => ({ value: opt.value, label: opt.textContent.trim() }))
  );
  logger.info(`Found ${categories.length} categories`);
  return categories;
}

/**
 * Select a category and read all available rows for it.
 *
 * @param {import('playwright').Page} page
 * @param {string} categoryValue - The value attribute of the category option
 * @returns {Promise<Array<{value: string, label: string}>>}
 */
async function getRowsForCategory(page, categoryValue) {
  await humanSelectOption(page, SELECTORS.CATEGORY_SELECT, categoryValue);

  const rows = await page.$$eval(
    `${SELECTORS.ROW_SELECT} option`,
    (options) =>
      options
        .filter((opt) => opt.value !== '')
        .map((opt) => ({ value: opt.value, label: opt.textContent.trim() }))
  );
  logger.info(`Found ${rows.length} rows for category ${categoryValue}`);
  return rows;
}

/**
 * Read the list of rows currently available in the row dropdown.
 * Rows that are fully sold out are removed from this dropdown by BMS.
 *
 * @param {import('playwright').Page} page
 * @returns {Promise<Set<string>>} Set of row values present in the dropdown
 */
async function getAvailableRowValues(page) {
  const rowValues = await page.$$eval(
    `${SELECTORS.ROW_SELECT} option`,
    (options) => options.map((opt) => opt.value).filter((v) => v !== '')
  );
  return new Set(rowValues);
}

/**
 * Select a row and read the seat statuses from the table.
 * Returns null if the row doesn't exist in the dropdown (fully sold out).
 *
 * @param {import('playwright').Page} page
 * @param {string} rowValue - The value attribute of the row option (e.g. "GOLD.-P")
 * @param {Set<string>} availableRowValues - Set of row values present in the dropdown
 * @returns {Promise<Array<{number: string, status: string}> | null>} null if row is unavailable
 */
async function getSeatsForRow(page, rowValue, availableRowValues) {
  // If the row is not in the dropdown, it's fully sold out
  if (availableRowValues && !availableRowValues.has(rowValue)) {
    logger.info(`Row ${rowValue}: not present in dropdown (fully sold out / unavailable)`);
    return null;
  }

  await humanSelectOption(page, SELECTORS.ROW_SELECT, rowValue);

  // Wait for the seat table with this specific row's data
  const tableSelector = `table[role="grid"][aria-label="Seats for Row ${rowValue}"]`;
  await page.waitForSelector(tableSelector, { timeout: 10000 });
  await delay(150, 300);

  const seats = await page.$$eval(`${tableSelector} tbody tr`, (rows) =>
    rows.map((row) => {
      const cells = row.querySelectorAll('td');
      return {
        number: cells[0] ? cells[0].textContent.trim() : '',
        status: cells[1] ? cells[1].textContent.trim() : '',
      };
    })
  );

  logger.info(`Row ${rowValue}: ${seats.length} seats found`);
  return seats;
}

/**
 * Close the accessibility modal.
 *
 * @param {import('playwright').Page} page
 */
async function closeModal(page) {
  try {
    const closeBtn = await page.$(SELECTORS.CLOSE_MODAL);
    if (closeBtn) {
      await humanClick(page, closeBtn);
      logger.info('Modal closed');
    }
  } catch (err) {
    // Modal might already be closed — safe to ignore
    logger.warn('Could not close modal (may already be closed)');
  }
}

/**
 * Full discovery scan: navigate to URL, open modal, read all categories and their rows.
 * Used during the setup wizard.
 *
 * @param {import('playwright').Page} page
 * @param {string} url
 * @returns {Promise<Array<{value: string, label: string, rows: Array<{value: string, label: string}>}>>}
 */
async function discoverLayout(page, url) {
  await openModalAndSetup(page, url);

  const categories = await getCategories(page);

  // For each category, read its rows
  for (const cat of categories) {
    cat.rows = await getRowsForCategory(page, cat.value);
  }

  await closeModal(page);
  return categories;
}

/**
 * Read the full list of row objects currently in the row dropdown.
 * Used when allRows=true to dynamically discover rows each poll cycle.
 *
 * @param {import('playwright').Page} page
 * @returns {Promise<Array<{value: string, label: string}>>}
 */
async function getCurrentRows(page) {
  const rows = await page.$$eval(
    `${SELECTORS.ROW_SELECT} option`,
    (options) =>
      options
        .filter((opt) => opt.value !== '')
        .map((opt) => ({ value: opt.value, label: opt.textContent.trim() }))
  );
  return rows;
}

/**
 * Poll scan: navigate to URL, open modal, select category, read seats for rows.
 * Used during monitoring poll cycles.
 *
 * When allRows=true, rows are discovered dynamically from the dropdown each cycle
 * (so new rows added by BMS are automatically picked up).
 * When allRows=false, only the specific rows in the `rows` array are checked.
 *
 * @param {import('playwright').Page} page
 * @param {string} url
 * @param {string} categoryValue
 * @param {Array<{value: string, label: string}>} rows - Rows to scan (used when allRows=false)
 * @param {boolean} [allRows=false] - If true, dynamically discover rows from dropdown
 * @returns {Promise<{seats: Map, unavailableRows: Array, scannedRows: Array}>}
 */
async function pollSeats(page, url, categoryValue, rows, allRows = false) {
  await openModalAndSetup(page, url);

  // Select the category
  await humanSelectOption(page, SELECTORS.CATEGORY_SELECT, categoryValue);

  // Determine which rows to scan
  let rowsToScan;
  if (allRows) {
    // Dynamically read all rows currently in the dropdown
    rowsToScan = await getCurrentRows(page);
    logger.info(`Dynamic row discovery (allRows): found ${rowsToScan.length} row(s): [${rowsToScan.map(r => r.value).join(', ')}]`);
  } else {
    rowsToScan = rows;
  }

  // Read which rows are actually present in the dropdown (for fixed-list checks)
  const availableRowValues = allRows
    ? new Set(rowsToScan.map(r => r.value))
    : await getAvailableRowValues(page);

  if (!allRows) {
    logger.info(`Dropdown has ${availableRowValues.size} row(s): [${[...availableRowValues].join(', ')}]`);
  }

  const result = new Map();
  const unavailableRows = [];

  for (const row of rowsToScan) {
    const seats = await getSeatsForRow(page, row.value, availableRowValues);
    if (seats === null) {
      unavailableRows.push(row);
      result.set(row.value, []);
    } else {
      result.set(row.value, seats);
    }
  }

  await closeModal(page);
  return { seats: result, unavailableRows, scannedRows: rowsToScan };
}

module.exports = {
  openModalAndSetup,
  getCategories,
  getRowsForCategory,
  getSeatsForRow,
  getAvailableRowValues,
  getCurrentRows,
  closeModal,
  discoverLayout,
  pollSeats,
};
