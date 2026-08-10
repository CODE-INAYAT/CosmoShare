/// <reference lib="webworker" />

// CosmoShare Service Worker v2
// Enables PWA installability, offline shell support, and offline fallback

const CACHE_NAME = 'cosmoshare-v3'

// Shell assets to pre-cache during install (app shell)
const PRECACHE_ASSETS = [
  '/',
  '/pwa',
  '/manifest.webmanifest',
  '/manifest-admin.webmanifest',
  '/offline.html',
  '/logo.svg',
  '/logoDark.svg',
  '/favicon-32x32.png',
  '/android-chrome-192x192.png',
  '/android-chrome-512x512.png',
]

// Install — pre-cache the app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS).catch((err) => {
        // Don't fail install if some assets can't be cached (e.g., in dev)
        console.warn('[SW] Pre-cache partial failure:', err)
      })
    })
  )
  // Activate immediately without waiting for old SW to finish
  self.skipWaiting()
})

// Activate — clean up old caches & enable navigation preload
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Clean up old caches
      const keys = await caches.keys()
      await Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )

      // Disable navigation preload to guarantee POST payload interception
      if (self.registration.navigationPreload) {
        try {
          await self.registration.navigationPreload.disable()
        } catch (e) {
          // Not all browsers support this; silently ignore
        }
      }
    })()
  )
  // Take control of all clients immediately
  self.clients.claim()
})

// Message handler — skip waiting when requested by the app
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})

