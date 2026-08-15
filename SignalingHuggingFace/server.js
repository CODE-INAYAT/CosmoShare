// CosmoShare Socket.IO Signaling Server for Hugging Face Spaces
// Mirrors the logic in src/lib/socket.ts — the existing Socket.IO signaling server

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cron = require('node-cron');

const PORT = process.env.PORT || 7860;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
    credentials: true,
  },
  // Match the path used by the Next.js client fallback
  path: '/api/socket/io',
});

// ── Health-check endpoint ────────────────────────────────────────────────────
app.get('/ping', (_req, res) => res.send('OK'));
app.get('/', (_req, res) =>
  res.json({
    service: 'CosmoShare Signaling Server',
    status: 'running',
    uptime: process.uptime(),
    connections: io.engine?.clientsCount ?? 0,
  })
);

// ── In-memory state ──────────────────────────────────────────────────────────
// Store room data: roomNumber -> Set<socketId>
const rooms = new Map();
// Map socket.id -> user payload
const users = new Map();
// Track admin socket per room: roomNumber -> socketId
const adminByRoom = new Map();
// Single-session tracking: `${roomNumber}:${logicalUserId}` -> socketId
const sessionByUserKey = new Map();
const userDataByKey = new Map();
// OneShare session storage: code -> { senderId, createdAt, files, multiShare, receivers }
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
  if (codePool.length === 0) return null; // All 9,000 codes in use (practically impossible)
  const idx = Math.floor(Math.random() * codePool.length);
  const code = codePool[idx];
  // Swap the picked code with the last element, then pop → O(1) removal
  codePool[idx] = codePool[codePool.length - 1];
  codePool.pop();
  return code;
}

/** O(1) Release: return a code to the pool */
function releaseOneShareCode(code) {
  codePool.push(code);
}

/** Daily cleanup — clears all state for a fresh start (3:00 AM IST = 21:30 UTC) */
function dailyCleanup() {
  console.log('Daily cleanup triggered — clearing all state');

  // Disconnect all sockets gracefully
  for (const [, socket] of io.sockets.sockets) {
    try {
      socket.emit('server-restart', {
        reason: 'Daily cleanup — reconnect for a fresh session',
      });
      socket.disconnect(true);
    } catch {}
  }

  // Clear all in-memory state
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

  console.log('All state cleared');
}

// Schedule daily cleanup at 3:00 AM IST (21:30 UTC)
cron.schedule('30 21 * * *', dailyCleanup, { timezone: 'UTC' });

