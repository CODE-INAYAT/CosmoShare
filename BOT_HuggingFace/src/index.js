'use strict';

// Force IPv4-first DNS (Docker containers often have broken IPv6 routing)
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');

const config = require('./config');
const logger = require('./utils/logger');
const waClient = require('./whatsapp/client');
const { sessionManager, STATES, getSavedName, saveName } = require('./conversation/session');
const { processMessage } = require('./conversation/stateMachine');
const validators = require('./utils/validators');
const formatter = require('./utils/formatter');
const signalingServer = require('./signaling/server');
const { registerRoutes: registerFileRoutes } = require('./relay/fileServer');
const { registerRoutes: registerAPIRoutes } = require('./api/routes');
const featuresConfig = require('../config/features.json');

// ─── Ensure directories exist ────────────────────────────────────────
function ensureDirectories() {
  const dirs = [
    path.resolve(config.bot.sessionDir),
    path.resolve(config.bot.tempDir),
    path.resolve(config.bot.tempDir, 'relay'),
    path.resolve(__dirname, '..', 'logs'),
  ];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

// ─── 24-Hour Greeting Persistence ────────────────────────────────────
const GREETINGS_FILE = path.resolve(config.bot.sessionDir, 'greetings.json');
let greetingStore = new Map();

function loadGreetings() {
  try {
    if (fs.existsSync(GREETINGS_FILE)) {
      const raw = fs.readFileSync(GREETINGS_FILE, 'utf-8');
      greetingStore = new Map(Object.entries(JSON.parse(raw)));
      // Cleanup entries older than 48h
      const cutoff = Date.now() - (48 * 60 * 60 * 1000);
      for (const [phone, timestamp] of greetingStore) {
        if (timestamp < cutoff) greetingStore.delete(phone);
      }
    }
  } catch {}
}

function saveGreetings() {
  try {
    const dir = path.dirname(GREETINGS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(GREETINGS_FILE, JSON.stringify(Object.fromEntries(greetingStore), null, 2), 'utf-8');
  } catch {}
}

function shouldSendGreeting(phone) {
  const now = Date.now();
  const clean = (phone || '').replace(/\D/g, '');
  const lastTime = greetingStore.get(clean);
  if (!lastTime || now - lastTime > 24 * 60 * 60 * 1000) {
    greetingStore.set(clean, now);
    saveGreetings();
    return true;
  }
  return false;
}

loadGreetings();

// ─── Message dedup ───────────────────────────────────────────────────
const processedMessageIds = new Set();

function markMessageProcessed(msgId) {
  if (!msgId) return false;
  if (processedMessageIds.has(msgId)) return true;
  processedMessageIds.add(msgId);
  setTimeout(() => processedMessageIds.delete(msgId), 30000);
  return false;
}

// ─── Rate limiting ───────────────────────────────────────────────────
const lastReplyTimestamps = new Map();

function isRateLimited(jid) {
  const now = Date.now();
  const last = lastReplyTimestamps.get(jid) || 0;
  if (now - last < config.messageRateLimitMs) return true;
  lastReplyTimestamps.set(jid, now);
  return false;
}

// ─── Message queue (sequential per user) ─────────────────────────────
const userQueues = new Map();

function queueMessage(jid, fn) {
  const current = userQueues.get(jid) || Promise.resolve();
  const next = current.then(async () => {
    try { await fn(); } catch (err) {
      logger.error('Message processing error', { error: err.message });
    }
  });
  userQueues.set(jid, next);
  next.then(() => { if (userQueues.get(jid) === next) userQueues.delete(jid); });
}

// ─── Media batching ──────────────────────────────────────────────────
const pendingBatches = new Map();
const MEDIA_TYPES = new Set(['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage']);

function hasMedia(msg) {
  const m = msg.message;
  if (!m) return false;
  for (const type of MEDIA_TYPES) {
    if (m[type]) return true;
  }
  return false;
}

function getMediaMimeType(msg) {
  const m = msg.message;
  if (!m) return 'application/octet-stream';
  for (const type of MEDIA_TYPES) {
    if (m[type]?.mimetype) return m[type].mimetype;
  }
  return 'application/octet-stream';
}

function getMediaFileName(msg) {
  const m = msg.message;
  if (!m) return `file_${Date.now()}`;
  for (const type of MEDIA_TYPES) {
    if (m[type]?.fileName) return m[type].fileName;
  }
  // Generate filename from mime type
  const mime = require('mime-types');
  const mimeType = getMediaMimeType(msg);
  const ext = mime.extension(mimeType) || 'bin';
  return `file_${Date.now()}.${ext}`;
}

// ─── Process a batch of media messages ───────────────────────────────
async function flushBatch(jid) {
  const batch = pendingBatches.get(jid);
  if (!batch || batch.messages.length === 0) {
    pendingBatches.delete(jid);
    return;
  }

  const messages = batch.messages.splice(0);
  pendingBatches.delete(jid);

  let session = sessionManager.getSession(jid);

  // Auto-create session if needed
  if (!session) {
    const name = messages[0]?.pushName || 'User';
    session = sessionManager.createSession(jid, name);
    // Show menu first
    await safeSend(jid, formatter.mainMenu(session.senderName));
    return;
  }

  // If not in COLLECTING state, show a prompt
  if (session.state !== STATES.COLLECTING) {
    await safeSend(jid, formatter.mainMenu(session.senderName));
    return;
  }

  // Block files if code snippets exist
  if (session.codeSnippets.length > 0) {
    await safeSend(jid, formatter.filesBlockedByCodeSnippet());
    return;
  }

  // Download and add each file — PARALLEL downloads (Baileys, no mutex!)
  const downloadPromises = messages.map(async (msg) => {
    try {
      const buffer = await waClient.downloadMedia(msg);
      if (!buffer || buffer.length === 0) return null;

      const fileName = getMediaFileName(msg);
      const mimeType = getMediaMimeType(msg);
      const fileSize = buffer.length;

      // Check file size
      if (!validators.validateFileSize(fileSize)) {
        const sizeMB = (fileSize / (1024 * 1024)).toFixed(2);
        await safeSend(jid, formatter.fileSkippedTooLargeMessage(fileName, sizeMB, config.bot.maxFileSizeMB));
        return null;
      }

      return {
        fileName,
        fileSize,
        fileType: mimeType,
        mimetype: mimeType,
        fileId: validators.generateFileId(false),
        buffer, // Store buffer directly — eager download for instant relay
      };
    } catch (err) {
      logger.error('Media download failed', { error: err.message });
      return null;
    }
  });

  const results = await Promise.all(downloadPromises);

  for (const fileInfo of results) {
    if (fileInfo) {
      sessionManager.addFile(jid, fileInfo);
      await safeSend(jid, formatter.fileReceivedMessage(fileInfo.fileName));
    }
  }
}

// ─── Safe send helper ────────────────────────────────────────────────
async function safeSend(jid, text) {
  if (!text) return;
  try {
    await waClient.sendMessage(jid, text);
  } catch (err) {
    logger.error('Failed to send message', { error: err.message });
  }
}

async function sendResponse(jid, response) {
  if (!response) return;
  if (Array.isArray(response)) {
    for (const msg of response) {
      if (msg) await safeSend(jid, msg);
    }
  } else {
    await safeSend(jid, response);
  }
}



// ═══════════════════════════════════════════════════════════════════════
// MAIN STARTUP
// ═══════════════════════════════════════════════════════════════════════

async function main() {
  logger.info('╔════════════════════════════════════════════╗');
  logger.info('║   CosmoShare Bot v3.0 — Hybrid Engine      ║');
  logger.info('╚════════════════════════════════════════════╝');

  ensureDirectories();

  // ── 1. Create Express app and HTTP server ──
  const app = express();
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true }));

  const httpServer = http.createServer(app);

  // ── 2. Attach Socket.IO signaling server (in-process) ──
  const io = signalingServer.attachToServer(httpServer);
  logger.info('✅ Socket.IO signaling server attached (path: /api/socket/io)');

  // ── 3. Register Express routes ──
  registerFileRoutes(app);
  registerAPIRoutes(app);
  logger.info('✅ Express routes registered');

  // ── 4. Start HTTP server ──
  const port = config.health.port;
  httpServer.listen(port, '0.0.0.0', () => {
    logger.info(`✅ HTTP server listening on port ${port}`);
    logger.info(`   Dashboard: http://0.0.0.0:${port}/`);
    logger.info(`   Health:    http://0.0.0.0:${port}/ping`);
    logger.info(`   Socket.IO: ws://0.0.0.0:${port}/api/socket/io`);
  });

  // ── 5. Initialize WhatsApp (whatsapp-web.js + Chromium) ──
  logger.info('Initializing WhatsApp client (Chromium)...');

  waClient.on('qr', (qr) => {
    logger.info('QR code ready — scan with WhatsApp');
  });

  waClient.on('ready', () => {
    logger.info('✅ WhatsApp Bot is ready!');
  });

  // ── 6. Handle incoming WhatsApp messages ──
  waClient.on('message', async (msg) => {
    const jid = msg.key.remoteJid;
    if (!jid) return;

    // Test number restriction
    if (config.test.enableTestNumbersOnly) {
      const phone = waClient.getPhoneFromJid(jid);
      if (!config.test.allowedTestNumbers.includes(phone)) {
        logger.debug('Message blocked: test number restriction', { phone });
        return;
      }
    }

    // Dedup
    const msgId = msg.key.id;
    if (markMessageProcessed(msgId)) return;

    // ── Media messages: batch and eagerly download ──
    if (hasMedia(msg)) {
      let batch = pendingBatches.get(jid);
      if (!batch) {
        batch = { messages: [], timer: null };
        pendingBatches.set(jid, batch);
      }
      batch.messages.push(msg);

      if (batch.timer) clearTimeout(batch.timer);
      batch.timer = setTimeout(() => {
        queueMessage(jid, () => flushBatch(jid));
      }, 2500);
      return;
    }

    // ── Text messages ──
    if (isRateLimited(jid)) return;

    queueMessage(jid, async () => {
      // Flush pending media batch first
      if (pendingBatches.has(jid)) {
        await flushBatch(jid);
      }

      // Get message text
      const body = (
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        ''
      ).trim();

      if (!body) return;

      // Check for session
      let session = sessionManager.getSession(jid);

      // If no session, auto-create on greeting or any input
      if (!session) {
        const pushName = msg.pushName || 'User';
        session = sessionManager.createSession(jid, pushName);

        // Send daily greeting if applicable
        const phone = waClient.getPhoneFromJid(jid);
        if (shouldSendGreeting(phone)) {
          if (featuresConfig.REMOVE_NAME_FROM_GREETING) {
            await safeSend(jid, `👋 *Hi!* Welcome to CosmoShare.`);
          } else {
            const name = session.senderName;
            const formatted = name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
            await safeSend(jid, `👋 *Hi ${formatted}!* Welcome to CosmoShare.`);
          }
        }

        // Show main menu
        await safeSend(jid, formatter.mainMenu(session.senderName));
        return;
      }

      // Update activity
      sessionManager.updateActivity(jid);

      // Link detection in COLLECTING state
      if (session.state === STATES.COLLECTING) {
        const url = validators.detectAndNormalizeLink(body);
        if (url) {
          if (session.codeSnippets.length > 0) {
            await safeSend(jid, formatter.filesBlockedByCodeSnippet());
            return;
          }
          const fileId = validators.generateFileId(true, url);
          sessionManager.addLink(jid, url, fileId);
          await safeSend(jid, formatter.linkReceivedMessage(url));
          return;
        }
      }

      // Process through state machine
      const sendProgress = async (text) => await safeSend(jid, text);
      const response = await processMessage(jid, body, sessionManager, sendProgress);
      await sendResponse(jid, response);
    });
  });

  // Start WhatsApp client
  await waClient.initialize();

  // ── Graceful shutdown ──
  async function gracefulShutdown(signal) {
    logger.info(`Received ${signal}. Shutting down...`);
    try {
      await waClient.destroy();
    } catch {}
    process.exit(0);
  }

  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception', { error: err.message, stack: err.stack });
  });
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection', { reason: String(reason) });
  });
}

// Run
main().catch(err => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
