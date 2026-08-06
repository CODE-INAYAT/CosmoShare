'use strict';

const { EventEmitter } = require('events');
const crypto = require('crypto');
const https = require('https');
const dns = require('dns');
const logger = require('../utils/logger');
const config = require('../config');
const { getAuthDir, backupAuthToDataset, restoreAuthFromDataset } = require('./auth');

// ═══════════════════════════════════════════════════════════════════════
// HKDF info strings for WhatsApp media decryption (per media type)
// ═══════════════════════════════════════════════════════════════════════
const MEDIA_HKDF_INFO = {
  image:    'WhatsApp Image Keys',
  video:    'WhatsApp Video Keys',
  audio:    'WhatsApp Audio Keys',
  ptt:      'WhatsApp Audio Keys',
  document: 'WhatsApp Document Keys',
  sticker:  'WhatsApp Image Keys',
};

function getHkdfMediaType(wwebType) {
  return MEDIA_HKDF_INFO[wwebType] ? wwebType : 'document';
}

// ═══════════════════════════════════════════════════════════════════════
// HKDF (RFC 5869) — Extract + Expand
// ═══════════════════════════════════════════════════════════════════════

function hkdf(ikm, length, infoStr) {
  // Step 1: Extract — PRK = HMAC-SHA256(salt=32_zero_bytes, IKM)
  const salt = Buffer.alloc(32, 0);
  const prk = crypto.createHmac('sha256', salt).update(ikm).digest();

  // Step 2: Expand — T(1) || T(2) || ...
  const info = Buffer.from(infoStr, 'utf8');
  let prev = Buffer.alloc(0);
  let output = Buffer.alloc(0);
  let counter = 1;

  while (output.length < length) {
    prev = crypto.createHmac('sha256', prk)
      .update(Buffer.concat([prev, info, Buffer.from([counter])]))
      .digest();
    output = Buffer.concat([output, prev]);
    counter++;
  }

  return output.slice(0, length);
}

// ═══════════════════════════════════════════════════════════════════════
// Direct CDN Download — IPv4, redirect-following, binary streaming
// ═══════════════════════════════════════════════════════════════════════

/**
 * Download a URL over HTTPS forcing strict IPv4.
 * Follows up to 3 redirects. 15-second timeout.
 */
function downloadIPv4(url, timeoutMs = 15000, maxRedirects = 3) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`CDN timeout (${timeoutMs / 1000}s)`)), timeoutMs);

    function request(currentUrl, redirectsLeft) {
      const parsed = new URL(currentUrl);

      const opts = {
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        port: 443,
        method: 'GET',
        family: 4, // ← FORCE IPv4 — bypasses Docker IPv6 black hole
        headers: {
          'User-Agent': 'WhatsApp/2.24.6.76 A',
          'Accept': '*/*',
        },
        // Force IPv4 DNS resolution as well
        lookup: (hostname, options, cb) => {
          dns.lookup(hostname, { ...options, family: 4 }, cb);
        },
      };

      const req = https.request(opts, (res) => {
        // Follow redirects
        if ((res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) &&
            res.headers.location && redirectsLeft > 0) {
          res.resume(); // drain response
          request(res.headers.location, redirectsLeft - 1);
          return;
        }

        if (res.statusCode !== 200) {
          clearTimeout(timer);
          reject(new Error(`CDN HTTP ${res.statusCode}`));
          return;
        }

        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          clearTimeout(timer);
          resolve(Buffer.concat(chunks));
        });
        res.on('error', (err) => {
          clearTimeout(timer);
          reject(err);
        });
      });

      req.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      req.end();
    }

    request(url, maxRedirects);
  });
}

/**
 * Download encrypted media from WhatsApp CDN and decrypt in Node.js.
 * Pure binary — zero base64, zero Chrome overhead.
 */
