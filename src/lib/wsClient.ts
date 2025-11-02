'use client'

type Handler = (...args: any[]) => void

export interface SocketLike {
  on: (event: string, handler: Handler) => void
  once: (event: string, handler: Handler) => void
  off: (event: string, handler?: Handler) => void
  emit: (event: string, data?: any) => void
  disconnect: () => void
  connected: boolean
}

function toWsUrl(base: string): string {
  if (base.startsWith('wss://') || base.startsWith('ws://')) return base
  if (base.startsWith('https://')) return 'wss://' + base.slice('https://'.length)
  if (base.startsWith('http://')) return 'ws://' + base.slice('http://'.length)
  return base
}

export function connectSignaling(baseUrl: string): SocketLike {
  // Ensure we always use a proper ws:// or wss:// scheme even if https:// was supplied
  const url = toWsUrl(baseUrl)
  const ws = new WebSocket(url)
  const handlers = new Map<string, Set<Handler>>()
  const onceHandlers = new Map<string, Set<Handler>>()
  let isConnected = false
  let heartbeatTimer: any = null
  let lastActivity = Date.now()
  const HEARTBEAT_ACTIVE_MS = 30_000 // 30s when tab visible
  const HEARTBEAT_BG_MS = 60_000 // 60s when tab hidden

  const dispatch = (event: string, ...args: any[]) => {
    // Mark inbound activity so idle-only heartbeat can skip sending
    lastActivity = Date.now()
    const hs = handlers.get(event)
    if (hs) hs.forEach((h) => {
      try { h(...args) } catch {}
    })
    const ohs = onceHandlers.get(event)
    if (ohs) {
      ohs.forEach((h) => {
        try { h(...args) } catch {}
      })
      onceHandlers.delete(event)
    }
  }

  const clearHeartbeat = () => {
    try { if (heartbeatTimer) clearInterval(heartbeatTimer) } catch {}
    heartbeatTimer = null
  }

  const scheduleHeartbeat = () => {
    clearHeartbeat()
    const interval = (typeof document !== 'undefined' && document.visibilityState === 'visible') ? HEARTBEAT_ACTIVE_MS : HEARTBEAT_BG_MS
    heartbeatTimer = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return
      const idleFor = Date.now() - lastActivity
      if (idleFor >= interval - 500) {
        try { ws.send(JSON.stringify({ event: 'heartbeat', data: {} })) } catch {}
      }
    }, interval)
  }

  ws.addEventListener('open', () => {
    isConnected = true
    dispatch('connect')
    // Start adaptive idle-only heartbeat
    scheduleHeartbeat()
  })
  ws.addEventListener('close', () => {
    isConnected = false
    dispatch('disconnect')
    clearHeartbeat()
  })
  ws.addEventListener('error', () => {
    dispatch('connect_error')
  })
  ws.addEventListener('message', (ev) => {
    try {
      const msg = JSON.parse(ev.data)
      if (msg && typeof msg.event === 'string') {
        // Always deliver the payload as a single argument.
        // Note: Arrays (e.g., list of users) must remain arrays for handlers expecting one param.
        dispatch(msg.event, msg.data)
      }
    } catch {}
  })

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (!isConnected) return
      scheduleHeartbeat()
    })
  }

  const api: SocketLike = {
    on: (event, handler) => {
      if (!handlers.has(event)) handlers.set(event, new Set())
      handlers.get(event)!.add(handler)
    },
    once: (event, handler) => {
      if (!onceHandlers.has(event)) onceHandlers.set(event, new Set())
      onceHandlers.get(event)!.add(handler)
    },
    off: (event, handler) => {
      if (!handler) { handlers.delete(event); onceHandlers.delete(event); return }
      handlers.get(event)?.delete(handler)
      onceHandlers.get(event)?.delete(handler)
    },
    emit: (event, data) => {
      try {
        ws.send(JSON.stringify({ event, data }))
        lastActivity = Date.now()
      } catch {}
    },
    disconnect: () => {
      try { ws.close() } catch {}
      clearHeartbeat()
    },
    get connected() {
      return isConnected && ws.readyState === WebSocket.OPEN
    }
  }

  return api
}
