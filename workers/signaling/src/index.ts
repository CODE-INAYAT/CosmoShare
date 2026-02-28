// @ts-nocheck
export interface Env {
  ROOMS: DurableObjectNamespace
}

/** CORS headers for non-WebSocket error responses */
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS })
    }

    // Lightweight health-check (does NOT touch Durable Objects)
    if (url.pathname === '/ping') {
      return new Response('OK', { status: 200, headers: CORS_HEADERS })
    }

    if (url.pathname === '/ws') {
      // Check if this is a OneShare connection (no room param) or regular room connection
      const room = url.searchParams.get('room') || ''

      // Use a special "oneshare" room for all OneShare connections
      // This allows them to communicate without joining specific rooms
      const roomName = room || '__oneshare__'
      const id = env.ROOMS.idFromName(roomName)
      const stub = env.ROOMS.get(id)

      try {
        return await stub.fetch(request)
      } catch (e: any) {
        // Gracefully handle Durable Object errors (e.g. free-tier duration exceeded)
        const msg = (e?.message || '').toLowerCase()
        const isOverloaded = msg.includes('exceeded') || msg.includes('duration') || msg.includes('free tier') || msg.includes('limit')
        console.error(`DO fetch error: ${e?.message}`)
        return new Response(
          JSON.stringify({
            error: isOverloaded ? 'worker-overloaded' : 'internal-error',
            message: e?.message || 'Unknown error',
          }),
          {
            status: 503,
            headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
          }
        )
      }
    }

    // Basic health
    return new Response('OK', { status: 200, headers: CORS_HEADERS })
  },

  // Cron trigger: runs daily at 3:00 AM IST (21:30 UTC)
  // Clears all Durable Object SQLite storage for a fresh start
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    // Send cleanup request to the well-known __oneshare__ DO
    const oneshareId = env.ROOMS.idFromName('__oneshare__')
    const oneshareStub = env.ROOMS.get(oneshareId)
    await oneshareStub.fetch(new Request('https://internal/cleanup'))
    console.log('Scheduled cleanup triggered at 3:00 AM IST')
  }
}

type User = { id: string; logicalId?: string; name: string; uniqueId: string; roomNumber: string; isOnline: boolean }

