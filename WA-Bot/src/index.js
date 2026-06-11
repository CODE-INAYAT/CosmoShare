'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const express = require('express');
const config = require('./config');
const logger = require('./utils/logger');
const client = require('./client');
const { createMessageHandler } = require('./handlers/messageHandler');
const { sessionManager } = require('./conversation/session');
const { cleanupAllTemp } = require('./handlers/fileHandler');

const startTime = Date.now();

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

// ─── Health Check Server ────────────────────────────────────────────
function startHealthServer() {
  const app = express();

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

  app.listen(config.health.port, () => {
    logger.info(`Health check server running on port ${config.health.port}`);
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
