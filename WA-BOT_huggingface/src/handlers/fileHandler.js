'use strict';

const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('../utils/logger');
const { validateFileSize } = require('../utils/validators');

// ─── Download Mutex ─────────────────────────────────────────────────
// Simple async mutex to serialize downloads. Unlike the old Promise-chain
// approach, this can NEVER deadlock — the lock is always released in a
// finally block, and the download function itself always resolves/rejects.
let downloadLock = Promise.resolve();

function acquireLock() {
  let releaseLock;
  const waitForLock = downloadLock;
  downloadLock = new Promise((resolve) => {
    releaseLock = resolve;
  });
  return waitForLock.then(() => releaseLock);
}

// ─── Timeout Constants ──────────────────────────────────────────────
// FAST timeouts. If media is cached by WhatsApp Web (visible in chat),
// downloadMedia() returns in <3 seconds. If it doesn't return quickly,
// it means the Puppeteer evaluate() is hung — waiting 90 seconds won't help.
const TIMEOUT_BY_TYPE = {
  sticker: 10000,   // 10s — tiny files
  image: 15000,     // 15s — if cached, takes <3s
  ptt: 20000,       // 20s — voice notes
  audio: 25000,     // 25s
  video: 30000,     // 30s — larger but still should be fast if cached
  document: 30000,  // 30s
};
const DEFAULT_TIMEOUT = 20000; // 20s fallback

/** Max retry attempts. 2 is enough — if media isn't available, retrying more just wastes time. */
const MAX_RETRIES = 2;

/** Cooldown between sequential downloads to let Puppeteer's page context stabilize */
const INTER_DOWNLOAD_COOLDOWN_MS = 500;

function getTimeout(message) {
  return TIMEOUT_BY_TYPE[message.type] || DEFAULT_TIMEOUT;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Download Media ─────────────────────────────────────────────────
/**
 * Download media from a WhatsApp message.
 * Uses a mutex to serialize downloads (Puppeteer can only handle one at a time).
 * Fast-fails with short timeouts — if media is available, it downloads in <3s.
 *
 * @param {object} message - whatsapp-web.js Message object
 * @returns {Promise<{ data: Buffer, mimetype: string, filename: string }>}
 */
async function downloadMedia(message) {
  const messageId = message.id?.id || 'unknown';
  const timeoutMs = getTimeout(message);

  // Acquire the mutex — only one download at a time
  const releaseLock = await acquireLock();

  try {
    let lastError = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      let timeoutHandle = null;

      try {
        logger.info('Media download starting', {
          messageId,
          attempt,
          timeoutMs,
          type: message.type,
          hasMedia: message.hasMedia,
        });

        // Race: download vs timeout
        const downloadPromise = message.downloadMedia();
        const timeoutPromise = new Promise((_, rej) => {
          timeoutHandle = setTimeout(() => {
            rej(new Error(`Download timed out after ${timeoutMs / 1000}s`));
          }, timeoutMs);
        });

        const media = await Promise.race([downloadPromise, timeoutPromise]);

        // Always clear timeout
        if (timeoutHandle) { clearTimeout(timeoutHandle); timeoutHandle = null; }

        if (!media || !media.data) {
          throw new Error('downloadMedia() returned empty result');
        }

        const filename = media.filename || `file_${Date.now()}.${_extensionFromMime(media.mimetype)}`;
        const data = Buffer.from(media.data, 'base64');

        logger.info('Media download succeeded', {
          messageId, attempt, filename, sizeBytes: data.length,
        });

        // Cooldown before releasing lock — gives Puppeteer page time to stabilize
        await sleep(INTER_DOWNLOAD_COOLDOWN_MS);

        return { data, mimetype: media.mimetype || 'application/octet-stream', filename };

      } catch (err) {
        // Always clear timeout on failure
        if (timeoutHandle) { clearTimeout(timeoutHandle); timeoutHandle = null; }
        lastError = err;

        logger.warn('Media download attempt failed', {
          messageId, attempt, maxRetries: MAX_RETRIES, error: err.message,
        });

        // Short backoff: 1s, 2s (much faster than the old 2s, 4s, 8s)
        if (attempt < MAX_RETRIES) {
          const backoffMs = 1000 * attempt;
          logger.info('Retrying after backoff', { messageId, backoffMs });
          await sleep(backoffMs);
        }
      }
    }

    // All retries exhausted — throw (will be caught by flushBatch's try/catch)
    throw lastError || new Error('Media download failed after all retries');

  } finally {
    // ALWAYS release the lock — this is what prevents deadlocks.
    // The old Promise-chain pattern could hang forever if an error
    // slipped past the catch handler. A finally block cannot be skipped.
    releaseLock();
  }
}

