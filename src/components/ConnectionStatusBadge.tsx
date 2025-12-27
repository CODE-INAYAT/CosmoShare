'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { Wifi, WifiOff, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ConnectionStatusBadgeProps {
    isOnline: boolean
    isConnecting?: boolean
    isSocketConnected?: boolean
    className?: string
}

export function ConnectionStatusBadge({
    isOnline,
    isConnecting = false,
    isSocketConnected = true,
    className
}: ConnectionStatusBadgeProps) {
    // Determine the actual status
    const showConnecting = isConnecting || (!isSocketConnected && isOnline)
    const showOffline = !isOnline
    const showOnline = isOnline && isSocketConnected && !isConnecting

    return (
        <AnimatePresence mode="wait">
            {showOffline && (
                <motion.div
                    key="offline"
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    className={cn(
                        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium",
                        "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
                        "border border-red-200 dark:border-red-800",
                        className
                    )}
                >
                    <WifiOff className="w-3.5 h-3.5" />
                    <span>Offline</span>
                </motion.div>
            )}

            {showConnecting && (
                <motion.div
                    key="connecting"
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    className={cn(
                        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium",
                        "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
                        "border border-amber-200 dark:border-amber-800",
                        className
                    )}
                >
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Connecting...</span>
                </motion.div>
            )}

            {showOnline && (
                <motion.div
                    key="online"
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    className={cn(
                        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium",
                        "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
                        "border border-emerald-200 dark:border-emerald-800",
                        className
                    )}
                >
                    <Wifi className="w-3.5 h-3.5" />
                    <span>Online</span>
                </motion.div>
            )}
        </AnimatePresence>
    )
}
