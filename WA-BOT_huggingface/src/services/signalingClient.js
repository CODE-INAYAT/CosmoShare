'use strict';

const WebSocket = require('ws');
const { EventEmitter } = require('events');
const logger = require('../utils/logger');
const config = require('../config');

/**
 * djb2 string hash — same algorithm as CosmoShare web app's signalingRouter.ts.
 * Ensures the bot connects to the same shard as the web receiver.
 */
function djb2Hash(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
  }
  return hash;
}

/**
 * Generate a random 4-digit code (1000–9999).
 */
function generateCode() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

/**
 * Generate a 4-digit code that maps to a specific shard index.
 * This ensures the code routes to the shard the bot is already connected to.
 */
function generateCodeForShard(shardIndex, totalShards) {
  if (totalShards <= 1) return generateCode();
  let code;
  let attempts = 0;
  do {
    code = generateCode();
    attempts++;
  } while (djb2Hash(code) % totalShards !== shardIndex && attempts < 1000);
  return code;
}

/**
 * Normalise a base URL into ws(s) format ending with /ws
 */
function normaliseWs(base) {
  const clean = base.replace(/\/$/, '');
  return (clean.endsWith('/ws') || clean.includes('/ws?')) ? clean : `${clean}/ws`;
}

/**
 * SignalingClient — connects to CosmoShare signaling Durable Objects via WebSocket.
 *
 * Uses the same shard routing (djb2Hash) as the CosmoShare web app, so
 * both bot and web receiver converge on the same signaling worker for a given code/room.
 */
class SignalingClient extends EventEmitter {
  /**
   * @param {string} wsUrl - Full WebSocket URL including /ws path and any query params
   */
  constructor(wsUrl) {
    super();
    this.wsUrl = wsUrl;
    this.ws = null;
    this.socketId = null;
    this.heartbeatTimer = null;
    this.connected = false;
    this._destroyed = false;
  }

  /**
   * Open the WebSocket connection and wait until it's ready.
   * @returns {Promise<void>}
   */
  connect() {
    return new Promise((resolve, reject) => {
      if (this._destroyed) return reject(new Error('Client destroyed'));

      try {
        this.ws = new WebSocket(this.wsUrl, {
          family: 4,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
          }
        });
      } catch (err) {
        return reject(err);
      }

      const timeout = setTimeout(() => {
        reject(new Error('WebSocket connection timeout (15s)'));
        this.destroy();
      }, 15000);

      this.ws.on('open', () => {
        clearTimeout(timeout);
        this.connected = true;
        this._startHeartbeat();
        logger.debug('Signaling WS connected', { url: this.wsUrl });
        resolve();
      });

      this.ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg.event) {
            this.emit(msg.event, msg.data || {});
          }
        } catch { /* ignore malformed */ }
      });

      this.ws.on('close', (code, reason) => {
        this.connected = false;
        this._stopHeartbeat();
        logger.debug('Signaling WS closed', { url: this.wsUrl, code, reason: reason?.toString() });
        this.emit('ws-close', { code, reason: reason?.toString() });
      });

      this.ws.on('error', (err) => {
        clearTimeout(timeout);
        logger.error('Signaling WS error', { url: this.wsUrl, error: err.message });
        this.emit('ws-error', err);
        if (!this.connected) reject(err);
      });
    });
  }

  /**
   * Send a signaling event.
   */
  send(event, data = {}) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      logger.warn('Cannot send, WS not open', { event });
      return false;
    }
    try {
      this.ws.send(JSON.stringify({ event, data }));
      return true;
    } catch (err) {
      logger.error('WS send error', { event, error: err.message });
      return false;
    }
  }

  /**
   * Send heartbeat every 25s to avoid 35s stale eviction by the Durable Object.
   */
  _startHeartbeat() {
    this._stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.send('heartbeat');
    }, 25000);
    if (this.heartbeatTimer.unref) this.heartbeatTimer.unref();
  }

  _stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Close the WebSocket and clean up.
   */
  destroy() {
    this._destroyed = true;
    this._stopHeartbeat();
    if (this.ws) {
      try { this.ws.close(1000, 'Bot done'); } catch { }
      this.ws = null;
    }
    this.connected = false;
    this.removeAllListeners();
  }
}

