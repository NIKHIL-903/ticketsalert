const { pollSeats, closeModal } = require('../scraper/scraper');
const { createPage } = require('../scraper/browser');
const logger = require('../logger');

class Monitor {
  /**
   * @param {object} config
   * @param {string} config.id - Unique monitor ID (e.g. "MON-1")
   * @param {string} config.url - BMS seat layout URL
   * @param {{value: string, label: string}} config.category - Selected category
   * @param {Array<{value: string, label: string}>} config.rows - Selected rows
   * @param {{from: number, to: number} | null} config.seatRange - Seat range (null = all)
   * @param {number} config.pollingInterval - Polling interval in seconds
   * @param {function} config.onAlert - Callback when new seats are found
   * @param {function} config.onError - Callback on persistent errors
   */
   constructor({ id, name, url, category, rows, allRows, seatRange, pollingInterval, onAlert, onError, isResumed = false }) {
    this.id = id;
    this.name = name || id;
    this.url = url;
    this.category = category;
    this.rows = rows;
    this.allRows = allRows || false;
    this.seatRange = seatRange;
    this.pollingInterval = pollingInterval;
    this.onAlert = onAlert;
    this.onError = onError;
    this.isResumed = isResumed;

    // State tracking
    this.previousState = new Map(); // rowValue -> Set of available seat numbers
    this.isRunning = false;
    this.page = null; // Stored temporarily during active poll
    this.timer = null;
    this.consecutiveErrors = 0;
    this.pollCount = 0;
    this.lastPollTime = null;
    this.createdAt = new Date();
  }

  /**
   * Start the monitor polling loop.
   */
  async start() {
    this.isRunning = true;
    logger.info(`[${this.id}] Monitor "${this.name}" started — polling every ${this.pollingInterval}s`);
    this._schedulePoll(0); // first poll immediately
  }

