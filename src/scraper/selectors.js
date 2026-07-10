/**
 * All BMS DOM selectors centralized in one place.
 * If BMS changes their HTML structure, only this file needs updating.
 */
const SELECTORS = {
  // ── Initial "How many seats?" popup (appears on page load) ──
  SEAT_COUNT_POPUP: '.sc-b1gr0h-0',
  SEAT_COUNT_SLIDER: 'input[type="range"]',
  SEAT_COUNT_BUTTON_PREFIX: '#quantity-', // append 1-6 for specific buttons
  SELECT_SEATS_BTN: 'button[aria-label="Select Seats"]',

  // Bottom sheet overlay that can block clicks
  BOTTOM_SHEET_CLOSE: '#bottomSheet-model-close',

  // Accessibility button on the seat layout page
  OPEN_MODAL: 'button[aria-label="Open accessibility seat selection"]',

  // Close button inside the accessibility modal
  CLOSE_MODAL: 'button[aria-label="Close accessibility modal"]',

  // Dropdowns inside the accessibility modal
  QUANTITY_SELECT: '#quantity-select',
  CATEGORY_SELECT: '#category-select',
  ROW_SELECT: '#row-select',

  // Seat table
  SEAT_TABLE: 'table[role="grid"]',
  SEAT_TABLE_ROWS: 'table[role="grid"] tbody tr',
};

module.exports = SELECTORS;
