'use strict';

const fs = require('fs');
const logger = require('../utils/logger');
const config = require('../config');
const { connectForOneShare, connectForLabShare, generateCode, djb2Hash } = require('./signalingClient');
const { WebRTCSender } = require('./webrtcSender');

/**
 * ShareManager — Orchestrates background share sessions for the WA-Bot.
 *
 * When a user chooses OneShare/MultiShare, the ShareManager:
 *   1. Generates a 4-digit code (mapped to the correct signaling shard)
 *   2. Connects to the signaling DO and registers the code
 *   3. Returns the code immediately so the bot can reply to the user
 *   4. Keeps the session alive in the background (up to TTL)
 *   5. When a receiver joins, sends files via WebRTC
 *   6. Cleans up after transfer or timeout
 *
 * For LabShare, the flow is similar but it joins a room and sends to
 * specific targets (admin for print, or all users).
 */
class ShareManager {
  constructor() {
    /** @type {Map<string, object>} Active background sessions keyed by code */
    this.activeSessions = new Map();
  }

  /**
   * Create a OneShare session.
   * Returns the code immediately; file transfer happens in background.
   *
   * @param {object} sessionData - { files, links, codeSnippets } with tempPath info
   * @returns {{ code: string }}
   */
  async createOneShare(sessionData) {
    const urls = config.signaling.oneShareUrls;
    const code = generateCode();

    // Connect to the correct signaling shard for this code
    const signalingClient = await connectForOneShare(code);

    // Register the OneShare session on the signaling DO
    const fileMetadata = sessionData.files.map(f => ({
      fileName: f.fileName,
      fileSize: f.fileSize,
      fileType: f.fileType || f.mimetype || 'application/octet-stream',
      fileId: f.fileId,
    }));

    signalingClient.send('oneshare-create', {
      code,
      files: fileMetadata,
      multiShare: false,
    });

    // Wait for 'oneshare-created' confirmation
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Code registration timeout')), 10000);

      signalingClient.once('oneshare-created', (data) => {
        clearTimeout(timeout);
        logger.info('OneShare session registered on signaling', { code: data.code });
        resolve();
      });

      signalingClient.once('oneshare-code-taken', () => {
        clearTimeout(timeout);
        reject(new Error('Code collision — try again'));
      });
    });

    // Start background transfer listener
    this._startBackgroundTransfer(code, signalingClient, sessionData, false);

    return { code };
  }

  /**
   * Create a MultiShare session.
   * Returns the code immediately; handles multiple receivers in background.
   */
  async createMultiShare(sessionData) {
    const code = generateCode();
    const signalingClient = await connectForOneShare(code);

    const fileMetadata = sessionData.files.map(f => ({
      fileName: f.fileName,
      fileSize: f.fileSize,
      fileType: f.fileType || f.mimetype || 'application/octet-stream',
      fileId: f.fileId,
    }));

    signalingClient.send('oneshare-create', {
      code,
      files: fileMetadata,
      multiShare: true,
    });

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Code registration timeout')), 10000);
      signalingClient.once('oneshare-created', (data) => {
        clearTimeout(timeout);
        logger.info('MultiShare session registered on signaling', { code: data.code });
        resolve();
      });
      signalingClient.once('oneshare-code-taken', () => {
        clearTimeout(timeout);
        reject(new Error('Code collision — try again'));
      });
    });

    this._startBackgroundTransfer(code, signalingClient, sessionData, true);

    return { code };
  }

  /**
   * Create a LabShare session.
   * Bot joins the room as a virtual student and sends files to targets.
   */
  async createLabShare(sessionData, roomNumber, recipientType, senderName, senderId) {
    const signalingClient = await connectForLabShare(roomNumber);

    // Join the room as a virtual student
    signalingClient.send('join-room', {
      roomNumber,
      user: {
        name: senderName.toUpperCase(),
        id: senderId,
        uniqueId: senderId,
      },
    });

    // Wait for room-users list to know who's in the room
    const roomUsers = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        // Even if we don't get users list, the join was successful
        resolve([]);
      }, 5000);

      signalingClient.once('room-users', (users) => {
        clearTimeout(timeout);
        resolve(Array.isArray(users) ? users : []);
      });
    });

    logger.info('Joined lab room', { roomNumber, usersCount: roomUsers.length, senderName, senderId });

    // Start file transfer to targets
    this._startLabShareTransfer(signalingClient, sessionData, roomUsers, recipientType, roomNumber, senderName, senderId);

    return {
      name: senderName,
      id: senderId,
      room: roomNumber,
      to: recipientType,
    };
  }

  /**
   * Background transfer for OneShare/MultiShare.
   * Keeps the signaling + WebRTC session alive until transfer completes or times out.
   */
  _startBackgroundTransfer(code, signalingClient, sessionData, isMultiShare) {
    const ttlMs = isMultiShare ? 5 * 60 * 1000 : 10 * 60 * 1000;

    const session = {
      code,
      signalingClient,
      sessionData,
      isMultiShare,
      createdAt: Date.now(),
      transfers: 0,
    };

    this.activeSessions.set(code, session);

    // Auto-cleanup after TTL
    const cleanupTimer = setTimeout(() => {
      logger.info('Share session expired', { code, transfers: session.transfers });
      this._cleanupSession(code);
    }, ttlMs);
    if (cleanupTimer.unref) cleanupTimer.unref();
    session.cleanupTimer = cleanupTimer;

    // Listen for receivers joining
    signalingClient.on('oneshare-receiver-joined', async (data) => {
      const receiverId = data.receiverId;
      logger.info('Receiver joined, starting WebRTC transfer', { code, receiverId });

      try {
        const sender = new WebRTCSender(signalingClient, code);
        // Manually trigger peer creation (receiver already joined)
        sender._receiverId = receiverId;
        sender._createPeer(receiverId,
          setTimeout(() => {}, 120000), // 2 min timeout for WebRTC setup
          async () => {
            // Connected! Send all files
            try {
              await this._sendAllContent(sender, sessionData);
              sender.complete(receiverId);
              session.transfers++;
              logger.info('Transfer complete', { code, receiverId, transferCount: session.transfers });

              // OneShare: cleanup after first transfer
              if (!isMultiShare) {
                sender.destroy();
                this._cleanupSession(code);
              } else {
                sender.destroy();
              }
            } catch (err) {
              logger.error('File transfer failed', { code, receiverId, error: err.message });
              sender.destroy();
            }
          },
          (err) => {
            logger.error('WebRTC connection failed', { code, receiverId, error: err.message });
            sender.destroy();
          }
        );
      } catch (err) {
        logger.error('Failed to handle receiver', { code, receiverId, error: err.message });
      }
    });
  }

  /**
   * LabShare transfer: send files to admin and/or all users via WebRTC.
   */
  async _startLabShareTransfer(signalingClient, sessionData, roomUsers, recipientType, roomNumber, senderName, senderId) {
    // For lab share, we need to initiate WebRTC with target users
    // The admin is identified by the 'admin-online' event or from room users
    const targets = recipientType === 'print'
      ? roomUsers.filter(u => u.name === 'Lab Admin' || u.uniqueId === 'ADMIN')
      : (recipientType === 'students'
        ? roomUsers.filter(u => u.name !== 'Lab Admin' && u.uniqueId !== 'ADMIN')
        : roomUsers);

    if (targets.length === 0) {
      logger.warn('No target users found in room', { roomNumber, recipientType });
      // Wait a bit for users/admin to appear
      await new Promise(resolve => setTimeout(resolve, 3000));
    }

    // For each target, create a WebRTC connection and send files
    for (const target of targets) {
      try {
        await this._sendToLabTarget(signalingClient, sessionData, target, senderName, senderId);
      } catch (err) {
        logger.error('Lab transfer to target failed', {
          roomNumber,
          targetId: target.id,
          targetName: target.name,
          error: err.message,
        });
      }
    }

    // Cleanup after all transfers
    setTimeout(() => {
      signalingClient.destroy();
    }, 5000);
  }

  /**
   * Send files to a single lab room target via WebRTC.
   */
  async _sendToLabTarget(signalingClient, sessionData, target, senderName, senderId) {
    return new Promise((resolve, reject) => {
      let SimplePeer, wrtcModule;
      try {
        SimplePeer = require('simple-peer');
        wrtcModule = require('node-datachannel/polyfill');
      } catch (err) {
        return reject(new Error('WebRTC dependencies not available'));
      }

      const peer = new SimplePeer({
        initiator: true,
        trickle: true,
        wrtc: wrtcModule,
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
          ],
        },
      });

      // Relay signaling
      peer.on('signal', (data) => {
        if (data.type === 'offer') {
          signalingClient.send('webrtc-offer', { targetId: target.id, offer: data });
        } else if (data.candidate) {
          signalingClient.send('webrtc-ice-candidate', { targetId: target.id, candidate: data });
        }
      });

      // Handle answer from target
      const onAnswer = (data) => {
        if (data.senderId === target.id) {
          peer.signal(data.answer);
        }
      };
      const onIce = (data) => {
        if (data.senderId === target.id) {
          peer.signal(data.candidate);
        }
      };
      signalingClient.on('webrtc-answer', onAnswer);
      signalingClient.on('webrtc-ice-candidate', onIce);

      const timeout = setTimeout(() => {
        peer.destroy();
        signalingClient.removeListener('webrtc-answer', onAnswer);
        signalingClient.removeListener('webrtc-ice-candidate', onIce);
        reject(new Error('Lab WebRTC timeout'));
      }, 30000);

      peer.on('connect', async () => {
        clearTimeout(timeout);
        try {
          // Send files using the same protocol
          for (const file of sessionData.files) {
            if (file.fileType === 'contact') {
              peer.send(JSON.stringify({
                type: 'contact-share',
                name: file.fileName,
                phone: file.contact ? file.contact.phone : '',
                fileId: file.fileId,
                senderName: senderName.toUpperCase(),
                senderUniqueId: senderId,
              }));
            } else if (file.fileType === 'location') {
              peer.send(JSON.stringify({
                type: 'location-share',
                latitude: file.location.latitude,
                longitude: file.location.longitude,
                name: file.fileName,
                address: file.location.address,
                fileId: file.fileId,
                senderName: senderName.toUpperCase(),
                senderUniqueId: senderId,
              }));
            } else if (file.tempPath && fs.existsSync(file.tempPath)) {
              const stat = fs.statSync(file.tempPath);
              peer.send(JSON.stringify({
                type: 'file-metadata',
                fileName: file.fileName,
                fileSize: stat.size,
                fileType: file.fileType || file.mimetype || 'application/octet-stream',
                senderName: senderName.toUpperCase(),
                senderUniqueId: senderId,
                fileId: file.fileId,
              }));

              // Send chunks
              const fd = fs.openSync(file.tempPath, 'r');
              const buf = Buffer.alloc(64 * 1024);
              let offset = 0;
              while (offset < stat.size) {
                const bytesRead = fs.readSync(fd, buf, 0, 64 * 1024, offset);
                // Make a copy of the read bytes to prevent concurrent overwrite memory corruption
                const chunk = Buffer.alloc(bytesRead);
                buf.copy(chunk, 0, 0, bytesRead);

                peer.send(chunk);
                offset += bytesRead;
                // Basic backpressure / event-loop yield
                await new Promise(r => setTimeout(r, 2));
              }
              fs.closeSync(fd);

              peer.send(JSON.stringify({ type: 'file-complete', fileName: file.fileName }));
            }
          }

          // Send links
          for (const link of (sessionData.links || [])) {
            peer.send(JSON.stringify({
              type: 'link',
              linkUrl: link.url,
              senderName: senderName.toUpperCase(),
              senderUniqueId: senderId,
              fileId: link.fileId,
            }));
          }

          // Send code snippets
          for (const snippet of (sessionData.codeSnippets || [])) {
            peer.send(JSON.stringify({
              type: 'message',
              message: snippet,
              senderName: senderName.toUpperCase(),
              senderUniqueId: senderId,
              allowReshare: true,
              timestamp: Date.now()
            }));
          }

          logger.info('Lab transfer complete to target', { targetId: target.id, targetName: target.name });
          peer.destroy();
          signalingClient.removeListener('webrtc-answer', onAnswer);
          signalingClient.removeListener('webrtc-ice-candidate', onIce);
          resolve();
        } catch (err) {
          peer.destroy();
          signalingClient.removeListener('webrtc-answer', onAnswer);
          signalingClient.removeListener('webrtc-ice-candidate', onIce);
          reject(err);
        }
      });

      peer.on('error', (err) => {
        clearTimeout(timeout);
        peer.destroy();
        signalingClient.removeListener('webrtc-answer', onAnswer);
        signalingClient.removeListener('webrtc-ice-candidate', onIce);
        reject(err);
      });
    });
  }

  /**
   * Send all session content (files, links, code snippets) via a WebRTCSender.
   */
  async _sendAllContent(sender, sessionData) {
    // Send files
    for (const file of sessionData.files) {
      if (file.fileType === 'contact') {
        await sender.sendContact(file.fileName, file.contact ? file.contact.phone : '', file.fileId);
      } else if (file.fileType === 'location') {
        await sender.sendLocation(
          file.location.latitude,
          file.location.longitude,
          file.fileName,
          file.location.address,
          file.fileId
        );
      } else if (file.tempPath && fs.existsSync(file.tempPath)) {
        await sender.sendFile(file.tempPath, file.mimetype || file.fileType, file.fileId);
      }
    }

    // Send links
    for (const link of (sessionData.links || [])) {
      await sender.sendLink(link.url, undefined, undefined, link.fileId);
    }

    // Send code snippets as messages
    for (const snippet of (sessionData.codeSnippets || [])) {
      await sender.sendMessage(snippet);
    }
  }

  /**
   * Clean up a share session.
   */
  _cleanupSession(code) {
    const session = this.activeSessions.get(code);
    if (!session) return;

    if (session.cleanupTimer) {
      clearTimeout(session.cleanupTimer);
    }
    if (session.signalingClient) {
      session.signalingClient.destroy();
    }
    this.activeSessions.delete(code);
    logger.debug('Share session cleaned up', { code });
  }

  /**
   * Get active session count (for health check / monitoring).
   */
  get activeCount() {
    return this.activeSessions.size;
  }

  /**
   * Destroy all active sessions (for graceful shutdown).
   */
  destroyAll() {
    for (const [code] of this.activeSessions) {
      this._cleanupSession(code);
    }
  }
}

// Singleton
const shareManager = new ShareManager();

module.exports = shareManager;
