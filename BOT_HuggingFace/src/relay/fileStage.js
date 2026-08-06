'use strict';

/**
 * File Stage — In-memory + temp disk file staging with TTL.
 * 
 * Files < 5MB are kept in memory for instant serving.
 * Files 5-50MB go to temp disk with streaming.
 * All files auto-expire after 10 minutes.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');
const logger = require('../utils/logger');

/** @type {Map<string, { buffer: Buffer|null, tempPath: string|null, fileName: string, mimeType: string, size: number, createdAt: number }>} */
const stagedFiles = new Map();

const TEMP_DIR = path.resolve(config.bot.tempDir, 'relay');

// Ensure temp directory exists
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

/**
 * Stage a file for download by web clients.
 * 
 * @param {Buffer} buffer - File content
 * @param {string} fileName - Original file name
 * @param {string} mimeType - MIME type
 * @returns {string} UUID for accessing the file via /relay/files/:uuid
 */
function stageFile(buffer, fileName, mimeType) {
  const uuid = crypto.randomUUID();
  const size = buffer.length;

  if (size <= config.relay.memoryThresholdBytes) {
    // Small file — keep in memory
    stagedFiles.set(uuid, {
      buffer,
      tempPath: null,
      fileName,
      mimeType: mimeType || 'application/octet-stream',
      size,
      createdAt: Date.now(),
    });
    logger.debug('File staged in memory', { uuid, fileName, size });
  } else {
    // Large file — write to temp disk
    const tempPath = path.join(TEMP_DIR, uuid);
    fs.writeFileSync(tempPath, buffer);

    stagedFiles.set(uuid, {
      buffer: null,
      tempPath,
      fileName,
      mimeType: mimeType || 'application/octet-stream',
      size,
      createdAt: Date.now(),
    });
    logger.debug('File staged to disk', { uuid, fileName, size, tempPath });
  }

  return uuid;
}

/**
 * Get a staged file by UUID.
 * @param {string} uuid
 * @returns {object|null}
 */
function getStaged(uuid) {
  return stagedFiles.get(uuid) || null;
}

/**
 * Remove a staged file (manual cleanup).
 */
function removeStaged(uuid) {
  const entry = stagedFiles.get(uuid);
  if (!entry) return;

  if (entry.tempPath) {
    try { fs.unlinkSync(entry.tempPath); } catch {}
  }
  stagedFiles.delete(uuid);
}

/**
 * Cleanup expired staged files.
 */
function cleanupExpired() {
  const now = Date.now();
  let cleaned = 0;

  for (const [uuid, entry] of stagedFiles.entries()) {
    if (now - entry.createdAt > config.relay.fileTTLMs) {
      if (entry.tempPath) {
        try { fs.unlinkSync(entry.tempPath); } catch {}
      }
      stagedFiles.delete(uuid);
      cleaned++;
    }
  }

  if (cleaned > 0) {
    logger.debug(`Cleaned ${cleaned} expired staged files`);
  }
}

/**
 * Get stats about the file stage.
 */
function getStats() {
  let totalMemory = 0;
  let totalDisk = 0;

  for (const [, entry] of stagedFiles) {
    if (entry.buffer) totalMemory += entry.size;
    else totalDisk += entry.size;
  }

  return {
    totalFiles: stagedFiles.size,
    memoryUsageMB: (totalMemory / (1024 * 1024)).toFixed(2),
    diskUsageMB: (totalDisk / (1024 * 1024)).toFixed(2),
  };
}

// Start periodic cleanup
setInterval(cleanupExpired, config.relay.cleanupIntervalMs);

module.exports = {
  stageFile,
  getStaged,
  removeStaged,
  cleanupExpired,
  getStats,
};
