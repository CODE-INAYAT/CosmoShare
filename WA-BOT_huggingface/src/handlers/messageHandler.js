'use strict';

const logger = require('../utils/logger');
const config = require('../config');
const { sessionManager, STATES } = require('../conversation/session');
const { processMessage } = require('../conversation/stateMachine');
const { downloadMedia, saveToTemp, getFileStats } = require('./fileHandler');
const validators = require('../utils/validators');
const formatter = require('../utils/formatter');
const pauseService = require('../services/pauseService');

/** Rate limit tracking: userId → last reply timestamp */
const lastReplyTimestamps = new Map();

/** Sequential queue per user to process messages in order */
const userQueues = new Map();

/** Map tracking pending media batches: userId → { timer, messages: [] } */
const pendingBatches = new Map();

/**
 * Deduplication: tracks recently processed message IDs so that
 * if both 'message' and 'message_create' fire for the same message,
 * we only process it once. Entries auto-expire after 30 seconds.
 */
const processedMessageIds = new Set();
const MESSAGE_DEDUP_TTL_MS = 30000;

function markMessageProcessed(msgId) {
  if (!msgId) return false;
  if (processedMessageIds.has(msgId)) return true;
  processedMessageIds.add(msgId);
  setTimeout(() => processedMessageIds.delete(msgId), MESSAGE_DEDUP_TTL_MS);
  return false;
}

/** Known media message types in whatsapp-web.js */
const MEDIA_TYPES = new Set(['image', 'video', 'audio', 'ptt', 'document', 'sticker']);

/**
 * Determine if a message is a media message.
 * Checks BOTH message.hasMedia AND message.type.
 */
function isMediaMessage(message) {
  if (message.hasMedia) return true;
  if (MEDIA_TYPES.has(message.type)) return true;
  return false;
}

function queueMessage(userId, fn) {
  const currentQueue = userQueues.get(userId) || Promise.resolve();
  const nextQueue = currentQueue.then(async () => {
    try {
      await fn();
    } catch (err) {
      logger.error('User message queue processing error', { userId, error: err.message });
    }
  });
  userQueues.set(userId, nextQueue);

  nextQueue.then(() => {
    if (userQueues.get(userId) === nextQueue) {
      userQueues.delete(userId);
    }
  });
}

/**
 * Check rate limit. Returns true if the message should be throttled.
 */
function isRateLimited(userId) {
  const now = Date.now();
  const lastReply = lastReplyTimestamps.get(userId) || 0;
  if (now - lastReply < config.messageRateLimitMs) {
    return true;
  }
  lastReplyTimestamps.set(userId, now);
  return false;
}

/**
 * Extract phone digits from userId.
 */
function extractPhone(userId) {
  return (userId || '').replace(/@.*$/, '').replace(/\D/g, '');
}

/**
 * Extract URL from text.
 * @deprecated Use validators.detectAndNormalizeLink instead.
 */
function extractUrl(text) {
  const match = (text || '').match(/https?:\/\/[^\s]+/i);
  return match ? match[0] : null;
}

// ─── Send Response Helper ───────────────────────────────────────────

/**
 * Send a response from the state machine.
 * Handles both single string and array (multi-bubble) responses.
 */
async function sendResponse(client, userId, response) {
  if (!response) return;

  if (Array.isArray(response)) {
    // Multi-bubble: send each as a separate message
    for (const msg of response) {
      if (msg) await safeSend(client, userId, msg);
    }
  } else {
    await safeSend(client, userId, response);
  }
}

// ─── Main Handler ───────────────────────────────────────────────────

/**
 * Main message event handler.
 * Attach to both client.on('message') and client.on('message_create').
 * Deduplication ensures each message is processed exactly once.
 * @param {object} client - whatsapp-web.js Client instance
 */
