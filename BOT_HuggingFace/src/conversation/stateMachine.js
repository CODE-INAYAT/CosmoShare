'use strict';

const { STATES } = require('./session');
const validators = require('../utils/validators');
const formatter = require('../utils/formatter');
const logger = require('../utils/logger');
const config = require('../config');
const relayEngine = require('../relay/engine');

// ─── Input Parsing ──────────────────────────────────────────────────

function parseInput(text, currentState) {
  if (!text || typeof text !== 'string') return { type: 'unknown' };

  const normalized = validators.normalizeInput(text);

  // Global commands
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

    case STATES.EDIT_NAME:
      return { type: 'name', value: text.trim() };

    case STATES.COLLECTING: {
      const normalizedLink = validators.detectAndNormalizeLink(text);
      if (normalizedLink) return { type: 'link', value: normalizedLink };
      return { type: 'text', value: text.trim() };
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

    case STATES.LABSHARE_STUDENT_OPTION: {
      const studentOpt = validators.isValidStudentOption(normalized);
      if (studentOpt) return { type: 'studentOption', value: studentOpt };
      return { type: 'text', value: normalized };
    }

    case STATES.LABSHARE_PICK_MEMBER: {
      const memberId = validators.isValidMemberId(normalized);
      if (memberId) return { type: 'memberId', value: memberId };
      return { type: 'text', value: normalized };
    }

    default:
      return { type: 'text', value: normalized };
  }
}

// ─── File Stats Helper ──────────────────────────────────────────────

function getFileStats(jid, sessionMgr) {
  const session = sessionMgr.getSessionData(jid);
  if (!session) return { totalFiles: 0, totalLinks: 0, totalCodeSnippets: 0, totalSizeMB: '0.00' };

  const totalFiles = session.files.length;
  const totalLinks = session.links.length;
  const totalCodeSnippets = session.codeSnippets.length;
  const totalBytes = session.files.reduce((acc, f) => acc + (f.fileSize || f.buffer?.length || 0), 0);

  return {
    totalFiles,
    totalLinks,
    totalCodeSnippets,
    totalSizeMB: (totalBytes / (1024 * 1024)).toFixed(2),
  };
}

// ─── Process Message ────────────────────────────────────────────────

