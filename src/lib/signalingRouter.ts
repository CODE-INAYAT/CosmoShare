/**
 * Signaling Router — Multi-Account Sharding for Cloudflare Workers
 *
 * Lab Share:  hash(roomNumber) % N  → deterministic worker per room
 * OneShare:   hash(code)       % N  → deterministic worker per code (client-generated)
 *
 * Failover:   When a worker is unreachable (e.g. Durable-Object free-tier quota
 *             exceeded), clients deterministically rotate through the remaining
 *             workers in the same ring order.  Both sender and receiver compute
 *             the same fallback sequence for a given room/code, so they always
 *             converge on the same healthy worker.
 *
 * Scaling: Just add URLs to the comma-separated env vars. No code changes needed.
 *
 * Env vars:
 *   NEXT_PUBLIC_SIGNALING_URLS           — comma-separated Lab Share worker URLs
 *   NEXT_PUBLIC_SIGNALING_URLS_ONESHARE  — comma-separated OneShare worker URLs
 *
 * Legacy fallback (single URL):
 *   NEXT_PUBLIC_SIGNALING_BASE_URL           — single Lab Share URL
 *   NEXT_PUBLIC_SIGNALING_BASE_URL_ONESHARE  — single OneShare URL
 */

/**
 * djb2 string hash — fast, deterministic, good distribution.
 * Returns a non-negative integer.
 */
function djb2Hash(str: string): number {
  let hash = 5381
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0 // force unsigned 32-bit
  }
  return hash
}

/** Parse a comma-separated env var into a trimmed, non-empty array of URLs. */
function parseUrls(envValue: string | undefined): string[] {
  if (!envValue) return []
  return envValue.split(',').map(u => u.trim()).filter(Boolean)
}

/** Normalise a base URL into ws(s) format ending with /ws */
function normaliseWs(base: string): string {
  const clean = base.replace(/\/$/, '')
  return (clean.endsWith('/ws') || clean.includes('/ws?')) ? clean : `${clean}/ws`
}

// ---------------------------------------------------------------------------
// Lab Share
// ---------------------------------------------------------------------------

/** All configured Lab Share signaling URLs, with legacy fallback. */
function getLabUrls(): string[] {
  const multi = parseUrls(process.env.NEXT_PUBLIC_SIGNALING_URLS)
  if (multi.length > 0) return multi

  // Legacy single-URL fallback
  const single = (process.env.NEXT_PUBLIC_SIGNALING_BASE_URL || '').trim()
  return single ? [single] : []
}

/**
 * Returns the full WebSocket URL for a Lab Share room.
 * Deterministic: same room always maps to the same worker.
 *
 * Returns `null` if no signaling URLs are configured (fallback to Socket.IO).
 */
export function getLabSignalingUrl(roomNumber: string): string | null {
  const urls = getLabUrls()
  if (urls.length === 0) return null

  const index = djb2Hash(roomNumber) % urls.length
  const wsBase = normaliseWs(urls[index])
  return `${wsBase}?room=${encodeURIComponent(roomNumber)}`
}

/**
 * Returns an **ordered list** of WebSocket URLs for a Lab Share room.
 * The primary URL comes first, followed by the remaining workers in
 * deterministic ring order so every client computes the same failover sequence.
 *
 * Returns an empty array if no signaling URLs are configured.
 */
export function getLabSignalingUrls(roomNumber: string): string[] {
  const urls = getLabUrls()
  if (urls.length === 0) return []

  const primary = djb2Hash(roomNumber) % urls.length
  const result: string[] = []
  for (let i = 0; i < urls.length; i++) {
    const idx = (primary + i) % urls.length
    const wsBase = normaliseWs(urls[idx])
    result.push(`${wsBase}?room=${encodeURIComponent(roomNumber)}`)
  }
  return result
}

// ---------------------------------------------------------------------------
// OneShare
// ---------------------------------------------------------------------------

/** All configured OneShare signaling URLs, with cascading fallback. */
function getOneShareUrls(): string[] {
  // 1. Dedicated multi-URL list for OneShare
  const multi = parseUrls(process.env.NEXT_PUBLIC_SIGNALING_URLS_ONESHARE)
  if (multi.length > 0) return multi

  // 2. Legacy single OneShare URL
  const singleOneShare = (process.env.NEXT_PUBLIC_SIGNALING_BASE_URL_ONESHARE || '').trim()
  if (singleOneShare) return [singleOneShare]

  // 3. Fall back to Lab Share URLs (shared workers)
  const labMulti = parseUrls(process.env.NEXT_PUBLIC_SIGNALING_URLS)
  if (labMulti.length > 0) return labMulti

  // 4. Legacy single Lab Share URL
  const singleLab = (process.env.NEXT_PUBLIC_SIGNALING_BASE_URL || '').trim()
  return singleLab ? [singleLab] : []
}

