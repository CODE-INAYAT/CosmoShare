export const runtime = 'edge'

import { NextApiRequest, NextApiResponse } from 'next'
import { NextApiResponseSocketIO } from '@/lib/socket'
import { Server as ServerIO } from 'socket.io'

export default function SocketHandler(req: NextApiRequest, res: NextApiResponseSocketIO) {
  if (res.socket.server.io) {
    console.log('Socket is already running')
  } else {
    console.log('Socket is initializing')
    const httpServer = res.socket.server as any
    const io = new ServerIO(httpServer, {
      path: '/api/socket/io',
      addTrailingSlash: false,
      cors: {
        origin: "*",
        methods: ["GET", "POST"]
      }
    })

  // Store room data
  const rooms = new Map<string, Set<string>>() // roomNumber -> Set<socketId>
  const users = new Map<string, any>() // socketId -> user
  // Track logical user sessions to prevent duplicates in the same room
  const userSessions = new Map<string, Set<string>>() // `${roomNumber}:${userId}` -> Set<socketId>
  const userDataByKey = new Map<string, any>() // `${roomNumber}:${userId}` -> latest user object

    io.on('connection', (socket: any) => {
      console.log('User connected:', socket.id)

      // Join room (dedupe by logical user id per room)
      socket.on('join-room', (data: { roomNumber: string; user: any }) => {
        const { roomNumber, user } = data
        
        // Join socket room
        socket.join(roomNumber)
        
        // Add to room tracking
        if (!rooms.has(roomNumber)) {
          rooms.set(roomNumber, new Set())
        }
        rooms.get(roomNumber)!.add(socket.id)
        
        // Store user data
        users.set(socket.id, user)

        // Session tracking for dedupe
        const key = `${roomNumber}:${user.id}`
        let sessions = userSessions.get(key)
        const prevSize = sessions ? sessions.size : 0
        const wasFirst = prevSize === 0
        if (!sessions) sessions = new Set<string>()
        // Add current session first so forced disconnects of old ones don't trigger 'user-left'
        sessions.add(socket.id)
        userSessions.set(key, sessions)
        userDataByKey.set(key, user)

        // If any previous sessions existed, force-disconnect them (single-session mode)
        if (prevSize > 0) {
          for (const sid of Array.from(sessions)) {
            if (sid !== socket.id) {
              const otherSock = io.sockets.sockets.get(sid)
              if (otherSock) {
                // Optionally notify client before disconnect
                otherSock.emit('single-session-logout')
                otherSock.disconnect(true)
              } else {
                sessions.delete(sid)
              }
            }
          }
          userSessions.set(key, sessions)
        }

        // Notify others in room only if this is the first active session for that logical user
        if (wasFirst) {
          socket.to(roomNumber).emit('user-joined', user)
        }

        // Send current room users (unique by logical user id) to the new user
        const uniqueKeys = Array.from(userSessions.keys()).filter(k => k.startsWith(roomNumber + ':'))
        const uniqueUsers = uniqueKeys
          .map(k => userDataByKey.get(k))
          .filter((u: any) => u && u.id !== user.id)
        socket.emit('room-users', uniqueUsers)
        
        console.log(`User ${user.name} joined room ${roomNumber}`)
      })

      // WebRTC signaling
      socket.on('webrtc-offer', (data: any) => {
        const { targetId, offer, roomNumber } = data
        socket.to(roomNumber).emit('webrtc-offer', {
          offer,
          senderId: socket.id,
        })
      })

      socket.on('webrtc-answer', (data: any) => {
        const { targetId, answer, roomNumber } = data
        socket.to(roomNumber).emit('webrtc-answer', {
          answer,
          senderId: socket.id,
        })
      })

      socket.on('webrtc-ice-candidate', (data: any) => {
        const { targetId, candidate, roomNumber } = data
        socket.to(roomNumber).emit('webrtc-ice-candidate', {
          candidate,
          senderId: socket.id,
        })
      })

      // File sharing notification
      socket.on('file-share-request', (data: any) => {
        const { receiverId, fileInfo, roomNumber } = data
        socket.to(roomNumber).emit('file-share-request', {
          fileInfo,
          senderId: socket.id,
        })
      })

      // Print request notification
      socket.on('print-request', (data: any) => {
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

          // Remove socket -> user mapping
          users.delete(socket.id)

          // Update logical sessions; emit user-left only if no more sessions remain
          const key = `${user.roomNumber}:${user.id}`
          const sessions = userSessions.get(key)
          if (sessions) {
            sessions.delete(socket.id)
            if (sessions.size === 0) {
              userSessions.delete(key)
              userDataByKey.delete(key)
              // Notify others only when last session leaves
              socket.to(user.roomNumber).emit('user-left', user)
            } else {
              userSessions.set(key, sessions)
            }
          }

          console.log(`User ${user.name} disconnected from room ${user.roomNumber}`)
        }
      })

      // Admin authentication
      socket.on('admin-auth', (data: any) => {
        const { roomNumber, password } = data
        if (password === 'admin123') {
          socket.join(`admin-${roomNumber}`)
          socket.emit('admin-auth-success', { roomNumber })
        } else {
          socket.emit('admin-auth-failed')
        }
      })
    })

    res.socket.server.io = io
  }
  res.end()
}

export const config = {
  api: {
    bodyParser: false,
  },
}