async function processMessage(jid, messageText, sessionMgr, sendProgress) {
  const session = sessionMgr.getSession(jid);
  const currentState = session ? session.state : STATES.IDLE;
  const input = parseInput(messageText, currentState);

  logger.debug('State machine input', { currentState, inputType: input.type, value: input.value });

  // ── Global: menu/9 ────────────────────────────────────────────
  if (input.type === 'menu') {
    if (session && (currentState === STATES.COLLECTING || currentState === STATES.LABSHARE_ROOM ||
        currentState === STATES.LABSHARE_RECIPIENT || currentState === STATES.LABSHARE_STUDENT_OPTION ||
        currentState === STATES.LABSHARE_PICK_MEMBER || currentState === STATES.CHOOSE_METHOD)) {
      sessionMgr.destroySession(jid);
    }
    const name = sessionMgr.getDisplayName(jid);
    if (session) {
      sessionMgr.setState(jid, STATES.MAIN_MENU);
      session.selectedMethod = null;
      session.files = [];
      session.links = [];
      session.codeSnippets = [];
      session.roomNumber = null;
      session.recipientType = null;
      session.targetMemberId = null;
    }
    return formatter.mainMenu(name);
  }

  // ── Global: cancel/0 ──────────────────────────────────────────
  if (input.type === 'cancel') {
    if (currentState === STATES.EDIT_NAME) {
      sessionMgr.setState(jid, STATES.MAIN_MENU);
      const name = sessionMgr.getDisplayName(jid);
      return formatter.mainMenu(name);
    }
    if (session) sessionMgr.destroySession(jid);
    return formatter.cancelledMessage();
  }

  // ── Route by state ────────────────────────────────────────────
  switch (currentState) {

    case STATES.IDLE: {
      if (input.type === 'greeting' || input.type === 'menuOption' || input.type === 'text') {
        if (!session) return null; // messageHandler handles session creation
        sessionMgr.setState(jid, STATES.MAIN_MENU);
        return formatter.mainMenu(session.senderName);
      }
      return formatter.promptGreeting();
    }

    case STATES.MAIN_MENU: {
      if (input.type === 'greeting') return formatter.mainMenu(session.senderName);

      if (input.type === 'menuOption') {
        switch (input.value) {
          case '1':
            session.selectedMethod = 'oneshare';
            sessionMgr.setState(jid, STATES.COLLECTING);
            return formatter.collectingEntry('oneshare');
          case '2':
            session.selectedMethod = 'labshare_print';
            sessionMgr.setState(jid, STATES.COLLECTING);
            return formatter.collectingEntry('labshare_print');
          case '3':
            session.selectedMethod = 'labshare_students';
            sessionMgr.setState(jid, STATES.COLLECTING);
            return formatter.collectingEntry('labshare_students');
          case '4':
            sessionMgr.setState(jid, STATES.EDIT_NAME);
            return formatter.editNamePrompt(session.senderName);
          case '5':
            return formatter.helpMessage();
        }
      }

      return formatter.invalidMenuOption();
    }

    case STATES.EDIT_NAME: {
      if (input.type === 'name' && input.value) {
        const sanitized = validators.sanitizeName(input.value);
        if (!sanitized || sanitized.length < 1) {
          return `Please enter a valid name using letters only.\n\n_Type *cancel/0* to go back._`;
        }
        const newName = sessionMgr.updateName(jid, sanitized);
        sessionMgr.setState(jid, STATES.MAIN_MENU);
        return [formatter.nameUpdated(newName), formatter.mainMenu(newName)];
      }
      return `Please enter a valid name.\n\n_Type *cancel/0* to go back._`;
    }

    case STATES.COLLECTING: {
      if (input.type === 'greeting') return formatter.alreadyInSessionMessage();

      if (input.type === 'done') {
        const stats = getFileStats(jid, sessionMgr);
        const totalItems = stats.totalFiles + stats.totalLinks + stats.totalCodeSnippets;
        if (totalItems === 0) return formatter.noFilesError();
        return await _processShare(jid, session, sessionMgr, stats, sendProgress);
      }

      if (input.type === 'link') {
        if (session.codeSnippets.length > 0) return formatter.filesBlockedByCodeSnippet();
        const fileId = validators.generateFileId(true, input.value);
        sessionMgr.addLink(jid, input.value, fileId);
        return formatter.linkReceivedMessage(input.value);
      }

      if (input.type === 'text' && input.value) {
        if (session.selectedMethod === 'labshare_print') return formatter.codeSnippetBlockedByPrint();
        if (session.files.length > 0 || session.links.length > 0) return formatter.codeSnippetBlockedByFiles();
        sessionMgr.addCodeSnippet(jid, input.value);
        return formatter.codeSnippetReceivedMessage();
      }

      return null;
    }

    case STATES.LABSHARE_ROOM: {
      if (input.type === 'room') {
        session.roomNumber = input.value;

        if (session.selectedMethod === 'labshare_print') {
          session.recipientType = 'print';
          return await _executeLabShare(jid, session, sessionMgr, sendProgress);
        }

        if (session.selectedMethod === 'labshare_students') {
          sessionMgr.setState(jid, STATES.LABSHARE_PICK_MEMBER);
          return formatter.showStudentOptions(input.value);
        }

        if (session.codeSnippets.length > 0) {
          session.recipientType = 'students';
          return await _executeLabShare(jid, session, sessionMgr, sendProgress);
        }

        sessionMgr.setState(jid, STATES.LABSHARE_RECIPIENT);
        return formatter.showRecipientOptions(input.value);
      }
      return formatter.invalidRoomError(config.validRooms);
    }

    case STATES.LABSHARE_STUDENT_OPTION: {
      const normalized = validators.normalizeInput(messageText);
      if (normalized === '1') {
        session.recipientType = 'students';
        return await _executeLabShare(jid, session, sessionMgr, sendProgress);
      }
      const memberId = validators.isValidMemberId(normalized);
      if (memberId) {
        session.targetMemberId = memberId;
        session.recipientType = 'single';
        return await _executeLabShare(jid, session, sessionMgr, sendProgress);
      }
      return formatter.invalidMemberIdError();
    }

    case STATES.LABSHARE_PICK_MEMBER: {
      const normalizedPick = validators.normalizeInput(messageText);
      if (normalizedPick === '1') {
        session.recipientType = 'students';
        return await _executeLabShare(jid, session, sessionMgr, sendProgress);
      }
      if (input.type === 'memberId') {
        session.targetMemberId = input.value;
        session.recipientType = 'single';
        return await _executeLabShare(jid, session, sessionMgr, sendProgress);
      }
      return formatter.invalidMemberIdError();
    }

    case STATES.LABSHARE_RECIPIENT: {
      if (input.type === 'recipient') {
        session.recipientType = input.value === '1' ? 'print' : 'all';
        return await _executeLabShare(jid, session, sessionMgr, sendProgress);
      }
      return formatter.invalidRecipientError();
    }

    case STATES.PROCESSING_ONESHARE:
    case STATES.PROCESSING_LABSHARE:
      return `⏳ Please wait, your files are being shared...`;

    default:
      sessionMgr.destroySession(jid);
      return formatter.promptGreeting();
  }
}

