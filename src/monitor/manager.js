const fs = require('fs');
const path = require('path');
const Monitor = require('./monitor');
const config = require('../config');
const msg = require('../bot/messages');
const logger = require('../logger');

class MonitorManager {
  constructor() {
    this.monitors = new Map(); // id -> Monitor
    this.nextId = 1;
  }

  /**
   * Persist active monitors configurations to disk.
   */
  saveMonitorsToDisk() {
    try {
      const activeConfigs = [...this.monitors.values()].map((m) => ({
        id: m.id,
        name: m.name,
        url: m.url,
        category: m.category,
        rows: m.rows,
        allRows: m.allRows || false,
        seatRange: m.seatRange,
        pollingInterval: m.pollingInterval,
      }));
      fs.writeFileSync(
        path.join(__dirname, '../../monitors.json'),
        JSON.stringify(activeConfigs, null, 2),
        'utf8'
      );
      logger.info('[Manager] Monitors persisted to disk');
    } catch (err) {
      logger.error(`[Manager] Failed to persist monitors: ${err.message}`);
    }
  }

  /**
   * Load and resume monitors from monitors.json.
   *
   * @param {object} bot - The active Telegram bot instance
   */
  async loadAndResumeMonitors(bot) {
    const filePath = path.join(__dirname, '../../monitors.json');
    if (!fs.existsSync(filePath)) {
      return;
    }

    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const configs = JSON.parse(content);
      if (!Array.isArray(configs) || configs.length === 0) {
        return;
      }

      logger.info(`[Manager] Resuming ${configs.length} monitor(s) from storage...`);
      const resumedIds = [];

      for (const conf of configs) {
        try {
          const monitor = new Monitor({
            id: conf.id,
            name: conf.name || conf.id,
            url: conf.url,
            category: conf.category,
            rows: conf.rows,
            allRows: conf.allRows || false,
            seatRange: conf.seatRange,
            pollingInterval: conf.pollingInterval,
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
            isResumed: true,
          });

          this.monitors.set(conf.id, monitor);
          await monitor.start();
          resumedIds.push({ id: conf.id, name: conf.name || conf.id });

          // Safely adjust nextId
          const numId = parseInt(conf.id.split('-')[1], 10);
          if (!isNaN(numId) && numId >= this.nextId) {
            this.nextId = numId + 1;
          }
        } catch (mErr) {
          logger.error(`[Manager] Failed to resume monitor ${conf.id}: ${mErr.message}`);
        }
      }

      // Broadcast consolidated resumption confirmation
      if (resumedIds.length > 0) {
        const resumedStr = resumedIds
          .map((m) => `*${msg.escapeMarkdown(m.name)}* \\(*${msg.escapeMarkdown(m.id)}*\\)`)
          .join(', ');
        const notificationMsg = `📢 *Monitors Resumed*\n\nResumed active seat monitor\\(s\\): ${resumedStr}\n_Monitoring is active and running\\._`;
        
        config.allowedUsers.forEach((targetChatId) => {
          bot.sendMessage(targetChatId, notificationMsg, { parse_mode: 'MarkdownV2' })
            .catch((err) => {
              logger.error(`Failed to send resumption notification to ${targetChatId}: ${err.message}`);
            });
        });
      }
    } catch (err) {
      logger.error(`[Manager] Failed to load/resume monitors: ${err.message}`);
    }
  }

  /**
   * Create and start a new monitor.
   *
   * @param {object} config
   * @param {string} config.url
   * @param {{value: string, label: string}} config.category
   * @param {Array<{value: string, label: string}>} config.rows
   * @param {{from: number, to: number} | null} config.seatRange
   * @param {number} config.pollingInterval
   * @param {function} config.onAlert
   * @param {function} config.onError
   * @returns {Promise<string>} The monitor ID
   */
   async createMonitor({ name, url, category, rows, allRows, seatRange, pollingInterval, onAlert, onError }) {
    const id = `MON-${this.nextId++}`;

    const monitor = new Monitor({
      id,
      name,
      url,
      category,
      rows,
      allRows,
      seatRange,
      pollingInterval,
      onAlert,
      onError,
    });

    this.monitors.set(id, monitor);
    await monitor.start();
    
    // Save to disk
    this.saveMonitorsToDisk();

    logger.info(`[Manager] Created monitor ${id} (${name})`);
    return id;
  }

  /**
   * Stop and remove a specific monitor.
   * @param {string} id
   * @returns {boolean} true if found and stopped
   */
  async stopMonitor(id) {
    const monitor = this.monitors.get(id);
    if (!monitor) return false;

    await monitor.stop();
    this.monitors.delete(id);
    
    if (this.monitors.size === 0) {
      this.nextId = 1;
    }
    
    // Save to disk
    this.saveMonitorsToDisk();

    logger.info(`[Manager] Stopped and removed monitor ${id}`);
    return true;
  }

  /**
   * Stop and remove all monitors.
   */
  async stopAll() {
    const ids = [...this.monitors.keys()];
    for (const id of ids) {
      const monitor = this.monitors.get(id);
      if (monitor) {
        await monitor.stop();
      }
    }
    this.monitors.clear();
    this.nextId = 1;
    this.saveMonitorsToDisk();
    logger.info(`[Manager] Stopped all monitors (${ids.length} total)`);
    return ids.length;
  }

  /**
   * Stop all monitor timers and browser pages during shutdown without deleting them.
   */
  async cleanup() {
    const monitors = [...this.monitors.values()];
    for (const monitor of monitors) {
      await monitor.stop();
    }
    logger.info(`[Manager] Cleaned up resources for ${monitors.length} active monitors`);
    return monitors.length;
  }

  /**
   * Get a monitor by ID.
   * @param {string} id
   * @returns {Monitor | undefined}
   */
  getMonitor(id) {
    return this.monitors.get(id);
  }

  /**
   * Update a monitor's preferences.
   * @param {string} id
   * @param {object} newPrefs - { rows?, seatRange?, pollingInterval? }
   * @returns {boolean} true if found and updated
   */
  updateMonitor(id, newPrefs) {
    const monitor = this.monitors.get(id);
    if (!monitor) return false;

    monitor.updatePreferences(newPrefs);
    
    // Save to disk
    this.saveMonitorsToDisk();

    return true;
  }

  /**
   * Get status of all monitors.
   * @returns {Array<object>}
   */
  listMonitors() {
    return [...this.monitors.values()].map((m) => m.getStatus());
  }

  /**
   * Get status of a specific monitor.
   * @param {string} id
   * @returns {object | null}
   */
  getStatus(id) {
    const monitor = this.monitors.get(id);
    return monitor ? monitor.getStatus() : null;
  }

  /**
   * Get the count of active monitors.
   */
  get activeCount() {
    return this.monitors.size;
  }
}

module.exports = new MonitorManager();
