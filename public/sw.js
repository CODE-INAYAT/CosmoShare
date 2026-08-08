/// <reference lib="webworker" />

// CosmoShare Service Worker v2
// Enables PWA installability, offline shell support, and offline fallback

const CACHE_NAME = 'cosmoshare-v2'

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
    event.respondWith(
      (async () => {
        try {
          const formData = await request.formData()
          const files = formData.getAll('files')
          
          if (files && files.length > 0) {
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
                
                const CHUNK_SIZE = 5 * 1024 * 1024 // 5MB chunks
                let completed = 0
                let expectedPuts = 0
                
                const checkDone = () => {
                  completed++
                  if (completed === expectedPuts) resolve()
                }
                
                tx.oncomplete = () => resolve()
                tx.onerror = () => reject(tx.error)
                
                const validFiles = files.filter(f => f.size > 0)
                if (validFiles.length === 0) {
                  resolve()
                  return
                }
                
                for (let f of validFiles) {
                  expectedPuts++ // For metadata
                  expectedPuts += Math.ceil(f.size / CHUNK_SIZE)
                }
                
                for (let f of validFiles) {
                  const fileId = self.crypto.randomUUID ? self.crypto.randomUUID() : Date.now().toString() + Math.random().toString()
                  const totalChunks = Math.ceil(f.size / CHUNK_SIZE)
                  
                  const metaReq = store.put({
                    type: 'metadata',
                    fileId,
                    name: f.name,
                    fileType: f.type,
                    size: f.size,
                    totalChunks,
                    timestamp: Date.now()
                  })
                  metaReq.onsuccess = checkDone
                  metaReq.onerror = () => reject(metaReq.error)
                  
                  for (let i = 0; i < totalChunks; i++) {
                    const start = i * CHUNK_SIZE
                    const end = Math.min(start + CHUNK_SIZE, f.size)
                    const chunkReq = store.put({
                      type: 'chunk',
                      fileId,
                      chunkIndex: i,
                      data: f.slice(start, end)
                    })
                    chunkReq.onsuccess = checkDone
                    chunkReq.onerror = () => reject(chunkReq.error)
                  }
                }
              }
              requestIdb.onerror = () => reject(requestIdb.error)
            })
          }
          
          return Response.redirect('/share-target', 303)
        } catch (err) {
          console.error('[SW] Share target error:', err)
          return Response.redirect('/share-target?error=1', 303)
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
