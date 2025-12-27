'use client'

import { useState, useEffect } from 'react'

interface NetworkStatus {
    isOnline: boolean
    wasOffline: boolean
}

/**
 * Hook to detect browser network online/offline status.
 * 
 * Note: This only tracks browser network status (navigator.onLine).
 * Socket connection status should be tracked separately and combined
 * in the UI component to determine actual connectivity.
 */
export function useNetworkStatus(): NetworkStatus {
    const [isOnline, setIsOnline] = useState(true)
    const [wasOffline, setWasOffline] = useState(false)

    useEffect(() => {
        // Set initial state based on browser's network status
        const online = typeof navigator !== 'undefined' ? navigator.onLine : true
        setIsOnline(online)
        if (!online) {
            setWasOffline(true)
        }

        const handleOnline = () => {
            console.log('[useNetworkStatus] Browser is online')
            setIsOnline(true)
        }

        const handleOffline = () => {
            console.log('[useNetworkStatus] Browser is offline')
            setIsOnline(false)
            setWasOffline(true)
        }

        window.addEventListener('online', handleOnline)
        window.addEventListener('offline', handleOffline)

        return () => {
            window.removeEventListener('online', handleOnline)
            window.removeEventListener('offline', handleOffline)
        }
    }, [])

    return { isOnline, wasOffline }
}