function createMessageHandler(client) {
  return async function onMessage(message) {
    // Check if the bot is temporarily paused
    if (pauseService.isPaused()) {
      logger.debug('Message ignored: bot is temporarily paused');
      return;
    }

    // Ignore group messages
    if (message.from.endsWith('@g.us')) return;

    // Ignore status updates
    if (message.from === 'status@broadcast') return;

    // Ignore messages from self
    if (message.fromMe) return;

    // Deduplication
    const msgId = message.id?.id || message.id?._serialized;
    if (markMessageProcessed(msgId)) {
      logger.debug('Duplicate message skipped', { msgId, type: message.type });
      return;
    }

    const userId = message.from;

    // Exception handling for unsupported message types
    if (message.type === 'poll' || message.type === 'poll_creation') {
      await safeSend(client, userId, '⚠️ Sorry, WA-BOT does not support poll sharing. Please send files, links, or code snippets.');
      return;
    }
    if (message.type === 'payment' || message.type === 'pay') {
      await safeSend(client, userId, '⚠️ Sorry, WA-BOT does not support payments. Please send files, links, or code snippets.');
      return;
    }
    if (message.type === 'event' || message.type === 'event_creation') {
      await safeSend(client, userId, '⚠️ Sorry, WA-BOT does not support event sharing. Please send files, links, or code snippets.');
      return;
    }

    // ── MEDIA MESSAGES: bypass rate limiter ──────────────────────────
    if (isMediaMessage(message)) {
      let batch = pendingBatches.get(userId);
      if (!batch) {
        batch = { messages: [], timer: null };
        pendingBatches.set(userId, batch);
      }
      batch.messages.push(message);

      logger.info('Media message added to batch', {
        userId,
        batchSize: batch.messages.length,
        type: message.type,
        hasMedia: message.hasMedia,
        msgId,
      });

      if (batch.timer) {
        clearTimeout(batch.timer);
      }

      batch.timer = setTimeout(() => {
        queueMessage(userId, async () => {
          await flushBatch(client, userId);
        });
      }, 2500);

      return;
    }

    // ── NON-MEDIA MESSAGES: apply rate limiter ──────────────────────
    if (isRateLimited(userId)) {
      logger.debug('Rate limited (non-media)', { userId });
      return;
    }

    queueMessage(userId, async () => {
      try {
        // Flush pending media batch if we receive a non-media message
        if (pendingBatches.has(userId)) {
          await flushBatch(client, userId);
        }

        // Handle location messages
        if (message.type === 'location') {
          await handleLocationMessage(client, message, userId);
          return;
        }

        // Handle contact sharing (vcard)
        if (message.type === 'vcard' || message.type === 'multi_vcard') {
          await handleContactMessage(client, message, userId);
          return;
        }

        // Handle text messages
        const body = (message.body || '').trim();
        if (!body) return;

        // Check for URL in text — only process as link if in COLLECTING state
        const whatsappDetectedLinks = Array.isArray(message.links) ? message.links.map(l => l.link) : [];
        const url = validators.detectAndNormalizeLink(body, whatsappDetectedLinks);
        if (url) {
          const session = sessionManager.getSession(userId);
          if (session && session.state === STATES.COLLECTING) {
            if (session.codeSnippets.length > 0) {
              await safeSend(client, userId, formatter.filesBlockedByCodeSnippet());
              return;
            }
            const fileId = validators.generateFileId(true, url);
            sessionManager.addLink(userId, url, fileId);
            await safeSend(client, userId, formatter.linkReceivedMessage(url));
            return;
          }
        }

        // Ensure session exists — create on greeting/menu or any interaction
        let session = sessionManager.getSession(userId);
        if (!session) {
          const normalized = validators.normalizeInput(body);
          if (validators.isGreeting(normalized) || validators.isMenu(normalized)) {
            const contact = await message.getContact();
            const profileName = contact.pushname || contact.name || 'User';
            const phone = extractPhone(userId);
            session = sessionManager.createSession(userId, profileName, phone);
            // Show main menu immediately
            await safeSend(client, userId, formatter.mainMenu(session.senderName));
            return;
          }
          // No session and not a greeting → prompt
          await safeSend(client, userId, formatter.promptGreeting());
          return;
        }

        // Process via state machine
        const response = await processMessage(userId, body, sessionManager, async (text) => {
          await safeSend(client, userId, text);
        });
        await sendResponse(client, userId, response);

      } catch (err) {
        logger.error('Message handler error', {
          userId,
          error: err.message,
          stack: err.stack,
        });

        try {
          const errorMsg = err.userMessage || formatter.genericErrorMessage();
          await safeSend(client, userId, errorMsg);
        } catch (sendErr) {
          logger.error('Failed to send error message', { error: sendErr.message });
        }
      }
    });
  };
}

// ─── Media Batch Processing ─────────────────────────────────────────

/**
 * Sequential processing of a user's batched media messages.
 */
