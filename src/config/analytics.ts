
const ANALYTICS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbydOho5SkvFewC6eXjOAheFcYBCrOneqxRy1aDHekSDFIQKb2e7YsBcnjmwhF6UnYVD/exec'

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

// ── Internal: Queue & Flush ───────────────────────────────────────

interface QueuedEvent {
    event: string
    value: number
    roomNumber?: string
}

let eventQueue: QueuedEvent[] = []
let flushTimer: ReturnType<typeof setTimeout> | null = null
const FLUSH_DELAY = 2000 // batch window: 2 seconds

/**
 * Pre-aggregate events: combine duplicates by summing their values.
 * E.g. [{event:'FILE_SHARED', value:1}, {event:'FILE_SHARED', value:1}]
 *   → [{event:'FILE_SHARED', value:2}]
 *
 * FILE_SIZE values are summed (total MB per flush).
 * Events with roomNumber are kept separate per room.
 */
function aggregateQueue(queue: QueuedEvent[]): QueuedEvent[] {
    const map = new Map<string, QueuedEvent>()
    for (const item of queue) {
        const key = item.roomNumber ? `${item.event}::${item.roomNumber}` : item.event
        const existing = map.get(key)
        if (existing) {
            existing.value += item.value
        } else {
            map.set(key, { ...item })
        }
    }
    return Array.from(map.values())
}

function flushQueue() {
    if (eventQueue.length === 0) return
    const raw = [...eventQueue]
    eventQueue = []
    flushTimer = null

    // Aggregate duplicates to reduce the payload
    const batch = aggregateQueue(raw)

    // Send entire batch in one request
    sendBatch(batch)
}

/**
 * Send a batch of analytics events in a single POST request.
 * The Apps Script accepts both { event, value } and { batch: [...] }.
 *
 * Includes a single retry on failure (3 second delay).
 */
function sendBatch(batch: QueuedEvent[], isRetry = false) {
    if (typeof window === 'undefined') return
    if (!ANALYTICS_SCRIPT_URL || batch.length === 0) return

    try {
        const body = JSON.stringify(batch.length === 1 ? batch[0] : { batch })

        fetch(ANALYTICS_SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body,
            keepalive: true,
            redirect: 'follow',
        }).then(res => {
            // Retry once on server error (5xx) or network issues
            if (!res.ok && !isRetry) {
                setTimeout(() => sendBatch(batch, true), 3000)
            }
        }).catch(() => {
            // Retry once on network failure
            if (!isRetry) {
                setTimeout(() => sendBatch(batch, true), 3000)
            }
        })
    } catch {
        // Completely silent
    }
}

// ── Page Lifecycle: Flush on Unload ───────────────────────────────
// Ensures no events are lost when the user navigates away or closes the tab.

let lifecycleRegistered = false

function registerLifecycleFlush() {
    if (lifecycleRegistered || typeof window === 'undefined') return
    lifecycleRegistered = true

    // visibilitychange fires reliably on tab switch/close on mobile
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            flushQueue()
        }
    })

    // pagehide fires on navigation/close (more reliable than beforeunload)
    window.addEventListener('pagehide', () => {
        flushQueue()
    })
}

// ── Public API ────────────────────────────────────────────────────

/**
 * Track an analytics event. Fire-and-forget.
 * Events are batched within a 2-second window, pre-aggregated, and sent
 * in a single network request. Silently retries once on failure.
 *
 * @param event - Event type from AnalyticsEvent
 * @param value - Numeric value to increment (default: 1)
 * @param roomNumber - Optional room number for room-wise tracking
 */
export function trackEvent(
    event: AnalyticsEventType | string,
    value: number = 1,
    roomNumber?: string
) {
    if (typeof window === 'undefined') return

    // Lazy-register lifecycle handlers on first call
    registerLifecycleFlush()

    eventQueue.push({ event, value, roomNumber })

    if (!flushTimer) {
        flushTimer = setTimeout(flushQueue, FLUSH_DELAY)
    }
}

/**
 * Track file size transferred (converts bytes to MB).
 */
export function trackFileSize(bytes: number) {
    if (!bytes || bytes <= 0) return
    const mb = Math.round((bytes / (1024 * 1024)) * 100) / 100 // 2 decimal places
    trackEvent(AnalyticsEvent.FILE_SIZE, mb)
}

/**
 * Track a unique visitor (deduplicated per browser session).
 * Uses sessionStorage so each tab/session is counted only once.
 */
export function trackVisitor() {
    if (typeof window === 'undefined') return

    try {
        const key = '__sharme_visitor_tracked'
        if (sessionStorage.getItem(key)) return
        sessionStorage.setItem(key, '1')
        trackEvent(AnalyticsEvent.VISITOR)
    } catch {
        // sessionStorage may be unavailable (private browsing etc.)
        trackEvent(AnalyticsEvent.VISITOR)
    }
}