// Fetch — network-first for pages, cache-first for static assets, offline fallback
self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  // --- Web Share Target API Interception ---
  // We use replace(/\/$/, '') to strip trailing slashes ensuring 100% match regardless of OS quirks.
  if (request.method === 'POST' && url.pathname.replace(/\/$/, '') === '/api/share-target') {
    const stream = new TransformStream()
    const writer = stream.writable.getWriter()
    const encoder = new TextEncoder()
    
    // Immediately return the Response to dismiss the OS Splash Screen instantly!
    event.respondWith(new Response(stream.readable, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    }))
    
    // Keep the Service Worker alive while we process the payload and stream the HTML
    event.waitUntil(
      (async () => {
        try {
          // 1. Instantly stream the beautiful loading UI to the browser
          await writer.write(encoder.encode(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
              <meta charset="UTF-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <title>Receiving Files...</title>
              <style>
                body { background: #09090b; font-family: system-ui, -apple-system, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; overflow: hidden; }
                .brand { display: flex; align-items: center; gap: 12px; margin-bottom: 40px; animation: fadeDown 0.5s ease-out; }
                .logo-box { width: 40px; height: 40px; background: linear-gradient(135deg, #3b82f6, #8b5cf6); border-radius: 12px; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 20px rgba(59, 130, 246, 0.4); }
                .logo-icon { width: 24px; height: 24px; color: white; }
                .brand-text { font-size: 1.5rem; font-weight: 700; color: white; letter-spacing: -0.025em; }
                .spinner-container { position: relative; width: 64px; height: 64px; margin-bottom: 24px; animation: scaleIn 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275) 0.2s both; }
                .spinner-ring { position: absolute; inset: 0; border: 3px solid rgba(255, 255, 255, 0.05); border-radius: 50%; }
                .spinner-progress { position: absolute; inset: 0; border: 3px solid transparent; border-top-color: #3b82f6; border-right-color: #8b5cf6; border-radius: 50%; animation: spin 1s cubic-bezier(0.6, 0.2, 0.4, 0.8) infinite; }
                .text { font-size: 1.125rem; font-weight: 500; letter-spacing: 0.01em; color: #a1a1aa; animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite; }
                @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
                @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }
                @keyframes fadeDown { from { opacity: 0; transform: translateY(-10px); } to { opacity: 1; transform: translateY(0); } }
                @keyframes scaleIn { from { opacity: 0; transform: scale(0.9); } to { opacity: 1; transform: scale(1); } }
              </style>
            </head>
            <body>
              <div class="brand">
                <div class="logo-box">
                  <svg class="logo-icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"></path><path d="M12 12v9"></path><path d="m8 17 4 4 4-4"></path></svg>
                </div>
                <div class="brand-text">CosmoShare</div>
              </div>
              <div class="spinner-container">
                <div class="spinner-ring"></div>
                <div class="spinner-progress"></div>
              </div>
              <div class="text">Securing your files offline...</div>
          `))

          // 2. Read raw body as blob (Zero RAM) while the UI is already showing
          const rawBlob = await request.blob()
          const contentType = request.headers.get('content-type')
          
          if (rawBlob && rawBlob.size > 0) {
            await new Promise((resolve, reject) => {
              const requestIdb = indexedDB.open('cosmoshare-share-db', 1)
              
              requestIdb.onupgradeneeded = (e) => {
                const db = e.target.result
                if (!db.objectStoreNames.contains('shared-files')) {
                  db.createObjectStore('shared-files', { autoIncrement: true })
                }
              }
              
              requestIdb.onsuccess = (e) => {
                const db = e.target.result
                const tx = db.transaction('shared-files', 'readwrite')
                const store = tx.objectStore('shared-files')
                
                const putReq = store.put({
                  type: 'raw-multipart',
                  blob: rawBlob,
                  contentType,
                  timestamp: Date.now()
                })
                
                putReq.onsuccess = () => resolve()
                putReq.onerror = () => reject(putReq.error)
              }
              
              requestIdb.onerror = () => reject(requestIdb.error)
            })
          }
          
          // 3. Complete the HTML stream to trigger the client-side redirect
          await writer.write(encoder.encode(`
              <script>window.location.replace('/share-target');</script>
            </body>
            </html>
          `))
        } catch (err) {
          console.error('[SW] Share target error:', err)
          await writer.write(encoder.encode(`
              <script>window.location.replace('/share-target?error=sw_failed');</script>
            </body>
            </html>
          `))
        } finally {
          await writer.close()
        }
      })()
    )
    return
  }

  // Skip non-GET requests
  if (request.method !== 'GET') return

  // Skip WebSocket, socket.io, and API requests
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/socket.io') ||
    url.pathname.includes('/_next/webpack') ||
    url.pathname.includes('hot-update') ||
    url.protocol === 'ws:' ||
    url.protocol === 'wss:'
  ) {
    return
  }

  // Skip cross-origin requests (CDN scripts, analytics, etc.)
  if (url.origin !== self.location.origin) return

  // Static assets (images, fonts, CSS, JS) — cache-first
  if (
    url.pathname.match(/\.(png|jpg|jpeg|gif|svg|webp|avif|ico|woff2?|ttf|eot|css|js)$/) ||
    url.pathname.startsWith('/_next/static/')
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached
        return fetch(request).then((response) => {
          // Only cache successful responses
          if (response.ok) {
            const clone = response.clone()
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone))
          }
          return response
        }).catch(() => {
          // If offline and not cached, return nothing
          return new Response('', { status: 503, statusText: 'Offline' })
        })
      })
    )
    return
  }

  // HTML pages — network-first with cache fallback + offline fallback
  if (request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      (async () => {
        try {
          // Use navigation preload response if available
          const preloadResponse = event.preloadResponse
            ? await event.preloadResponse
            : null

          const response = preloadResponse || await fetch(request)

          if (response.ok) {
            const clone = response.clone()
            const cache = await caches.open(CACHE_NAME)
            cache.put(request, clone)
          }
          return response
        } catch (error) {
          // Network failed — try cache first
          const cached = await caches.match(request)
          if (cached) return cached

          // No cache — try cached homepage as fallback
          const homeFallback = await caches.match('/')
          if (homeFallback) return homeFallback

          // Final fallback — the offline page
          const offlinePage = await caches.match('/offline.html')
          if (offlinePage) return offlinePage

          return new Response('Offline', { status: 503, statusText: 'Offline' })
        }
      })()
    )
    return
  }
})
