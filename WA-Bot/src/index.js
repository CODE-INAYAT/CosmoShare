'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const express = require('express');
const config = require('./config');
const logger = require('./utils/logger');
const client = require('./client');
const { createMessageHandler } = require('./handlers/messageHandler');
const { sessionManager, getSavedName } = require('./conversation/session');
const { cleanupAllTemp } = require('./handlers/fileHandler');

const startTime = Date.now();

// ─── 24-Hour Greeting Persistence ───────────────────────────────────
const GREETINGS_FILE = path.resolve(config.bot.sessionDir, 'greetings.json');
let greetingStore = new Map();

function _loadGreetings() {
  try {
    if (fs.existsSync(GREETINGS_FILE)) {
      const raw = fs.readFileSync(GREETINGS_FILE, 'utf-8');
      const data = JSON.parse(raw);
      greetingStore = new Map(Object.entries(data));
    }
  } catch (err) {
    logger.error('Failed to load greeting store', { error: err.message });
  }
}

function _saveGreetings() {
  try {
    const dir = path.dirname(GREETINGS_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const obj = Object.fromEntries(greetingStore);
    fs.writeFileSync(GREETINGS_FILE, JSON.stringify(obj, null, 2), 'utf-8');
  } catch (err) {
    logger.error('Failed to save greeting store', { error: err.message });
  }
}

function shouldSendGreeting(cleanNumber) {
  const now = Date.now();
  const phone = cleanNumber.replace(/\D/g, '');
  const lastTime = greetingStore.get(phone);
  if (!lastTime || now - lastTime > 24 * 60 * 60 * 1000) {
    greetingStore.set(phone, now);
    _saveGreetings();
    return true;
  }
  return false;
}

// Load greetings on module init
_loadGreetings();

async function sendDailyGreetingIfNeeded(cleanNumber) {
  if (shouldSendGreeting(cleanNumber)) {
    let nameVal = getSavedName(cleanNumber.replace(/\D/g, ''));
    if (!nameVal) {
      try {
        const contact = await client.getContactById(cleanNumber);
        nameVal = contact.pushname || contact.name || contact.shortName;
      } catch (err) {
        logger.warn('Failed to fetch contact details for name', { error: err.message });
      }
    }
    let formattedName = 'there';
    if (nameVal) {
      formattedName = nameVal.charAt(0).toUpperCase() + nameVal.slice(1).toLowerCase();
    }
    await client.sendMessage(cleanNumber, `👋 *Hi ${formattedName}!* Welcome to CosmoShare. Here is the resource shared from the web portal:`);
  }
}

// ─── Ensure directories exist ────────────────────────────────────────
function ensureDirectories() {
  const dirs = [
    path.resolve(config.bot.sessionDir),
    path.resolve(config.bot.tempDir),
    path.resolve(__dirname, '..', 'logs'),
  ];

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      logger.debug('Created directory', { dir });
    }
  }
}

