// @ts-nocheck
export interface Env {
  ROOMS: DurableObjectNamespace
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/ws') {
      // Check if this is a OneShare connection (no room param) or regular room connection
      const room = url.searchParams.get('room') || ''

      // Use a special "oneshare" room for all OneShare connections
      // This allows them to communicate without joining specific rooms
      const roomName = room || '__oneshare__'
      const id = env.ROOMS.idFromName(roomName)
      const stub = env.ROOMS.get(id)
      return stub.fetch(request)
    }

    // Basic health
    return new Response('OK', { status: 200 })
  }
}

type User = { id: string; logicalId?: string; name: string; uniqueId: string; roomNumber: string; isOnline: boolean }

// OneShare session type
type OneShareSession = {
  senderId: string
  createdAt: number
  files?: any[]
}

export class RoomDurableObject implements DurableObject {
  state: DurableObjectState
  roomNumber: string | null = null
  sockets: Map<string, WebSocket> = new Map()
  users: Map<string, User> = new Map()
  adminId: string | null = null
  sessionByUserKey: Map<string, string> = new Map()
  userDataByKey: Map<string, User> = new Map()
  lastSeen: Map<string, number> = new Map()

  // OneShare sessions: 4-digit code -> session data
  oneShareSessions: Map<string, OneShareSession> = new Map()

  constructor(state: DurableObjectState, _env: Env) {
    this.state = state
  }

  // Generate unique 4-digit code for OneShare
  generateOneShareCode(): string {
    let code: string
    let attempts = 0
    do {
      code = Math.floor(1000 + Math.random() * 9000).toString()
      attempts++
    } while (this.oneShareSessions.has(code) && attempts < 100)
    return code
  }

  // Clean up expired OneShare sessions (older than 10 minutes)
  cleanupExpiredOneShareSessions(): void {
    const now = Date.now()
    const TEN_MINUTES = 10 * 60 * 1000
    for (const [code, session] of Array.from(this.oneShareSessions.entries())) {
      if (now - session.createdAt > TEN_MINUTES) {
        this.oneShareSessions.delete(code)
      }
    }
  }

