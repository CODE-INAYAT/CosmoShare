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
  CHOOSE_METHOD: 'CHOOSE_METHOD',
  PROCESSING_ONESHARE: 'PROCESSING_ONESHARE',
  LABSHARE_ROOM: 'LABSHARE_ROOM',
  LABSHARE_RECIPIENT: 'LABSHARE_RECIPIENT',
  LABSHARE_STUDENT_OPTION: 'LABSHARE_STUDENT_OPTION',
  LABSHARE_PICK_MEMBER: 'LABSHARE_PICK_MEMBER',
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
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(NAMES_FILE, JSON.stringify(Object.fromEntries(nameStore), null, 2), 'utf-8');
  } catch (err) {
    logger.error('Failed to save name store', { error: err.message });
  }
}

function _phoneFromJid(jid) {
  return (jid || '').replace(/@.*$/, '').replace(/\D/g, '');
}

function getSavedName(phone) {
  return nameStore.get((phone || '').replace(/\D/g, '')) || null;
}

function saveName(phone, name) {
  const clean = (phone || '').replace(/\D/g, '');
  if (!clean || !name) return;
  nameStore.set(clean, name.toUpperCase());
  _saveNames();
}

_loadNames();

// ─── Session Manager ────────────────────────────────────────────────
class SessionManager {
  constructor() {
    this.sessions = new Map();
  }

  getSession(jid) {
    return this.sessions.get(jid) || null;
  }

  createSession(jid, senderName) {
    if (this.sessions.has(jid)) this.destroySession(jid);

    const phone = _phoneFromJid(jid);

    if (!getSavedName(phone) && senderName && senderName !== 'User') {
      saveName(phone, senderName);
    }

    const session = {
      state: STATES.MAIN_MENU,
      files: [],          // { fileName, fileSize, fileType, mimetype, fileId, buffer }
      links: [],          // { url, fileId }
      codeSnippets: [],   // string[]
      createdAt: Date.now(),
      lastActivity: Date.now(),
      timeoutTimer: null,
      senderName: getSavedName(phone) || (senderName || 'User').toUpperCase(),
      senderPhone: phone,
      roomNumber: null,
      recipientType: null,
      selectedMethod: null,
      targetMemberId: null,
    };

    this.sessions.set(jid, session);
    this._startTimeout(jid);
    logger.info('Session created', { jid: jid.slice(0, 6) + '...', senderName: session.senderName });
    return session;
  }

  updateActivity(jid) {
    const session = this.sessions.get(jid);
    if (!session) return;
    session.lastActivity = Date.now();
    this._startTimeout(jid);
  }

  addFile(jid, fileInfo) {
    const session = this.sessions.get(jid);
    if (!session) return;
    session.files.push(fileInfo);
    this.updateActivity(jid);
  }

  addLink(jid, url, fileId) {
    const session = this.sessions.get(jid);
    if (!session) return;
    session.links.push({ url, fileId });
    this.updateActivity(jid);
  }

  addCodeSnippet(jid, code) {
    const session = this.sessions.get(jid);
    if (!session) return;
    session.codeSnippets.push(code);
    this.updateActivity(jid);
  }

  setState(jid, newState) {
    const session = this.sessions.get(jid);
    if (!session) return;
    session.state = newState;
    this.updateActivity(jid);
  }

  getSessionData(jid) {
    return this.sessions.get(jid) || null;
  }

  getDisplayName(jid) {
    const session = this.sessions.get(jid);
    if (session) return session.senderName;
    return getSavedName(_phoneFromJid(jid)) || 'User';
  }

  updateName(jid, newName) {
    const session = this.sessions.get(jid);
    const phone = session ? session.senderPhone : _phoneFromJid(jid);
    const upper = (newName || '').toUpperCase();
    saveName(phone, upper);
    if (session) session.senderName = upper;
    return upper;
  }

  destroySession(jid) {
    const session = this.sessions.get(jid);
    if (!session) return;
    if (session.timeoutTimer) clearTimeout(session.timeoutTimer);
    this.sessions.delete(jid);
    logger.info('Session destroyed', { jid: jid.slice(0, 6) + '...' });
  }

  get activeSessionCount() {
    return this.sessions.size;
  }

  _startTimeout(jid) {
    const session = this.sessions.get(jid);
    if (!session) return;
    if (session.timeoutTimer) clearTimeout(session.timeoutTimer);

    const timeoutMs = config.bot.sessionTimeoutMinutes * 60 * 1000;
    session.timeoutTimer = setTimeout(() => {
      logger.warn('Session expired', { jid: jid.slice(0, 6) + '...' });
      this.destroySession(jid);
    }, timeoutMs);

    if (session.timeoutTimer.unref) session.timeoutTimer.unref();
  }
}

const sessionManager = new SessionManager();

module.exports = { sessionManager, SessionManager, STATES, getSavedName, saveName };
