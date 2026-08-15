'use strict';

/**
 * Embedded Socket.IO Signaling Server
 * 
 * This is the FULL signaling server (equivalent to SignalingHuggingFace/server.js)
 * running inside the same process as the WhatsApp bot.
 * 
 * All existing web clients (LabShare Student, Admin, OneShare) connect here
 * via Socket.IO path /api/socket/io — same protocol, same events.
 * 
 * The bot communicates with signaling via direct function calls through
 * the manager module — zero network latency.
 */

const { Server } = require('socket.io');
const cron = require('node-cron');
const logger = require('../utils/logger');
const config = require('../config');

// ── In-memory state ──────────────────────────────────────────────────────────
const rooms = new Map();
const users = new Map();
const adminByRoom = new Map();
const sessionByUserKey = new Map();
const userDataByKey = new Map();
const oneShareSessions = new Map();

// ── O(1) Pick-and-Swap-Last Code Pool ────────────────────────────────────────
// Pre-compute all 9,000 possible 4-digit codes (1000–9999) in an array.
// Generation: pick a random index, grab the code, swap-last, pop → O(1)
// Release:    push the code back to the end of the array            → O(1)
// 100% uniform randomness, zero CPU loops, zero hash collisions.
const codePool = [];
for (let i = 1000; i <= 9999; i++) codePool.push(i.toString());

/** O(1) Pick-and-Swap-Last: acquire a random code from the pool */
function acquireOneShareCode() {
  if (codePool.length === 0) return null;
  const idx = Math.floor(Math.random() * codePool.length);
  const code = codePool[idx];
  codePool[idx] = codePool[codePool.length - 1];
  codePool.pop();
  return code;
}

/** O(1) Release: return a code to the pool */
function releaseOneShareCode(code) {
  codePool.push(code);
}

function dailyCleanup() {
  logger.info('Daily cleanup triggered — clearing all state');
  if (_io) {
    for (const [, socket] of _io.sockets.sockets) {
      try {
        socket.emit('server-restart', { reason: 'Daily cleanup — reconnect for a fresh session' });
        socket.disconnect(true);
      } catch {}
    }
  }
  rooms.clear();
  users.clear();
  adminByRoom.clear();
  sessionByUserKey.clear();
  userDataByKey.clear();
  // Return all active codes to the pool before clearing sessions
  for (const code of oneShareSessions.keys()) {
    releaseOneShareCode(code);
  }
  oneShareSessions.clear();
  logger.info('All state cleared');
}

// Schedule daily cleanup at 3:00 AM IST (21:30 UTC)
cron.schedule('30 21 * * *', dailyCleanup, { timezone: 'UTC' });

// ── Module-level IO reference ────────────────────────────────────────────────
let _io = null;

/**
 * Attach Socket.IO to an HTTP server.
 * @param {http.Server} httpServer
 * @returns {Server} Socket.IO server instance
 */
