'use client'

import { useEffect, useState } from 'react'
import {
    AlertDialog,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { WifiOff, Loader2 } from 'lucide-react'

interface OfflineDialogProps {
    isOnline: boolean
}

export function OfflineDialog({ isOnline }: OfflineDialogProps) {
    const [open, setOpen] = useState(false)

    useEffect(() => {
        // Show dialog when going offline
        if (!isOnline) {
            setOpen(true)
        } else {
            setOpen(false)
        }
    }, [isOnline])

    return (
        <AlertDialog open={open} onOpenChange={setOpen}>
            <AlertDialogContent className="sm:max-w-md">
                <AlertDialogHeader>
                    <div className="flex items-center gap-3 mb-2">
                        <div className="w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                            <WifiOff className="w-6 h-6 text-red-600 dark:text-red-400" />
                        </div>
                        <AlertDialogTitle className="text-xl">You&apos;re Offline</AlertDialogTitle>
                    </div>
                    <AlertDialogDescription className="text-base">
                        It looks like you&apos;ve lost your internet connection. File sharing requires an active connection to work.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <div className="py-4">
                    <p className="text-sm text-muted-foreground">
                        Please check your internet connection. The app will automatically reconnect when you&apos;re back online.
                    </p>
                </div>
                <div className="flex items-center justify-center gap-3">
                    <Button variant="outline" onClick={() => setOpen(false)}>
                        Dismiss
                    </Button>
                    <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border border-amber-200 dark:border-amber-800">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Connecting...</span>
                    </div>
                </div>
            </AlertDialogContent>
        </AlertDialog>
    )
}