// ─── Health & Sharing Server ─────────────────────────────────────────
function startHealthServer() {
  const app = express();

  // Middleware to authenticate API requests from the Next.js portal
  function checkApiAuth(req, res, next) {
    const authHeader = req.headers['authorization'] || '';
    const botSecretHeader = req.headers['x-bot-secret'] || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;

    const expectedSecret = config.bridge.apiSecret;
    if (!expectedSecret) {
      logger.warn('API authentication skipped because BRIDGE_API_SECRET is not set in bot config');
      return next();
    }

    if (token === expectedSecret || botSecretHeader === expectedSecret) {
      return next();
    }

    logger.warn('Unauthorized API share request received', {
      hasAuth: !!authHeader,
      hasSecretHeader: !!botSecretHeader
    });
    return res.status(401).json({ error: 'Unauthorized: Invalid API secret key' });
  }

  // 1. Register raw binary endpoint before global body parsers
  app.post('/api/whatsapp/share-file', checkApiAuth, express.raw({ type: '*/*', limit: '100mb' }), async (req, res) => {
    try {
      const phoneNumber = req.headers['x-phone-number'];
      const fileNameEncoded = req.headers['x-file-name'];
      const messageEncoded = req.headers['x-message'];
      const contentType = req.headers['content-type'];

      const fileName = fileNameEncoded ? decodeURIComponent(fileNameEncoded) : 'file';
      const message = messageEncoded ? decodeURIComponent(messageEncoded) : '';

      if (!phoneNumber) {
        return res.status(400).json({ error: 'x-phone-number header is required' });
      }

      // Check if WhatsApp bot is connected
      const info = client.info;
      if (!info || !info.wid) {
        return res.status(503).json({ error: 'WhatsApp bot is offline or not linked. Please scan the QR code to link it first.' });
      }

      // Clean phone number
      let cleanNumber = phoneNumber.replace(/\D/g, '');
      if (cleanNumber.length < 8) {
        return res.status(400).json({ error: 'Invalid phone number format.' });
      }
      if (!cleanNumber.endsWith('@c.us')) {
        cleanNumber = `${cleanNumber}@c.us`;
      }

      // 1. Send daily greeting if needed
      await sendDailyGreetingIfNeeded(cleanNumber);

      const buffer = req.body;
      if (!buffer || buffer.length === 0) {
        return res.status(400).json({ error: 'Empty file body received.' });
      }

      const { MessageMedia } = require('whatsapp-web.js');
      const base64Data = buffer.toString('base64');
      const media = new MessageMedia(contentType || 'application/octet-stream', base64Data, fileName);

      // 3. Send the file itself
      await client.sendMessage(cleanNumber, media);

      // 4. Send note description if provided as a separate bubble
      if (message) {
        await client.sendMessage(cleanNumber, `*Note:* ${message}`);
      }

      return res.json({ success: true, message: 'File shared successfully via WhatsApp!' });
    } catch (err) {
      logger.error('Error sharing file via WhatsApp', { error: err.message });
      return res.status(500).json({ error: 'Failed to share file: ' + err.message });
    }
  });

  // 2. Register global json body parser middlewares
  app.use(express.json({ limit: '100mb' }));
  app.use(express.urlencoded({ limit: '100mb', extended: true }));

  // Health check endpoint (public)
  app.get('/health', (req, res) => {
    const info = client.info;
    res.json({
      status: 'ok',
      uptime: Math.floor((Date.now() - startTime) / 1000),
      connectedToWhatsApp: !!(info && info.wid),
      activeSessions: sessionManager.activeSessionCount,
      timestamp: new Date().toISOString(),
    });
  });

  // API Sharing Endpoint (authenticated)
  app.post('/api/whatsapp/share', checkApiAuth, async (req, res) => {
    try {
      const { phoneNumber, type, linkUrl, codeSnippet, message, files } = req.body;

      if (!phoneNumber) {
        return res.status(400).json({ error: 'Phone number is required' });
      }

      // Check if WhatsApp bot is connected
      const info = client.info;
      if (!info || !info.wid) {
        return res.status(503).json({ error: 'WhatsApp bot is offline or not linked. Please scan the QR code to link it first.' });
      }

      // Clean phone number (keep only digits)
      let cleanNumber = phoneNumber.replace(/\D/g, '');
      if (cleanNumber.length < 8) {
        return res.status(400).json({ error: 'Invalid phone number format. Must contain at least 8 digits.' });
      }

      // Format target number as chatId
      if (!cleanNumber.endsWith('@c.us')) {
        cleanNumber = `${cleanNumber}@c.us`;
      }

      logger.info('Received API share request', { phoneNumber: cleanNumber, type });

      // 1. Send daily greeting if needed
      await sendDailyGreetingIfNeeded(cleanNumber);

      if (type === 'link') {
        if (!linkUrl) {
          return res.status(400).json({ error: 'linkUrl is required for type link' });
        }
        
        // Chat bubble 1: Intro
        await client.sendMessage(cleanNumber, `Below is a shared *Link* from CosmoShare 👇`);
        
        // Chat bubble 2: Link
        await client.sendMessage(cleanNumber, linkUrl);
        
        // Chat bubble 3: Note
        if (message) {
          await client.sendMessage(cleanNumber, `*Note:* ${message}`);
        }
      } else if (type === 'code') {
        if (!codeSnippet) {
          return res.status(400).json({ error: 'codeSnippet is required for type code' });
        }
        
        // Chat bubble 1: Intro
        await client.sendMessage(cleanNumber, `Below is a shared *Code Snippet* from CosmoShare 👇`);
        
        // Chat bubble 2: Code
        await client.sendMessage(cleanNumber, `\`\`\`\n${codeSnippet}\n\`\`\``);
        
        // Chat bubble 3: Note
        if (message) {
          await client.sendMessage(cleanNumber, `*Note:* ${message}`);
        }
      } else if (type === 'file') {
        if (!files || !Array.isArray(files) || files.length === 0) {
          return res.status(400).json({ error: 'files array is required and must not be empty for type file' });
        }

        const { MessageMedia } = require('whatsapp-web.js');
        for (const file of files) {
          if (!file.fileName || !file.base64Data || !file.fileType) {
            return res.status(400).json({ error: 'Each file must contain fileName, fileType, and base64Data' });
          }
          
          // Chat bubble 2: File
          const media = new MessageMedia(file.fileType, file.base64Data, file.fileName);
          await client.sendMessage(cleanNumber, media);
          
          // Chat bubble 3: Note
          if (message) {
            await client.sendMessage(cleanNumber, `*Note:* ${message}`);
          }
          
          // Introduce a short delay between multiple files to prevent flooding
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      } else {
        return res.status(400).json({ error: 'Invalid share type. Must be link, code, or file' });
      }

      return res.json({ success: true, message: 'Content shared successfully via WhatsApp!' });
    } catch (err) {
      logger.error('Error handling API share request', { error: err.message, stack: err.stack });
      return res.status(500).json({ error: 'Failed to share content: ' + err.message });
    }
  });

  app.listen(config.health.port, () => {
    logger.info(`Health check and API server running on port ${config.health.port}`);
  });
}

// ─── Graceful Shutdown ──────────────────────────────────────────────
async function shutdown(signal) {
  logger.info(`Received ${signal}. Starting graceful shutdown...`);

  try {
    // Persist sessions
    sessionManager.persistToDisk();
    logger.info('Sessions persisted');

    // Cleanup temp files
    cleanupAllTemp();
    logger.info('Temp files cleaned');

    // Destroy client (handled in client.js too, but ensure)
    try {
      await client.destroy();
    } catch (err) {
      // May already be destroyed
    }

    logger.info('Shutdown complete');
    process.exit(0);
  } catch (err) {
    logger.error('Error during shutdown', { error: err.message });
    process.exit(1);
  }
}

// ─── Main ───────────────────────────────────────────────────────────
async function main() {
  logger.info('╔══════════════════════════════════════╗');
  logger.info('║       CosmoShare WhatsApp Bot        ║');
  logger.info('╚══════════════════════════════════════╝');
  logger.info('Starting up...');

  // Ensure required directories
  ensureDirectories();

  // Restore sessions from disk
  sessionManager.restoreFromDisk();

  // Register message handler on BOTH events for maximum reliability.
  // Some media (especially gallery multi-select) only fires 'message_create'.
  // Deduplication in messageHandler.js ensures each message is processed exactly once.
  const onMessage = createMessageHandler(client);
  client.on('message', onMessage);
  client.on('message_create', (msg) => {
    // 'message_create' fires for all messages including our own.
    // Skip our own messages — they'll be filtered by onMessage anyway,
    // but this avoids unnecessary function call overhead.
    if (msg.fromMe) return;
    onMessage(msg);
  });

  // Start health check server
  startHealthServer();

  // Initialize WhatsApp client
  logger.info('Initializing WhatsApp client...');
  await client.initialize();

  logger.info('Bot startup sequence complete');
}

// ─── Process-level handlers ─────────────────────────────────────────
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { error: err.message, stack: err.stack });
  shutdown('uncaughtException');
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', { reason: reason instanceof Error ? reason.message : reason });
});

// ─── Run ────────────────────────────────────────────────────────────
main().catch((err) => {
  logger.error('Fatal startup error', { error: err.message, stack: err.stack });
  process.exit(1);
});