async function downloadAndDecryptMedia(directPath, mediaKeyBase64, mediaType) {
  const cdnUrl = `https://mmg.whatsapp.net${directPath}`;

  // 1. Download encrypted bytes (forced IPv4, binary streaming)
  const encrypted = await downloadIPv4(cdnUrl);
  logger.debug({ cdnBytes: encrypted.length, mediaType }, 'CDN raw download complete');

  // 2. HKDF key derivation (Extract + Expand)
  const mediaKey = Buffer.from(mediaKeyBase64, 'base64');
  const infoStr = MEDIA_HKDF_INFO[getHkdfMediaType(mediaType)] || MEDIA_HKDF_INFO.document;
  const expanded = hkdf(mediaKey, 112, infoStr);

  const iv        = expanded.slice(0, 16);
  const cipherKey = expanded.slice(16, 48);
  // macKey     = expanded.slice(48, 80)  — for HMAC verification
  // refKey     = expanded.slice(80, 112) — unused

  // 3. Strip 10-byte MAC, decrypt AES-256-CBC
  const encData = encrypted.slice(0, -10);
  const decipher = crypto.createDecipheriv('aes-256-cbc', cipherKey, iv);
  return Buffer.concat([decipher.update(encData), decipher.final()]);
}

// ═══════════════════════════════════════════════════════════════════════
// Message adapter: whatsapp-web.js → Baileys-compatible shape
// ═══════════════════════════════════════════════════════════════════════

