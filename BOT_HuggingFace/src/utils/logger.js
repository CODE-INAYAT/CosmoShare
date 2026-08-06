'use strict';

const pino = require('pino');
const fs = require('fs');
const path = require('path');

const logsDir = path.resolve(__dirname, '..', '..', 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const logFilePath = path.join(logsDir, 'bot.log');

// Create a multi-stream: console + file
const streams = [
  { stream: process.stdout },
  { stream: fs.createWriteStream(logFilePath, { flags: 'a' }) },
];

const logger = pino(
  {
    level: process.env.LOG_LEVEL || 'info',
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level(label) {
        return { level: label };
      },
    },
  },
  pino.multistream(streams)
);

// Convenience: add child methods that match winston-style API used elsewhere
logger.child = logger.child.bind(logger);

module.exports = logger;
