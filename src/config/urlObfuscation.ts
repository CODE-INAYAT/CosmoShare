/**
 * URL & WebSocket Obfuscation Configuration
 *
 * When enabled, this feature:
 *  1. Encodes student dashboard URL query params into an opaque hash-like token
 *     so the address bar shows  /student?s=7f3a9c...  instead of readable JSON.
 *  2. Masks WebSocket (wss://) URLs in all console output so workers URLs
 *     are not human-readable in the DevTools Console tab.
 *
 * Toggle ON/OFF with the flag below — no other code changes needed.
 *
 * NOTE: Browser DevTools Network tab always displays the real connection URL
 *       because the browser itself initiates the TCP/TLS handshake.  This
 *       config hides URLs from the Console and the address bar only.
 */

// ──────────────────────────────────────────────────────────────
//  Master toggle  —  set to `false` to disable all obfuscation
// ──────────────────────────────────────────────────────────────
export const URL_OBFUSCATION_ENABLED = true

// ──────────────────────────────────────────────────────────────
//  Internal cipher key (change this to any random string you like)
// ──────────────────────────────────────────────────────────────
const CIPHER_KEY = 'Sk@r0$hR2024!xZpQ9w'

// ──────────────────────────────────────────────────────────────
//  XOR cipher — simple reversible transformation
// ──────────────────────────────────────────────────────────────
function xorCipher(input: string, key: string): string {
  let out = ''
  for (let i = 0; i < input.length; i++) {
    out += String.fromCharCode(input.charCodeAt(i) ^ key.charCodeAt(i % key.length))
  }
  return out
}

// ──────────────────────────────────────────────────────────────
//  URL-param encoding  (student page query-string)
// ──────────────────────────────────────────────────────────────

/**
 * Encode an object (e.g. `{ room, user }`) into an opaque URL-safe token.
 *
 * Pipeline:  JSON → XOR → base64 → URL-safe chars → hex-prefix
 *
 * The result looks like `7f3a9c2b…` — not recognisable as base64 or JSON.
 */
export function encodeUrlData(data: Record<string, unknown>): string {
  if (!URL_OBFUSCATION_ENABLED) {
    // Fallback: plain base64 of JSON (still somewhat opaque)
    return btoa(JSON.stringify(data))
  }

  const json = JSON.stringify(data)
  const xored = xorCipher(json, CIPHER_KEY)
  // btoa works on Latin-1 range — XOR output stays in 0-255
  const b64 = btoa(unescape(encodeURIComponent(xored)))
  // Replace base64 alphabet with hex-friendly chars so it looks like a hash
  const token = b64
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

  // Prefix with a 4-char pseudo-random hex tag derived from the key
  const tag = Array.from(CIPHER_KEY)
    .reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0)
    .toString(16)
    .replace('-', '')
    .slice(0, 4)

  return `${tag}${token}`
}

/**
 * Decode an opaque token back into the original object.
 */
export function decodeUrlData(encoded: string): Record<string, unknown> {
  if (!URL_OBFUSCATION_ENABLED) {
    return JSON.parse(atob(encoded))
  }

  // Strip the 4-char hex tag
  const token = encoded.slice(4)

  // Restore standard base64
  let b64 = token.replace(/-/g, '+').replace(/_/g, '/')
  while (b64.length % 4 !== 0) b64 += '='

  const xored = decodeURIComponent(escape(atob(b64)))
  const json = xorCipher(xored, CIPHER_KEY)
  return JSON.parse(json)
}

// ──────────────────────────────────────────────────────────────
//  Console URL masking  (hides wss:// / ws:// URLs in logs)
// ──────────────────────────────────────────────────────────────

/** Convert a URL string into a short opaque identifier like `[sig-a7f3]`. */
function hashUrlForDisplay(url: string): string {
  let h = 0x811c9dc5 // FNV offset basis
  for (let i = 0; i < url.length; i++) {
    h ^= url.charCodeAt(i)
    h = Math.imul(h, 0x01000193) // FNV prime
  }
  return `[sig-${(h >>> 0).toString(16).slice(0, 6)}]`
}

/** Replace any ws:// or wss:// URL in a string with its hashed label. */
function maskUrlsInString(value: unknown): unknown {
  if (typeof value !== 'string') return value
  // Match wss:// or ws:// URLs (greedy up to whitespace / quote / paren)
  return value.replace(/wss?:\/\/[^\s"')]+/gi, (match) => hashUrlForDisplay(match))
}

function maskArgs(args: unknown[]): unknown[] {
  return args.map((arg) => {
    if (typeof arg === 'string') return maskUrlsInString(arg)
    if (typeof arg === 'object' && arg !== null) {
      try {
        // Shallow clone & mask string values
        const clone: Record<string, unknown> = { ...arg as Record<string, unknown> }
        for (const k of Object.keys(clone)) {
          clone[k] = maskUrlsInString(clone[k])
        }
        return clone
      } catch {
        return arg
      }
    }
    return arg
  })
}

let _consolePatched = false

/**
 * Patch `console.log`, `console.warn`, `console.error`, and `console.info`
 * to automatically replace any WebSocket URL with an opaque hash.
 *
 * Safe to call multiple times — only patches once.
 */
export function installConsoleMask(): void {
  if (!URL_OBFUSCATION_ENABLED) return
  if (typeof window === 'undefined') return
  if (_consolePatched) return
  _consolePatched = true

  const methods = ['log', 'warn', 'error', 'info', 'debug'] as const
  for (const m of methods) {
    const original = console[m].bind(console)
    ;(console as any)[m] = (...args: unknown[]) => {
      original(...maskArgs(args))
    }
  }
}
