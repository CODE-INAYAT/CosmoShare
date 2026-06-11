'use strict';

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

// Use node-datachannel polyfill for browser-compatible RTCPeerConnection
let wrtcModule;
try {
  wrtcModule = require('node-datachannel/polyfill');
} catch {
  logger.error('node-datachannel not available. WebRTC transfers will not work.');
  wrtcModule = null;
}

const CHUNK_SIZE = 64 * 1024; // 64KB — matches CosmoShare web app
const STUN_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

/**
 * WebRTCSender — sends files over a WebRTC data channel to a CosmoShare receiver.
 *
 * Uses the same chunking protocol as CosmoShare's useOneShareWebRTC hook:
 *   1. JSON control: { type: 'file-metadata', fileName, fileSize, fileType }
 *   2. Binary chunks: raw Uint8Array (64KB each)
 *   3. JSON control: { type: 'file-complete', fileName }
 *
 * For links: JSON { type: 'link', linkUrl, message }
 * For messages/code snippets: JSON { type: 'message-only', message }
 */
class WebRTCSender {
  /**
   * @param {SignalingClient} signalingClient - Connected signaling client
   * @param {string} code - OneShare code (for signaling event routing)
   */
  constructor(signalingClient, code) {
    this.signaling = signalingClient;
    this.code = code;
    this.peer = null;
    this.dataChannel = null;
    this.connected = false;
    this._destroyed = false;
    this._connectPromise = null;
    this._receiverId = null;
  }

  /**
   * Wait for a receiver to join and establish WebRTC connection.
   * Returns when the data channel is open and ready for file transfer.
   *
   * @param {number} [timeoutMs=600000] - Max wait time (default 10 min)
   * @returns {Promise<string>} receiverId
   */
  waitForReceiver(timeoutMs = 600000) {
    if (!wrtcModule) return Promise.reject(new Error('WebRTC not available'));

    return new Promise((resolve, reject) => {
      if (this._destroyed) return reject(new Error('Sender destroyed'));

      const timeout = setTimeout(() => {
        reject(new Error('No receiver joined within timeout'));
        this.destroy();
      }, timeoutMs);

      // When receiver joins the OneShare session via signaling
      this.signaling.on('oneshare-receiver-joined', (data) => {
        const receiverId = data.receiverId;
        this._receiverId = receiverId;
        logger.info('Receiver joined, initiating WebRTC', { code: this.code, receiverId });

        try {
          this._createPeer(receiverId, timeout, resolve, reject);
        } catch (err) {
          clearTimeout(timeout);
          reject(err);
        }
      });

      // Handle code collision
      this.signaling.on('oneshare-code-taken', () => {
        clearTimeout(timeout);
        reject(new Error('Code already taken on this shard'));
      });

      // Handle session cancellation
      this.signaling.on('oneshare-cancelled', () => {
        clearTimeout(timeout);
        reject(new Error('Session cancelled'));
        this.destroy();
      });

      // Handle WS close
      this.signaling.on('ws-close', () => {
        clearTimeout(timeout);
        reject(new Error('Signaling connection lost'));
      });
    });
  }

  /**
   * Create RTCPeerConnection using simple-peer (same library as web app).
   */
  _createPeer(receiverId, timeout, resolve, reject) {
    let SimplePeer;
    try {
      SimplePeer = require('simple-peer');
    } catch {
      clearTimeout(timeout);
      return reject(new Error('simple-peer not installed'));
    }

    // Create initiator peer with node-datachannel as the WebRTC backend
    this.peer = new SimplePeer({
      initiator: true,
      trickle: true,
      wrtc: wrtcModule,
      config: {
        iceServers: STUN_SERVERS,
      },
    });

    // Relay signaling data to the receiver via signaling server
    this.peer.on('signal', (signalData) => {
      if (signalData.type === 'offer') {
        this.signaling.send('oneshare-offer', {
          targetId: receiverId,
          offer: signalData,
          code: this.code,
        });
      } else if (signalData.type === 'answer') {
        this.signaling.send('oneshare-answer', {
          targetId: receiverId,
          answer: signalData,
          code: this.code,
        });
      } else if (signalData.candidate) {
        this.signaling.send('oneshare-ice-candidate', {
          targetId: receiverId,
          candidate: signalData,
          code: this.code,
        });
      }
    });

    // Handle incoming signaling from receiver
    this.signaling.on('oneshare-answer', (data) => {
      if (data.senderId === receiverId && this.peer && !this.peer.destroyed) {
        this.peer.signal(data.answer);
      }
    });

    this.signaling.on('oneshare-ice-candidate', (data) => {
      if (data.senderId === receiverId && this.peer && !this.peer.destroyed) {
        this.peer.signal(data.candidate);
      }
    });

    // Data channel connected
    this.peer.on('connect', () => {
      clearTimeout(timeout);
      this.connected = true;
      logger.info('WebRTC data channel open', { code: this.code, receiverId });
      resolve(receiverId);
    });

    this.peer.on('error', (err) => {
      logger.error('WebRTC peer error', { code: this.code, error: err.message });
      if (!this.connected) {
        clearTimeout(timeout);
        reject(err);
      }
    });

    this.peer.on('close', () => {
      this.connected = false;
      logger.debug('WebRTC peer closed', { code: this.code });
    });
  }

