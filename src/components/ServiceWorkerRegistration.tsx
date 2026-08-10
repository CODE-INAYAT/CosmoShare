'use client'

import { useEffect } from 'react'

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (
      typeof window !== 'undefined' &&
      'serviceWorker' in navigator
    ) {
      if (process.env.NODE_ENV !== 'production') {
        navigator.serviceWorker.getRegistrations().then((registrations) => {
          for (let registration of registrations) {
            registration.unregister()
            console.log('[PWA] Service Worker unregistered in development mode')
          }
        })
        return
      }

      // Register after page load to avoid competing with critical resources
      window.addEventListener('load', () => {
        navigator.serviceWorker
          .register('/sw.js', { scope: '/' })
          .then((registration) => {
            console.log('[PWA] Service Worker registered with scope:', registration.scope)

            // Auto-update: when a new SW is found, skip waiting and activate it
            registration.addEventListener('updatefound', () => {
              const newWorker = registration.installing
              if (newWorker) {
                newWorker.addEventListener('statechange', () => {
                  if (newWorker.state === 'installed') {
                    if (navigator.serviceWorker.controller) {
                      // New content available — tell the waiting SW to skip waiting
                      console.log('[PWA] New content available — activating new service worker')
                      newWorker.postMessage({ type: 'SKIP_WAITING' })
                    } else {
                      // First install — content cached for offline
                      console.log('[PWA] Content cached for offline use')
                    }
                  }
                })
              }
            })
          })
          .catch((error) => {
            console.error('[PWA] Service Worker registration failed:', error)
          })
      })

      // When a new SW takes over, reload the page for a clean state
      let refreshing = false
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!refreshing) {
          refreshing = true
          console.log('[PWA] New service worker activated — refreshing page')
          window.location.reload()
        }
      })
    }
  }, [])

  return null
}
