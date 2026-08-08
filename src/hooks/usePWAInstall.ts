'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

type InstallState = 'idle' | 'prompted' | 'accepted' | 'dismissed'

interface UsePWAInstallReturn {
  /** Whether the browser has a deferred install prompt ready */
  isInstallable: boolean
  /** Whether the app is already installed (running in standalone/twa mode) */
  isInstalled: boolean
  /** Whether the device is iOS (Safari — no native prompt, needs manual instructions) */
  isIOS: boolean
  /** Current install flow state */
  installState: InstallState
  /**
   * Trigger the native install prompt.
   * For admin installs, pass `manifestUrl` to temporarily swap the manifest
   * before prompting (e.g. '/manifest-admin.webmanifest').
   */
  promptInstall: (manifestUrl?: string) => Promise<void>
}

/**
 * Cross-platform PWA install hook.
 * Captures `beforeinstallprompt`, detects standalone mode, and handles
 * manifest-swapping for variant installs (e.g. admin PWA).
 */
export function usePWAInstall(): UsePWAInstallReturn {
  const [installState, setInstallState] = useState<InstallState>('idle')
  const [isInstallable, setIsInstallable] = useState(false)
  const [isInstalled, setIsInstalled] = useState(false)
  const [isIOS, setIsIOS] = useState(false)

  const deferredPromptRef = useRef<BeforeInstallPromptEvent | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return

    // Force installable for testing on localhost or ngrok
    const hostname = window.location.hostname
    if (hostname === 'localhost' || hostname.includes('ngrok')) {
      setIsInstallable(true)
    }

    // Detect iOS
    const ua = navigator.userAgent
    const isIOSDevice =
      /iPad|iPhone|iPod/.test(ua) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    setIsIOS(isIOSDevice)

    // Detect if already installed (standalone / twa / fullscreen)
    const checkInstalled = () => {
      const isStandalone =
        window.matchMedia('(display-mode: standalone)').matches ||
        window.matchMedia('(display-mode: fullscreen)').matches ||
        (window.navigator as any).standalone === true // Safari iOS
      setIsInstalled(isStandalone)
    }
    checkInstalled()

    // Listen for display-mode changes (user installs while page is open)
    const mq = window.matchMedia('(display-mode: standalone)')
    const handleDisplayChange = () => checkInstalled()
    mq.addEventListener('change', handleDisplayChange)

    // Capture beforeinstallprompt
    const handleBeforeInstall = (e: Event) => {
      e.preventDefault()
      deferredPromptRef.current = e as BeforeInstallPromptEvent
      setIsInstallable(true)
    }
    window.addEventListener('beforeinstallprompt', handleBeforeInstall)

    // Listen for successful install
    const handleAppInstalled = () => {
      setIsInstalled(true)
      setIsInstallable(false)
      setInstallState('accepted')
      deferredPromptRef.current = null
    }
    window.addEventListener('appinstalled', handleAppInstalled)

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall)
      window.removeEventListener('appinstalled', handleAppInstalled)
      mq.removeEventListener('change', handleDisplayChange)
    }
  }, [])

  const promptInstall = useCallback(async (manifestUrl?: string) => {
    // Swap manifest if a variant URL is provided (e.g. admin manifest)
    let originalHref: string | null = null
    let manifestLink: HTMLLinkElement | null = null

    if (manifestUrl) {
      manifestLink = document.querySelector('link[rel="manifest"]')
      if (manifestLink) {
        originalHref = manifestLink.getAttribute('href')
        manifestLink.setAttribute('href', manifestUrl)
        // Give the browser a tick to pick up the new manifest
        await new Promise((r) => setTimeout(r, 100))
      }
    }

    const restoreManifest = () => {
      if (manifestLink && originalHref !== null) {
        manifestLink.setAttribute('href', originalHref)
      }
    }

    if (!deferredPromptRef.current) {
      // If we forced the button to show for testing, alert the user
      const hostname = window.location.hostname
      if (hostname === 'localhost' || hostname.includes('ngrok')) {
        alert("The browser hasn't fired the native install prompt yet. You can still install the app via your browser's menu (e.g. 'Install App' or 'Add to Home Screen').")
      }
      restoreManifest()
      return
    }

    try {
      setInstallState('prompted')
      await deferredPromptRef.current.prompt()
      const { outcome } = await deferredPromptRef.current.userChoice

      if (outcome === 'accepted') {
        setInstallState('accepted')
        setIsInstallable(false)
        deferredPromptRef.current = null
      } else {
        setInstallState('dismissed')
      }
    } catch (err) {
      console.error('[PWA] Install prompt error:', err)
      setInstallState('idle')
    } finally {
      restoreManifest()
    }
  }, [])

  return {
    isInstallable,
    isInstalled,
    isIOS,
    installState,
    promptInstall,
  }
}
