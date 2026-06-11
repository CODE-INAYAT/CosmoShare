'use strict';

const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('../utils/logger');
const emailService = require('./emailService');
const storageService = require('./storageService');

const PAUSE_FILE = path.resolve(config.bot.sessionDir, 'pause.json');

// In-memory state representation
let isPaused = false;
let pauseType = null; // 'manual' | 'scheduled'
let pausedAt = null;
let resumeAt = null;  // Epoch timestamp

let checkIntervalTimer = null;

/**
 * Format a Date object or timestamp as an IST locale string.
 * @param {Date|number|string} dateOrTimestamp 
 * @returns {string}
 */
function formatToIST(dateOrTimestamp) {
  if (!dateOrTimestamp) return '';
  const date = new Date(dateOrTimestamp);
  return date.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'medium',
    timeStyle: 'medium'
  });
}

/**
 * Get the current IST time as an ISO string format for HTML inputs (YYYY-MM-DDTHH:MM)
 * @param {Date} date 
 * @returns {string}
 */
function getISTISOString(date = new Date()) {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false
    });
    const parts = formatter.formatToParts(date);
    const map = Object.fromEntries(parts.map(p => [p.type, p.value]));
    return `${map.year}-${map.month}-${map.day}T${map.hour}:${map.minute}`;
  } catch (err) {
    logger.error('Failed to get IST ISO string', { error: err.message });
    // Safe fallback using UTC offset calculation
    const offsetDate = new Date(date.getTime() + (5.5 * 60 * 60 * 1000));
    return offsetDate.toISOString().slice(0, 16);
  }
}

/**
 * Load pause state from pause.json file.
 */
function loadPauseState() {
  try {
    if (fs.existsSync(PAUSE_FILE)) {
      const raw = fs.readFileSync(PAUSE_FILE, 'utf-8');
      const data = JSON.parse(raw);
      
      isPaused = !!data.isPaused;
      pauseType = data.pauseType || null;
      pausedAt = data.pausedAt || null;
      resumeAt = data.resumeAt || null;
      
      logger.info('Pause state loaded from disk', { isPaused, pauseType, resumeAt: formatToIST(resumeAt) });
    } else {
      logger.info('No pause.json found. Initializing with unpaused state.');
      isPaused = false;
      pauseType = null;
      pausedAt = null;
      resumeAt = null;
    }
    
    // Start background check interval
    startCheckInterval();
  } catch (err) {
    logger.error('Failed to load pause state', { error: err.message });
  }
}

/**
 * Save pause state to pause.json and trigger backup to dataset.
 */
function savePauseState() {
  try {
    const dir = path.dirname(PAUSE_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    const data = {
      isPaused,
      pauseType,
      pausedAt,
      resumeAt
    };
    
    fs.writeFileSync(PAUSE_FILE, JSON.stringify(data, null, 2), 'utf-8');
    logger.info('Pause state saved to disk', data);

    // Asynchronously trigger backup to Hugging Face dataset
    storageService.backupSession().catch(err => {
      logger.error('Failed to backup pause state to Hugging Face Dataset', { error: err.message });
    });
  } catch (err) {
    logger.error('Failed to save pause state', { error: err.message });
  }
}

/**
 * Periodically check if a scheduled pause duration has expired.
 */
function startCheckInterval() {
  if (checkIntervalTimer) {
    clearInterval(checkIntervalTimer);
  }
  
  checkIntervalTimer = setInterval(() => {
    checkScheduledResume();
  }, 5000); // Check every 5 seconds for accuracy
  
  if (checkIntervalTimer.unref) {
    checkIntervalTimer.unref();
  }
}

/**
 * Check if the current scheduled pause duration has elapsed, and resume if so.
 */
function checkScheduledResume() {
  if (isPaused && pauseType === 'scheduled' && resumeAt) {
    const now = Date.now();
    if (now >= resumeAt) {
      logger.info('Scheduled pause duration elapsed. Resuming bot automatically.');
      resumeBot('auto');
    }
  }
}

/**
 * Query if the bot is currently paused.
 * Performs a sanity check on scheduled resume as well.
 * @returns {boolean}
 */
function checkIsPaused() {
  // Direct check first
  if (isPaused && pauseType === 'scheduled' && resumeAt) {
    const now = Date.now();
    if (now >= resumeAt) {
      logger.info('Scheduled pause duration elapsed during active check. Resuming bot.');
      resumeBot('auto');
      return false;
    }
  }
  return isPaused;
}

/**
 * Pause the WhatsApp Bot.
 * @param {string} type - 'manual' or 'scheduled'
 * @param {number|null} resumeEpoch - Epoch timestamp when the bot should resume (if scheduled)
 */
function pauseBot(type, resumeEpoch = null) {
  isPaused = true;
  pauseType = type;
  pausedAt = Date.now();
  resumeAt = type === 'scheduled' ? resumeEpoch : null;
  
  savePauseState();
  
  const resumeTimeIST = resumeAt ? formatToIST(resumeAt) : null;
  emailService.sendPauseAlert(type, resumeTimeIST).catch(err => {
    logger.error('Failed to send pause email alert', { error: err.message });
  });
  
  logger.info(`WhatsApp bot paused (${type === 'scheduled' ? 'Scheduled until ' + resumeTimeIST : 'Manual indefinitely'})`);
}

/**
 * Resume the WhatsApp Bot.
 * @param {string} trigger - 'manual' or 'auto'
 */
function resumeBot(trigger) {
  isPaused = false;
  pauseType = null;
  pausedAt = null;
  resumeAt = null;
  
  savePauseState();
  
  emailService.sendResumeAlert(trigger).catch(err => {
    logger.error('Failed to send resume email alert', { error: err.message });
  });
  
  logger.info(`WhatsApp bot resumed successfully (Trigger: ${trigger})`);
}

module.exports = {
  loadPauseState,
  isPaused: checkIsPaused,
  pauseBot,
  resumeBot,
  formatToIST,
  getISTISOString,
  getState: () => ({
    isPaused,
    pauseType,
    pausedAt,
    resumeAt
  })
};
