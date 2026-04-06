const ANALYTICS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycby9a2TDUNVcSnQRWOG5huQa_fZsB9tHwgYekS-SNT9EX_gG64nnltuCYcQ40qe6Hu-lGg/exec'

// ── Event Types ───────────────────────────────────────────────────
export const AnalyticsEvent = {
    FILE_SHARED: 'FILE_SHARED',
    LINK_SHARED: 'LINK_SHARED',
    CODE_SHARED: 'CODE_SHARED',
    AUTO_SHARE: 'AUTO_SHARE',
    CANCELED_TRANSFER: 'CANCELED_TRANSFER',
    VISITOR: 'VISITOR',
    ROOM_JOIN: 'ROOM_JOIN',
    ONESHARE_USER: 'ONESHARE_USER',
    ADMIN_JOIN: 'ADMIN_JOIN',
    STUDENT_JOIN: 'STUDENT_JOIN',
    SUPPORT_DIALOG: 'SUPPORT_DIALOG',
    ONESHARE_MULTISHARE: 'ONESHARE_MULTISHARE',
    FILE_SIZE: 'FILE_SIZE',
} as const

export type AnalyticsEventType = (typeof AnalyticsEvent)[keyof typeof AnalyticsEvent]

// ── Session Context ───────────────────────────────────────────────

interface AnalyticsContext {
    roomNumber: string
    userName: string
    isAdmin: boolean
}

let _ctx: AnalyticsContext | null = null

export function setAnalyticsContext(ctx: AnalyticsContext) {
    _ctx = ctx
}

export function clearAnalyticsContext() {
    _ctx = null
}

// ── Types ─────────────────────────────────────────────────────────

interface QueuedEvent {
    event: string
    value: number
    roomNumber?: string
    userName?: string
    isAdmin?: boolean
}

// ── In-Memory Queue ──────────────────────────────────────────────
// Simple in-memory queue. No localStorage = no double-counting.
// Events are aggregated before sending to minimize requests.

let eventQueue: QueuedEvent[] = []
let flushTimer: ReturnType<typeof setTimeout> | null = null
let isFlushing = false

const FLUSH_DELAY = 2000
const MAX_RETRIES = 3
const BASE_RETRY_MS = 1500

// ── Aggregation ──────────────────────────────────────────────────

function aggregateQueue(queue: QueuedEvent[]): QueuedEvent[] {
    const map = new Map<string, QueuedEvent>()
    for (const item of queue) {
        const key = [
            item.event,
            item.roomNumber || '',
            item.userName || '',
            item.isAdmin ? '1' : '0'
        ].join('::')
        const existing = map.get(key)
        if (existing) {
            existing.value += item.value
        } else {
            map.set(key, { ...item })
        }
    }
    return Array.from(map.values())
}

// ── Payload Builder ──────────────────────────────────────────────

function buildPayload(batch: QueuedEvent[]): string {
    const clean = batch.map(({ event, value, roomNumber, userName, isAdmin }) => {
        const obj: Record<string, unknown> = { event, value }
        if (roomNumber) obj.roomNumber = roomNumber
        if (userName) obj.userName = userName
        if (isAdmin) obj.isAdmin = true
        return obj
    })
    return JSON.stringify(clean.length === 1 ? clean[0] : { batch: clean })
}

// ── Send via fetch (with retry) ──────────────────────────────────

async function sendViaFetch(payload: string, attempt = 0): Promise<boolean> {
    try {
        const res = await fetch(ANALYTICS_SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: payload,
            keepalive: true,
            redirect: 'follow',
        })

        if (res.ok) return true

        // Server error — retry with backoff
        if (attempt < MAX_RETRIES) {
            await new Promise(r => setTimeout(r, BASE_RETRY_MS * Math.pow(2, attempt)))
            return sendViaFetch(payload, attempt + 1)
        }
        return false
    } catch {
        if (attempt < MAX_RETRIES) {
            await new Promise(r => setTimeout(r, BASE_RETRY_MS * Math.pow(2, attempt)))
            return sendViaFetch(payload, attempt + 1)
        }
        return false
    }
}

