'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { Wifi, WifiOff, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ConnectionStatusBadgeProps {
    isOnline: boolean
    isConnecting?: boolean
    isSocketConnected?: boolean
    className?: string
    variant?: 'default' | 'minimal'
    size?: 'sm' | 'md'
}

export function ConnectionStatusBadge({
    isOnline,
    isConnecting = false,
    isSocketConnected = true,
    className,
    variant = 'default',
    size = 'sm'
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
                        "inline-flex items-center rounded-full font-medium",
                        size === 'sm' ? "gap-1.5 px-2.5 py-1 text-xs" : "gap-2 px-3 py-1.5 text-sm",
                        variant === 'default'
                            ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border border-red-200 dark:border-red-800"
                            : "bg-transparent text-red-600 dark:text-red-400 border-none p-0",
                        className
                    )}
                >
                    <WifiOff className={size === 'sm' ? "w-3.5 h-3.5" : "w-4 h-4"} />
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
                        "inline-flex items-center rounded-full font-medium",
                        size === 'sm' ? "gap-1.5 px-2.5 py-1 text-xs" : "gap-2 px-3 py-1.5 text-sm",
                        variant === 'default'
                            ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border border-amber-200 dark:border-amber-800"
                            : "bg-transparent text-amber-600 dark:text-amber-400 border-none p-0",
                        className
                    )}
                >
                    <Loader2 className={cn("animate-spin", size === 'sm' ? "w-3.5 h-3.5" : "w-4 h-4")} />
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
                        "inline-flex items-center rounded-full font-medium",
                        size === 'sm' ? "gap-1.5 px-2.5 py-1 text-xs" : "gap-2 px-3 py-1.5 text-sm",
                        variant === 'default'
                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800"
                            : "bg-transparent text-emerald-600 dark:text-emerald-400 border-none p-0",
                        className
                    )}
                >
                    <Wifi className={size === 'sm' ? "w-3.5 h-3.5" : "w-4 h-4"} />
                    <span>Online</span>
                </motion.div>
            )}
        </AnimatePresence>
    )
}
