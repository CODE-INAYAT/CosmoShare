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

// ─── QR Code ─────────────────────────────────────────────────────────
client.on("qr", (qr) => {
  logger.info("QR Code received — scan with WhatsApp:");
  qrcode.generate(qr, { small: true });
});

// ─── Ready ───────────────────────────────────────────────────────────
client.on("ready", async () => {
  logger.info("✅ WhatsApp Bot is ready!");
  try {
    await client.setStatus("CosmoShare Bot — Send Hi to start!");
  } catch (err) {
    logger.warn("Could not set bot status", { error: err.message });
  }
});

// ─── Authenticated ──────────────────────────────────────────────────
client.on("authenticated", () => {
  logger.info("✅ WhatsApp authentication successful");
});

// ─── Auth Failure ───────────────────────────────────────────────────
client.on("auth_failure", (msg) => {
  logger.error("❌ WhatsApp authentication failed", { message: msg });
  // Attempt recovery: the user will need to re-scan QR
});

// ─── Disconnected ───────────────────────────────────────────────────
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY_MS = 10000;

client.on("disconnected", (reason) => {
  logger.warn("⚠️ WhatsApp client disconnected", { reason });

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
