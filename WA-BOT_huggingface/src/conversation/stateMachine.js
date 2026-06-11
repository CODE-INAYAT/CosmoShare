'use strict';

const { STATES } = require('./session');
const validators = require('../utils/validators');
const formatter = require('../utils/formatter');
const logger = require('../utils/logger');
const config = require('../config');
const { getFileStats } = require('../handlers/fileHandler');
const shareManager = require('../services/shareManager');

// ─── Input Parsing ──────────────────────────────────────────────────

/**
 * Parse incoming text to determine input type and value.
 * Context-aware: uses currentState to resolve ambiguous inputs.
 */
function parseInput(text, currentState) {
  if (!text || typeof text !== 'string') return { type: 'unknown' };

  const normalized = validators.normalizeInput(text);

  // Global commands (available in most states)
  if (validators.isCancel(normalized))  return { type: 'cancel' };
  if (validators.isMenu(normalized))    return { type: 'menu' };
  if (validators.isDone(normalized))    return { type: 'done' };
  if (validators.isGreeting(normalized)) return { type: 'greeting' };

  // Context-specific parsing
  switch (currentState) {
    case STATES.MAIN_MENU:
    case STATES.IDLE: {
      const opt = validators.isValidMenuOption(normalized);
      if (opt) return { type: 'menuOption', value: opt };
      return { type: 'text', value: normalized };
    }

    case STATES.EDIT_NAME: {
      return { type: 'name', value: text.trim() }; // preserve original casing
    }

    case STATES.COLLECTING: {
      const normalizedLink = validators.detectAndNormalizeLink(text);
      if (normalizedLink) return { type: 'link', value: normalizedLink };
      return { type: 'text', value: text.trim() }; // code snippet (preserve original)
    }

    case STATES.LABSHARE_ROOM: {
      const room = validators.isValidRoomNumber(normalized);
      if (room) return { type: 'room', value: room };
      return { type: 'text', value: normalized };
    }

    case STATES.LABSHARE_RECIPIENT: {
      const recipient = validators.isValidRecipientType(normalized);
      if (recipient) return { type: 'recipient', value: recipient };
      return { type: 'text', value: normalized };
    }

    default:
      return { type: 'text', value: normalized };
  }
}

// ─── Process Message ────────────────────────────────────────────────

/**
 * Main orchestrator. Returns one of:
 * - a string (single message)
 * - an array of strings (multiple chat bubbles)
 * - null (no response needed)
 */