function adaptMessage(wwebMsg) {
  const from = wwebMsg.from || wwebMsg.id?.remote;
  const msgId = wwebMsg.id?.id || `msg_${Date.now()}`;
  const fromMe = wwebMsg.id?.fromMe || false;

  const message = {};

  switch (wwebMsg.type) {
    case 'chat':
      message.conversation = wwebMsg.body || '';
      break;
    case 'image':
      message.imageMessage = {
        mimetype: wwebMsg._data?.mimetype || 'image/jpeg',
        fileName: wwebMsg._data?.filename || null,
        caption: wwebMsg._data?.caption || wwebMsg.body || null,
      };
      break;
    case 'video':
      message.videoMessage = {
        mimetype: wwebMsg._data?.mimetype || 'video/mp4',
        fileName: wwebMsg._data?.filename || null,
        caption: wwebMsg._data?.caption || null,
      };
      break;
    case 'audio':
    case 'ptt':
      message.audioMessage = {
        mimetype: wwebMsg._data?.mimetype || 'audio/ogg',
        fileName: wwebMsg._data?.filename || null,
      };
      break;
    case 'document':
      message.documentMessage = {
        mimetype: wwebMsg._data?.mimetype || 'application/octet-stream',
        fileName: wwebMsg._data?.filename || wwebMsg._data?.fileName || null,
        caption: wwebMsg._data?.caption || null,
      };
      break;
    case 'sticker':
      message.stickerMessage = {
        mimetype: wwebMsg._data?.mimetype || 'image/webp',
      };
      break;
    default:
      if (wwebMsg.body) message.conversation = wwebMsg.body;
      break;
  }

  return {
    key: { remoteJid: from, fromMe, id: msgId },
    pushName: wwebMsg._data?.notifyName || wwebMsg._data?.pushname || 'User',
    message,
    _mediaType: wwebMsg.type,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// WhatsApp Client — Hybrid Architecture
//
//   Chrome  = WhatsApp Web session (connection + messaging)
//   Node.js = Direct CDN media download (fast, binary, no base64)
//   Chrome  = Fallback media download (if CDN fails)
// ═══════════════════════════════════════════════════════════════════════

class WhatsAppClient extends EventEmitter {
  constructor() {
    super();
    this.client = null;
    this.qrCode = null;
    this.pairingCode = null;
    this.status = 'INITIALIZING';
    this._destroyed = false;

    // Map<msgId, { cdnPromise, chromePromise }> — dual-track eager downloads
    this._mediaDownloads = new Map();
  }

  async initialize() {
    const { Client, LocalAuth } = require('whatsapp-web.js');

    await restoreAuthFromDataset();
    const authDir = getAuthDir();

    this.client = new Client({
      authStrategy: new LocalAuth({
        clientId: 'cosmoshare',
        dataPath: authDir,
      }),
      puppeteer: {
        headless: true,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
          '--disable-extensions',
          '--disable-background-networking',
          '--disable-default-apps',
          '--disable-sync',
          '--metrics-recording-only',
          '--mute-audio',
          '--single-process',
        ],
      },
      webVersionCache: {
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/AdenKoperorth/whatsapp-web-versions/main/versions.json',
      },
    });

    // ─── QR Code ─────────────────────────────────────────────────────
    this.client.on('qr', (qr) => {
      this.qrCode = qr;
      this.status = 'AWAITING_SCAN';
      this.emit('qr', qr);
      logger.info('🔳 QR code generated — visit your Space dashboard and scan with WhatsApp');
    });

    // ─── Authentication ──────────────────────────────────────────────
    this.client.on('authenticated', () => {
      this.qrCode = null;
      logger.info('WhatsApp session authenticated');
    });

    this.client.on('auth_failure', (msg) => {
      this.qrCode = null;
      this.status = 'LOGGED_OUT';
      this.emit('logged-out');
      logger.error({ error: msg }, 'WhatsApp auth failure');
    });

    // ─── Ready ───────────────────────────────────────────────────────
    this.client.on('ready', () => {
      this.qrCode = null;
      this.status = 'CONNECTED';
      this.emit('ready');
      logger.info('✅ WhatsApp Bot connected successfully!');

      backupAuthToDataset().catch(err => {
        logger.error({ error: err.message }, 'Auth backup failed');
      });
    });

    // ─── Disconnected ────────────────────────────────────────────────
    this.client.on('disconnected', (reason) => {
      this.qrCode = null;
      this.status = 'DISCONNECTED';
      logger.warn({ reason }, 'WhatsApp disconnected');

      if (!this._destroyed) {
        logger.info('Reinitializing in 5s...');
        setTimeout(() => this.initialize(), 5000);
      }
    });

    // ─── Loading screen ──────────────────────────────────────────────
    this.client.on('loading_screen', (percent, message) => {
      this.status = 'CONNECTING';
      logger.info({ percent, message }, 'WhatsApp loading...');
    });

    // ─── Incoming messages ───────────────────────────────────────────
    this.client.on('message', async (wwebMsg) => {
      try {
        if (wwebMsg.from?.endsWith('@g.us')) return;
        if (wwebMsg.from === 'status@broadcast') return;
        if (wwebMsg.id?.fromMe) return;

        // ════════════════════════════════════════════════════════════
        // DUAL-TRACK EAGER DOWNLOAD
        //
        // We start BOTH download strategies the INSTANT the message
        // arrives. This is critical because:
        //
        // Track 1 (CDN Direct): Fast binary download via Node.js.
        //   No base64, no Chrome overhead. ~0.5-2s for 5MB.
        //
        // Track 2 (Chrome Fallback): Started immediately to prevent
        //   the "r" error (Chrome's Store.Msg expires after ~2s).
        //   Slower (~3-8s) but guaranteed to work if CDN is blocked.
        //
        // downloadMedia() awaits CDN first. If CDN fails, it
        // falls back to the already-in-progress Chrome download.
        // ════════════════════════════════════════════════════════════
        if (wwebMsg.hasMedia) {
          const msgId = wwebMsg.id?.id || `msg_${Date.now()}`;
          const directPath = wwebMsg._data?.directPath;
          const mediaKeyB64 = wwebMsg._data?.mediaKey;
          const mediaType = wwebMsg.type;

          // Track 1: CDN direct (fast path)
          let cdnPromise = Promise.resolve(null);
          if (directPath && mediaKeyB64) {
            cdnPromise = downloadAndDecryptMedia(directPath, mediaKeyB64, mediaType)
              .then(buf => {
                logger.info({ size: buf.length, msgId, method: 'cdn-direct' },
                  '⚡ Media downloaded via direct CDN (fast path)');
                return buf;
              })
              .catch(err => {
                logger.warn({ error: err.message, msgId },
                  'CDN direct download failed, Chrome fallback in progress');
                return null;
              });
          }

          // Track 2: Chrome eager (fallback — started NOW to avoid "r" error)
          const chromePromise = wwebMsg.downloadMedia()
            .then(media => {
              if (!media?.data) return null;
              const buf = Buffer.from(media.data, 'base64');
              logger.debug({ size: buf.length, msgId, method: 'chrome' },
                'Chrome media download completed');
              return buf;
            })
            .catch(err => {
              logger.warn({ error: err.message, msgId },
                'Chrome eager download also failed');
              return null;
            });

          this._mediaDownloads.set(msgId, { cdnPromise, chromePromise });

          // Auto-cleanup after 5 minutes
          setTimeout(() => this._mediaDownloads.delete(msgId), 5 * 60 * 1000);
        }

        // Emit adapted message
        const adapted = adaptMessage(wwebMsg);
        this.emit('message', adapted);
      } catch (err) {
        logger.error({ error: err.message }, 'Error processing incoming message');
      }
    });

    // ─── Start the client ────────────────────────────────────────────
    this.status = 'CONNECTING';
    logger.info('Starting Chromium + WhatsApp Web session...');
    await this.client.initialize();
  }

  /**
   * Download media — Hybrid strategy.
   *
   * Both tracks were started eagerly in the message handler.
   * CDN finishes first most of the time (~1s vs ~5s).
   * If CDN failed, Chrome result is already waiting.
   */
  async downloadMedia(adaptedMsg) {
    const msgId = adaptedMsg.key?.id;
    const download = msgId ? this._mediaDownloads.get(msgId) : null;

    if (!download) {
      throw new Error('No media download available for this message');
    }

    this._mediaDownloads.delete(msgId);

    const { cdnPromise, chromePromise } = download;

    // Try CDN first (fast path — pure binary, no base64)
    const cdnBuffer = await cdnPromise;
    if (cdnBuffer && cdnBuffer.length > 0) {
      return cdnBuffer;
    }

    // CDN failed → use Chrome result (already downloaded or in-progress)
    const chromeBuffer = await chromePromise;
    if (chromeBuffer && chromeBuffer.length > 0) {
      logger.info({ size: chromeBuffer.length, method: 'chrome-fallback' },
        'Using Chrome fallback result');
      return chromeBuffer;
    }

    throw new Error('All download strategies failed — CDN blocked and Chrome returned null');
  }

  /**
   * Send a text message.
   */
  async sendMessage(jid, text) {
    if (!this.client || this.status !== 'CONNECTED') {
      throw new Error('WhatsApp bot is not connected');
    }
    const chatId = jid.replace('@s.whatsapp.net', '@c.us');
    return this.client.sendMessage(chatId, text);
  }

  /**
   * Send a file/media message.
   */
  async sendFile(jid, buffer, mimetype, fileName, caption) {
    if (!this.client || this.status !== 'CONNECTED') {
      throw new Error('WhatsApp bot is not connected');
    }

    const { MessageMedia } = require('whatsapp-web.js');
    const media = new MessageMedia(mimetype, buffer.toString('base64'), fileName);
    const chatId = jid.replace('@s.whatsapp.net', '@c.us');

    return this.client.sendMessage(chatId, media, {
      caption: caption || undefined,
      sendMediaAsDocument: !mimetype.startsWith('image/') && !mimetype.startsWith('video/'),
    });
  }

  getContactName(msg) {
    return msg.pushName || null;
  }

  getPhoneFromJid(jid) {
    return (jid || '').replace(/@.*$/, '').replace(/\D/g, '');
  }

  async destroy() {
    this._destroyed = true;
    this._mediaDownloads.clear();
    if (this.client) {
      try { await this.client.destroy(); } catch {}
      this.client = null;
    }
    this.status = 'DESTROYED';
  }
}

const waClient = new WhatsAppClient();
module.exports = waClient;