async function flushBatch(client, userId) {
  const batch = pendingBatches.get(userId);
  if (!batch) return;
  pendingBatches.delete(userId);

  if (batch.timer) {
    clearTimeout(batch.timer);
  }

  const messages = batch.messages;
  const total = messages.length;
  if (total === 0) return;

  logger.info('Processing media batch', { userId, count: total });

  let session = sessionManager.getSession(userId);

  // Auto-create session if user sends media without greeting
  if (!session) {
    const contact = await messages[0].getContact();
    const profileName = contact.pushname || contact.name || 'User';
    const phone = extractPhone(userId);
    session = sessionManager.createSession(userId, profileName, phone);
    // Show menu first — user needs to pick a method before collecting files
    await safeSend(client, userId, formatter.mainMenu(session.senderName));
    // Store the messages back into a pending batch so they're processed
    // after the user picks a method
    // For now, inform user to pick a method first
    await safeSend(client, userId, `📎 ${total} file(s) detected. Please select a sharing method first, then send your files.`);
    return;
  }

  if (session.state !== STATES.COLLECTING) {
    await safeSend(client, userId, `⚠️ Please select a sharing method first (1, 2, or 3), then send your files.\n\n_Type *menu/9* to see options._`);
    return;
  }

  // If session already has code snippets, reject files
  if (session.codeSnippets.length > 0) {
    await safeSend(client, userId, formatter.filesBlockedByCodeSnippet());
    return;
  }

  let statusMessage = null;
  const receivedFileNames = [];

  for (let i = 0; i < total; i++) {
    const msg = messages[i];
    try {
      // Download media (fileHandler uses mutex + fast timeouts + auto-retry)
      const media = await downloadMedia(msg);
      const fileSizeBytes = media.data.length;
      const fileSizeMB = (fileSizeBytes / (1024 * 1024)).toFixed(2);

      // Validate file size
      if (!validators.validateFileSize(fileSizeBytes)) {
        const errorText = formatter.fileSkippedTooLargeMessage(media.filename, fileSizeMB, config.bot.maxFileSizeMB);
        await safeSend(client, userId, errorText);
        continue;
      }

      // Save to temp
      const tempPath = saveToTemp(media, userId);
      const fileType = media.mimetype || 'application/octet-stream';
      const fileId = validators.generateFileId(false);

      // Add to session
      sessionManager.addFile(userId, {
        fileName: media.filename,
        fileSize: fileSizeBytes,
        fileType,
        mimetype: media.mimetype,
        tempPath,
        fileId,
      });

      const ellipsizedName = ellipsizeFileName(media.filename, 20);
      receivedFileNames.push(ellipsizedName);

      // Send status update
      const progressIndex = i + 1;
      const progressText = `Files Received (${progressIndex}/${total})`;

      const detailsText = config.bot.updateSingleMessage
        ? `✅ ${progressText}:\n` + receivedFileNames.map(name => `- *${name}*`).join('\n')
        : `✅ File received: *${ellipsizedName}* (${progressText})`;

      if (config.bot.updateSingleMessage) {
        if (!statusMessage) {
          statusMessage = await safeSend(client, userId, detailsText);
        } else {
          try {
            await statusMessage.edit(detailsText);
          } catch (editErr) {
            logger.error('Failed to edit status message, sending new one', { error: editErr.message });
            statusMessage = await safeSend(client, userId, detailsText);
          }
        }
      } else {
        await safeSend(client, userId, detailsText);
      }
    } catch (err) {
      logger.error('Failed to process batch media message', { userId, index: i, error: err.message });
      await safeSend(client, userId, `❌ Failed to process file ${i + 1}.`);
    }
  }
}

// ─── Location Message Handler ───────────────────────────────────────

async function handleLocationMessage(client, message, userId) {
  try {
    let session = sessionManager.getSession(userId);

    if (session && session.codeSnippets.length > 0) {
      await safeSend(client, userId, formatter.filesBlockedByCodeSnippet());
      return;
    }

    if (!session) {
      const contact = await message.getContact();
      const profileName = contact.pushname || contact.name || 'User';
      const phone = extractPhone(userId);
      session = sessionManager.createSession(userId, profileName, phone);
      await safeSend(client, userId, formatter.mainMenu(session.senderName));
      await safeSend(client, userId, `📍 Location detected. Please select a sharing method first, then send your location.`);
      return;
    }

    if (session.state !== STATES.COLLECTING) {
      await safeSend(client, userId, `⚠️ Please select a sharing method first (1, 2, or 3), then send your location.\n\n_Type *menu/9* to see options._`);
      return;
    }

    const loc = message.location;
    if (!loc) {
      throw new Error('Location data missing from message');
    }

    const latitude = loc.latitude;
    const longitude = loc.longitude;
    const name = loc.name || 'Shared Location';
    const address = loc.address || `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;

    const fileId = validators.generateFileId(true, `https://www.google.com/maps?q=${latitude},${longitude}`);

    sessionManager.addFile(userId, {
      fileName: name,
      fileSize: 0,
      fileType: 'location',
      mimetype: 'application/json',
      tempPath: null,
      fileId,
      location: { latitude, longitude, name, address }
    });

    await safeSend(client, userId, `✅ Location received: *${name}* (${address})`);
  } catch (err) {
    logger.error('Location handling error', { userId, error: err.message });
    await safeSend(client, userId, '❌ Failed to process that location. Please try again.');
  }
}