async function processMessage(userId, messageText, sessionMgr, sendProgress) {
  const session = sessionMgr.getSession(userId);
  const currentState = session ? session.state : STATES.IDLE;
  const input = parseInput(messageText, currentState);

  logger.debug('State machine input', { userId, currentState, inputType: input.type, value: input.value });

  // ── Global: menu/9 from ANY state → show main menu ──────────────
  if (input.type === 'menu') {
    if (session && (currentState === STATES.COLLECTING || currentState === STATES.LABSHARE_ROOM ||
        currentState === STATES.LABSHARE_RECIPIENT || currentState === STATES.CHOOSE_METHOD)) {
      sessionMgr.destroySession(userId);
    }
    const name = sessionMgr.getDisplayName(userId);
    if (session) {
      sessionMgr.setState(userId, STATES.MAIN_MENU);
      session.selectedMethod = null;
      session.files = [];
      session.links = [];
      session.codeSnippets = [];
      session.roomNumber = null;
      session.recipientType = null;
    }
    return formatter.mainMenu(name);
  }

  // ── Global: cancel/0 from ANY active state → cancel ─────────────
  if (input.type === 'cancel') {
    if (currentState === STATES.EDIT_NAME) {
      // Cancel from edit name → back to menu
      sessionMgr.setState(userId, STATES.MAIN_MENU);
      const name = sessionMgr.getDisplayName(userId);
      return formatter.mainMenu(name);
    }
    if (session) {
      sessionMgr.destroySession(userId);
    }
    return formatter.cancelledMessage();
  }

  // ── Route by state ──────────────────────────────────────────────
  switch (currentState) {

    // ── IDLE ───────────────────────────────────────────────────────
    case STATES.IDLE: {
      // Any input from IDLE → show main menu
      if (input.type === 'greeting' || input.type === 'menuOption' || input.type === 'text') {
        // Create session if not exists
        if (!session) {
          // Session creation handled by messageHandler (it has access to contact)
          // If session was already created by messageHandler, setState
          return null; // messageHandler handles greeting + session creation
        }
        sessionMgr.setState(userId, STATES.MAIN_MENU);
        return formatter.mainMenu(session.senderName);
      }
      return formatter.promptGreeting();
    }

    // ── MAIN_MENU ─────────────────────────────────────────────────
    case STATES.MAIN_MENU: {
      if (input.type === 'greeting') {
        return formatter.mainMenu(session.senderName);
      }

      if (input.type === 'menuOption') {
        switch (input.value) {
          case '1': // OneShare
            session.selectedMethod = 'oneshare';
            sessionMgr.setState(userId, STATES.COLLECTING);
            return formatter.collectingEntry('oneshare');

          case '2': // MultiShare
            session.selectedMethod = 'multishare';
            sessionMgr.setState(userId, STATES.COLLECTING);
            return formatter.collectingEntry('multishare');

          case '3': // LabShare
            session.selectedMethod = 'labshare';
            sessionMgr.setState(userId, STATES.COLLECTING);
            return formatter.collectingEntry('labshare');

          case '4': // Edit Name
            sessionMgr.setState(userId, STATES.EDIT_NAME);
            return formatter.editNamePrompt(session.senderName);

          case '5': // Help
            return formatter.helpMessage();
        }
      }

      // Unrecognized input → show menu hint
      if (input.type === 'done') {
        return formatter.invalidMenuOption();
      }
      return formatter.invalidMenuOption();
    }

    // ── EDIT_NAME ─────────────────────────────────────────────────
    case STATES.EDIT_NAME: {
      if (input.type === 'name' && input.value) {
        const sanitized = validators.sanitizeName(input.value);
        if (!sanitized || sanitized.length < 1) {
          return `Please enter a valid name using letters only.\n\n_Type *cancel/0* to go back._`;
        }
        const newName = sessionMgr.updateName(userId, sanitized);
        sessionMgr.setState(userId, STATES.MAIN_MENU);
        // Two bubbles: name updated + main menu
        return [
          formatter.nameUpdated(newName),
          formatter.mainMenu(newName),
        ];
      }
      return `Please enter a valid name.\n\n_Type *cancel/0* to go back._`;
    }

    // ── COLLECTING ────────────────────────────────────────────────
    case STATES.COLLECTING: {
      if (input.type === 'greeting') {
        return formatter.alreadyInSessionMessage();
      }

      if (input.type === 'done') {
        const stats = getFileStats(userId, sessionMgr);
        const totalItems = stats.totalFiles + stats.totalLinks + stats.totalCodeSnippets;
        if (totalItems === 0) {
          return formatter.noFilesError();
        }

        // Route based on selectedMethod
        return await _processShare(userId, session, sessionMgr, stats, sendProgress);
      }

      // Link received via text
      if (input.type === 'link') {
        if (session.codeSnippets.length > 0) {
          return formatter.filesBlockedByCodeSnippet();
        }
        const fileId = validators.generateFileId(true, input.value);
        sessionMgr.addLink(userId, input.value, fileId);
        return formatter.linkReceivedMessage(input.value);
      }

      // Text → code snippet
      if (input.type === 'text' && input.value) {
        if (session.files.length > 0 || session.links.length > 0) {
          return formatter.codeSnippetBlockedByFiles();
        }
        sessionMgr.addCodeSnippet(userId, input.value);
        return formatter.codeSnippetReceivedMessage();
      }

      return null; // Media handled by messageHandler
    }

    // ── LABSHARE_ROOM ─────────────────────────────────────────────
    case STATES.LABSHARE_ROOM: {
      if (input.type === 'room') {
        session.roomNumber = input.value;

        // Code snippets → auto-skip recipient (always students)
        if (session.codeSnippets.length > 0) {
          session.recipientType = 'students';
          return await _executeLabShare(userId, session, sessionMgr, sendProgress);
        }

        sessionMgr.setState(userId, STATES.LABSHARE_RECIPIENT);
        return formatter.showRecipientOptions(input.value);
      }

      return formatter.invalidRoomError(config.validRooms);
    }

    // ── LABSHARE_RECIPIENT ────────────────────────────────────────
    case STATES.LABSHARE_RECIPIENT: {
      if (input.type === 'recipient') {
        session.recipientType = input.value === '1' ? 'print' : 'all';
        return await _executeLabShare(userId, session, sessionMgr, sendProgress);
      }

      return formatter.invalidRecipientError();
    }

    // ── Processing states (shouldn't receive messages) ────────────
    case STATES.PROCESSING_ONESHARE:
    case STATES.PROCESSING_MULTISHARE:
    case STATES.PROCESSING_LABSHARE:
      return `⏳ Please wait, your files are being shared...`;

    default:
      sessionMgr.destroySession(userId);
      return formatter.promptGreeting();
  }
}

// ─── Share Execution Helpers ────────────────────────────────────────

/**
 * Route to the correct share handler based on selectedMethod.
 * Returns the success message string.
 */
