import { Server as NetServer } from 'http'
import { NextApiRequest, NextApiResponse } from 'next'
import { Server as ServerIO } from 'socket.io'
import { z } from 'zod'

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
      if (password === 'admin123') {
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