// ── Send via sendBeacon (page unload only) ───────────────────────

function sendViaBeacon(payload: string): boolean {
    if (typeof navigator === 'undefined' || !navigator.sendBeacon) return false
    try {
        return navigator.sendBeacon(
            ANALYTICS_SCRIPT_URL,
            new Blob([payload], { type: 'text/plain;charset=utf-8' })
        )
    } catch {
        return false
    }
}

// ── Flush Logic ──────────────────────────────────────────────────
// Drains the in-memory queue, aggregates, and sends ONCE.
// The queue is cleared BEFORE sending — this is intentional:
//   • Prevents any other flush path from re-sending the same events
//   • Trade-off: if the send fails after all retries, those events are lost
//   • This is acceptable because double-counting is far worse than
//     occasionally missing one event

function flush(useBeacon = false) {
    if (eventQueue.length === 0) return

    // Drain the queue atomically (prevents double-send)
    const raw = eventQueue.splice(0, eventQueue.length)
    flushTimer = null

    const aggregated = aggregateQueue(raw)
    const payload = buildPayload(aggregated)

    if (useBeacon) {
        // Page is unloading — use sendBeacon (fire-and-forget)
        sendViaBeacon(payload)
    } else {
        // Normal flush — use fetch with retry
        if (!isFlushing) {
            isFlushing = true
            sendViaFetch(payload).finally(() => {
                isFlushing = false
            })
        } else {
            // Another fetch is in flight — use sendBeacon as fallback
            sendViaBeacon(payload)
        }
    }
}

// ── Page Lifecycle ───────────────────────────────────────────────

let lifecycleRegistered = false
let unloadFlushed = false

function registerLifecycle() {
    if (lifecycleRegistered || typeof window === 'undefined') return
    lifecycleRegistered = true

    // Single unload handler — only fires ONCE per page lifecycle
    const onUnload = () => {
        if (unloadFlushed) return
        unloadFlushed = true
        flush(true)
    }

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') onUnload()
    })

    window.addEventListener('pagehide', onUnload)
    window.addEventListener('beforeunload', onUnload)
}

// ── Public API ────────────────────────────────────────────────────

/**
 * Track an analytics event.
 *
 * Events are:
 *   1. Queued in memory
 *   2. Batched within a 2s window and pre-aggregated
 *   3. Sent via fetch with retry (up to 3 attempts)
 *   4. On page unload: sent via sendBeacon (once only)
 *
 * The queue is drained BEFORE sending to prevent any
 * double-counting from concurrent flush paths.
 */
export function trackEvent(
    event: AnalyticsEventType | string,
    value: number = 1,
    roomNumber?: string
) {
    if (typeof window === 'undefined') return

    registerLifecycle()

    eventQueue.push({
        event,
        value,
        roomNumber: roomNumber || _ctx?.roomNumber || undefined,
        userName: _ctx?.userName || undefined,
        isAdmin: _ctx?.isAdmin || undefined,
    })

    // Schedule a batched flush (coalesces multiple trackEvent calls)
    if (!flushTimer) {
        flushTimer = setTimeout(() => flush(false), FLUSH_DELAY)
    }
}

/**
 * Track file size transferred (converts bytes to MB).
 */
export function trackFileSize(bytes: number) {
    if (!bytes || bytes <= 0) return
    const mb = Math.round((bytes / (1024 * 1024)) * 100) / 100
    trackEvent(AnalyticsEvent.FILE_SIZE, mb)
}

/**
 * Track a unique visitor (deduplicated per browser session).
 */
export function trackVisitor() {
    if (typeof window === 'undefined') return

    try {
        const key = '__cosmoshare_visitor_tracked'
        if (sessionStorage.getItem(key)) return
        sessionStorage.setItem(key, '1')
        trackEvent(AnalyticsEvent.VISITOR)
    } catch {
        trackEvent(AnalyticsEvent.VISITOR)
    }
}