// ── Socket.IO Connection Handler ─────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // ── Join room for students/admins (presence) with single-session per logical user ──
  socket.on('join-room', (data) => {
    const { roomNumber } = data || {};
    if (!roomNumber) return;

    const logicalId = data.user?.id;
    // Build presence payload (id is current socket id for P2P; keep logicalId separately)
    const user = {
      ...(data.user || {}),
      id: socket.id,
      logicalId,
      roomNumber,
      isOnline: true,
    };

    // Join socket room
    socket.join(roomNumber);

    // Add to room tracking
    if (!rooms.has(roomNumber)) {
      rooms.set(roomNumber, new Set());
    }
    rooms.get(roomNumber).add(socket.id);

    // Store user data
    users.set(socket.id, user);

    // Enforce single-session per logical user within the room
    if (logicalId) {
      const key = `${roomNumber}:${logicalId}`;
      const prevSid = sessionByUserKey.get(key);
      // Update mapping to current socket
      sessionByUserKey.set(key, socket.id);
      userDataByKey.set(key, user);
      if (prevSid && prevSid !== socket.id) {
        // Disconnect previous session
        const prevSock = io.sockets.sockets.get(prevSid);
        if (prevSock) {
          prevSock.emit('single-session-logout');
          prevSock.disconnect(true);
        } else {
          // Clean up stale
          for (const [r, set] of rooms.entries()) {
            set.delete(prevSid);
            if (set.size === 0) rooms.delete(r);
          }
          users.delete(prevSid);
        }
      }
    }

    // Notify others in room
    socket.to(roomNumber).emit('user-joined', user);

    // Send current room users (dedup by logical user) to new user
    const seen = new Set();
    const roomUsers = Array.from(users.values())
      .filter((u) => u.roomNumber === roomNumber && u.id !== user.id)
      .filter((u) => {
        const k = u.logicalId || u.uniqueId || u.id;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    socket.emit('room-users', roomUsers);

    // Notify admin presence (if any)
    const adminId = adminByRoom.get(roomNumber);
    if (adminId) {
      socket.emit('admin-online', { adminId, roomNumber });
    }

    console.log(`User ${user.name} joined room ${roomNumber}`);
  });

  // ── Get room users (polling) ──
  socket.on('get-room-users', (data) => {
    const user = users.get(socket.id);
    const roomNumber = data?.roomNumber || user?.roomNumber;
    if (!roomNumber) return;

    const seen = new Set();
    const roomUsers = Array.from(users.values())
      .filter((u) => u.roomNumber === roomNumber && u.id !== socket.id)
      .filter((u) => {
        const k = u.logicalId || u.uniqueId || u.id;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    socket.emit('room-users', roomUsers);
  });

  // ── WebRTC signaling ──
  socket.on('webrtc-offer', (data) => {
    const { targetId, offer } = data || {};
    if (targetId) {
      socket.to(targetId).emit('webrtc-offer', {
        offer,
        senderId: socket.id,
      });
    }
  });

  socket.on('webrtc-answer', (data) => {
    const { targetId, answer } = data || {};
    if (targetId) {
      socket.to(targetId).emit('webrtc-answer', {
        answer,
        senderId: socket.id,
      });
    }
  });

  socket.on('webrtc-ice-candidate', (data) => {
    const { targetId, candidate } = data || {};
    if (targetId) {
      socket.to(targetId).emit('webrtc-ice-candidate', {
        candidate,
        senderId: socket.id,
      });
    }
  });

  // ── File sharing notification ──
  socket.on('file-share-request', (data) => {
    const { roomNumber } = data || {};
    if (roomNumber) {
      socket.to(roomNumber).emit('file-share-request', {
        fileInfo: data.fileInfo,
        senderId: socket.id,
      });
    }
  });

  // ── Print request notification ──
  socket.on('print-request', (data) => {
    const { fileInfo, roomNumber } = data || {};
    if (roomNumber) {
      socket.to(roomNumber).emit('print-request', {
        fileInfo,
        senderId: socket.id,
      });
    }
  });

  // ── Transfer cancelled ──
  socket.on('transfer-cancelled', (data) => {
    const { targetId, senderName, senderUniqueId } = data || {};
    if (targetId) {
      socket.to(targetId).emit('transfer-cancelled', {
        senderName,
        senderUniqueId,
        senderId: socket.id,
      });
    }
  });

  // ── Admin authentication and presence ──
  socket.on('admin-auth', (data) => {
    const { roomNumber, password, admin } = data || {};
    if (password === ADMIN_PASSWORD) {
      socket.join(`admin-${roomNumber}`);
      // Track admin for room
      adminByRoom.set(roomNumber, socket.id);
      // Store as a user too
      const adminUser = admin || {
        id: socket.id,
        name: 'Lab Admin',
        uniqueId: 'ADMIN',
        roomNumber,
        isOnline: true,
      };
      users.set(socket.id, adminUser);
      // Notify everyone in room that admin is online
      io.to(roomNumber).emit('admin-online', {
        adminId: socket.id,
        roomNumber,
      });
      socket.emit('admin-auth-success', { roomNumber, adminId: socket.id });
    } else {
      socket.emit('admin-auth-failed');
    }
  });

  // ── Heartbeat (keep-alive) ──
  socket.on('heartbeat', () => {
    // Socket.IO has built-in ping/pong, but we accept heartbeats from clients
    // that send them explicitly (e.g. wsClient wrapper used with Socket.IO)
  });

  // ════════════════════════════════════════════════════════════════════════════
  // OneShare: Room-less file sharing with 4-digit codes
  // ════════════════════════════════════════════════════════════════════════════

  // Sender creates a OneShare session
  socket.on('oneshare-create', (data) => {
    // Accept client-generated code if provided, otherwise acquire from O(1) pool
    let code;
    if (
      data?.code &&
      typeof data.code === 'string' &&
      /^\d{4}$/.test(data.code)
    ) {
      // Client-provided code — check if already in use
      if (oneShareSessions.has(data.code)) {
        socket.emit('oneshare-code-taken', { code: data.code });
        return;
      }
      // Remove the client-provided code from the pool (if present) to prevent double-use
      const poolIdx = codePool.indexOf(data.code);
      if (poolIdx !== -1) {
        codePool[poolIdx] = codePool[codePool.length - 1];
        codePool.pop();
      }
      code = data.code;
    } else {
      // O(1) Pick-and-Swap-Last acquisition
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
    });

    // Join a private room for this session
    socket.join(`oneshare-${code}`);
    socket.emit('oneshare-created', { code });
    console.log(
      `OneShare session created: ${code} by ${socket.id}${data?.multiShare ? ' (MultiShare)' : ''}`
    );
  });

  // Receiver joins a OneShare session with code
  socket.on('oneshare-join', (data) => {
    const { code } = data || {};
    const session = oneShareSessions.get(code);
    if (!session) {
      socket.emit('oneshare-error', { message: 'Invalid or expired code' });
      return;
    }

    // Track this receiver
    if (session.receivers) {
      session.receivers.add(socket.id);
    }

    // Join the session room
    socket.join(`oneshare-${code}`);

    // Notify sender that receiver connected
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
    console.log(`Receiver ${socket.id} joined OneShare session: ${code}`);
  });

  // OneShare WebRTC signaling
  socket.on('oneshare-offer', (data) => {
    const { targetId, offer, code } = data || {};
    if (targetId) {
      socket.to(targetId).emit('oneshare-offer', {
        offer,
        senderId: socket.id,
        code,
      });
    }
  });

  socket.on('oneshare-answer', (data) => {
    const { targetId, answer, code } = data || {};
    if (targetId) {
      socket.to(targetId).emit('oneshare-answer', {
        answer,
        senderId: socket.id,
        code,
      });
    }
  });

  socket.on('oneshare-ice-candidate', (data) => {
    const { targetId, candidate, code } = data || {};
    if (targetId) {
      socket.to(targetId).emit('oneshare-ice-candidate', {
        candidate,
        senderId: socket.id,
        code,
      });
    }
  });

  // Sender signals transfer complete
  socket.on('oneshare-complete', (data) => {
    const { code, receiverId } = data || {};
    const session = oneShareSessions.get(code);
    if (!session) return;
    // Only the session sender can mark transfers complete
    if (session.senderId !== socket.id) return;

    if (session.multiShare && receiverId) {
      // MultiShare: notify only the specific receiver, keep session alive
      io.to(receiverId).emit('oneshare-transfer-complete', { code });
      console.log(
        `OneShare MultiShare transfer complete for receiver ${receiverId}: ${code}`
      );
    } else {
      // Regular: notify all in session room and clean up
      io.to(`oneshare-${code}`).emit('oneshare-transfer-complete', { code });
      oneShareSessions.delete(code);
      releaseOneShareCode(code);
      console.log(`OneShare session completed and cleaned up: ${code}`);
    }
  });

  // Cancel/leave OneShare session — only the sender can cancel
  socket.on('oneshare-cancel', (data) => {
    const { code } = data || {};
    const session = oneShareSessions.get(code);
    if (session && session.senderId === socket.id) {
      io.to(`oneshare-${code}`).emit('oneshare-cancelled', { code });
      oneShareSessions.delete(code);
      releaseOneShareCode(code);
      console.log(`OneShare session cancelled: ${code}`);
    }
  });

  // ── Handle disconnect ─────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    if (user) {
      // Remove from room
      const roomUsers = rooms.get(user.roomNumber);
      if (roomUsers) {
        roomUsers.delete(socket.id);
        if (roomUsers.size === 0) {
          rooms.delete(user.roomNumber);
        }
      }

      // Remove user
      users.delete(socket.id);

      // Clear single-session mapping if this was the active session
      const logicalId = user.logicalId;
      if (logicalId) {
        const key = `${user.roomNumber}:${logicalId}`;
        const activeSid = sessionByUserKey.get(key);
        if (activeSid === socket.id) {
          sessionByUserKey.delete(key);
          userDataByKey.delete(key);
        }
      }

      // Notify others
      socket.to(user.roomNumber).emit('user-left', user);

      console.log(
        `User ${user.name} disconnected from room ${user.roomNumber}`
      );
    }

    // If admin disconnected, notify room
    for (const [room, adminId] of adminByRoom.entries()) {
      if (adminId === socket.id) {
        adminByRoom.delete(room);
        io.to(room).emit('admin-offline', { roomNumber: room });
      }
    }

    // Clean up any OneShare sessions owned by this socket
    for (const [code, session] of oneShareSessions.entries()) {
      if (session.senderId === socket.id) {
        io.to(`oneshare-${code}`).emit('oneshare-cancelled', {
          code,
          reason: 'Sender disconnected',
        });
        oneShareSessions.delete(code);
        releaseOneShareCode(code);
        console.log(`OneShare session auto-cancelled on disconnect: ${code}`);
      }
    }
  });
});

// ── Start server ─────────────────────────────────────────────────────────────
server.listen(PORT, '0.0.0.0', () => {
  console.log(`> CosmoShare Signaling Server running on port ${PORT}`);
  console.log(`> Socket.IO path: /api/socket/io`);
  console.log(`> Health check: http://0.0.0.0:${PORT}/ping`);
  console.log(`> Daily cleanup scheduled at 3:00 AM IST (21:30 UTC)`);
});
