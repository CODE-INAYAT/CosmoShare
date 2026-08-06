'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_VALID_ROOMS = '203,204,205,214,215,220,221,222,223,304,305,306,307,308,309,310,312,317';

// Auto-detect writeable /data mount (HF Spaces persistent storage)
const defaultSessionDir = fs.existsSync('/data') ? '/data' : './sessions';

// Load rooms from config file if available
let roomsFromFile;
try {
  roomsFromFile = require('../config/rooms.json');
} catch {
  roomsFromFile = null;
}

const config = {
  signaling: {
    adminPassword: process.env.ADMIN_PASSWORD || 'admin123',
  },
  bot: {
    sessionDir: process.env.BOT_SESSION_DIR || defaultSessionDir,
    tempDir: process.env.BOT_TEMP_DIR || './temp',
    maxFileSizeMB: parseInt(process.env.BOT_MAX_FILE_SIZE_MB, 10) || 50,
    sessionTimeoutMinutes: parseInt(process.env.BOT_SESSION_TIMEOUT_MINUTES, 10) || 30,
    updateSingleMessage: process.env.BOT_UPDATE_SINGLE_MESSAGE !== 'false',
  },
  health: {
    port: process.env.SPACE_ID ? 7860 : (parseInt(process.env.PORT || process.env.HEALTH_PORT, 10) || 7860),
  },
  admin: {
    password: process.env.ADMIN_PASSWORD || 'admin123',
  },
  hf: {
    dataset: process.env.HF_DATASET || '',
    token: process.env.HF_TOKEN || '',
  },
  relay: {
    // Files smaller than this are kept in memory; larger go to temp disk
    memoryThresholdBytes: 5 * 1024 * 1024, // 5MB
    // Staged files expire after this duration
    fileTTLMs: 10 * 60 * 1000, // 10 minutes
    // Cleanup interval
    cleanupIntervalMs: 60 * 1000, // 60 seconds
  },
  validRooms: roomsFromFile
    ? roomsFromFile
    : (process.env.VALID_ROOMS || DEFAULT_VALID_ROOMS).split(',').map(r => r.trim()).filter(Boolean),
  messageRateLimitMs: parseInt(process.env.MESSAGE_RATE_LIMIT_MS, 10) || 1000,
  logLevel: process.env.LOG_LEVEL || 'info',

  // Test number restriction
  test: {
    enableTestNumbersOnly: process.env.ENABLE_TEST_NUMBERS_ONLY === 'true',
    allowedTestNumbers: (process.env.ALLOWED_TEST_NUMBERS || '').split(',').map(n => n.trim()).filter(Boolean),
  },
};

module.exports = config;