async function _processShare(userId, session, sessionMgr, stats, sendProgress) {
  const method = session.selectedMethod;

  switch (method) {
    case 'oneshare':
      return await _executeOneShare(userId, session, sessionMgr, stats, sendProgress);
    case 'multishare':
      return await _executeMultiShare(userId, session, sessionMgr, stats, sendProgress);
    case 'labshare': {
      // LabShare needs room number first
      sessionMgr.setState(userId, STATES.LABSHARE_ROOM);
      const hasCode = stats.totalCodeSnippets > 0;
      return formatter.askRoomNumber(hasCode);
    }
    default:
      // Fallback (shouldn't happen)
      sessionMgr.setState(userId, STATES.MAIN_MENU);
      return formatter.mainMenu(session.senderName);
  }
}

async function _executeOneShare(userId, session, sessionMgr, stats, sendProgress) {
  sessionMgr.setState(userId, STATES.PROCESSING_ONESHARE);
  try {
    const sendingMsg = formatter.sendingMessage(stats);
    if (sendProgress) {
      await sendProgress(sendingMsg);
    }
    const sessionData = sessionMgr.getSessionData(userId);

    const result = await shareManager.createOneShare(sessionData);

    const successMsg = formatter.oneShareSuccess({
      code: result.code,
      validFor: '10 Minutes',
      totalFiles: stats.totalFiles,
      links: stats.totalLinks,
      codeSnippets: stats.totalCodeSnippets,
      size: stats.totalSizeMB,
    });

    sessionMgr.sessions.delete(userId);
    logger.info('OneShare created', { userId, code: result.code });

    return successMsg;
  } catch (err) {
    logger.error('OneShare creation failed', { userId, error: err.message });
    sessionMgr.setState(userId, STATES.MAIN_MENU);
    return formatter.serviceUnavailableMessage();
  }
}

async function _executeMultiShare(userId, session, sessionMgr, stats, sendProgress) {
  sessionMgr.setState(userId, STATES.PROCESSING_MULTISHARE);
  try {
    const sendingMsg = formatter.sendingMessage(stats);
    if (sendProgress) {
      await sendProgress(sendingMsg);
    }
    const sessionData = sessionMgr.getSessionData(userId);

    const result = await shareManager.createMultiShare(sessionData);

    const successMsg = formatter.multiShareSuccess({
      code: result.code,
      validFor: '5 Minutes',
      totalFiles: stats.totalFiles,
      links: stats.totalLinks,
      codeSnippets: stats.totalCodeSnippets,
      size: stats.totalSizeMB,
    });

    sessionMgr.sessions.delete(userId);
    logger.info('MultiShare created', { userId, code: result.code });

    return successMsg;
  } catch (err) {
    logger.error('MultiShare creation failed', { userId, error: err.message });
    sessionMgr.setState(userId, STATES.MAIN_MENU);
    return formatter.serviceUnavailableMessage();
  }
}

async function _executeLabShare(userId, session, sessionMgr, sendProgress) {
  sessionMgr.setState(userId, STATES.PROCESSING_LABSHARE);
  try {
    const stats = getFileStats(userId, sessionMgr);
    const sendingMsg = formatter.sendingMessage(stats);
    if (sendProgress) {
      await sendProgress(sendingMsg);
    }
    const sessionData = sessionMgr.getSessionData(userId);

    const sanitizedName = validators.sanitizeName(session.senderName);
    const generatedId = validators.generateUserId(sanitizedName, session.senderPhone);
    const recipientType = session.recipientType === 'students'
      ? 'students'
      : (session.recipientType === 'print' ? 'print' : 'all');

    const result = await shareManager.createLabShare(
      sessionData,
      session.roomNumber,
      recipientType,
      sanitizedName || session.senderName,
      generatedId
    );

    const toLabel = recipientType === 'print'
      ? 'Lab Admin (Print)'
      : (recipientType === 'students' ? 'All Students' : 'Everyone (Admin + Students)');

    const successMsg = formatter.labShareSuccess({
      name: (sanitizedName || session.senderName).toUpperCase(),
      id: generatedId,
      room: session.roomNumber,
      to: toLabel,
      totalFiles: stats.totalFiles,
      links: stats.totalLinks,
      codeSnippets: stats.totalCodeSnippets,
      size: stats.totalSizeMB,
    });

    sessionMgr.sessions.delete(userId);
    logger.info('LabShare created', { userId, room: session.roomNumber });

    return successMsg;
  } catch (err) {
    logger.error('LabShare creation failed', { userId, error: err.message });
    sessionMgr.setState(userId, STATES.MAIN_MENU);
    return formatter.serviceUnavailableMessage();
  }
}

// ─── Exports ────────────────────────────────────────────────────────

module.exports = {
  STATES,
  parseInput,
  processMessage,
};
