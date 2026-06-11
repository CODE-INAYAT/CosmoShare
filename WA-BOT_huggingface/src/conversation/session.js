'use strict';

const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('../utils/logger');

// ─── States ─────────────────────────────────────────────────────────
const STATES = {
  IDLE: 'IDLE',
  MAIN_MENU: 'MAIN_MENU',
  EDIT_NAME: 'EDIT_NAME',
  COLLECTING: 'COLLECTING',
  CHOOSE_METHOD: 'CHOOSE_METHOD',       // kept for backward compat, but rarely used now
  PROCESSING_ONESHARE: 'PROCESSING_ONESHARE',
  PROCESSING_MULTISHARE: 'PROCESSING_MULTISHARE',
  LABSHARE_ROOM: 'LABSHARE_ROOM',
  LABSHARE_RECIPIENT: 'LABSHARE_RECIPIENT',
  PROCESSING_LABSHARE: 'PROCESSING_LABSHARE',
};

// ─── Name Persistence ───────────────────────────────────────────────
const NAMES_FILE = path.resolve(config.bot.sessionDir, 'names.json');
let nameStore = new Map();

function _loadNames() {
  try {
    if (fs.existsSync(NAMES_FILE)) {
      const raw = fs.readFileSync(NAMES_FILE, 'utf-8');
      const data = JSON.parse(raw);
      nameStore = new Map(Object.entries(data));
      logger.info('Name store loaded', { count: nameStore.size });
    }
  } catch (err) {
    logger.error('Failed to load name store', { error: err.message });
  }
}