  /**
   * Send a file over the data channel.
   * Uses the same chunking protocol as CosmoShare's useOneShareWebRTC.
   *
   * @param {string} filePath - Absolute path to the file
   * @param {string} [mimeType] - MIME type override
   */
  async sendFile(filePath, mimeType, fileId) {
    if (!this.peer || this.peer.destroyed || !this.connected) {
      throw new Error('Not connected');
    }

    const fileName = path.basename(filePath);
    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const fileType = mimeType || require('mime-types').lookup(filePath) || 'application/octet-stream';

    // 1. Send file metadata
    this.peer.send(JSON.stringify({
      type: 'file-metadata',
      fileName,
      fileSize,
      fileType,
      fileId,
    }));

    // 2. Send binary chunks
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(CHUNK_SIZE);
    let offset = 0;

    try {
      while (offset < fileSize) {
        const bytesRead = fs.readSync(fd, buffer, 0, CHUNK_SIZE, offset);
        // Make a copy of the read bytes to prevent concurrent overwrite memory corruption
        const chunk = Buffer.alloc(bytesRead);
        buffer.copy(chunk, 0, 0, bytesRead);

        // Wait for buffer to drain if needed (backpressure)
        await this._waitForDrain();

        this.peer.send(chunk);
        offset += bytesRead;

        // Yield to the event loop to allow native WebRTC processing
        await new Promise(r => setTimeout(r, 2));
      }
    } finally {
      fs.closeSync(fd);
    }

    // 3. Send file-complete marker
    this.peer.send(JSON.stringify({
      type: 'file-complete',
      fileName,
    }));

    logger.info('File sent via WebRTC', { fileName, fileSize, code: this.code });
  }

  /**
   * Send a link over the data channel.
   */
  async sendLink(linkUrl, message, sender, fileId) {
    if (!this.peer || this.peer.destroyed || !this.connected) {
      throw new Error('Not connected');
    }
    this.peer.send(JSON.stringify({ type: 'link', linkUrl, message, fileId }));
  }

  /**
   * Send a contact over the data channel.
   */
  async sendContact(name, phone, fileId) {
    if (!this.peer || this.peer.destroyed || !this.connected) {
      throw new Error('Not connected');
    }
    this.peer.send(JSON.stringify({
      type: 'contact-share',
      name,
      phone,
      fileId,
    }));
  }

  /**
   * Send a location over the data channel.
   */
  async sendLocation(latitude, longitude, name, address, fileId) {
    if (!this.peer || this.peer.destroyed || !this.connected) {
      throw new Error('Not connected');
    }
    this.peer.send(JSON.stringify({
      type: 'location-share',
      latitude,
      longitude,
      name,
      address,
      fileId,
    }));
  }

  /**
   * Send a code snippet / message over the data channel.
   */
  async sendMessage(message) {
    if (!this.peer || this.peer.destroyed || !this.connected) {
      throw new Error('Not connected');
    }
    this.peer.send(JSON.stringify({ type: 'message-only', message }));
  }

  /**
   * Signal transfer complete to the signaling server.
   */
  complete(receiverId) {
    this.signaling.send('oneshare-complete', {
      code: this.code,
      receiverId,
    });
  }

  /**
   * Basic backpressure: wait if the internal buffer is too full.
   */
  async _waitForDrain() {
    if (!this.peer || this.peer.destroyed) return;
    try {
      const ch = this.peer._channel || this.peer.channel || this.peer.dataChannel;
      if (ch && typeof ch.bufferedAmount === 'number') {
        const MAX_BUFFER = 256 * 1024;
        if (ch.bufferedAmount > MAX_BUFFER) {
          await new Promise((resolve) => {
            const poll = setInterval(() => {
              if (!ch || ch.bufferedAmount <= MAX_BUFFER / 2) {
                clearInterval(poll);
                resolve();
              }
            }, 20);
            // Safety: don't wait forever
            setTimeout(() => { clearInterval(poll); resolve(); }, 5000);
          });
        }
      }
    } catch { /* ignore */ }
  }

  /**
   * Clean up WebRTC and signaling resources.
   */
  destroy() {
    this._destroyed = true;
    if (this.peer) {
      try { this.peer.destroy(); } catch { }
      this.peer = null;
    }
    this.connected = false;
  }
}

module.exports = { WebRTCSender };