  fetch(request: Request): Response {
    const url = new URL(request.url)
    const upgrade = request.headers.get('Upgrade')
    if (upgrade !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 })
    }

    const room = url.searchParams.get('room') || 'default'
    this.roomNumber = room

    const pair = new WebSocketPair()
    const client = (pair as any)[0] as WebSocket
    const server = (pair as any)[1] as WebSocket
    const socketId = crypto.randomUUID()
      ; (server as any).accept()

    this.sockets.set(socketId, server)

    const send = (ws: WebSocket, event: string, data?: any) => {
      try { ws.send(JSON.stringify({ event, data })) } catch { }
    }
    const broadcast = (event: string, data?: any, exceptId?: string) => {
      this.sockets.forEach((ws, id) => { if (id !== exceptId) send(ws, event, data) })
    }
    const sendTo = (targetId: string, event: string, data?: any) => {
      const ws = this.sockets.get(targetId)
      if (ws) send(ws, event, data)
    }

    const sweepStale = () => {
      const now = Date.now()
      const STALE_MS = 35_000
      for (const [sid, seen] of Array.from(this.lastSeen.entries())) {
        if (now - seen > STALE_MS) {
          const ws = this.sockets.get(sid)
          // Cleanup maps first
          const user = this.users.get(sid)
          if (user) {
            this.users.delete(sid)
            if ((user as any).logicalId) {
              const key = `${user.roomNumber}:${(user as any).logicalId}`
              const active = this.sessionByUserKey.get(key)
              if (active === sid) {
                this.sessionByUserKey.delete(key)
                this.userDataByKey.delete(key)
              }
            }
            broadcast('user-left', user, sid)
          }
          // Also cleanup any OneShare sessions owned by this socket
          for (const [code, session] of Array.from(this.oneShareSessions.entries())) {
            if (session.senderId === sid) {
              this.oneShareSessions.delete(code)
            }
          }
          this.lastSeen.delete(sid)
          this.sockets.delete(sid)
          try { (ws as any)?.close?.() } catch { }
        }
      }
    }

    const dedupRoomUsers = (): User[] => {
      const seen = new Set<string>()
      const res: User[] = []
      this.users.forEach((u) => {
        if (u.roomNumber !== this.roomNumber) return
        const k = (u as any).logicalId || u.uniqueId || u.id
        if (seen.has(k)) return
        seen.add(k)
        res.push(u)
      })
      return res
    }

    const cleanupSocket = () => {
      const user = this.users.get(socketId)
      if (user) {
        this.users.delete(socketId)
        if ((user as any).logicalId) {
          const key = `${user.roomNumber}:${(user as any).logicalId}`
          const active = this.sessionByUserKey.get(key)
          if (active === socketId) {
            this.sessionByUserKey.delete(key)
            this.userDataByKey.delete(key)
          }
        }
        broadcast('user-left', user, socketId)
      }
      if (this.adminId === socketId) {
        this.adminId = null
        if (this.roomNumber) broadcast('admin-offline', { roomNumber: this.roomNumber })
      }

      // Cleanup any OneShare sessions owned by this socket
      for (const [code, session] of Array.from(this.oneShareSessions.entries())) {
        if (session.senderId === socketId) {
          // Notify any receivers that the session is cancelled
          this.sockets.forEach((ws, id) => {
            if (id !== socketId) {
              send(ws, 'oneshare-cancelled', { code, reason: 'Sender disconnected' })
            }
          })
          this.oneShareSessions.delete(code)
        }
      }

      this.sockets.delete(socketId)
    }

    server.addEventListener('message', (ev: MessageEvent) => {
      let msg: any
      try { msg = JSON.parse(ev.data as any) } catch { return }
      const event = msg?.event
      const data = msg?.data || {}
      const roomNumber = data?.roomNumber || this.roomNumber || 'default'

      // Update last-seen and sweep stale on every message
      this.lastSeen.set(socketId, Date.now())
      sweepStale()

      // Also cleanup expired OneShare sessions periodically
      this.cleanupExpiredOneShareSessions()

      switch (event) {
        case 'join-room': {
          const logicalId = data?.user?.id
          const user: User = { ...(data?.user || {}), id: socketId, logicalId, roomNumber, isOnline: true }
          this.users.set(socketId, user)
          this.lastSeen.set(socketId, Date.now())
          if (logicalId) {
            const key = `${roomNumber}:${logicalId}`
            const prev = this.sessionByUserKey.get(key)
            this.sessionByUserKey.set(key, socketId)
            this.userDataByKey.set(key, user)
            if (prev && prev !== socketId) {
              const prevSock = this.sockets.get(prev)
              if (prevSock) {
                send(prevSock, 'single-session-logout')
                try { prevSock.close() } catch { }
              }
              this.sockets.delete(prev)
              this.users.delete(prev)
            }
          }
          broadcast('user-joined', user, socketId)
          const others = dedupRoomUsers().filter(u => u.id !== socketId)
          send(server, 'room-users', others)
          if (this.adminId) send(server, 'admin-online', { adminId: this.adminId, roomNumber })
          return
        }
        case 'heartbeat': {
          this.lastSeen.set(socketId, Date.now())
          // Optional: could reply with a pong
          return
        }
        case 'get-room-users': {
          sweepStale()
          const list = dedupRoomUsers().filter(u => u.id !== socketId)
          send(server, 'room-users', list)
          return
        }
        case 'admin-auth': {
          const { password, admin } = data
          if (password === 'admin123') {
            this.adminId = socketId
            const adminUser: User = admin || { id: socketId, name: 'Lab Admin', uniqueId: 'ADMIN', roomNumber, isOnline: true }
            this.users.set(socketId, adminUser)
            broadcast('admin-online', { adminId: socketId, roomNumber })
            send(server, 'admin-auth-success', { roomNumber, adminId: socketId })
          } else {
            send(server, 'admin-auth-failed')
          }
          return
        }
        case 'webrtc-offer': {
          const { targetId, offer } = data
          if (targetId) sendTo(targetId, 'webrtc-offer', { offer, senderId: socketId })
          return
        }
        case 'webrtc-answer': {
          const { targetId, answer } = data
          if (targetId) sendTo(targetId, 'webrtc-answer', { answer, senderId: socketId })
          return
        }
        case 'webrtc-ice-candidate': {
          const { targetId, candidate } = data
          if (targetId) sendTo(targetId, 'webrtc-ice-candidate', { candidate, senderId: socketId })
          return
        }

        case 'transfer-cancelled': {
          const { targetId, senderName, senderUniqueId } = data
          if (targetId) {
            sendTo(targetId, 'transfer-cancelled', {
              senderName,
              senderUniqueId,
              senderId: socketId
            })
          }
          return
        }

        // ============================================
        // OneShare Events: Room-less file sharing
        // ============================================

        case 'oneshare-create': {
          // Sender creates a OneShare session
          const code = this.generateOneShareCode()
          this.oneShareSessions.set(code, {
            senderId: socketId,
            createdAt: Date.now(),
            files: data.files
          })
          send(server, 'oneshare-created', { code })
          console.log(`OneShare session created: ${code} by ${socketId}`)
          return
        }

        case 'oneshare-join': {
          // Receiver joins a OneShare session with code
          const { code } = data
          const session = this.oneShareSessions.get(code)
          if (!session) {
            send(server, 'oneshare-error', { message: 'Invalid or expired code' })
            return
          }
          // Notify sender that receiver connected
          sendTo(session.senderId, 'oneshare-receiver-joined', {
            receiverId: socketId,
            code
          })
          // Send session info to receiver
          send(server, 'oneshare-joined', {
            senderId: session.senderId,
            code,
            files: session.files
          })
          console.log(`Receiver ${socketId} joined OneShare session: ${code}`)
          return
        }

        case 'oneshare-offer': {
          // OneShare WebRTC offer relay
          const { targetId, offer, code } = data
          if (targetId) {
            sendTo(targetId, 'oneshare-offer', {
              offer,
              senderId: socketId,
              code
            })
          }
          return
        }

        case 'oneshare-answer': {
          // OneShare WebRTC answer relay
          const { targetId, answer, code } = data
          if (targetId) {
            sendTo(targetId, 'oneshare-answer', {
              answer,
              senderId: socketId,
              code
            })
          }
          return
        }

        case 'oneshare-ice-candidate': {
          // OneShare ICE candidate relay
          const { targetId, candidate, code } = data
          if (targetId) {
            sendTo(targetId, 'oneshare-ice-candidate', {
              candidate,
              senderId: socketId,
              code
            })
          }
          return
        }

        case 'oneshare-complete': {
          // Sender signals transfer complete
          const { code } = data
          // Notify all participants
          this.sockets.forEach((ws) => {
            send(ws, 'oneshare-transfer-complete', { code })
          })
          // Clean up session
          this.oneShareSessions.delete(code)
          console.log(`OneShare session completed: ${code}`)
          return
        }

        case 'oneshare-cancel': {
          // Cancel/leave OneShare session
          const { code } = data
          const session = this.oneShareSessions.get(code)
          if (session) {
            // Notify all participants
            this.sockets.forEach((ws) => {
              send(ws, 'oneshare-cancelled', { code })
            })
            this.oneShareSessions.delete(code)
            console.log(`OneShare session cancelled: ${code}`)
          }
          return
        }

        default:
          return
      }
    })

    server.addEventListener('close', () => {
      cleanupSocket()
    })

    return new Response(null, { status: 101, webSocket: client })
  }
}

