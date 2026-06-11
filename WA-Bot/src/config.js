'use strict';

require('dotenv').config();

const DEFAULT_VALID_ROOMS = '203,204,205,214,215,220,221,222,223,304,305,306,307,308,309,310,312,317';

const config = {
  bridge: {
    apiUrl: process.env.BRIDGE_API_URL || 'http://localhost:8787',
    apiSecret: process.env.BRIDGE_API_SECRET || '',
  },
  signaling: {
    oneShareUrls: (process.env.SIGNALING_URLS_ONESHARE || process.env.SIGNALING_URLS || '')
      .split(',')
      .map((u) => u.trim())
      .filter(Boolean),
    labUrls: (process.env.SIGNALING_URLS || '')
      .split(',')
      .map((u) => u.trim())
      .filter(Boolean),
  },
  bot: {
    sessionDir: process.env.BOT_SESSION_DIR || './sessions',
    tempDir: process.env.BOT_TEMP_DIR || './temp',
    maxFileSizeMB: parseInt(process.env.BOT_MAX_FILE_SIZE_MB, 10) || 50,
    sessionTimeoutMinutes: parseInt(process.env.BOT_SESSION_TIMEOUT_MINUTES, 10) || 30,
    updateSingleMessage: process.env.BOT_UPDATE_SINGLE_MESSAGE !== 'false',
  },
  health: {
    port: parseInt(process.env.HEALTH_PORT, 10) || 3001,
  },
  validRooms: (process.env.VALID_ROOMS || DEFAULT_VALID_ROOMS)
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean),
  messageRateLimitMs: parseInt(process.env.MESSAGE_RATE_LIMIT_MS, 10) || 1000,
  logLevel: process.env.LOG_LEVEL || 'info',
};

module.exports = config;