/**
 * Returns the full WebSocket URL for OneShare given a 4-digit code.
 * Deterministic: same code always maps to the same worker.
 *
 * Called by both sender (after generating code) and receiver (after entering code).
 *
 * Returns `null` if no signaling URLs are configured (fallback to Socket.IO).
 */
export function getOneShareSignalingUrl(code: string): string | null {
  const urls = getOneShareUrls()
  if (urls.length === 0) return null

  const index = djb2Hash(code) % urls.length
  return normaliseWs(urls[index])
}

/**
 * Returns an **ordered list** of WebSocket URLs for a OneShare code.
 * The primary URL comes first, followed by the remaining workers in
 * deterministic ring order for failover.
 *
 * Returns an empty array if no signaling URLs are configured.
 */
export function getOneShareSignalingUrls(code: string): string[] {
  const urls = getOneShareUrls()
  if (urls.length === 0) return []

  const primary = djb2Hash(code) % urls.length
  const result: string[] = []
  for (let i = 0; i < urls.length; i++) {
    const idx = (primary + i) % urls.length
    result.push(normaliseWs(urls[idx]))
  }
  return result
}

/**
 * Returns a random OneShare worker URL and its shard index.
 * Used for eager connection on page load.
 *
 * Returns `{ url, shardIndex }` or `null` if no URLs configured.
 */
export function getRandomOneShareShard(): { url: string; shardIndex: number } | null {
  const urls = getOneShareUrls()
  if (urls.length === 0) return null

  const shardIndex = Math.floor(Math.random() * urls.length)
  return { url: normaliseWs(urls[shardIndex]), shardIndex }
}

/**
 * Returns all OneShare worker URLs starting from a random shard, suitable
 * for eager connection with automatic failover.
 *
 * Returns `{ urls, startShardIndex }` or `null` if no URLs configured.
 */
export function getRandomOneShareShardWithFallbacks(): { urls: string[]; startShardIndex: number } | null {
  const urls = getOneShareUrls()
  if (urls.length === 0) return null

  const start = Math.floor(Math.random() * urls.length)
  const ordered: string[] = []
  for (let i = 0; i < urls.length; i++) {
    const idx = (start + i) % urls.length
    ordered.push(normaliseWs(urls[idx]))
  }
  return { urls: ordered, startShardIndex: start }
}

/**
 * Returns the shard index for a given 4-digit code.
 */
export function getOneShareShardIndex(code: string): number {
  const urls = getOneShareUrls()
  if (urls.length <= 1) return 0
  return djb2Hash(code) % urls.length
}

/**
 * Returns the total number of OneShare workers configured.
 */
export function getOneShareShardCount(): number {
  return getOneShareUrls().length
}

/**
 * Returns the shard index for a given WebSocket URL.
 * Used to determine which shard a connection is actually on after failover.
 */
export function getShardIndexForUrl(url: string): number {
  const urls = getOneShareUrls()
  if (urls.length === 0) return 0
  const normalised = normaliseWs(url)
  const idx = urls.findIndex(u => normaliseWs(u) === normalised)
  return idx >= 0 ? idx : 0
}

// ---------------------------------------------------------------------------
// Code Generation (client-side)
// ---------------------------------------------------------------------------

/**
 * Generate a random 4-digit code (1000–9999).
 * The client generates this, then sends it to the worker for registration.
 */
export function generateOneShareCode(): string {
  return Math.floor(1000 + Math.random() * 9000).toString()
}

/**
 * Generate a random 4-digit code that maps to a specific shard index.
 * Sender uses this to generate codes that always map to the shard they're already connected to.
 * With 1 shard, returns any random code.
 */
export function generateOneShareCodeForShardIndex(shardIndex: number): string {
  const total = getOneShareUrls().length
  if (total <= 1) return generateOneShareCode()

  let code: string
  let attempts = 0
  do {
    code = Math.floor(1000 + Math.random() * 9000).toString()
    attempts++
  } while (djb2Hash(code) % total !== shardIndex && attempts < 1000)
  return code
}

/**
 * Generate a new 4-digit code that maps to the same shard as the given reference code.
 * Used for retry on code collision — avoids reconnecting to a different worker.
 * With 1 shard, this is identical to generateOneShareCode().
 */
export function generateOneShareCodeForSameShard(referenceCode: string): string {
  const urls = getOneShareUrls()
  const total = urls.length
  if (total <= 1) return generateOneShareCode()

  const targetIndex = djb2Hash(referenceCode) % total
  return generateOneShareCodeForShardIndex(targetIndex)
}