  /**
   * Stop the monitor and close its page.
   */
  async stop() {
    this.isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.page) {
      try {
        await this.page.context().close();
      } catch {}
      this.page = null;
    }
    logger.info(`[${this.id}] Monitor "${this.name}" stopped`);
  }

  /**
   * Update monitor preferences without stopping.
   * Clears previous state to avoid false alerts.
   */
  updatePreferences({ rows, allRows, seatRange, pollingInterval }) {
    if (rows !== undefined) this.rows = rows;
    if (allRows !== undefined) this.allRows = allRows;
    if (seatRange !== undefined) this.seatRange = seatRange;
    if (pollingInterval !== undefined) this.pollingInterval = pollingInterval;

    // Reset state when rows/range/allRows change to avoid false alerts
    if (rows !== undefined || seatRange !== undefined || allRows !== undefined) {
      this.previousState.clear();
      logger.info(`[${this.id}] Preferences updated, state reset`);
    } else {
      logger.info(`[${this.id}] Polling interval updated to ${this.pollingInterval}s`);
    }
  }

  /**
   * Get current status summary.
   */
  getStatus() {
    return {
      id: this.id,
      name: this.name,
      url: this.url,
      category: this.category.label,
      rows: this.rows.map((r) => r.label),
      seatRange: this.seatRange,
      pollingInterval: this.pollingInterval,
      isRunning: this.isRunning,
      pollCount: this.pollCount,
      lastPollTime: this.lastPollTime,
      consecutiveErrors: this.consecutiveErrors,
      createdAt: this.createdAt,
    };
  }

  // ── Private methods ──────────────────────────────────────────

  _schedulePoll(delayMs) {
    if (!this.isRunning) return;
    this.timer = setTimeout(() => this._poll(), delayMs);
  }

  async _poll() {
    if (!this.isRunning) return;

    let page = null;
    try {
      logger.info(`[${this.id}] Polling... (cycle #${this.pollCount + 1})`);

      // Allocate fresh page and context for clean slate
      page = await createPage();
      this.page = page;

      // Scrape seats for all monitored rows
      // When allRows=true, pollSeats dynamically discovers rows from the dropdown
      const { seats: seatData, unavailableRows, scannedRows } = await pollSeats(
        page,
        this.url,
        this.category.value,
        this.rows,
        this.allRows
      );

      // Use scannedRows for iteration (dynamic rows when allRows=true, fixed list otherwise)
      const rowsToProcess = this.allRows ? scannedRows : this.rows;

      // ── Log unavailable rows (only relevant when allRows=false) ──
      if (unavailableRows.length > 0) {
        const soldOutLabels = unavailableRows.map(r => r.label);
        logger.info(`[${this.id}] Rows not in dropdown this cycle (unavailable): ${soldOutLabels.join(', ')}`);
      }

      const alerts = [];

      for (const row of rowsToProcess) {
        const seats = seatData.get(row.value) || [];

        // Filter by seat range
        const filtered = this._filterByRange(seats);

        // Get currently available seat numbers
        const currentAvailable = new Set(
          filtered.filter((s) => s.status === 'Available').map((s) => s.number)
        );

        // Get previously available seat numbers for this row
        const prevAvailable = this.previousState.get(row.value) || new Set();

        // Find newly available seats (in current but NOT in previous)
        const newlyAvailable = [...currentAvailable].filter(
          (s) => !prevAvailable.has(s)
        );

        if (newlyAvailable.length > 0) {
          // Extract row letter from label (e.g. "GOLD. Row P" → "P")
          const rowLetter = row.label.split('Row ').pop() || row.label;
          alerts.push({
            rowLabel: rowLetter,
            rowValue: row.value,
            newSeats: newlyAvailable.sort(),
            totalAvailable: currentAvailable.size,
          });
        }

        // Update previous state
        this.previousState.set(row.value, currentAvailable);
      }

      // Fire alert callback if new seats found
      // Resume monitors skip the first poll cycle to establish the baseline silently.
      // Newly created monitors notify immediately on the first cycle.
      const shouldNotify = !this.isResumed || this.pollCount > 0;
      if (alerts.length > 0 && shouldNotify) {
        this.onAlert({
          monitorId: this.id,
          name: this.name,
          url: this.url,
          category: this.category.label,
          seatRange: this.seatRange,
          alerts,
          timestamp: new Date(),
        });
      }

      this.consecutiveErrors = 0;
      this.pollCount++;
      this.lastPollTime = new Date();
    } catch (error) {
      this.consecutiveErrors++;
      logger.error(`[${this.id}] Poll error (${this.consecutiveErrors}x): ${error.message}`);

      let screenshotPath = null;
      let failureReason = 'Unknown error';

      if (page) {
        try {
          failureReason = await determineFailureReason(page, error);
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          screenshotPath = `screenshots/error-${this.id}-${timestamp}.png`;
          await page.screenshot({ path: screenshotPath, timeout: 5000 });
          logger.info(`[${this.id}] Error screenshot saved to ${screenshotPath}`);
        } catch (screenshotErr) {
          logger.error(`[${this.id}] Failed to capture error details: ${screenshotErr.message}`);
        }
      } else {
        failureReason = `Browser/Page context allocation failed: ${error.message}`;
      }

      // Notify user after 5 consecutive failures
      if (this.consecutiveErrors >= 5 && this.consecutiveErrors % 5 === 0) {
        this.onError({
          monitorId: this.id,
          name: this.name,
          error: `${this.consecutiveErrors} consecutive errors. Last: ${error.message}\n\nPossible cause: ${failureReason}`,
          screenshotPath,
        });
      }
    } finally {
      // Clean up the page context for this cycle
      if (page) {
        try {
          await page.context().close();
        } catch {}
      }
      this.page = null;
    }

    // Schedule next poll
    this._schedulePoll(this.pollingInterval * 1000);
  }

  _filterByRange(seats) {
    if (!this.seatRange) return seats;
    return seats.filter((s) => {
      const num = parseInt(s.number, 10);
      return num >= this.seatRange.from && num <= this.seatRange.to;
    });
  }
}

/**
 * Diagnose the failure by looking at the page title, content, or the error message.
 * @param {import('playwright').Page} page
 * @param {Error} error
 * @returns {Promise<string>}
 */
async function determineFailureReason(page, error) {
  const errMsg = error.message || '';
  try {
    const title = await page.title();
    const content = await page.content();

    if (title.includes('Just a moment') || content.includes('cloudflare') || content.includes('ddos') || content.includes('captcha')) {
      return 'Blocked by Cloudflare anti-bot verification screen.';
    }

    if (title.includes('Access Denied') || content.includes('Access Denied') || content.includes('403 Forbidden')) {
      return 'Access Denied (403 Forbidden). BookMyShow blocked the request.';
    }

    if (errMsg.includes('Open accessibility seat selection')) {
      return 'Accessibility seat selection button not found. The seat layout page did not load fully, or layout changed.';
    }

    if (errMsg.includes('QUANTITY_SELECT') || errMsg.includes('quantity-select')) {
      return 'Modal quantity selection dropdown not found. The accessibility modal failed to open.';
    }

    if (errMsg.includes('table[role="grid"]') || errMsg.includes('Seats for Row')) {
      return 'Seat table grid not found. Selector select option might have failed or selected row is invalid.';
    }

    if (errMsg.includes('net::ERR') || errMsg.includes('Network')) {
      return 'Network connection issue or host is unreachable.';
    }

    if (errMsg.includes('Timeout')) {
      return 'Browser operation timed out. (Slow network or element failed to render).';
    }

    return `Unspecified automation failure (${errMsg})`;
  } catch (err) {
    return `Page state inaccessible: ${err.message}. (Browser context might have crashed/closed)`;
  }
}

module.exports = Monitor;
