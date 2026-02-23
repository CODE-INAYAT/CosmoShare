import { Server as NetServer } from 'http'
import { NextApiRequest, NextApiResponse } from 'next'
import { Server as ServerIO } from 'socket.io'
import { z } from 'zod'
import { AUTO_LOGIN_PASSWORD } from '@/config/autoLogin'

export type NextApiResponseSocketIO = NextApiResponse & {
  socket: {
    server: NetServer & {
      io: ServerIO
    }
  }
}

const MessageSchema = z.object({
  type: z.string(),
  payload: z.any(),
  roomNumber: z.string(),
  senderId: z.string(),
  receiverId: z.string().optional(),
})

const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
  uniqueId: z.string(),
  roomNumber: z.string(),
  isOnline: z.boolean(),
})

export const config = {
  api: {
    bodyParser: false,
  },
}

export const setupSocket = (io: ServerIO) => {
  // Store room data
  const rooms = new Map<string, Set<string>>()
  // Map socket.id -> user payload
  const users = new Map<string, any>()
  // Track admin socket per room
  const adminByRoom = new Map<string, string>()
  // Single-session tracking: `${roomNumber}:${logicalUserId}` -> socketId
  const sessionByUserKey = new Map<string, string>()
  const userDataByKey = new Map<string, any>()

  io.on('connection', (socket) => {
    console.log('User connected:', socket.id)

    // Join room for students/admins (presence) with single-session per logical user
    socket.on('join-room', (data: { roomNumber: string; user: any }) => {
      const { roomNumber } = data
      const logicalId = data.user?.id
      // Build presence payload (id is current socket id for P2P; keep logicalId separately)
      const user = { ...data.user, id: socket.id, logicalId, roomNumber, isOnline: true }

      // Join socket room
      socket.join(roomNumber)

      // Add to room tracking
      if (!rooms.has(roomNumber)) {
        rooms.set(roomNumber, new Set())
      }
      rooms.get(roomNumber)!.add(socket.id)

      // Store user data
      users.set(socket.id, user)

      // Enforce single-session per logical user within the room
      if (logicalId) {
        const key = `${roomNumber}:${logicalId}`
        const prevSid = sessionByUserKey.get(key)
        // Update mapping to current socket
        sessionByUserKey.set(key, socket.id)
        userDataByKey.set(key, user)
        if (prevSid && prevSid !== socket.id) {
          // Disconnect previous session; client may handle this event if needed
          const prevSock = io.sockets.sockets.get(prevSid)
          if (prevSock) {
            prevSock.emit('single-session-logout')
            prevSock.disconnect(true)
          } else {
            // Clean up stale
            for (const [r, set] of rooms.entries()) {
              set.delete(prevSid)
              if (set.size === 0) rooms.delete(r)
            }
            users.delete(prevSid)
          }
        }
      }

      // Notify others in room
      socket.to(roomNumber).emit('user-joined', user)

      // Send current room users (dedup by logical user if present, else by uniqueId) to new user
      const seen = new Set<string>()
      const roomUsers = Array.from(users.values())
        .filter((u: any) => u.roomNumber === roomNumber && u.id !== user.id)
        .filter((u: any) => {
          const k = u.logicalId || u.uniqueId || u.id
          if (seen.has(k)) return false
          seen.add(k)
          return true
        })
      socket.emit('room-users', roomUsers)

      // Notify admin presence (if any)
      const adminId = adminByRoom.get(roomNumber)
      if (adminId) {
        socket.emit('admin-online', { adminId, roomNumber })
      }

      console.log(`User ${user.name} joined room ${roomNumber}`)
    })

    // WebRTC signaling
    socket.on('webrtc-offer', (data: { targetId: string; offer: any; roomNumber: string }) => {
      const { targetId, offer } = data
      if (targetId) {
        socket.to(targetId).emit('webrtc-offer', {
          offer,
          senderId: socket.id,
        })
      }
    })

    socket.on('webrtc-answer', (data: { targetId: string; answer: any; roomNumber: string }) => {
      const { targetId, answer } = data
      if (targetId) {
        socket.to(targetId).emit('webrtc-answer', {
          answer,
          senderId: socket.id,
        })
      }
    })

    socket.on('webrtc-ice-candidate', (data: { targetId: string; candidate: any; roomNumber: string }) => {
      const { targetId, candidate } = data
      if (targetId) {
        socket.to(targetId).emit('webrtc-ice-candidate', {
          candidate,
          senderId: socket.id,
        })
      }
    })

    // File sharing notification
    socket.on('file-share-request', (data) => {
      const { receiverId, fileInfo, roomNumber } = data
      socket.to(roomNumber).emit('file-share-request', {
        fileInfo,
        senderId: socket.id,
      })
    })

    // Print request notification
    socket.on('print-request', (data) => {
      const { fileInfo, roomNumber } = data
      socket.to(roomNumber).emit('print-request', {
        fileInfo,
        senderId: socket.id,
      })
    })

    // Handle disconnect
    socket.on('disconnect', () => {
      const user = users.get(socket.id)
      if (user) {
        // Remove from room
        const roomUsers = rooms.get(user.roomNumber)
        if (roomUsers) {
          roomUsers.delete(socket.id)
          if (roomUsers.size === 0) {
            rooms.delete(user.roomNumber)
          }
        }

        // Remove user
        users.delete(socket.id)
        // Clear single-session mapping if this was the active session
        const logicalId = user.logicalId
        if (logicalId) {
          const key = `${user.roomNumber}:${logicalId}`
          const activeSid = sessionByUserKey.get(key)
          if (activeSid === socket.id) {
            sessionByUserKey.delete(key)
            userDataByKey.delete(key)
          }
        }

        // Notify others
        socket.to(user.roomNumber).emit('user-left', user)

        console.log(`User ${user.name} disconnected from room ${user.roomNumber}`)
      }

      // If admin disconnected, notify room
      for (const [room, adminId] of adminByRoom.entries()) {
        if (adminId === socket.id) {
          adminByRoom.delete(room)
          io.to(room).emit('admin-offline', { roomNumber: room })
        }
      }
    })

    // Admin authentication and presence
    socket.on('admin-auth', (data: { roomNumber: string; password: string; admin?: any }) => {
      const { roomNumber, password, admin } = data
      if (password === AUTO_LOGIN_PASSWORD) {
        socket.join(`admin-${roomNumber}`)
        // Track admin for room
        adminByRoom.set(roomNumber, socket.id)
        // Optionally store as a user too
        const adminUser = admin || { id: socket.id, name: 'Lab Admin', uniqueId: 'ADMIN', roomNumber, isOnline: true }
        users.set(socket.id, adminUser)
        // Notify everyone in room that admin is online
        io.to(roomNumber).emit('admin-online', { adminId: socket.id, roomNumber })
        socket.emit('admin-auth-success', { roomNumber, adminId: socket.id })
      } else {
        socket.emit('admin-auth-failed')
      }
    })

    // ============================================
    // OneShare: Room-less file sharing with 4-digit codes
    // ============================================

    // OneShare session storage: code -> { senderId, createdAt, files }
    // Using closure variable to persist across connections
    const oneShareSessions = (io as any)._oneShareSessions || new Map<string, { senderId: string; createdAt: number; files?: any[]; multiShare?: boolean; receivers?: Set<string> }>()
      ; (io as any)._oneShareSessions = oneShareSessions

    // Generate unique 4-digit code
    const generateOneShareCode = (): string => {
      let code: string
      let attempts = 0
      do {
        code = Math.floor(1000 + Math.random() * 9000).toString()
        attempts++
      } while (oneShareSessions.has(code) && attempts < 100)
      return code
    }

    // Clean up expired sessions (5 min for MultiShare, 10 min for regular)
    const cleanupExpiredSessions = () => {
      const now = Date.now()
      const FIVE_MINUTES = 5 * 60 * 1000
      const TEN_MINUTES = 10 * 60 * 1000
      for (const [code, session] of oneShareSessions.entries()) {
        const ttl = session.multiShare ? FIVE_MINUTES : TEN_MINUTES
        if (now - session.createdAt > ttl) {
          // Notify participants that session expired
          io.to(`oneshare-${code}`).emit('oneshare-cancelled', { code, reason: 'Session expired' })
          oneShareSessions.delete(code)
        }
      }
    }

    // Sender creates a OneShare session
    socket.on('oneshare-create', (data: { files?: any[]; multiShare?: boolean }) => {
      cleanupExpiredSessions()
      const code = generateOneShareCode()
      oneShareSessions.set(code, {
        senderId: socket.id,
        createdAt: Date.now(),
        files: data.files,
        multiShare: data.multiShare || false
      })
      // Join a private room for this session
      socket.join(`oneshare-${code}`)
      socket.emit('oneshare-created', { code })
      console.log(`OneShare session created: ${code} by ${socket.id}${data.multiShare ? ' (MultiShare)' : ''}`)
    })

    // Receiver joins a OneShare session with code
    socket.on('oneshare-join', (data: { code: string }) => {
      const { code } = data
      const session = oneShareSessions.get(code)
      if (!session) {
        socket.emit('oneshare-error', { message: 'Invalid or expired code' })
        return
      }
      // Join the session room
      socket.join(`oneshare-${code}`)
      // Notify sender that receiver connected
      io.to(session.senderId).emit('oneshare-receiver-joined', {
        receiverId: socket.id,
        code
      })
      // Send session info to receiver
      socket.emit('oneshare-joined', {
        senderId: session.senderId,
        code,
        files: session.files
      })
      console.log(`Receiver ${socket.id} joined OneShare session: ${code}`)
    })

    // OneShare WebRTC signaling
    socket.on('oneshare-offer', (data: { targetId: string; offer: any; code: string }) => {
      const { targetId, offer, code } = data
      socket.to(targetId).emit('oneshare-offer', {
        offer,
        senderId: socket.id,
        code
      })
    })

    socket.on('oneshare-answer', (data: { targetId: string; answer: any; code: string }) => {
      const { targetId, answer, code } = data
      socket.to(targetId).emit('oneshare-answer', {
        answer,
        senderId: socket.id,
        code
      })
    })

    socket.on('oneshare-ice-candidate', (data: { targetId: string; candidate: any; code: string }) => {
      const { targetId, candidate, code } = data
      socket.to(targetId).emit('oneshare-ice-candidate', {
        candidate,
        senderId: socket.id,
        code
      })
    })

    // Sender signals transfer complete (for a specific receiver or entire session)
    socket.on('oneshare-complete', (data: { code: string; receiverId?: string }) => {
      const { code, receiverId } = data
      const session = oneShareSessions.get(code)
      if (!session) return
      // Only the session sender can mark transfers complete
      if (session.senderId !== socket.id) return
      if (session.multiShare && receiverId) {
        // MultiShare: notify only the specific receiver, keep session alive
        io.to(receiverId).emit('oneshare-transfer-complete', { code })
        console.log(`OneShare MultiShare transfer complete for receiver ${receiverId}: ${code}`)
      } else {
        // Regular: notify all in session room and clean up
        io.to(`oneshare-${code}`).emit('oneshare-transfer-complete', { code })
        oneShareSessions.delete(code)
        console.log(`OneShare session completed and cleaned up: ${code}`)
      }
    })

    // Cancel/leave OneShare session — only the sender can cancel
    socket.on('oneshare-cancel', (data: { code: string }) => {
      const { code } = data
      const session = oneShareSessions.get(code)
      if (session && session.senderId === socket.id) {
        io.to(`oneshare-${code}`).emit('oneshare-cancelled', { code })
        oneShareSessions.delete(code)
        console.log(`OneShare session cancelled: ${code}`)
      }
    })

    // Handle OneShare cleanup on disconnect (in addition to existing disconnect handler)
    // Note: Socket.IO allows multiple handlers for same event
    socket.on('disconnect', () => {
      // Clean up any OneShare sessions owned by this socket
      for (const [code, session] of oneShareSessions.entries()) {
        if (session.senderId === socket.id) {
          io.to(`oneshare-${code}`).emit('oneshare-cancelled', { code, reason: 'Sender disconnected' })
          oneShareSessions.delete(code)
          console.log(`OneShare session auto-cancelled on disconnect: ${code}`)
        }
      }
    })
  })
}

const SocketHandler = (req: NextApiRequest, res: NextApiResponseSocketIO) => {
  if (res.socket.server.io) {
    console.log('Socket is already running')
  } else {
    console.log('Socket is initializing')
    const httpServer: NetServer = res.socket.server as any
    const io = new ServerIO(httpServer, {
      path: '/api/socket/io',
      addTrailingSlash: false,
      cors: {
        origin: "*",
        methods: ["GET", "POST"]
      }
    })

    setupSocket(io)

    res.socket.server.io = io
  }
  res.end()
}

export default SocketHandler