// ─── File Helpers ───────────────────────────────────────────────────

/**
 * Save media data to a temp directory, returns the temp file path.
 */
function saveToTemp(mediaData, userId) {
  const sanitizedUserId = userId.replace(/[^a-zA-Z0-9]/g, '_');
  const userDir = path.join(path.resolve(config.bot.tempDir), sanitizedUserId);

  if (!fs.existsSync(userDir)) {
    fs.mkdirSync(userDir, { recursive: true });
  }

  // Ensure unique filename
  let filename = mediaData.filename || `file_${Date.now()}`;
  const targetPath = path.join(userDir, filename);

  // Avoid collisions
  let finalPath = targetPath;
  let counter = 1;
  while (fs.existsSync(finalPath)) {
    const ext = path.extname(filename);
    const base = path.basename(filename, ext);
    finalPath = path.join(userDir, `${base}_${counter}${ext}`);
    counter++;
  }

  fs.writeFileSync(finalPath, mediaData.data);
  logger.debug('File saved to temp', { userId, path: finalPath, size: mediaData.data.length });
  return finalPath;
}

/**
 * Delete all temp files for a specific user.
 */
function cleanupUserFiles(userId) {
  try {
    const sanitizedUserId = userId.replace(/[^a-zA-Z0-9]/g, '_');
    const userDir = path.join(path.resolve(config.bot.tempDir), sanitizedUserId);
    if (fs.existsSync(userDir)) {
      fs.rmSync(userDir, { recursive: true, force: true });
      logger.debug('Cleaned up user temp files', { userId });
    }
  } catch (err) {
    logger.error('Failed to cleanup user files', { userId, error: err.message });
  }
}

/**
 * Delete all temp files in the temp directory.
 */
function cleanupAllTemp() {
  try {
    const tempDir = path.resolve(config.bot.tempDir);
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      fs.mkdirSync(tempDir, { recursive: true });
      logger.info('Cleaned up all temp files');
    }
  } catch (err) {
    logger.error('Failed to cleanup all temp files', { error: err.message });
  }
}

/**
 * Get aggregate file statistics for a session.
 */
function getFileStats(userId, sessionManager) {
  const session = sessionManager.getSessionData(userId);
  if (!session) {
    return { totalFiles: 0, totalLinks: 0, totalCodeSnippets: 0, totalSizeBytes: 0, totalSizeMB: '0.00' };
  }

  const totalFiles = session.files.length;
  const totalLinks = session.links.length;
  const totalCodeSnippets = session.codeSnippets.length;
  const totalSizeBytes = session.files.reduce((sum, f) => sum + (f.fileSize || 0), 0);
  const totalSizeMB = (totalSizeBytes / (1024 * 1024)).toFixed(2);

  return { totalFiles, totalLinks, totalCodeSnippets, totalSizeBytes, totalSizeMB };
}

/**
 * Guess file extension from MIME type.
 */
function _extensionFromMime(mimetype) {
  const map = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'video/mp4': 'mp4',
    'audio/ogg': 'ogg',
    'audio/mpeg': 'mp3',
    'application/pdf': 'pdf',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.ms-excel': 'xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'application/vnd.ms-powerpoint': 'ppt',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
    'application/zip': 'zip',
    'text/plain': 'txt',
  };
  return map[mimetype] || 'bin';
}

module.exports = {
  downloadMedia,
  saveToTemp,
  cleanupUserFiles,
  cleanupAllTemp,
  getFileStats,
};