function _saveNames() {
  try {
    const dir = path.dirname(NAMES_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const obj = Object.fromEntries(nameStore);
    fs.writeFileSync(NAMES_FILE, JSON.stringify(obj, null, 2), 'utf-8');
  } catch (err) {
    logger.error('Failed to save name store', { error: err.message });
  }
}

/**
 * Extract phone digits from WhatsApp userId (e.g., "919876543210@c.us" → "919876543210").
 */
function _phoneFromUserId(userId) {
  return (userId || '').replace(/@.*$/, '').replace(/\D/g, '');
}

/**
 * Get the saved display name for a phone number. Returns null if not saved.
 */
function getSavedName(phone) {
  const clean = (phone || '').replace(/\D/g, '');
  return nameStore.get(clean) || null;
}

/**
 * Save a display name for a phone number (always stored UPPERCASE).
 */
function saveName(phone, name) {
  const clean = (phone || '').replace(/\D/g, '');
  if (!clean || !name) return;
  const upper = name.toUpperCase();
  nameStore.set(clean, upper);
  _saveNames();
  logger.info('Name saved', { phone: clean, name: upper });
}

// Load names on module init
_loadNames();

// ─── Session State File ─────────────────────────────────────────────
const STATE_FILE = path.resolve(config.bot.sessionDir, 'state.json');

// ─── Session Manager ────────────────────────────────────────────────
class SessionManager {
  constructor() {
    /** @type {Map<string, object>} */
    this.sessions = new Map();
  }

  /**
   * Get an existing session, or null.
   */
  getSession(userId) {
    return this.sessions.get(userId) || null;
  }

  /**
   * Create a new session in MAIN_MENU state.
   */
  createSession(userId, senderName, senderPhone) {
    if (this.sessions.has(userId)) {
      this.destroySession(userId);
    }

    const phone = senderPhone || _phoneFromUserId(userId);

    // Auto-save WhatsApp username if no saved name exists
    if (!getSavedName(phone) && senderName && senderName !== 'User') {
      saveName(phone, senderName);
    }

    const session = {
      state: STATES.MAIN_MENU,
      files: [],
      links: [],
      codeSnippets: [],
      createdAt: Date.now(),
      lastActivity: Date.now(),
      timeoutTimer: null,
      senderName: getSavedName(phone) || (senderName || 'User').toUpperCase(),
      senderPhone: phone,
      roomNumber: null,
      recipientType: null,
      selectedMethod: null,  // 'oneshare' | 'multishare' | 'labshare'
    };

    this.sessions.set(userId, session);
    this._startTimeout(userId);
    logger.info('Session created', { userId, senderName: session.senderName });
    return session;
  }

  /**
   * Reset the inactivity timeout.
   */
  updateActivity(userId) {
    const session = this.sessions.get(userId);
    if (!session) return;
    session.lastActivity = Date.now();
    this._startTimeout(userId);
  }

  /**
   * Add a file to the session.
   */
  addFile(userId, fileInfo) {
    const session = this.sessions.get(userId);
    if (!session) return;
    session.files.push(fileInfo);
    this.updateActivity(userId);
    logger.debug('File added to session', { userId, fileName: fileInfo.fileName });
  }

  /**
   * Add a link URL to the session.
   */
  addLink(userId, url, fileId) {
    const session = this.sessions.get(userId);
    if (!session) return;
    session.links.push({ url, fileId });
    this.updateActivity(userId);
    logger.debug('Link added to session', { userId, url });
  }

  /**
   * Add a code snippet to the session.
   */
  addCodeSnippet(userId, code) {
    const session = this.sessions.get(userId);
    if (!session) return;
    session.codeSnippets.push(code);
    this.updateActivity(userId);
    logger.debug('Code snippet added to session', { userId });
  }

  /**
   * Update session state.
   */
  setState(userId, newState) {
    const session = this.sessions.get(userId);
    if (!session) return;
    const oldState = session.state;
    session.state = newState;
    this.updateActivity(userId);
    logger.debug('State transition', { userId, from: oldState, to: newState });
  }

  /**
   * Return full session data.
   */
  getSessionData(userId) {
    return this.sessions.get(userId) || null;
  }

  /**
   * Get the display name for a userId (from session or name store).
   */
  getDisplayName(userId) {
    const session = this.sessions.get(userId);
    if (session) return session.senderName;
    const phone = _phoneFromUserId(userId);
    return getSavedName(phone) || 'User';
  }

  /**
   * Update the user's saved name.
   */
  updateName(userId, newName) {
    const session = this.sessions.get(userId);
    const phone = session ? session.senderPhone : _phoneFromUserId(userId);
    const upper = (newName || '').toUpperCase();
    saveName(phone, upper);
    if (session) {
      session.senderName = upper;
    }
    return upper;
  }

  /**
   * Destroy session: clear timeout, delete temp files, remove from map.
   */
  destroySession(userId) {
    const session = this.sessions.get(userId);
    if (!session) return;

    if (session.timeoutTimer) {
      clearTimeout(session.timeoutTimer);
      session.timeoutTimer = null;
    }

    this._cleanupTempFiles(userId, session);
    this.sessions.delete(userId);
    logger.info('Session destroyed', { userId });
  }

  /**
   * Persist sessions to disk (metadata only, no temp paths).
   */
  persistToDisk() {
    try {
      const dir = path.dirname(STATE_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const data = {};
      for (const [userId, session] of this.sessions.entries()) {
        data[userId] = {
          state: session.state,
          files: session.files.map((f) => ({
            fileName: f.fileName,
            fileSize: f.fileSize,
            fileType: f.fileType,
            mimetype: f.mimetype,
          })),
          links: session.links,
          codeSnippets: session.codeSnippets,
          createdAt: session.createdAt,
          lastActivity: session.lastActivity,
          senderName: session.senderName,
          senderPhone: session.senderPhone,
          roomNumber: session.roomNumber,
          recipientType: session.recipientType,
          selectedMethod: session.selectedMethod,
        };
      }

      fs.writeFileSync(STATE_FILE, JSON.stringify(data, null, 2), 'utf-8');
      logger.info('Sessions persisted to disk', { count: this.sessions.size });
    } catch (err) {
      logger.error('Failed to persist sessions', { error: err.message });
    }
  }

  /**
   * Restore sessions from disk.
   */
  restoreFromDisk() {
    try {
      if (!fs.existsSync(STATE_FILE)) {
        logger.info('No persisted sessions found');
        return;
      }

      const raw = fs.readFileSync(STATE_FILE, 'utf-8');
      const data = JSON.parse(raw);
      let restored = 0;

      for (const [userId, saved] of Object.entries(data)) {
        const session = {
          state: STATES.IDLE,
          files: [],
          links: saved.links || [],
          codeSnippets: saved.codeSnippets || [],
          createdAt: saved.createdAt,
          lastActivity: saved.lastActivity,
          timeoutTimer: null,
          senderName: saved.senderName || 'Unknown',
          senderPhone: saved.senderPhone || '',
          roomNumber: saved.roomNumber || null,
          recipientType: saved.recipientType || null,
          selectedMethod: saved.selectedMethod || null,
        };

        this.sessions.set(userId, session);
        restored++;
      }

      logger.info('Sessions restored from disk', { restored });
    } catch (err) {
      logger.error('Failed to restore sessions', { error: err.message });
    }
  }

  get activeSessionCount() {
    return this.sessions.size;
  }

  // ─── Internal ─────────────────────────────────────────────────────

  _startTimeout(userId) {
    const session = this.sessions.get(userId);
    if (!session) return;

    if (session.timeoutTimer) {
      clearTimeout(session.timeoutTimer);
    }

    const timeoutMs = config.bot.sessionTimeoutMinutes * 60 * 1000;
    session.timeoutTimer = setTimeout(() => {
      logger.warn('Session expired due to inactivity', { userId });
      this.destroySession(userId);
    }, timeoutMs);

    if (session.timeoutTimer.unref) {
      session.timeoutTimer.unref();
    }
  }

  _cleanupTempFiles(userId, session) {
    try {
      const userTempDir = path.join(path.resolve(config.bot.tempDir), userId.replace(/[^a-zA-Z0-9]/g, '_'));
      if (fs.existsSync(userTempDir)) {
        fs.rmSync(userTempDir, { recursive: true, force: true });
        logger.debug('Cleaned up temp files', { userId, dir: userTempDir });
      }
    } catch (err) {
      logger.error('Failed to cleanup temp files', { userId, error: err.message });
    }
  }
}

// Singleton
const sessionManager = new SessionManager();

module.exports = { sessionManager, SessionManager, STATES, getSavedName, saveName };