// OneShare session type
type OneShareSession = {
  senderId: string
  createdAt: number
  files?: any[]
  multiShare?: boolean
  receivers: Set<string>  // Track all receiver socket IDs for scoped broadcasts
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

  // Tracks last REAL user activity per socket (excludes heartbeats & auto-polls).
  // Used for 1-hour idle disconnect to save DO duration.
  lastActive: Map<string, number> = new Map()

  // OneShare sessions: 4-digit code -> session data
  oneShareSessions: Map<string, OneShareSession> = new Map()

  // Proactive zombie sweep: detects dead connections even when no messages arrive.
  // Without this, if ALL clients die simultaneously (e.g. laptop lid closed + router off),
  // no messages arrive → reactive sweepStale never runs → DO holds zombie sockets
  // indefinitely → burns account DO duration quota until exhausted.
  private sweepIntervalId: any = null
  private static readonly SWEEP_INTERVAL_MS = 30_000 // Check every 30 seconds
  private static readonly IDLE_DISCONNECT_MS = 60 * 60 * 1000 // 1 hour of no real activity

  // Events that count as REAL user activity (reset the idle timer).
  // Everything else (heartbeat, get-room-users) is automated and does NOT reset it.
  private static readonly ACTIVE_EVENTS = new Set([
    'join-room', 'admin-auth',
    'webrtc-offer', 'webrtc-answer', 'webrtc-ice-candidate',
    'transfer-cancelled',
    'oneshare-create', 'oneshare-join',
    'oneshare-offer', 'oneshare-answer', 'oneshare-ice-candidate',
    'oneshare-complete', 'oneshare-cancel',
  ])

  constructor(state: DurableObjectState, _env: Env) {
    this.state = state
    // Schedule the next 3 AM IST alarm on construction
    this.scheduleNextCleanupAlarm()
  }

  // ---- Class-level helpers for proactive sweep ----

  /** Send a JSON event to a single WebSocket (class-level) */
  private sendToWs(ws: WebSocket, event: string, data?: any): void {
    try { ws.send(JSON.stringify({ event, data })) } catch { }
  }

  /** Broadcast a JSON event to all connected sockets (class-level) */
  private broadcastAll(event: string, data?: any, exceptId?: string): void {
    this.sockets.forEach((ws, id) => {
      if (id !== exceptId) this.sendToWs(ws, event, data)
    })
  }

  /**
   * Start the proactive sweep interval. Safe to call multiple times.
   * Runs every 30s while there are active connections. Once all zombie
   * sockets are cleaned up, stops itself so the DO can hibernate.
   */
  private startSweepInterval(): void {
    if (this.sweepIntervalId) return
    this.sweepIntervalId = setInterval(() => {
      this.proactiveSweepStale()
      this.cleanupExpiredOneShareSessions()
      // If no connections remain after sweep, stop interval → DO hibernates
      if (this.sockets.size === 0) {
        clearInterval(this.sweepIntervalId)
        this.sweepIntervalId = null
        console.log('All connections closed — sweep stopped, DO will hibernate')
      }
    }, RoomDurableObject.SWEEP_INTERVAL_MS)
  }

  /**
   * Proactive server-side sweep: closes zombie WebSocket connections whose
   * lastSeen exceeds STALE_MS, even when no client messages are arriving.
   *
   * This is the class-level counterpart of the inline sweepStale() that runs
   * reactively on each message. It additionally handles admin cleanup which
   * the inline version doesn't cover.
   */
  /**
   * Full cleanup of a socket: removes user/admin/OneShare state and notifies others.
   * Used by both proactive sweep and the inline cleanupSocket on WS close.
   */
  private evictSocket(sid: string, reason: string): void {
    const ws = this.sockets.get(sid)
    // Clean up user state
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
      this.broadcastAll('user-left', user, sid)
    }
    // Clean up admin state
    if (this.adminId === sid) {
      this.adminId = null
      if (this.roomNumber) this.broadcastAll('admin-offline', { roomNumber: this.roomNumber })
    }
    // Clean up OneShare sessions owned by this socket
    for (const [code, session] of Array.from(this.oneShareSessions.entries())) {
      if (session.senderId === sid) {
        for (const recvId of session.receivers) {
          const recvWs = this.sockets.get(recvId)
          if (recvWs) this.sendToWs(recvWs, 'oneshare-cancelled', { code, reason: 'Sender disconnected' })
        }
        this.oneShareSessions.delete(code)
      }
    }
    this.lastSeen.delete(sid)
    this.lastActive.delete(sid)
    this.sockets.delete(sid)
    try { ws?.close?.(4001, reason) } catch { }
  }

  private proactiveSweepStale(): void {
    const now = Date.now()
    const STALE_MS = 35_000

    for (const [sid] of Array.from(this.sockets.entries())) {
      const seen = this.lastSeen.get(sid) ?? 0
      const active = this.lastActive.get(sid) ?? 0

      // Priority 1: Zombie detection — no messages at all for 35s (dead connection)
      if (now - seen > STALE_MS) {
        this.evictSocket(sid, 'Stale connection')
        continue
      }

      // Priority 2: Idle disconnect — connected but no real activity for 1 hour
      if (now - active > RoomDurableObject.IDLE_DISCONNECT_MS) {
        console.log(`Socket ${sid} idle for >${Math.round((now - active) / 60000)}min — disconnecting`)
        this.evictSocket(sid, 'Idle for 1 hour')
        continue
      }
    }
  }

  // Schedule an alarm for the next 3:00 AM IST (21:30 UTC previous day)
  async scheduleNextCleanupAlarm(): Promise<void> {
    const existing = await this.state.storage.getAlarm()
    if (existing) return // Alarm already scheduled

    const now = new Date()
    // 3:00 AM IST = 21:30 UTC (previous day)
    const next = new Date(now)
    next.setUTCHours(21, 30, 0, 0)
    // If that time already passed today, schedule for tomorrow
    if (next.getTime() <= now.getTime()) {
      next.setUTCDate(next.getUTCDate() + 1)
    }
    await this.state.storage.setAlarm(next.getTime())
    console.log(`Cleanup alarm scheduled for ${next.toISOString()}`)
  }

  // Alarm handler: clears all SQLite storage for a fresh start
  async alarm(): Promise<void> {
    console.log('3 AM IST cleanup alarm fired — clearing all Durable Object storage')
    // Close all active WebSocket connections
    for (const [id, ws] of this.sockets) {
      try { ws.close(1000, 'Daily cleanup — reconnect for a fresh session') } catch { }
    }
    // Clear all in-memory state
    this.sockets.clear()
    this.users.clear()
    this.adminId = null
    this.sessionByUserKey.clear()
    this.userDataByKey.clear()
    this.lastSeen.clear()
    this.lastActive.clear()
    this.oneShareSessions.clear()
    // Wipe all persisted SQLite storage
    await this.state.storage.deleteAll()
    // Schedule the next cleanup alarm for tomorrow
    await this.scheduleNextCleanupAlarm()
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

  // Clean up expired OneShare sessions (5 min for MultiShare, 10 min for regular)
  cleanupExpiredOneShareSessions(): void {
    const now = Date.now()
    const FIVE_MINUTES = 5 * 60 * 1000
    const TEN_MINUTES = 10 * 60 * 1000
    for (const [code, session] of Array.from(this.oneShareSessions.entries())) {
      const ttl = session.multiShare ? FIVE_MINUTES : TEN_MINUTES
      if (now - session.createdAt > ttl) {
        // Notify only session participants that session expired
        const senderWs = this.sockets.get(session.senderId)
        if (senderWs) {
          try { senderWs.send(JSON.stringify({ event: 'oneshare-cancelled', data: { code, reason: 'Session expired' } })) } catch { }
        }
        for (const recvId of session.receivers) {
          const recvWs = this.sockets.get(recvId)
          if (recvWs) {
            try { recvWs.send(JSON.stringify({ event: 'oneshare-cancelled', data: { code, reason: 'Session expired' } })) } catch { }
          }
        }
        this.oneShareSessions.delete(code)
      }
    }
  }

  fetch(request: Request): Response | Promise<Response> {
    const url = new URL(request.url)

    // Handle internal cleanup request from cron trigger
    if (url.pathname === '/cleanup') {
      return this.alarm().then(() => new Response('Cleaned up', { status: 200 }))
    }

    // Handle internal ping for health checks
    if (url.pathname === '/ping') {
      return new Response('OK', { status: 200 })
    }

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
    const now = Date.now()
    this.lastSeen.set(socketId, now)    // Track from connection start
    this.lastActive.set(socketId, now)  // Connecting counts as activity
    this.startSweepInterval()           // Ensure proactive sweep is running

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
          // Also cleanup any OneShare sessions owned by this stale socket
          for (const [code, session] of Array.from(this.oneShareSessions.entries())) {
            if (session.senderId === sid) {
              // Notify only session receivers
              for (const recvId of session.receivers) {
                const recvWs = this.sockets.get(recvId)
                if (recvWs) send(recvWs, 'oneshare-cancelled', { code, reason: 'Sender disconnected' })
              }
              this.oneShareSessions.delete(code)
            }
          }
          this.lastSeen.delete(sid)
          this.lastActive.delete(sid)
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
          // Notify only session receivers that the session is cancelled
          for (const recvId of session.receivers) {
            const recvWs = this.sockets.get(recvId)
            if (recvWs) {
              send(recvWs, 'oneshare-cancelled', { code, reason: 'Sender disconnected' })
            }
          }
          this.oneShareSessions.delete(code)
        }
      }

      this.sockets.delete(socketId)
      this.lastActive.delete(socketId)
    }

    server.addEventListener('message', (ev: MessageEvent) => {
      let msg: any
      try { msg = JSON.parse(ev.data as any) } catch { return }
      const event = msg?.event
      const data = msg?.data || {}
      const roomNumber = data?.roomNumber || this.roomNumber || 'default'

      // Update last-seen and sweep stale on every message
      const now = Date.now()
      this.lastSeen.set(socketId, now)
      // Update last-active only for real user actions (not heartbeats/auto-polls)
      if (RoomDurableObject.ACTIVE_EVENTS.has(event)) {
        this.lastActive.set(socketId, now)
      }
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

        // OneShare Event
        
        case 'oneshare-create': {
          // Sender creates a OneShare session
          // Accept client-generated code if provided, otherwise generate server-side (backward compat)
          let code: string
          if (data.code && typeof data.code === 'string' && /^\d{4}$/.test(data.code)) {
            // Client-provided code — check if already in use on this worker
            if (this.oneShareSessions.has(data.code)) {
              send(server, 'oneshare-code-taken', { code: data.code })
              return
            }
            code = data.code
          } else {
            // Legacy: server generates code
            code = this.generateOneShareCode()
          }
          this.oneShareSessions.set(code, {
            senderId: socketId,
            createdAt: Date.now(),
            files: data.files,
            multiShare: data.multiShare || false,
            receivers: new Set()
          })
          send(server, 'oneshare-created', { code })
          console.log(`OneShare session created: ${code} by ${socketId}${data.multiShare ? ' (MultiShare)' : ''}`)
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
          // Track this receiver in the session
          session.receivers.add(socketId)
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
          // Sender signals transfer complete (for a specific receiver or entire session)
          const { code, receiverId } = data
          const session = this.oneShareSessions.get(code)
          if (!session) return
          // Only the session sender can mark transfers complete
          if (session.senderId !== socketId) return
          if (session.multiShare && receiverId) {
            // MultiShare: notify only the specific receiver, keep session alive
            const recvWs = this.sockets.get(receiverId)
            if (recvWs) send(recvWs, 'oneshare-transfer-complete', { code })
            console.log(`OneShare MultiShare transfer complete for receiver ${receiverId}: ${code}`)
          } else {
            // Regular: notify sender + all tracked receivers, then clean up
            send(server, 'oneshare-transfer-complete', { code })
            for (const recvId of session.receivers) {
              const recvWs = this.sockets.get(recvId)
              if (recvWs) send(recvWs, 'oneshare-transfer-complete', { code })
            }
            this.oneShareSessions.delete(code)
            console.log(`OneShare session completed: ${code}`)
          }
          return
        }

        case 'oneshare-cancel': {
          // Cancel/leave OneShare session — only the sender can cancel
          const { code } = data
          const session = this.oneShareSessions.get(code)
          if (session && session.senderId === socketId) {
            // Notify only session participants
            for (const recvId of session.receivers) {
              const recvWs = this.sockets.get(recvId)
              if (recvWs) send(recvWs, 'oneshare-cancelled', { code })
            }
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

