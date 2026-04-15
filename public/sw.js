/// <reference lib="webworker" />

// CosmoShare Service Worker
// Enables PWA installability + offline shell support

const CACHE_NAME = 'cosmoshare-v1'

// Shell assets to pre-cache during install (app shell)
const PRECACHE_ASSETS = [
  '/',
  '/manifest.webmanifest',
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

// Activate — clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    })
  )
  // Take control of all clients immediately
  self.clients.claim()
})

// Fetch — network-first for pages, cache-first for static assets
self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  // Skip non-GET requests
  if (request.method !== 'GET') return

  // Skip WebSocket, socket.io, and API requests
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/socket.io') ||
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

  // HTML pages — network-first with cache fallback
  if (request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone()
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone))
          }
          return response
        })
        .catch(() => {
          return caches.match(request).then((cached) => {
            // Return cached page or fallback to cached homepage
            return cached || caches.match('/')
          })
        })
    )
    return
  }
})
