'use client'

import { useEffect, useRef, useState } from 'react'
import { Html5Qrcode } from 'html5-qrcode'
import { Button } from '@/components/ui/button'
import { Camera, CameraOff, RotateCcw } from 'lucide-react'
import { cn } from '@/lib/utils'

interface QRCodeScannerProps {
    onScan: (result: string) => void
    onError?: (error: string) => void
    className?: string
}

export function QRCodeScanner({ onScan, onError, className }: QRCodeScannerProps) {
    const [isScanning, setIsScanning] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [hasPermission, setHasPermission] = useState<boolean | null>(null)
    const scannerRef = useRef<Html5Qrcode | null>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const scannedRef = useRef(false)

    const startScanner = async () => {
        if (!containerRef.current) return

        try {
            setError(null)
            scannedRef.current = false

            // Create scanner instance
            scannerRef.current = new Html5Qrcode('qr-reader')

            // Get available cameras
            const cameras = await Html5Qrcode.getCameras()

            if (cameras.length === 0) {
                setError('No camera found')
                setHasPermission(false)
                return
            }

            setHasPermission(true)

            // Prefer back camera on mobile
            const backCamera = cameras.find(c =>
                c.label.toLowerCase().includes('back') ||
                c.label.toLowerCase().includes('rear')
            )
            const cameraId = backCamera?.id || cameras[0].id

            await scannerRef.current.start(
                cameraId,
                {
                    fps: 10,
                    qrbox: { width: 250, height: 250 },
                    aspectRatio: 1.0,
                },
                (decodedText) => {
                    // Prevent multiple triggers
                    if (scannedRef.current) return
                    scannedRef.current = true

                    onScan(decodedText)
                    stopScanner()
                },
                () => {
                    // QR code not found - ignore
                }
            )

            setIsScanning(true)
        } catch (err: any) {
            console.error('Scanner error:', err)
            const errorMessage = err?.message || 'Failed to start camera'
            setError(errorMessage)
            onError?.(errorMessage)

            if (errorMessage.includes('permission') || errorMessage.includes('Permission')) {
                setHasPermission(false)
            }
        }
    }

    const stopScanner = async () => {
        if (scannerRef.current && isScanning) {
            try {
                await scannerRef.current.stop()
                scannerRef.current.clear()
            } catch (err) {
                console.error('Error stopping scanner:', err)
            }
        }
        setIsScanning(false)
    }

    useEffect(() => {
        return () => {
            // Cleanup on unmount
            if (scannerRef.current) {
                try {
                    scannerRef.current.stop()
                    scannerRef.current.clear()
                } catch (err) {
                    // Ignore cleanup errors
                }
            }
        }
    }, [])

    return (
        <div className={cn("flex flex-col items-center gap-4", className)}>
            {/* Scanner viewport */}
            <div
                ref={containerRef}
                className="relative w-full max-w-[300px] aspect-square rounded-2xl overflow-hidden bg-secondary"
            >
                <div id="qr-reader" className="w-full h-full" />

                {!isScanning && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-secondary">
                        <Camera className="w-16 h-16 text-muted-foreground" />
                        <p className="text-sm text-muted-foreground text-center px-4">
                            {hasPermission === false
                                ? 'Camera permission denied'
                                : 'Click Start to scan QR code'
                            }
                        </p>
                    </div>
                )}
            </div>

            {/* Error display */}
            {error && (
                <p className="text-sm text-destructive text-center">{error}</p>
            )}

            {/* Controls */}
            <div className="flex gap-2">
                {!isScanning ? (
                    <Button onClick={startScanner} className="gap-2">
                        <Camera className="w-4 h-4" />
                        Start Scanning
                    </Button>
                ) : (
                    <>
                        <Button onClick={stopScanner} variant="outline" className="gap-2">
                            <CameraOff className="w-4 h-4" />
                            Stop
                        </Button>
                        <Button onClick={() => { stopScanner(); startScanner(); }} variant="outline" className="gap-2">
                            <RotateCcw className="w-4 h-4" />
                            Retry
                        </Button>
                    </>
                )}
            </div>
        </div>
    )
}
