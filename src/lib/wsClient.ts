'use client'

type Handler = (...args: any[]) => void

export interface SocketLike {
  on: (event: string, handler: Handler) => void
  once: (event: string, handler: Handler) => void
  off: (event: string, handler?: Handler) => void
  emit: (event: string, data?: any) => void
  disconnect: () => void
  connect: () => void
  connected: boolean
}

function toWsUrl(base: string): string {
  if (base.startsWith('wss://') || base.startsWith('ws://')) return base
  if (base.startsWith('https://')) return 'wss://' + base.slice('https://'.length)
  if (base.startsWith('http://')) return 'ws://' + base.slice('http://'.length)
  return base
}

export function connectSignaling(baseUrl: string): SocketLike {
  const url = toWsUrl(baseUrl)
  const handlers = new Map<string, Set<Handler>>()
  const onceHandlers = new Map<string, Set<Handler>>()

  let ws: WebSocket | null = null
  let isConnected = false
  let heartbeatTimer: any = null
  let reconnectAttempts = 0
  let reconnectTimer: any = null
  let intentionalDisconnect = false

  const MAX_RECONNECT_ATTEMPTS = 5
  const RECONNECT_BASE_DELAY = 1000 // 1 second base delay
  const MAX_RECONNECT_DELAY = 30000 // 30 seconds max delay

  const dispatch = (event: string, ...args: any[]) => {
    const hs = handlers.get(event)
    if (hs) hs.forEach((h) => {
      try { h(...args) } catch { }
    })
    const ohs = onceHandlers.get(event)
    if (ohs) {
      ohs.forEach((h) => {
        try { h(...args) } catch { }
      })
      onceHandlers.delete(event)
    }
  }

  const clearTimers = () => {
    try { if (heartbeatTimer) clearInterval(heartbeatTimer); heartbeatTimer = null } catch { }
    try { if (reconnectTimer) clearTimeout(reconnectTimer); reconnectTimer = null } catch { }
  }

  const startHeartbeat = () => {
    clearTimers()
    heartbeatTimer = setInterval(() => {
      try {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ event: 'heartbeat', data: {} }))
        }
      } catch { }
    }, 15000)
  }

  const scheduleReconnect = () => {
    if (intentionalDisconnect || reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.log('[wsClient] Max reconnect attempts reached or intentional disconnect')
      return
    }

    // Exponential backoff with jitter
    const delay = Math.min(
      RECONNECT_BASE_DELAY * Math.pow(2, reconnectAttempts) + Math.random() * 1000,
      MAX_RECONNECT_DELAY
    )

    console.log(`[wsClient] Scheduling reconnect attempt ${reconnectAttempts + 1} in ${delay}ms`)

    reconnectTimer = setTimeout(() => {
      reconnectAttempts++
      createConnection()
    }, delay)
  }

  const createConnection = () => {
    // Clean up existing connection if any
    if (ws) {
      try { ws.close() } catch { }
      ws = null
    }

    console.log(`[wsClient] Creating new WebSocket connection to ${url}`)

    try {
      ws = new WebSocket(url)
    } catch (e) {
      console.error('[wsClient] Failed to create WebSocket:', e)
      scheduleReconnect()
      return
    }

    ws.addEventListener('open', () => {
      console.log('[wsClient] WebSocket connected')
      isConnected = true
      reconnectAttempts = 0 // Reset on successful connection
      intentionalDisconnect = false
      dispatch('connect')
      startHeartbeat()
    })

    ws.addEventListener('close', (event) => {
      console.log(`[wsClient] WebSocket closed: code=${event.code}, reason=${event.reason}`)
      const wasConnected = isConnected
      isConnected = false
      clearTimers()

      if (wasConnected) {
        dispatch('disconnect')
      }

      // Only auto-reconnect if not intentional and was previously connected
      if (!intentionalDisconnect) {
        scheduleReconnect()
      }
    })

    ws.addEventListener('error', (e) => {
      console.error('[wsClient] WebSocket error:', e)
      dispatch('connect_error')
    })

    ws.addEventListener('message', (ev) => {
      try {
        const msg = JSON.parse(ev.data)
        if (msg && typeof msg.event === 'string') {
          dispatch(msg.event, msg.data)
        }
      } catch { }
    })
  }

  // Create initial connection
  createConnection()

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
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ event, data }))
        } else {
          console.warn('[wsClient] Cannot emit, WebSocket not open')
        }
      } catch { }
    },
    disconnect: () => {
      console.log('[wsClient] Intentional disconnect')
      intentionalDisconnect = true
      clearTimers()
      try { ws?.close() } catch { }
      ws = null
      isConnected = false
    },
    connect: () => {
      console.log('[wsClient] Manual connect called')
      intentionalDisconnect = false
      reconnectAttempts = 0
      clearTimers()

      // If already connected, do nothing
      if (ws && ws.readyState === WebSocket.OPEN) {
        console.log('[wsClient] Already connected')
        return
      }

      // If connecting, wait for it
      if (ws && ws.readyState === WebSocket.CONNECTING) {
        console.log('[wsClient] Already connecting')
        return
      }

      // Create new connection
      createConnection()
    },
    get connected() {
      return isConnected && ws !== null && ws.readyState === WebSocket.OPEN
    }
  }

  return api
}
