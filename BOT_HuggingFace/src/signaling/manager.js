'use strict';

/**
 * Signaling Manager — In-process API for the bot to interact with the
 * embedded signaling server via direct function calls (zero network latency).
 * 
 * Instead of connecting via WebSocket/Socket.IO client, the bot calls
 * these functions directly. This eliminates all signaling network overhead.
 */

const logger = require('../utils/logger');
const signaling = require('./server');

/**
 * Create a OneShare/MultiShare session directly in signaling state.
 * Returns the code immediately (< 1ms, no network).
 * 
 * @param {object} opts
 * @param {Array} opts.files - File metadata array [{fileName, fileSize, fileType, fileId}]
 * @param {boolean} opts.multiShare - Whether this is a multi-receiver session
 * @param {Array} [opts.relayFiles] - Relay download URLs for files
 * @param {Array} [opts.relayLinks] - Links to relay
 * @param {Array} [opts.relayCodeSnippets] - Code snippets to relay
 * @param {string} [opts.botSocketId] - A virtual socket ID for the bot sender
 * @returns {{ code: string }}
 */
function createOneShareSession(opts) {
  const code = signaling.acquireOneShareCode();
  if (!code) {
    logger.error('Failed to acquire OneShare code — pool exhausted');
    return null;
  }

  const session = {
    senderId: opts.botSocketId || '__bot__',
    createdAt: Date.now(),
    files: opts.files || [],
    multiShare: opts.multiShare || false,
    receivers: new Set(),
    relayFiles: opts.relayFiles || null,
    relayLinks: opts.relayLinks || null,
    relayCodeSnippets: opts.relayCodeSnippets || null,
  };

  signaling.oneShareSessions.set(code, session);

  logger.info('OneShare session created (in-process)', { code, multiShare: session.multiShare });
  return { code };
}

/**
 * Cancel a OneShare session.
 */
function cancelOneShareSession(code) {
  const session = signaling.oneShareSessions.get(code);
  if (!session) return false;

  const io = signaling.getIO();
  if (io) {
    io.to(`oneshare-${code}`).emit('oneshare-cancelled', { code });
  }
  signaling.oneShareSessions.delete(code);
  signaling.releaseOneShareCode(code);
  logger.info('OneShare session cancelled (in-process)', { code });
  return true;
}

/**
 * Mark a OneShare transfer as complete for a specific receiver.
 */
function completeOneShareTransfer(code, receiverId) {
  const session = signaling.oneShareSessions.get(code);
  if (!session) return false;

  const io = signaling.getIO();
  if (!io) return false;

  if (session.multiShare && receiverId) {
    io.to(receiverId).emit('oneshare-transfer-complete', { code });
    logger.info('MultiShare transfer complete (in-process)', { code, receiverId });
  } else {
    io.to(`oneshare-${code}`).emit('oneshare-transfer-complete', { code });
    signaling.oneShareSessions.delete(code);
    signaling.releaseOneShareCode(code);
    logger.info('OneShare completed (in-process)', { code });
  }
  return true;
}

/**
 * Listen for receivers joining a specific OneShare session.
 * Returns a cleanup function to stop listening.
 * 
 * @param {string} code - OneShare code
 * @param {function} callback - Called with { receiverId, socketId } when a receiver joins
 * @returns {function} cleanup function
 */
function onReceiverJoined(code, callback) {
  const io = signaling.getIO();
  if (!io) return () => {};

  // We intercept the oneshare-join event from the signaling server
  // by watching for new receivers in the session
  const checkInterval = setInterval(() => {
    const session = signaling.oneShareSessions.get(code);
    if (!session) {
      clearInterval(checkInterval);
      return;
    }

    for (const receiverId of session.receivers) {
      if (!receiverId._notified) {
        // Mark as notified
        session.receivers.delete(receiverId);
        session.receivers.add(Object.assign(String(receiverId), { _notified: true }));
        callback({ receiverId });
      }
    }
  }, 100);

  return () => clearInterval(checkInterval);
}

/**
 * Join a lab room as a virtual bot user (for LabShare).
 * Returns the list of users currently in the room.
 * 
 * @param {string} roomNumber
 * @param {object} botUser - { name, id, uniqueId }
 * @returns {Array} Current room users
 */
function joinRoom(roomNumber, botUser) {
  const virtualId = `__bot_${roomNumber}_${Date.now()}__`;

  const user = {
    ...botUser,
    id: virtualId,
    logicalId: botUser.id,
    roomNumber,
    isOnline: true,
    isBot: true,
  };

  // Add to room state
  if (!signaling.rooms.has(roomNumber)) {
    signaling.rooms.set(roomNumber, new Set());
  }
  signaling.rooms.get(roomNumber).add(virtualId);
  signaling.users.set(virtualId, user);

  // Notify others via Socket.IO
  const io = signaling.getIO();
  if (io) {
    io.to(roomNumber).emit('user-joined', user);
  }

  // Get current users in the room (excluding the bot itself)
  const seen = new Set();
  const roomUsers = Array.from(signaling.users.values())
    .filter(u => u.roomNumber === roomNumber && u.id !== virtualId)
    .filter(u => {
      const k = u.logicalId || u.uniqueId || u.id;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

  logger.info('Bot joined room (in-process)', { roomNumber, usersInRoom: roomUsers.length });
  return { virtualId, roomUsers };
}

/**
 * Leave a lab room (cleanup bot virtual presence).
 */
function leaveRoom(roomNumber, virtualId) {
  const roomUserSet = signaling.rooms.get(roomNumber);
  if (roomUserSet) {
    roomUserSet.delete(virtualId);
    if (roomUserSet.size === 0) signaling.rooms.delete(roomNumber);
  }

  const user = signaling.users.get(virtualId);
  signaling.users.delete(virtualId);

  const io = signaling.getIO();
  if (io && user) {
    io.to(roomNumber).emit('user-left', user);
  }
}

/**
 * Send a relay-file event to a specific socket (for LabShare file transfer).
 */
function relayFileToTarget(targetSocketId, data) {
  const io = signaling.getIO();
  if (!io) return false;

  io.to(targetSocketId).emit('relay-file', data);
  return true;
}

/**
 * Send a relay-link event to a specific socket.
 */
function relayLinkToTarget(targetSocketId, data) {
  const io = signaling.getIO();
  if (!io) return false;

  io.to(targetSocketId).emit('relay-link', data);
  return true;
}

/**
 * Send a relay-code event to a specific socket.
 */
function relayCodeToTarget(targetSocketId, data) {
  const io = signaling.getIO();
  if (!io) return false;

  io.to(targetSocketId).emit('relay-code', data);
  return true;
}

/**
 * Get stats about the signaling server state.
 */
function getStats() {
  const io = signaling.getIO();
  return {
    connectedClients: io?.engine?.clientsCount ?? 0,
    activeRooms: signaling.rooms.size,
    activeOneShareSessions: signaling.oneShareSessions.size,
    totalUsers: signaling.users.size,
  };
}

module.exports = {
  createOneShareSession,
  cancelOneShareSession,
  completeOneShareTransfer,
  onReceiverJoined,
  joinRoom,
  leaveRoom,
  relayFileToTarget,
  relayLinkToTarget,
  relayCodeToTarget,
  getStats,
};