function attachToServer(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
      credentials: true,
    },
    path: '/api/socket/io',
  });

  _io = io;

  io.on('connection', (socket) => {
    logger.info('Socket connected', { id: socket.id });

    // ── Join room (LabShare presence) ──
    socket.on('join-room', (data) => {
      const { roomNumber } = data || {};
      if (!roomNumber) return;

      const logicalId = data.user?.id;
      const user = {
        ...(data.user || {}),
        id: socket.id,
        logicalId,
        roomNumber,
        isOnline: true,
      };

      socket.join(roomNumber);

      if (!rooms.has(roomNumber)) rooms.set(roomNumber, new Set());
      rooms.get(roomNumber).add(socket.id);
      users.set(socket.id, user);

      // Single-session enforcement
      if (logicalId) {
        const key = `${roomNumber}:${logicalId}`;
        const prevSid = sessionByUserKey.get(key);
        sessionByUserKey.set(key, socket.id);
        userDataByKey.set(key, user);
        if (prevSid && prevSid !== socket.id) {
          const prevSock = io.sockets.sockets.get(prevSid);
          if (prevSock) {
            prevSock.emit('single-session-logout');
            prevSock.disconnect(true);
          } else {
            for (const [r, set] of rooms.entries()) {
              set.delete(prevSid);
              if (set.size === 0) rooms.delete(r);
            }
            users.delete(prevSid);
          }
        }
      }

      socket.to(roomNumber).emit('user-joined', user);

      // Send current room users (dedup)
      const seen = new Set();
      const roomUsersList = Array.from(users.values())
        .filter(u => u.roomNumber === roomNumber && u.id !== user.id)
        .filter(u => {
          const k = u.logicalId || u.uniqueId || u.id;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });
      socket.emit('room-users', roomUsersList);

      const adminId = adminByRoom.get(roomNumber);
      if (adminId) {
        socket.emit('admin-online', { adminId, roomNumber });
      }

      logger.info(`User ${user.name} joined room ${roomNumber}`);
    });

    // ── Get room users ──
    socket.on('get-room-users', (data) => {
      const user = users.get(socket.id);
      const roomNumber = data?.roomNumber || user?.roomNumber;
      if (!roomNumber) return;

      const seen = new Set();
      const roomUsersList = Array.from(users.values())
        .filter(u => u.roomNumber === roomNumber && u.id !== socket.id)
        .filter(u => {
          const k = u.logicalId || u.uniqueId || u.id;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });
      socket.emit('room-users', roomUsersList);
    });

    // ── WebRTC signaling relay ──
    socket.on('webrtc-offer', (data) => {
      const { targetId, offer } = data || {};
      if (targetId) socket.to(targetId).emit('webrtc-offer', { offer, senderId: socket.id });
    });

    socket.on('webrtc-answer', (data) => {
      const { targetId, answer } = data || {};
      if (targetId) socket.to(targetId).emit('webrtc-answer', { answer, senderId: socket.id });
    });

    socket.on('webrtc-ice-candidate', (data) => {
      const { targetId, candidate } = data || {};
      if (targetId) socket.to(targetId).emit('webrtc-ice-candidate', { candidate, senderId: socket.id });
    });

    // ── File sharing notification ──
    socket.on('file-share-request', (data) => {
      const { roomNumber } = data || {};
      if (roomNumber) socket.to(roomNumber).emit('file-share-request', { fileInfo: data.fileInfo, senderId: socket.id });
    });

    // ── Print request ──
    socket.on('print-request', (data) => {
      const { fileInfo, roomNumber } = data || {};
      if (roomNumber) socket.to(roomNumber).emit('print-request', { fileInfo, senderId: socket.id });
    });

    // ── Transfer cancelled ──
    socket.on('transfer-cancelled', (data) => {
      const { targetId, senderName, senderUniqueId } = data || {};
      if (targetId) socket.to(targetId).emit('transfer-cancelled', { senderName, senderUniqueId, senderId: socket.id });
    });

    // ── Admin auth ──
    socket.on('admin-auth', (data) => {
      const { roomNumber, password, admin } = data || {};
      if (password === config.signaling.adminPassword) {
        socket.join(`admin-${roomNumber}`);
        adminByRoom.set(roomNumber, socket.id);
        const adminUser = admin || {
          id: socket.id,
          name: 'Lab Admin',
          uniqueId: 'ADMIN',
          roomNumber,
          isOnline: true,
        };
        users.set(socket.id, adminUser);
        io.to(roomNumber).emit('admin-online', { adminId: socket.id, roomNumber });
        socket.emit('admin-auth-success', { roomNumber, adminId: socket.id });
      } else {
        socket.emit('admin-auth-failed');
      }
    });

    // ── Heartbeat ──
    socket.on('heartbeat', () => {});

    // ══════════════════════════════════════════════════════════════════
    // OneShare
    // ══════════════════════════════════════════════════════════════════

    socket.on('oneshare-create', (data) => {
      // Accept client-generated code if provided, otherwise acquire from O(1) pool
      let code;
      if (data?.code && typeof data.code === 'string' && /^\d{4}$/.test(data.code)) {
        if (oneShareSessions.has(data.code)) {
          socket.emit('oneshare-code-taken', { code: data.code });
          return;
        }
        // Remove from pool to prevent double-use
        const poolIdx = codePool.indexOf(data.code);
        if (poolIdx !== -1) {
          codePool[poolIdx] = codePool[codePool.length - 1];
          codePool.pop();
        }
        code = data.code;
      } else {
        code = acquireOneShareCode();
        if (!code) {
          socket.emit('oneshare-error', { message: 'Server is at maximum capacity. Please try again later.' });
          return;
        }
      }

      oneShareSessions.set(code, {
        senderId: socket.id,
        createdAt: Date.now(),
        files: data?.files,
        multiShare: data?.multiShare || false,
        receivers: new Set(),
        // Store relay download URLs if provided by the bot
        relayFiles: data?.relayFiles || null,
        relayLinks: data?.relayLinks || null,
        relayCodeSnippets: data?.relayCodeSnippets || null,
      });

      socket.join(`oneshare-${code}`);
      socket.emit('oneshare-created', { code });
      logger.info(`OneShare created: ${code}${data?.multiShare ? ' (MultiShare)' : ''}`);
    });

    socket.on('oneshare-join', (data) => {
      const { code } = data || {};
      const session = oneShareSessions.get(code);
      if (!session) {
        socket.emit('oneshare-error', { message: 'Invalid or expired code' });
        return;
      }

      if (session.receivers) session.receivers.add(socket.id);
      socket.join(`oneshare-${code}`);

      // Notify sender
      io.to(session.senderId).emit('oneshare-receiver-joined', {
        receiverId: socket.id,
        code,
      });

      // Send session info to receiver
      socket.emit('oneshare-joined', {
        senderId: session.senderId,
        code,
        files: session.files,
      });

      // If relay data is available (bot-mediated transfer), send it immediately
      if (session.relayFiles || session.relayLinks || session.relayCodeSnippets) {
        socket.emit('relay-ready', {
          code,
          files: session.relayFiles || [],
          links: session.relayLinks || [],
          codeSnippets: session.relayCodeSnippets || [],
        });
      }

      logger.info(`Receiver ${socket.id} joined OneShare: ${code}`);
    });

    // ── OneShare WebRTC signaling ──
    socket.on('oneshare-offer', (data) => {
      const { targetId, offer, code } = data || {};
      if (targetId) socket.to(targetId).emit('oneshare-offer', { offer, senderId: socket.id, code });
    });

    socket.on('oneshare-answer', (data) => {
      const { targetId, answer, code } = data || {};
      if (targetId) socket.to(targetId).emit('oneshare-answer', { answer, senderId: socket.id, code });
    });

    socket.on('oneshare-ice-candidate', (data) => {
      const { targetId, candidate, code } = data || {};
      if (targetId) socket.to(targetId).emit('oneshare-ice-candidate', { candidate, senderId: socket.id, code });
    });

    socket.on('oneshare-complete', (data) => {
      const { code, receiverId } = data || {};
      const session = oneShareSessions.get(code);
      if (!session) return;
      if (session.senderId !== socket.id) return;

      if (session.multiShare && receiverId) {
        io.to(receiverId).emit('oneshare-transfer-complete', { code });
        logger.info(`MultiShare transfer complete for ${receiverId}: ${code}`);
      } else {
        io.to(`oneshare-${code}`).emit('oneshare-transfer-complete', { code });
        oneShareSessions.delete(code);
        releaseOneShareCode(code);
        logger.info(`OneShare completed: ${code}`);
      }
    });

    socket.on('oneshare-cancel', (data) => {
      const { code } = data || {};
      const session = oneShareSessions.get(code);
      if (session && session.senderId === socket.id) {
        io.to(`oneshare-${code}`).emit('oneshare-cancelled', { code });
        oneShareSessions.delete(code);
        releaseOneShareCode(code);
        logger.info(`OneShare cancelled: ${code}`);
      }
    });

    // ══════════════════════════════════════════════════════════════════
    // Relay events (bot → web client, server-mediated file transfer)
    // ══════════════════════════════════════════════════════════════════

    socket.on('relay-file', (data) => {
      const { targetId } = data || {};
      if (targetId) io.to(targetId).emit('relay-file', { ...data, senderId: socket.id });
    });

    socket.on('relay-link', (data) => {
      const { targetId } = data || {};
      if (targetId) io.to(targetId).emit('relay-link', { ...data, senderId: socket.id });
    });

    socket.on('relay-code', (data) => {
      const { targetId } = data || {};
      if (targetId) io.to(targetId).emit('relay-code', { ...data, senderId: socket.id });
    });

    // ── Disconnect ──
    socket.on('disconnect', () => {
      const user = users.get(socket.id);
      if (user) {
        const roomUserSet = rooms.get(user.roomNumber);
        if (roomUserSet) {
          roomUserSet.delete(socket.id);
          if (roomUserSet.size === 0) rooms.delete(user.roomNumber);
        }
        users.delete(socket.id);

        const logicalId = user.logicalId;
        if (logicalId) {
          const key = `${user.roomNumber}:${logicalId}`;
          if (sessionByUserKey.get(key) === socket.id) {
            sessionByUserKey.delete(key);
            userDataByKey.delete(key);
          }
        }

        socket.to(user.roomNumber).emit('user-left', user);
        logger.info(`User ${user.name} disconnected from room ${user.roomNumber}`);
      }

      // Admin disconnect
      for (const [room, adminId] of adminByRoom.entries()) {
        if (adminId === socket.id) {
          adminByRoom.delete(room);
          io.to(room).emit('admin-offline', { roomNumber: room });
        }
      }

      // OneShare session cleanup
      for (const [code, session] of oneShareSessions.entries()) {
        if (session.senderId === socket.id) {
          io.to(`oneshare-${code}`).emit('oneshare-cancelled', { code, reason: 'Sender disconnected' });
          oneShareSessions.delete(code);
          releaseOneShareCode(code);
          logger.info(`OneShare auto-cancelled on disconnect: ${code}`);
        }
      }
    });
  });

  return io;
}

// ── Exported state accessors (used by manager.js) ────────────────────────────
module.exports = {
  attachToServer,
  getIO: () => _io,
  rooms,
  users,
  adminByRoom,
  oneShareSessions,
  acquireOneShareCode,
  releaseOneShareCode,
};
