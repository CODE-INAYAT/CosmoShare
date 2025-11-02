// @ts-nocheck
export interface Env {
  ROOMS: DurableObjectNamespace
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/ws') {
      const room = url.searchParams.get('room') || ''
      if (!room) return new Response('room is required', { status: 400 })
      const id = env.ROOMS.idFromName(room)
      const stub = env.ROOMS.get(id)
      return stub.fetch(request)
    }

    // Basic health
    return new Response('OK', { status: 200 })
  }
}

type User = { id: string; logicalId?: string; name: string; uniqueId: string; roomNumber: string; isOnline: boolean }

export class RoomDurableObject implements DurableObject {
  state: DurableObjectState
  roomNumber: string | null = null
  sockets: Map<string, WebSocket> = new Map()
  users: Map<string, User> = new Map()
  adminId: string | null = null
  sessionByUserKey: Map<string, string> = new Map()
  userDataByKey: Map<string, User> = new Map()
  lastSeen: Map<string, number> = new Map()

  constructor(state: DurableObjectState, _env: Env) {
    this.state = state
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
    ;(server as any).accept()

    this.sockets.set(socketId, server)

    const send = (ws: WebSocket, event: string, data?: any) => {
      try { ws.send(JSON.stringify({ event, data })) } catch {}
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
          this.lastSeen.delete(sid)
          this.sockets.delete(sid)
          try { (ws as any)?.close?.() } catch {}
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
                try { prevSock.close() } catch {}
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
