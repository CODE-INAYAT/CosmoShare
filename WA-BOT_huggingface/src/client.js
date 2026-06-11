"use strict";

const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const path = require("path");
const config = require("./config");
const logger = require("./utils/logger");

const PUPPETEER_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-accelerated-2d-canvas",
  "--no-first-run",
  "--no-zygote",
  "--disable-gpu",
];

const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: path.resolve(config.bot.sessionDir),
    clientId: "cosmoshare-bot",
  }),
  puppeteer: {
    headless: true,
    args: PUPPETEER_ARGS,
  },
});

const emailService = require("./services/emailService");
const storageService = require("./services/storageService");

// Initialize status globals for dashboard reporting
global.botStatus = "INITIALIZING";
global.latestQrCode = null;

// Helper to resolve Hugging Face Space URL for user notifications
function getSpaceUrl() {
  if (process.env.SPACE_ID) {
    const parts = process.env.SPACE_ID.split('/');
    if (parts.length === 2) {
      return `https://${parts[0]}-${parts[1]}.hf.space`;
    }
  }
  return "http://localhost:7860";
}

// ─── QR Code ─────────────────────────────────────────────────────────
client.on("qr", (qr) => {
  logger.info("QR Code received — scan with WhatsApp:");
  qrcode.generate(qr, { small: true });
  
  global.latestQrCode = qr;
  global.botStatus = "AWAITING_SCAN";
  
  // Alert the administrator via email
  const spaceUrl = getSpaceUrl();
  emailService.sendQrScanAlert(spaceUrl);
});

// ─── Ready ───────────────────────────────────────────────────────────
client.on("ready", async () => {
  logger.info("✅ WhatsApp Bot is ready!");
  global.latestQrCode = null;
  global.botStatus = "CONNECTED";
  
  try {
    await client.setStatus("CosmoShare Bot — Send Hi to start!");
  } catch (err) {
    logger.warn("Could not set bot status", { error: err.message });
  }

  // Backup session files to the persistent dataset asynchronously on successful login
  storageService.backupSession().catch(err => {
    logger.error("Failed to backup session on ready", { error: err.message });
  });
});

// ─── Authenticated ──────────────────────────────────────────────────
client.on("authenticated", () => {
  logger.info("✅ WhatsApp authentication successful");
  global.latestQrCode = null;
  global.botStatus = "AUTHENTICATED";
});

// ─── Auth Failure ───────────────────────────────────────────────────
client.on("auth_failure", (msg) => {
  logger.error("❌ WhatsApp authentication failed", { message: msg });
  global.latestQrCode = null;
  global.botStatus = "AUTH_FAILURE";
  
  emailService.sendOfflineAlert(`WhatsApp Authentication Failure: ${msg}`);
});

// ─── Disconnected ───────────────────────────────────────────────────
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY_MS = 10000;

client.on("disconnected", (reason) => {
  logger.warn("⚠️ WhatsApp client disconnected", { reason });
  global.latestQrCode = null;
  global.botStatus = "DISCONNECTED";

  // Alert the admin via email
  emailService.sendOfflineAlert(`WhatsApp disconnected: ${reason}`);

  if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
    reconnectAttempts++;
    logger.info(
      `Attempting reconnection (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}) in ${
        RECONNECT_DELAY_MS / 1000
      }s...`
    );
    setTimeout(async () => {
      try {
        await client.initialize();
        reconnectAttempts = 0;
        logger.info("Reconnected successfully");
      } catch (err) {
        logger.error("Reconnection failed", { error: err.message });
      }
    }, RECONNECT_DELAY_MS);
  } else {
    logger.error("Max reconnection attempts reached. Manual restart required.");
  }
});

// ─── Graceful Shutdown ──────────────────────────────────────────────
async function gracefulShutdown(signal) {
  logger.info(`Received ${signal}. Shutting down gracefully...`);
  try {
    await client.destroy();
    logger.info("WhatsApp client destroyed");
  } catch (err) {
    logger.error("Error during client shutdown", { error: err.message });
  }
}

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

module.exports = client;