// ─── Static Helpers ────────────────────────────────────────────────

/**
 * Get the OneShare signaling WebSocket URL for a given code.
 * Uses the same shard routing as the CosmoShare web app.
 */
function getOneShareUrl(code) {
  const urls = config.signaling.oneShareUrls;
  if (urls.length === 0) return null;
  const index = djb2Hash(code) % urls.length;
  return normaliseWs(urls[index]);
}

/**
 * Get the Lab Share signaling WebSocket URL for a given room number.
 */
function getLabShareUrl(roomNumber) {
  const urls = config.signaling.labUrls;
  if (urls.length === 0) return null;
  const index = djb2Hash(roomNumber) % urls.length;
  const wsBase = normaliseWs(urls[index]);
  return `${wsBase}?room=${encodeURIComponent(roomNumber)}`;
}

/**
 * Create a SignalingClient connected to a OneShare shard, with ring-order
 * fallback across ALL configured shards (matches the web portal's
 * getOneShareSignalingUrls behaviour). If the primary shard is overloaded
 * (Cloudflare Durable Object free-tier limits surface as "WebSocket was closed
 * before the connection was established"), the remaining shards are tried in
 * the same deterministic ring order both sides compute, so sender + receiver
 * converge on the same healthy shard.
 */
async function connectForOneShare(code) {
  const urls = config.signaling.oneShareUrls;
  if (urls.length === 0) throw new Error('No signaling URLs configured');

  const primary = djb2Hash(code) % urls.length;
  let lastErr = null;
  for (let i = 0; i < urls.length; i++) {
    const idx = (primary + i) % urls.length;
    const url = normaliseWs(urls[idx]);
    const client = new SignalingClient(url);
    try {
      await client.connect();
      if (i > 0) logger.info('Connected to fallback OneShare shard', { shard: idx, url, primary });
      return client;
    } catch (err) {
      lastErr = err;
      logger.warn('OneShare shard connection failed, trying next', { shard: idx, url, error: err.message });
      client.destroy();
    }
  }
  throw new Error('All OneShare signaling shards unreachable' + (lastErr ? `: ${lastErr.message}` : ''));
}

/**
 * Create a SignalingClient connected to a Lab Share shard, with ring-order
 * fallback across ALL configured shards (matches the web portal's
 * getLabSignalingUrls behaviour).
 */
async function connectForLabShare(roomNumber) {
  const urls = config.signaling.labUrls;
  if (urls.length === 0) throw new Error('No signaling URLs configured');

  const primary = djb2Hash(roomNumber) % urls.length;
  let lastErr = null;
  for (let i = 0; i < urls.length; i++) {
    const idx = (primary + i) % urls.length;
    const wsBase = normaliseWs(urls[idx]);
    const url = `${wsBase}?room=${encodeURIComponent(roomNumber)}`;
    const client = new SignalingClient(url);
    try {
      await client.connect();
      if (i > 0) logger.info('Connected to fallback Lab Share shard', { shard: idx, url, primary });
      return client;
    } catch (err) {
      lastErr = err;
      logger.warn('Lab Share shard connection failed, trying next', { shard: idx, url, error: err.message });
      client.destroy();
    }
  }
  throw new Error('All Lab Share signaling shards unreachable' + (lastErr ? `: ${lastErr.message}` : ''));
}

module.exports = {
  SignalingClient,
  djb2Hash,
  generateCode,
  generateCodeForShard,
  getOneShareUrl,
  getLabShareUrl,
  connectForOneShare,
  connectForLabShare,
};
