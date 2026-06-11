'use strict';

const path = require('path');
const { createLogger, format, transports } = require('winston');
require('winston-daily-rotate-file');
const config = require('../config');

const logsDir = path.resolve(__dirname, '..', '..', 'logs');

const logger = createLogger({
  level: config.logLevel,
  defaultMeta: { service: 'wa-bot' },
  transports: [
    // Console – colorized simple format for dev
    new transports.Console({
      format: format.combine(
        format.colorize(),
        format.timestamp({ format: 'HH:mm:ss' }),
        format.printf(({ timestamp, level, message, service, ...meta }) => {
          const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
          return `${timestamp} [${level}] ${message}${metaStr}`;
        })
      ),
    }),

    // File – JSON format, 5 MB max, 3 rotated files
    new transports.File({
      filename: path.join(logsDir, 'bot.log'),
      format: format.combine(format.timestamp(), format.json()),
      maxsize: 5 * 1024 * 1024, // 5 MB
      maxFiles: 3,
      tailable: true,
    }),

    // Error file
    new transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      format: format.combine(format.timestamp(), format.json()),
      maxsize: 5 * 1024 * 1024,
      maxFiles: 3,
      tailable: true,
    }),
  ],
});

module.exports = logger;
