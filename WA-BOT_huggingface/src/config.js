'use strict';

require('dotenv').config();
const fs = require('fs');

const DEFAULT_VALID_ROOMS = '203,204,205,214,215,220,221,222,223,304,305,306,307,308,309,310,312,317';

// Auto-detect writeable /data mount if running on Hugging Face paid persistent storage
const defaultSessionDir = fs.existsSync('/data') ? '/data' : './sessions';

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
    sessionDir: process.env.BOT_SESSION_DIR || defaultSessionDir,
    tempDir: process.env.BOT_TEMP_DIR || './temp',
    maxFileSizeMB: parseInt(process.env.BOT_MAX_FILE_SIZE_MB, 10) || 50,
    sessionTimeoutMinutes: parseInt(process.env.BOT_SESSION_TIMEOUT_MINUTES, 10) || 30,
    updateSingleMessage: process.env.BOT_UPDATE_SINGLE_MESSAGE !== 'false',
  },
  health: {
    // Port 7860 is required for Hugging Face Spaces. Force it if running in HF Space environment.
    port: process.env.SPACE_ID ? 7860 : (parseInt(process.env.PORT || process.env.HEALTH_PORT, 10) || 7860),
  },
  admin: {
    password: process.env.ADMIN_PASSWORD || 'admin123',
  },
  hf: {
    dataset: process.env.HF_DATASET || '',
    token: process.env.HF_TOKEN || '',
  },
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: process.env.SMTP_PORT || '587',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    alertEmail: process.env.ALERT_EMAIL || '',
  },
  validRooms: (process.env.VALID_ROOMS || DEFAULT_VALID_ROOMS)
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean),
  messageRateLimitMs: parseInt(process.env.MESSAGE_RATE_LIMIT_MS, 10) || 1000,
  logLevel: process.env.LOG_LEVEL || 'info',
};

module.exports = config;