// ─── Share Execution ────────────────────────────────────────────────

async function _processShare(jid, session, sessionMgr, stats, sendProgress) {
  const method = session.selectedMethod;

  switch (method) {
    case 'oneshare':
      return await _executeOneShare(jid, session, sessionMgr, stats, sendProgress);

    case 'labshare_print':
    case 'labshare_students':
    case 'labshare':
      sessionMgr.setState(jid, STATES.LABSHARE_ROOM);
      return formatter.askRoomNumber();

    default:
      sessionMgr.setState(jid, STATES.MAIN_MENU);
      return formatter.mainMenu(session.senderName);
  }
}

async function _executeOneShare(jid, session, sessionMgr, stats, sendProgress) {
  sessionMgr.setState(jid, STATES.PROCESSING_ONESHARE);
  try {
    if (sendProgress) await sendProgress(formatter.sendingMessage(stats));

    const sessionData = sessionMgr.getSessionData(jid);

    // INSTANT: in-process function call — no network hops
    const result = relayEngine.createOneShare(sessionData);

    const successMsg = formatter.oneShareSuccess({
      code: result.code,
      validFor: '5 Minutes',
      totalFiles: stats.totalFiles,
      links: stats.totalLinks,
      codeSnippets: stats.totalCodeSnippets,
      size: stats.totalSizeMB,
    });

    sessionMgr.sessions.delete(jid);
    logger.info('OneShare created', { code: result.code });
    return successMsg;
  } catch (err) {
    logger.error('OneShare creation failed', { error: err.message });
    sessionMgr.setState(jid, STATES.MAIN_MENU);
    return formatter.serviceUnavailableMessage();
  }
}

async function _executeLabShare(jid, session, sessionMgr, sendProgress) {
  sessionMgr.setState(jid, STATES.PROCESSING_LABSHARE);
  try {
    const stats = getFileStats(jid, sessionMgr);
    if (sendProgress) await sendProgress(formatter.sendingMessage(stats));

    const sessionData = sessionMgr.getSessionData(jid);
    const sanitizedName = validators.sanitizeName(session.senderName);
    const generatedId = validators.generateUserId(sanitizedName, session.senderPhone);
    const recipientType = session.recipientType === 'students' ? 'students'
      : (session.recipientType === 'print' ? 'print'
        : (session.recipientType === 'single' ? 'single' : 'all'));

    // INSTANT: in-process function call
    const result = relayEngine.createLabShare(
      sessionData,
      session.roomNumber,
      recipientType,
      sanitizedName || session.senderName,
      generatedId,
      session.targetMemberId
    );

    if (recipientType === 'single' && result && result.memberNotFound) {
      sessionMgr.setState(jid, STATES.LABSHARE_PICK_MEMBER);
      return formatter.memberNotFound(session.targetMemberId, session.roomNumber);
    }

    let toLabel;
    switch (recipientType) {
      case 'print': toLabel = 'Lab Admin (Print)'; break;
      case 'students': toLabel = 'All Students'; break;
      case 'single': {
        const memberName = result?.targetMemberName || session.targetMemberId;
        toLabel = `${memberName} (${session.targetMemberId})`;
        break;
      }
      default: toLabel = 'Everyone (Admin + Students)';
    }

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

    sessionMgr.sessions.delete(jid);
    logger.info('LabShare created', { room: session.roomNumber, recipientType });
    return successMsg;
  } catch (err) {
    logger.error('LabShare creation failed', { error: err.message });
    sessionMgr.setState(jid, STATES.MAIN_MENU);
    return formatter.serviceUnavailableMessage();
  }
}

module.exports = { STATES, parseInput, processMessage };