// ─── Contact Message Handler ────────────────────────────────────────

async function handleContactMessage(client, message, userId) {
  try {
    let session = sessionManager.getSession(userId);

    if (session && session.codeSnippets.length > 0) {
      await safeSend(client, userId, formatter.filesBlockedByCodeSnippet());
      return;
    }

    if (!session) {
      const contact = await message.getContact();
      const profileName = contact.pushname || contact.name || 'User';
      const phone = extractPhone(userId);
      session = sessionManager.createSession(userId, profileName, phone);
      await safeSend(client, userId, formatter.mainMenu(session.senderName));
      await safeSend(client, userId, `👤 Contact detected. Please select a sharing method first, then send your contacts.`);
      return;
    }

    if (session.state !== STATES.COLLECTING) {
      await safeSend(client, userId, `⚠️ Please select a sharing method first (1, 2, or 3), then send your contacts.\n\n_Type *menu/9* to see options._`);
      return;
    }

    const vcards = message.vCards || [];
    if (vcards.length === 0 && message.body) {
      vcards.push(message.body);
    }

    if (vcards.length === 0) {
      throw new Error('No vCard data found');
    }

    const parsedContacts = [];
    for (const vcard of vcards) {
      const parsed = _parseVCard(vcard);
      if (parsed.name) {
        parsedContacts.push({ ...parsed, vcard });
      }
    }

    if (parsedContacts.length === 0) {
      throw new Error('Failed to parse contact card data');
    }

    for (const contactInfo of parsedContacts) {
      const fileId = validators.generateFileId(true, `tel:${contactInfo.phone}`);
      sessionManager.addFile(userId, {
        fileName: contactInfo.name,
        fileSize: 0,
        fileType: 'contact',
        mimetype: 'text/vcard',
        tempPath: null,
        fileId,
        contact: { name: contactInfo.name, phone: contactInfo.phone }
      });
    }

    if (parsedContacts.length === 1) {
      await safeSend(client, userId, `✅ Contact received: *${parsedContacts[0].name}* (${parsedContacts[0].phone})`);
    } else {
      await safeSend(client, userId, `✅ ${parsedContacts.length} Contacts received successfully.`);
    }
  } catch (err) {
    logger.error('Contact handling error', { userId, error: err.message });
    await safeSend(client, userId, '❌ Failed to process that contact card. Please try again.');
  }
}

// ─── Utility Helpers ────────────────────────────────────────────────

function _parseVCard(vcardStr) {
  const fnMatch = vcardStr.match(/FN:(.+)/i);
  const telMatch = vcardStr.match(/TEL;.*:(.+)/i);
  const name = fnMatch ? fnMatch[1].trim() : 'Unknown Contact';
  const phone = telMatch ? telMatch[1].trim() : '';
  return { name, phone };
}

function ellipsizeFileName(name, max = 20) {
  if (typeof name !== 'string') return '';
  if (name.length <= max) return name;
  const extIndex = name.lastIndexOf('.');
  const ext = extIndex !== -1 ? name.slice(extIndex) : '';
  const base = extIndex !== -1 ? name.slice(0, extIndex) : name;

  const keep = max - ext.length - 1;
  if (keep <= 0) {
    return base.slice(0, 5) + '…' + ext;
  }
  const front = Math.ceil(keep / 2);
  const back = Math.floor(keep / 2);
  return base.slice(0, front) + '…' + base.slice(-back) + ext;
}

async function safeSend(client, chatId, text) {
  if (pauseService.isPaused()) {
    logger.warn('Send blocked: bot is temporarily paused', { chatId, text });
    return null;
  }
  try {
    return await client.sendMessage(chatId, text);
  } catch (err) {
    logger.error('Failed to send message', { chatId, error: err.message });
    return null;
  }
}

module.exports = { createMessageHandler };
