'use client'

import { useState, useEffect, useRef, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { useTheme } from 'next-themes'
import { io } from 'socket.io-client'
import { useDropzone } from 'react-dropzone'
import { connectSignaling, SocketLike } from '@/lib/wsClient'
import { getOneShareSignalingUrl, getRandomOneShareShard, getOneShareShardIndex, generateOneShareCodeForShardIndex, generateOneShareCodeForSameShard } from '@/lib/signalingRouter'

// UI Components
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

// Custom Components
import { QRCodeDisplay } from '@/components/QRCodeDisplay'
import { QRCodeScanner } from '@/components/QRCodeScanner'
import { CodeInput, CodeInputRef } from '@/components/CodeInput'
import { ConnectionStatusBadge } from '@/components/ConnectionStatusBadge'
import { OfflineDialog } from '@/components/OfflineDialog'
import FullPageLoader from '@/components/FullPageLoader'

// Hooks
import { useOneShareWebRTC } from '@/hooks/useOneShareWebRTC'
import { useNetworkStatus } from '@/hooks/useNetworkStatus'

// Icons
import {
    Upload,
    Download,
    Send,
    QrCode,
    Hash,
    ArrowLeft,
    FileText,
    Link as LinkIcon,
    X,
    Loader2,
    CheckCircle2,
    Share2,
    Copy,
    Check,
    Wifi,
    WifiOff,
    Users,
    Sun,
    Moon,
    Sparkles,
    AlertCircle,
    Image as ImageIcon,
    Video,
    Music,
    FileArchive,
    File,
    Code as CodeIcon,
    ExternalLink,
    MessageCircle,
    Timer,
    StopCircle,
    UserPlus,
} from 'lucide-react'

// Helper to get icon by file type
const getFileIcon = (fileName: string) => {
    const ext = fileName.split('.').pop()?.toLowerCase() || ''
    switch (ext) {
        case 'jpg': case 'jpeg': case 'png': case 'gif': case 'webp': case 'svg': case 'bmp': return ImageIcon
        case 'mp4': case 'webm': case 'mov': case 'avi': case 'mkv': return Video
        case 'mp3': case 'wav': case 'ogg': case 'm4a': return Music
        case 'zip': case 'rar': case '7z': case 'tar': case 'gz': return FileArchive
        case 'pdf': case 'doc': case 'docx': case 'txt': case 'md': case 'rtf': return FileText
        case 'json': case 'js': case 'ts': case 'tsx': case 'jsx': case 'html': case 'css': return CodeIcon
        default: return File
    }
}

// Theme Toggle Component
function ThemeToggle() {
    const { resolvedTheme, setTheme } = useTheme()
    const [mounted, setMounted] = useState(false)

    useEffect(() => setMounted(true), [])

    if (!mounted) return (
        <div className="w-10 h-10 rounded-xl bg-secondary/50 animate-pulse" />
    )

    return (
        <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
            className="relative w-10 h-10 rounded-xl bg-secondary/80 hover:bg-secondary flex items-center justify-center transition-all duration-300 hover:shadow-lg hover:shadow-primary/20"
            aria-label="Toggle theme"
        >
            <AnimatePresence mode="wait">
                {resolvedTheme === 'dark' ? (
                    <motion.div
                        key="sun"
                        initial={{ rotate: -90, opacity: 0 }}
                        animate={{ rotate: 0, opacity: 1 }}
                        exit={{ rotate: 90, opacity: 0 }}
                        transition={{ duration: 0.3 }}
                    >
                        <Sun className="w-5 h-5 text-amber-400" />
                    </motion.div>
                ) : (
                    <motion.div
                        key="moon"
                        initial={{ rotate: 90, opacity: 0 }}
                        animate={{ rotate: 0, opacity: 1 }}
                        exit={{ rotate: -90, opacity: 0 }}
                        transition={{ duration: 0.3 }}
                    >
                        <Moon className="w-5 h-5 text-primary" />
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.button>
    )
}

// Format bytes helper
const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}


// Inner component that uses searchParams
function OneShareInner() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const [mounted, setMounted] = useState(false)
    const [isPageLoading, setIsPageLoading] = useState(true)

    // Network status
    const { isOnline } = useNetworkStatus()

    // Show loading screen for minimum 1 second
    useEffect(() => {
        const timer = setTimeout(() => {
            setIsPageLoading(false)
        }, 3000)
        return () => clearTimeout(timer)
    }, [])

    // Mode selection
    const [mode, setMode] = useState<'select' | 'send' | 'receive'>('select')
    const [receiveMethod, setReceiveMethod] = useState<'scan' | 'code'>('code')

    // Socket state
    const [socket, setSocket] = useState<any>(null)
    const [isConnected, setIsConnected] = useState(false)
    const socketRef = useRef<any>(null)

    // Session state
    const [sessionCode, setSessionCode] = useState<string | null>(null)
    const sessionCodeRef = useRef<string | null>(null)
    const [isWaitingForReceiver, setIsWaitingForReceiver] = useState(false)
    const [receiverConnected, setReceiverConnected] = useState(false)

    // Track which shard index we're currently connected to
    const currentShardIndexRef = useRef<number>(0)
    const pendingCreateDataRef = useRef<{ files: any[]; multiShare: boolean } | null>(null)
    const attemptedCodeRef = useRef<string | null>(null)

    // Sender state
    const [selectedFiles, setSelectedFiles] = useState<File[]>([])
    const [linkUrl, setLinkUrl] = useState('')
    const [message, setMessage] = useState('')
    const [codeShareText, setCodeShareText] = useState('')
    const [shareMode, setShareMode] = useState<'files' | 'links'>('files')
    const [codeShareMode, setCodeShareMode] = useState(false)
    const [multiShareEnabled, setMultiShareEnabled] = useState(false)
    const [sessionExpiry, setSessionExpiry] = useState<number | null>(null)
    const [sessionTimeLeft, setSessionTimeLeft] = useState<string>('')
    const [multiShareReceivers, setMultiShareReceivers] = useState<Array<{ id: string; status: 'connecting' | 'sending' | 'completed' | 'failed' }>>([])
    const [isUploading, setIsUploading] = useState(false)
    const [uploadProgress, setUploadProgress] = useState(0)
    const [transferComplete, setTransferComplete] = useState(false)

    // Receiver state
    const [enteredCode, setEnteredCode] = useState('')
    const [isJoining, setIsJoining] = useState(false)
    const [joinError, setJoinError] = useState<string | null>(null)
    const [isReceiving, setIsReceiving] = useState(false)
    const [receiveProgress, setReceiveProgress] = useState(0)
    const [receivedFiles, setReceivedFiles] = useState<Array<{ name: string; url: string; size: number; type: string }>>([])
    const [receiveComplete, setReceiveComplete] = useState(false)
    const [autoDownload, setAutoDownload] = useState(true)
    const [receivedMessage, setReceivedMessage] = useState<string | null>(null)
    const [messageDialogOpen, setMessageDialogOpen] = useState(false)
    const [messageCopied, setMessageCopied] = useState(false)

    // Individual file progress tracking for receiver (matching Lab Room)
    const [recvFileProgress, setRecvFileProgress] = useState<Record<string, {
        fileName: string
        fileType: string
        total: number
        received: number
        message?: string
    }>>({})

    // Smooth progress animation states (matching Lab Room exactly)
    const [uiUploadProgress, setUiUploadProgress] = useState(0)
    const [uiReceiveProgress, setUiReceiveProgress] = useState(0)
    const uiUploadProgressRef = useRef(0)
    const uiReceiveProgressRef = useRef(0)
    useEffect(() => { uiUploadProgressRef.current = uiUploadProgress }, [uiUploadProgress])
    useEffect(() => { uiReceiveProgressRef.current = uiReceiveProgress }, [uiReceiveProgress])

    // Force progress flags for smooth 100% completion
    const [forceUploadProgress, setForceUploadProgress] = useState(false)
    const [forceReceiveProgress, setForceReceiveProgress] = useState(false)
    const uploadStartAtRef = useRef<number | null>(null)
    const receiveStartAtRef = useRef<number | null>(null)

    // Cumulative byte tracking for accurate multi-file progress
    const totalBytesToSendRef = useRef(0)
    const bytesSentSoFarRef = useRef(0)
    const currentFileSizeRef = useRef(0)

    // CodeInput ref for reset on error
    const codeInputRef = useRef<CodeInputRef>(null)

    // Ensure UI progress visibly reaches 100% before showing success (matching Lab Room)
    const ensureUploadProgressComplete = async (minVisibleMs = 1000) => {
        const startedAt = uploadStartAtRef.current || performance.now()
        setForceUploadProgress(true)
        setIsUploading(true)
        setUploadProgress(100)
        return new Promise<void>((resolve) => {
            const check = () => {
                const elapsed = performance.now() - startedAt
                const uiDone = uiUploadProgressRef.current >= 99.8
                if (elapsed >= minVisibleMs && uiDone) {
                    resolve()
                } else {
                    requestAnimationFrame(check)
                }
            }
            requestAnimationFrame(check)
        })
    }

    // Copy state
    const [copied, setCopied] = useState(false)

    // Ref for MultiShare transfer function (avoid hoisting issues)
    const startMultiShareTransferRef = useRef<(receiverId: string) => Promise<void>>(async () => { })

    // WebRTC hook
    const webrtc = useOneShareWebRTC(
        socket,
        sessionCode || enteredCode || null,
        mode === 'send',
        {
            onConnect: () => {
                console.log('WebRTC connected')
                if (!multiShareEnabled) {
                    setReceiverConnected(true)
                    // Auto-start transfer after a short delay
                    if (mode === 'send') {
                        setTimeout(() => {
                            startTransfer()
                        }, 500)
                    }
                }
            },
            onReceiverConnected: (receiverId: string) => {
                console.log('MultiShare receiver connected:', receiverId)
                setMultiShareReceivers(prev => {
                    // Avoid duplicate entries if the same receiver reconnects
                    if (prev.some(r => r.id === receiverId)) {
                        // Reset existing entry to 'connecting' for a fresh transfer
                        return prev.map(r => r.id === receiverId ? { ...r, status: 'connecting' as const } : r)
                    }
                    return [...prev, { id: receiverId, status: 'connecting' as const }]
                })
                // Auto-start transfer to this receiver
                if (mode === 'send' && multiShareEnabled) {
                    setTimeout(() => {
                        startMultiShareTransferRef.current(receiverId)
                    }, 500)
                }
            },
            onReceiverDisconnected: (receiverId: string) => {
                console.log('MultiShare receiver disconnected:', receiverId)
                // Don't overwrite 'completed' status — receiver may have disconnected after a successful transfer
                setMultiShareReceivers(prev => prev.map(r => {
                    if (r.id === receiverId && r.status !== 'completed') {
                        return { ...r, status: 'failed' as const }
                    }
                    return r
                }))
            },
            onFileMetadata: (meta) => {
                console.log('Receiving file:', meta)
                setIsReceiving(true)
                // Add to individual file progress tracking - Logic matches Lab Room
                const key = `${meta.fileName}:${meta.fileSize}`
                setRecvFileProgress(prev => ({
                    ...prev,
                    [key]: {
                        fileName: meta.fileName,
                        fileType: meta.fileType,
                        total: meta.fileSize,
                        received: 0,
                        message: meta.message
                    }
                }))
                // Capture message from sender if present
                if (meta.message && meta.message.trim()) {
                    setReceivedMessage(meta.message)
                }
            },
            onFileChunk: (fileName, received, total) => {
                // Update the file that matches this total size - Logic matches Lab Room
                setRecvFileProgress(prev => {
                    const next = { ...prev }
                    const keys = Object.keys(next)
                    for (const k of keys) {
                        if (next[k].fileName === fileName && next[k].total === total) {
                            next[k] = { ...next[k], received }
                        }
                    }
                    return next
                })
            },
            onFileComplete: (fileUrl, meta) => {
                console.log('File received:', meta.fileName)
                // Remove from in-progress tracking - Logic matches Lab Room
                const key = `${meta.fileName}:${meta.fileSize}`
                setRecvFileProgress(prev => {
                    const { [key]: _, ...rest } = prev
                    return rest
                })
                // Add to completed files list
                const newFile = {
                    name: meta.fileName,
                    url: fileUrl,
                    size: meta.fileSize,
                    type: meta.fileType
                }
                setReceivedFiles(prev => [...prev, newFile])

                // Auto-download if enabled (for files, not links)
                if (autoDownload && meta.fileType !== 'link') {
                    const a = document.createElement('a')
                    a.href = fileUrl
                    a.download = meta.fileName
                    document.body.appendChild(a)
                    a.click()
                    document.body.removeChild(a)
                }
                // Don't set receiveComplete here - detected by useEffect
            },
            onLink: (linkUrl, msg) => {
                console.log('Link received:', linkUrl)
                setReceivedFiles(prev => [...prev, {
                    name: linkUrl,
                    url: linkUrl,
                    size: 0,
                    type: 'link'
                }])
                // Capture message from sender if present
                if (msg && msg.trim()) {
                    setReceivedMessage(msg)
                }
                // Don't set receiveComplete here - wait for sender signal
            },
            onMessage: (msg) => {
                console.log('Message received:', msg)
                if (msg && msg.trim()) {
                    setReceivedMessage(msg)
                }
                // Mark as complete for message-only transfers
                setIsReceiving(false)
                setReceiveComplete(true)
            },
            onSendStart: (fileName, total) => {
                // Track the current file size for cumulative calculation  
                currentFileSizeRef.current = total
                setIsUploading(true)
            },
            onSendProgress: (fileName, sent, total) => {
                // Calculate cumulative progress: bytes already completed + current file progress
                const cumulativeSent = bytesSentSoFarRef.current + sent
                const totalBytes = totalBytesToSendRef.current
                if (totalBytes > 0) {
                    const progress = Math.round((cumulativeSent / totalBytes) * 100)
                    setUploadProgress(Math.min(100, progress))
                }
            },
            onSendComplete: (fileName) => {
                // Add completed file size to cumulative total
                bytesSentSoFarRef.current += currentFileSizeRef.current
                console.log('File sent:', fileName, 'Total sent so far:', bytesSentSoFarRef.current)
            },
            onSendFailed: (fileName, reason) => {
                setIsUploading(false)
                setJoinError(reason || 'Transfer failed')
            },
        },
        multiShareEnabled,
    )

    useEffect(() => setMounted(true), [])

    // Keep sessionCodeRef in sync for use in socket event handlers (avoids stale closures)
    useEffect(() => {
        sessionCodeRef.current = sessionCode
    }, [sessionCode])

    // Smooth progress animation for upload (matching Lab Room exactly)
    useEffect(() => {
        // Only run when uploading or forcing progress to 100
        if (!isUploading && !forceUploadProgress) return
        let raf: number
        let running = true
        let last = performance.now()
        const tick = (now?: number) => {
            const t = now ?? performance.now()
            const dt = Math.min(100, Math.max(0, t - last)) // cap dt to avoid jumps
            last = t
            setUiUploadProgress(prev => {
                // Never go backwards - target is 100 when forcing, otherwise max of current and actual progress
                const target = forceUploadProgress ? 100 : Math.max(prev, uploadProgress)
                const diff = target - prev
                if (diff <= 0.05) return target
                // Time-based easing: base speed + proportional gain
                const basePerSec = 22 // minimum 22% per second
                const gain = 3.0      // accelerates when far from target
                const step = (basePerSec * (dt / 1000)) + diff * gain * (dt / 1000)
                const next = Math.min(prev + step, target)
                return Math.min(100, next)
            })
            if (running) raf = requestAnimationFrame(tick)
        }
        raf = requestAnimationFrame(tick)
        return () => { running = false; try { cancelAnimationFrame(raf) } catch { } }
    }, [isUploading, uploadProgress, forceUploadProgress])

    // Smooth progress animation for receive (matching Lab Room exactly)
    useEffect(() => {
        // Only run when receiving or forcing progress to 100
        if (!isReceiving && !forceReceiveProgress) return
        let raf: number
        let running = true
        let last = performance.now()
        const tick = (now?: number) => {
            const t = now ?? performance.now()
            const dt = Math.min(100, Math.max(0, t - last)) // cap dt to avoid jumps
            last = t
            setUiReceiveProgress(prev => {
                // Never go backwards - target is 100 when forcing, otherwise max of current and actual progress
                const target = forceReceiveProgress ? 100 : Math.max(prev, receiveProgress)
                const diff = target - prev
                if (diff <= 0.05) return target
                // Time-based easing: base speed + proportional gain
                const basePerSec = 22 // minimum 22% per second
                const gain = 3.0      // accelerates when far from target
                const step = (basePerSec * (dt / 1000)) + diff * gain * (dt / 1000)
                const next = Math.min(prev + step, target)
                return Math.min(100, next)
            })
            if (running) raf = requestAnimationFrame(tick)
        }
        raf = requestAnimationFrame(tick)
        return () => { running = false; try { cancelAnimationFrame(raf) } catch { } }
    }, [isReceiving, receiveProgress, forceReceiveProgress])

    // Detect receiver completion independently - when all files finish receiving
    // This removes dependency on sender's completion signal
    useEffect(() => {
        // If we have received files and no files are currently in progress, mark as complete
        if (receivedFiles.length > 0 && Object.keys(recvFileProgress).length === 0 && !receiveComplete) {
            // Small delay to ensure no more files are coming
            const timer = setTimeout(() => {
                console.log('Receiver detected completion - all files received!')
                setIsReceiving(false)
                setReceiveComplete(true)
            }, 500)
            return () => clearTimeout(timer)
        }
    }, [receivedFiles.length, recvFileProgress, receiveComplete])

    // Check for pre-filled code from URL (QR code scan)
    useEffect(() => {
        const codeParam = searchParams?.get('code')
        if (codeParam && codeParam.length === 4) {
            setMode('receive')
            setEnteredCode(codeParam)
            // Auto-join after socket connects
        }
    }, [searchParams])

    // Setup event listeners on a socket instance
    const setupSocketListeners = (sock: SocketLike | ReturnType<typeof io>) => {
        sock.on('connect', () => {
            console.log('OneShare socket connected')
            setIsConnected(true)
        })

        sock.on('disconnect', () => {
            console.log('OneShare socket disconnected')
            setIsConnected(false)
        })

        sock.on('oneshare-created', (data: { code: string }) => {
            console.log('Session created with code:', data?.code)
            setSessionCode(data?.code)
            setIsWaitingForReceiver(true)
            pendingCreateDataRef.current = null
        })

        sock.on('oneshare-code-taken', () => {
            // Code collision on this shard — retry with a new code on the same shard
            console.log('Code taken, retrying with new code on same shard...')
            const createData = pendingCreateDataRef.current
            if (!createData || !socketRef.current) return
            const newCode = generateOneShareCodeForShardIndex(currentShardIndexRef.current)
            attemptedCodeRef.current = newCode
            socketRef.current.emit('oneshare-create', {
                code: newCode,
                files: createData.files,
                multiShare: createData.multiShare
            })
        })

        sock.on('oneshare-receiver-joined', () => {
            console.log('Receiver connected!')
            // WebRTC will take over from here
        })

        sock.on('oneshare-joined', (data: { senderId: string; code: string }) => {
            console.log('Joined session:', data?.code)
            setIsJoining(false)
            setSessionCode(data?.code)
        })

        sock.on('oneshare-error', (data: { message: string }) => {
            setJoinError(data?.message)
            setIsJoining(false)
            // Reset and refocus the CodeInput on error so user can re-enter
            codeInputRef.current?.reset()
        })

        sock.on('oneshare-cancelled', (data: { reason?: string; code?: string }) => {
            // Only reset if the cancelled session matches our current session
            const cancelledCode = (data as any)?.code
            if (cancelledCode && sessionCodeRef.current && cancelledCode !== sessionCodeRef.current) {
                return // Ignore cancellation for a different session
            }
            setJoinError(data?.reason || 'Session ended')
            resetToSelect()
        })

        sock.on('oneshare-transfer-complete', () => {
            console.log('Transfer complete signal received from sender (backup)')
        })
    }

    // Connect to a specific shard URL, returns the socket
    const connectToShard = (url: string, shardIndex: number) => {
        // Disconnect existing socket if any
        if (socketRef.current) {
            try { socketRef.current.disconnect() } catch { }
        }

        const sock = connectSignaling(url)
        setupSocketListeners(sock)
        currentShardIndexRef.current = shardIndex
        socketRef.current = sock
        setSocket(sock)
        return sock
    }

    // Eagerly connect on page mount to a random shard
    useEffect(() => {
        if (!mounted) return

        const shard = getRandomOneShareShard()
        if (shard) {
            connectToShard(shard.url, shard.shardIndex)
        } else {
            // Fallback to local Socket.IO for development
            const sock = io({ path: '/api/socket/io' }) as any
            setupSocketListeners(sock)
            socketRef.current = sock
            setSocket(sock)
        }

        return () => {
            if (socketRef.current) {
                try { socketRef.current.disconnect() } catch { }
            }
        }
    }, [mounted])

    // Reconnect socket when network comes back online
    useEffect(() => {
        if (isOnline && !isConnected && socketRef.current && mounted) {
            console.log('[OneShare] Network back online, attempting socket reconnect...')
            const sock = socketRef.current
            // Check if socket is disconnected and try to reconnect
            if (sock && typeof sock.connect === 'function') {
                try {
                    sock.connect()
                } catch (e) {
                    console.error('[OneShare] Socket reconnect failed:', e)
                }
            }
        }
    }, [isOnline, isConnected, mounted])

    // Auto-join when code is entered from URL and socket is ready
    useEffect(() => {
        const codeParam = searchParams?.get('code')
        if (codeParam && codeParam.length === 4 && socket && isConnected && mode === 'receive') {
            handleJoinSession(codeParam)
        }
    }, [socket, isConnected, searchParams, mode])

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop: (acceptedFiles) => {
            setSelectedFiles(prev => [...prev, ...acceptedFiles])
        },
        multiple: true
    })

    const removeFile = (index: number) => {
        setSelectedFiles(prev => prev.filter((_, i) => i !== index))
    }

    const handleCreateSession = () => {
        if (!socket || !isConnected) {
            setJoinError('Not connected to server')
            return
        }

        if (selectedFiles.length === 0 && !linkUrl && (!codeShareText || !codeShareMode)) {
            setJoinError('Please select files, enter a link, or write code to share')
            return
        }

        // Create session with file info
        const files = selectedFiles.map(f => ({
            name: f.name,
            size: f.size,
            type: f.type
        }))

        // Generate code that maps to the shard we're already connected to — zero reconnection
        const code = generateOneShareCodeForShardIndex(currentShardIndexRef.current)
        attemptedCodeRef.current = code
        pendingCreateDataRef.current = { files, multiShare: multiShareEnabled }

        // Emit immediately — we're already connected to the right shard
        socket.emit('oneshare-create', { code, files, multiShare: multiShareEnabled })

        // Set session expiry timer (5 min for MultiShare, 10 min for regular)
        const ttl = multiShareEnabled ? 5 * 60 * 1000 : 10 * 60 * 1000
        setSessionExpiry(Date.now() + ttl)
    }

    const handleJoinSession = (code: string) => {
        if (code.length !== 4) {
            setJoinError('Please enter a valid 4-digit code')
            return
        }

        setIsJoining(true)
        setJoinError(null)
        setEnteredCode(code)

        const targetShardIndex = getOneShareShardIndex(code)

        if (targetShardIndex === currentShardIndexRef.current && socket && isConnected) {
            // Already on the correct shard — emit immediately
            socket.emit('oneshare-join', { code })
        } else {
            // Need to reconnect to a different shard
            const url = getOneShareSignalingUrl(code)
            if (url) {
                const sock = connectToShard(url, targetShardIndex)
                // Emit join once connected
                sock.on('connect', () => {
                    sock.emit('oneshare-join', { code })
                })
            } else {
                // Fallback (Socket.IO) — already connected, just emit
                socket?.emit('oneshare-join', { code })
            }
        }
    }

    const handleQRScan = (result: string) => {
        // Extract code from URL or use directly
        let code = result
        try {
            const url = new URL(result)
            const codeParam = url.searchParams.get('code')
            if (codeParam) {
                code = codeParam
            }
        } catch {
            // Not a URL, use as-is
        }

        if (code.length === 4 && /^\d{4}$/.test(code)) {
            handleJoinSession(code)
        }
    }

    const startTransfer = async () => {
        // Guard: MultiShare uses startMultiShareTransfer instead
        if (multiShareEnabled) {
            console.log('MultiShare enabled — skipping startTransfer (use startMultiShareTransfer)')
            return
        }
        // Use isConnectedNow() which checks the peer ref directly, bypassing React state timing
        if (!webrtc.isConnectedNow()) {
            console.log('Waiting for WebRTC connection...')
            return
        }

        console.log('Starting file transfer...')

        // Calculate total bytes for all files upfront
        const totalBytes = selectedFiles.reduce((sum, f) => sum + f.size, 0)
        totalBytesToSendRef.current = totalBytes
        bytesSentSoFarRef.current = 0
        currentFileSizeRef.current = 0

        // Track start time for smooth progress animation
        uploadStartAtRef.current = performance.now()

        setIsUploading(true)
        setUploadProgress(5) // Start at 5% so animation begins immediately
        setUiUploadProgress(0)
        setTransferComplete(false)
        setForceUploadProgress(false)

        try {
            // Send files - progress is handled in onSendProgress callback
            for (const file of selectedFiles) {
                await webrtc.sendFile(file, { message })
            }

            // Send link if present (links have no byte progress, so simulate it)
            if (linkUrl) {
                // For links, set progress to show activity
                if (selectedFiles.length === 0) {
                    setUploadProgress(50) // Links-only: set midway progress
                }
                await webrtc.sendLink(linkUrl, message)
                if (selectedFiles.length === 0) {
                    setUploadProgress(90) // Links completed
                }
            }

            // Send code if in code share mode with no files/links
            if (codeShareMode && selectedFiles.length === 0 && !linkUrl && codeShareText) {
                setUploadProgress(50)
                await webrtc.sendMessage(codeShareText)
                setUploadProgress(100)
            }

            // ALL files/links sent - wait for UI to smoothly reach 100%
            console.log('All transfers complete! Total bytes:', totalBytesToSendRef.current)
            await ensureUploadProgressComplete()

            // Now show success
            setForceUploadProgress(false)
            setIsUploading(false)
            setTransferComplete(true)
            // Notify server transfer is complete
            socket?.emit('oneshare-complete', { code: sessionCode })
        } catch (err) {
            console.error('Transfer error:', err)
            setForceUploadProgress(false)
            setIsUploading(false)
            setJoinError('Transfer failed')
        }
    }

    const resetToSelect = () => {
        setMode('select')
        setSessionCode(null)
        setEnteredCode('')
        setIsWaitingForReceiver(false)
        setReceiverConnected(false)
        setSelectedFiles([])
        setLinkUrl('')
        setMessage('')
        setCodeShareText('')
        setCodeShareMode(false)
        setMultiShareEnabled(false)
        setSessionExpiry(null)
        setSessionTimeLeft('')
        setMultiShareReceivers([])
        setIsUploading(false)
        setUploadProgress(0)
        setUiUploadProgress(0)
        setForceUploadProgress(false)
        setTransferComplete(false)
        setIsReceiving(false)
        setReceiveProgress(0)
        setUiReceiveProgress(0)
        setForceReceiveProgress(false)
        setReceivedFiles([])
        setRecvFileProgress({})
        setReceiveComplete(false)
        setJoinError(null)
        // Reset cumulative byte tracking and timing
        totalBytesToSendRef.current = 0
        bytesSentSoFarRef.current = 0
        currentFileSizeRef.current = 0
        uploadStartAtRef.current = null
        receiveStartAtRef.current = null
        webrtc.cleanup()

        // Only the sender should cancel the session on the server
        if (mode === 'send' && sessionCode && socket) {
            socket.emit('oneshare-cancel', { code: sessionCode })
        }

        // Reconnect to a fresh random shard so we're ready for next session
        const shard = getRandomOneShareShard()
        if (shard) {
            connectToShard(shard.url, shard.shardIndex)
        }
        // Clear sharding refs
        pendingCreateDataRef.current = null
        attemptedCodeRef.current = null
    }

    const copyCode = () => {
        if (sessionCode) {
            navigator.clipboard.writeText(sessionCode)
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
        }
    }

    // MultiShare: send all content to a specific receiver
    const startMultiShareTransfer = async (receiverId: string) => {
        // Update receiver status
        setMultiShareReceivers(prev => prev.map(r => r.id === receiverId ? { ...r, status: 'sending' as const } : r))

        try {
            const ok = await webrtc.sendToReceiver(
                receiverId,
                selectedFiles,
                linkUrl || undefined,
                (codeShareMode ? codeShareText : message) || undefined,
                codeShareMode,
                (sent, total) => {
                    // Could track per-receiver progress here if needed
                }
            )

            if (ok) {
                setMultiShareReceivers(prev => prev.map(r => r.id === receiverId ? { ...r, status: 'completed' as const } : r))
                // Notify server this specific receiver's transfer is complete
                socket?.emit('oneshare-complete', { code: sessionCode, receiverId })
            } else {
                setMultiShareReceivers(prev => prev.map(r => r.id === receiverId ? { ...r, status: 'failed' as const } : r))
            }
        } catch (err) {
            console.error('MultiShare transfer error for', receiverId, err)
            setMultiShareReceivers(prev => prev.map(r => r.id === receiverId ? { ...r, status: 'failed' as const } : r))
        }
    }
    // Keep ref in sync
    startMultiShareTransferRef.current = startMultiShareTransfer

    // Session countdown timer (works for both regular and MultiShare)
    useEffect(() => {
        if (!sessionExpiry || !sessionCode) {
            setSessionTimeLeft('')
            return
        }

        const update = () => {
            const remaining = sessionExpiry - Date.now()
            if (remaining <= 0) {
                setSessionTimeLeft('Expired')
                // Auto-cancel on expiry
                resetToSelect()
                return false
            }
            const mins = Math.floor(remaining / 60000)
            const secs = Math.floor((remaining % 60000) / 1000)
            setSessionTimeLeft(`${mins}:${secs.toString().padStart(2, '0')}`)
            return true
        }

        if (!update()) return

        const interval = setInterval(() => {
            if (!update()) clearInterval(interval)
        }, 1000)

        return () => clearInterval(interval)
    }, [sessionExpiry, sessionCode])

    const getShareUrl = () => {
        if (typeof window === 'undefined' || !sessionCode) return ''
        return `${window.location.origin}/oneshare?code=${sessionCode}`
    }

    const downloadFile = (file: { name: string; url: string; type: string }) => {
        if (file.type === 'link') {
            window.open(file.url, '_blank')
        } else {
            const a = document.createElement('a')
            a.href = file.url
            a.download = file.name
            document.body.appendChild(a)
            a.click()
            document.body.removeChild(a)
        }
    }

    if (!mounted || isPageLoading) return <FullPageLoader variant="oneshare" />

    return (
        <div className="min-h-screen bg-background text-foreground overflow-hidden relative transition-colors duration-500">
            {/* Animated Background */}
            <div className="fixed inset-0 overflow-hidden pointer-events-none">
                <div className="absolute inset-0 bg-mesh opacity-60" />
                <div className="absolute top-[-20%] left-[-10%] w-[600px] h-[600px] rounded-full bg-gradient-to-br from-emerald-500/20 to-teal-500/10 blur-[100px]" />
                <div className="absolute top-[40%] right-[-15%] w-[500px] h-[500px] rounded-full bg-gradient-to-br from-teal-500/15 to-cyan-500/10 blur-[80px]" />
                <div className="absolute inset-0 bg-grid-light dark:bg-grid-dark opacity-40" />
            </div>

            {/* Header */}
            <motion.nav
                initial={{ y: -20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ duration: 0.6 }}
                className="relative z-50 px-2 sm:px-4 py-3 sm:py-4"
            >
                <div className="max-w-7xl mx-auto">
                    <div className="glass rounded-2xl px-3 sm:px-6 py-2.5 sm:py-3 flex items-center justify-between">
                        <div className="flex items-center gap-1.5 sm:gap-3">
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => router.push('/')}
                                className="gap-1.5 sm:gap-2 px-2 sm:px-3"
                            >
                                <ArrowLeft className="w-4 h-4" />
                                <span className="hidden sm:inline">Home</span>
                            </Button>
                            <div className="h-6 w-px bg-border hidden sm:block" />
                            <div className="flex items-center gap-1.5 sm:gap-2">
                                <motion.div
                                    whileHover={{ rotate: 180, scale: 1.1 }}
                                    transition={{ duration: 0.4 }}
                                    className="w-7 h-7 sm:w-10 sm:h-10 rounded-xl gradient-primary flex items-center justify-center glow-sm"
                                >
                                    <Share2 className="w-3.5 h-3.5 sm:w-5 sm:h-5 text-white" />
                                </motion.div>
                                <span className="text-base sm:text-xl font-bold gradient-text">OneShare</span>
                            </div>
                        </div>

                        <div className="flex items-center gap-1.5 sm:gap-3">
                            <ConnectionStatusBadge
                                isOnline={isOnline}
                                isSocketConnected={isConnected}
                            />
                            <ThemeToggle />
                        </div>
                    </div>
                </div>
            </motion.nav>

            {/* Main Content */}
            <main className="relative pt-4 sm:pt-8 pb-12 px-4">
                <div className="max-w-2xl mx-auto">
                    <AnimatePresence mode="wait">
                        {/* Mode Selection */}
                        {mode === 'select' && (
                            <motion.div
                                key="select"
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -20 }}
                                className="space-y-6"
                            >
                                <div className="text-center mb-8">
                                    <h1 className="text-3xl sm:text-4xl font-bold mb-3">
                                        <span className="gradient-text">OneShare</span>
                                    </h1>
                                    <p className="text-muted-foreground">
                                        Share files instantly without joining a room
                                    </p>
                                </div>

                                <div className="grid sm:grid-cols-2 gap-4">
                                    <motion.button
                                        whileHover={{ scale: 1.02 }}
                                        whileTap={{ scale: 0.98 }}
                                        onClick={() => setMode('send')}
                                        className="glass-card rounded-2xl p-6 text-left transition-all duration-300 hover:ring-2 hover:ring-primary hover:shadow-lg hover:shadow-primary/20"
                                    >
                                        <div className="w-14 h-14 rounded-xl gradient-primary flex items-center justify-center mb-4 glow-sm">
                                            <Upload className="w-7 h-7 text-white" />
                                        </div>
                                        <h3 className="text-xl font-semibold text-foreground mb-2">Send</h3>
                                        <p className="text-sm text-muted-foreground">
                                            Share files or links. Get a code for the receiver.
                                        </p>
                                    </motion.button>

                                    <motion.button
                                        whileHover={{ scale: 1.02 }}
                                        whileTap={{ scale: 0.98 }}
                                        onClick={() => setMode('receive')}
                                        className="glass-card rounded-2xl p-6 text-left transition-all duration-300 hover:ring-2 hover:ring-primary hover:shadow-lg hover:shadow-primary/20"
                                    >
                                        <div className="w-14 h-14 rounded-xl gradient-primary flex items-center justify-center mb-4 glow-sm">
                                            <Download className="w-7 h-7 text-white" />
                                        </div>
                                        <h3 className="text-xl font-semibold text-foreground mb-2">Receive</h3>
                                        <p className="text-sm text-muted-foreground">
                                            Scan QR code or enter 4-digit code to receive.
                                        </p>
                                    </motion.button>
                                </div>
                            </motion.div>
                        )}

                        {/* Send Mode */}
                        {mode === 'send' && !sessionCode && (
                            <motion.div
                                key="send-setup"
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -20 }}
                            >
                                <Card className="glass-card border-0">
                                    <CardHeader>
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <CardTitle className="flex items-center gap-2 text-xl">
                                                    <Upload className="w-5 h-5" />
                                                    Send
                                                </CardTitle>
                                                <CardDescription>
                                                    Select files, enter a link, or send a message
                                                </CardDescription>
                                            </div>
                                            <Button variant="ghost" size="sm" onClick={resetToSelect}>
                                                <X className="w-4 h-4" />
                                            </Button>
                                        </div>
                                    </CardHeader>
                                    <CardContent className="space-y-6">
                                        {/* Code Share Toggle */}
                                        <div className="flex items-center justify-between p-3 bg-secondary/50 dark:bg-secondary/30 rounded-xl border border-border/50">
                                            <div className="flex items-center gap-3">
                                                <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-primary/30 to-primary/20 dark:from-primary/20 dark:to-primary/10 flex items-center justify-center">
                                                    <CodeIcon className="w-4 h-4 text-primary" />
                                                </div>
                                                <div>
                                                    <label htmlFor="code-share-toggle" className="text-sm font-medium cursor-pointer">
                                                        Code Share
                                                    </label>
                                                    <p className="text-xs text-muted-foreground">Send code snippet</p>
                                                </div>
                                            </div>
                                            <Switch
                                                id="code-share-toggle"
                                                checked={codeShareMode}
                                                onCheckedChange={setCodeShareMode}
                                            />
                                        </div>

                                        {/* MultiShare Toggle */}
                                        <div className="flex items-center justify-between p-3 bg-secondary/50 dark:bg-secondary/30 rounded-xl border border-border/50">
                                            <div className="flex items-center gap-3">
                                                <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-violet-500/30 to-violet-500/20 dark:from-violet-500/20 dark:to-violet-500/10 flex items-center justify-center">
                                                    <Users className="w-4 h-4 text-violet-500" />
                                                </div>
                                                <div>
                                                    <label htmlFor="multi-share-toggle" className="text-sm font-medium cursor-pointer">
                                                        MultiShare
                                                    </label>
                                                    <p className="text-xs text-muted-foreground">Multiple users can download (5 min)</p>
                                                </div>
                                            </div>
                                            <Switch
                                                id="multi-share-toggle"
                                                checked={multiShareEnabled}
                                                onCheckedChange={setMultiShareEnabled}
                                            />
                                        </div>

                                        <AnimatePresence mode="wait">
                                            {codeShareMode ? (
                                                /* Code Share Mode */
                                                <motion.div
                                                    key="code-share"
                                                    initial={{ opacity: 0, y: -10 }}
                                                    animate={{ opacity: 1, y: 0 }}
                                                    exit={{ opacity: 0, y: 10 }}
                                                    transition={{ duration: 0.2 }}
                                                    className="space-y-4"
                                                >
                                                    <div className="space-y-2">
                                                        <Label htmlFor="code-share-input">Your Code</Label>
                                                        <Textarea
                                                            id="code-share-input"
                                                            placeholder="Paste your code here..."
                                                            value={codeShareText}
                                                            onChange={(e) => setCodeShareText(e.target.value)}
                                                            rows={8}
                                                            className="max-h-64 overflow-y-auto resize-none bg-slate-800 text-slate-200 border-slate-600 placeholder:text-slate-500"
                                                            style={{ fontFamily: 'Consolas, Monaco, monospace' }}
                                                        />
                                                        <p className="text-xs text-muted-foreground">
                                                            Share code snippets directly without files
                                                        </p>
                                                    </div>
                                                </motion.div>
                                            ) : (
                                                /* Files/Links Mode */
                                                <motion.div
                                                    key="files-links"
                                                    initial={{ opacity: 0, y: -10 }}
                                                    animate={{ opacity: 1, y: 0 }}
                                                    exit={{ opacity: 0, y: 10 }}
                                                    transition={{ duration: 0.2 }}
                                                    className="space-y-6"
                                                >
                                                    {/* Tabs for files/links */}
                                                    <Tabs value={shareMode} onValueChange={(v) => setShareMode(v as any)}>
                                                        <TabsList className="grid w-full grid-cols-2">
                                                            <TabsTrigger value="files">Files</TabsTrigger>
                                                            <TabsTrigger value="links">Links</TabsTrigger>
                                                        </TabsList>

                                                        <TabsContent value="files" className="space-y-4 mt-4">
                                                            {/* Dropzone */}
                                                            <div
                                                                {...getRootProps()}
                                                                className={`dropzone p-8 text-center cursor-pointer border-2 border-dashed rounded-xl transition-all ${isDragActive ? 'border-primary bg-primary/5' : 'border-border'
                                                                    }`}
                                                            >
                                                                <input {...getInputProps()} />
                                                                <Upload className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                                                                {isDragActive ? (
                                                                    <p className="text-primary">Drop files here...</p>
                                                                ) : (
                                                                    <div>
                                                                        <p className="text-muted-foreground mb-1">
                                                                            Drag & drop files here, or click to select
                                                                        </p>
                                                                        <p className="text-xs text-muted-foreground">
                                                                            Multiple files supported
                                                                        </p>
                                                                    </div>
                                                                )}
                                                            </div>

                                                            {/* Selected files */}
                                                            {selectedFiles.length > 0 && (
                                                                <div className="space-y-2">
                                                                    <Label>
                                                                        Selected Files ({selectedFiles.length} total, {formatBytes(selectedFiles.reduce((sum, f) => sum + f.size, 0))})
                                                                    </Label>
                                                                    <div className="max-h-40 overflow-y-auto space-y-2">
                                                                        {selectedFiles.map((file, index) => (
                                                                            <div
                                                                                key={index}
                                                                                className="flex items-center justify-between p-2 bg-secondary/50 rounded-lg"
                                                                            >
                                                                                <div className="flex items-center gap-2 min-w-0">
                                                                                    <FileText className="w-4 h-4 flex-shrink-0" />
                                                                                    <span className="text-sm truncate">{file.name}</span>
                                                                                    <span className="text-xs text-muted-foreground flex-shrink-0">
                                                                                        ({formatBytes(file.size)})
                                                                                    </span>
                                                                                </div>
                                                                                <Button
                                                                                    variant="ghost"
                                                                                    size="sm"
                                                                                    onClick={() => removeFile(index)}
                                                                                >
                                                                                    <X className="w-4 h-4" />
                                                                                </Button>
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </TabsContent>

                                                        <TabsContent value="links" className="space-y-4 mt-4">
                                                            <div className="space-y-2">
                                                                <Label htmlFor="link">Share Link</Label>
                                                                <Input
                                                                    id="link"
                                                                    type="url"
                                                                    placeholder="https://..."
                                                                    value={linkUrl}
                                                                    onChange={(e) => setLinkUrl(e.target.value)}
                                                                />
                                                            </div>
                                                        </TabsContent>
                                                    </Tabs>

                                                    {/* Optional message */}
                                                    <div className="space-y-1">
                                                        <Label htmlFor="message">Message (Optional)</Label>
                                                        <Textarea
                                                            id="message"
                                                            placeholder="Add a message..."
                                                            value={message}
                                                            onChange={(e) => setMessage(e.target.value.slice(0, 200))}
                                                            maxLength={200}
                                                            rows={2}
                                                            className={`max-h-32 overflow-y-auto ${message.length >= 200 ? 'border-red-400 focus-visible:ring-red-400' : ''}`}
                                                        />
                                                        <span className={`text-xs text-right block ${message.length > 180 ? 'text-red-500' : 'text-muted-foreground'}`}>
                                                            {message.length}/200
                                                        </span>
                                                    </div>
                                                </motion.div>
                                            )}
                                        </AnimatePresence>

                                        {/* Error */}
                                        {joinError && (
                                            <div className="flex items-center gap-2 p-3 bg-destructive/10 text-destructive rounded-lg">
                                                <AlertCircle className="w-4 h-4" />
                                                <span className="text-sm">{joinError}</span>
                                            </div>
                                        )}

                                        {/* Generate Code Button */}
                                        <Button
                                            className="w-full gradient-primary text-white glow-button"
                                            disabled={!isConnected || (selectedFiles.length === 0 && !linkUrl && (!codeShareText || !codeShareMode))}
                                            onClick={handleCreateSession}
                                        >
                                            <Hash className="w-4 h-4 mr-2" />
                                            Generate Share Code
                                        </Button>
                                    </CardContent>
                                </Card>
                            </motion.div>
                        )}

                        {/* Send Mode - Waiting for Receiver */}
                        {mode === 'send' && sessionCode && (
                            <motion.div
                                key="send-waiting"
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -20 }}
                            >
                                <Card className="glass-card border-0">
                                    <CardHeader className="text-center">
                                        <CardTitle className="text-xl">
                                            {multiShareEnabled
                                                ? (multiShareReceivers.length > 0 ? 'MultiShare Active' : 'MultiShare — Waiting')
                                                : (transferComplete
                                                    ? 'Transfer Complete!'
                                                    : receiverConnected
                                                        ? 'Transferring...'
                                                        : 'Share These with Receiver')}
                                        </CardTitle>
                                        <CardDescription>
                                            {multiShareEnabled
                                                ? (multiShareReceivers.length > 0
                                                    ? `${multiShareReceivers.filter(r => r.status === 'completed').length} of ${multiShareReceivers.length} receivers completed`
                                                    : 'Share the code — multiple users can join')
                                                : (transferComplete
                                                    ? 'All files have been sent successfully'
                                                    : receiverConnected
                                                        ? 'Files are being sent...'
                                                        : 'Ask the receiver to scan QR code or enter the code')}
                                        </CardDescription>
                                        {/* Session Timer Badge — always for MultiShare, only while waiting for regular */}
                                        {sessionTimeLeft && (multiShareEnabled || !receiverConnected) && (
                                            <div className="flex justify-center mt-2">
                                                <Badge variant="outline" className={`gap-1.5 px-3 py-1 text-sm font-mono ${sessionTimeLeft === 'Expired' ? 'text-destructive border-destructive' : 'text-violet-500 border-violet-500/40'}`}>
                                                    <Timer className="w-3.5 h-3.5" />
                                                    {sessionTimeLeft}
                                                </Badge>
                                            </div>
                                        )}
                                    </CardHeader>
                                    <CardContent className="space-y-6">
                                        {(multiShareEnabled || !receiverConnected) ? (
                                            <>
                                                {/* QR Code */}
                                                <div className="flex justify-center">
                                                    <QRCodeDisplay value={getShareUrl()} size={180} />
                                                </div>

                                                {/* Code Display */}
                                                <div className="text-center">
                                                    <Label className="text-muted-foreground mb-2 block">Or enter this code:</Label>
                                                    <div className="flex items-center justify-center gap-2">
                                                        <span className="text-4xl font-bold tracking-widest gradient-text">
                                                            {sessionCode}
                                                        </span>
                                                        <Button variant="ghost" size="sm" onClick={copyCode}>
                                                            {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                                                        </Button>
                                                    </div>
                                                </div>

                                                {/* MultiShare Receiver List */}
                                                {multiShareEnabled && multiShareReceivers.length > 0 && (
                                                    <div className="p-4 bg-secondary/30 rounded-xl space-y-2">
                                                        <Label className="text-xs text-muted-foreground mb-1 block flex items-center gap-1.5">
                                                            <Users className="w-3 h-3" />
                                                            Receivers ({multiShareReceivers.length})
                                                        </Label>
                                                        <div className="space-y-1.5 max-h-32 overflow-y-auto">
                                                            {multiShareReceivers.map((r, i) => (
                                                                <div key={`${r.id}-${i}`} className="flex items-center justify-between text-sm p-2 bg-background/40 rounded-lg">
                                                                    <div className="flex items-center gap-2">
                                                                        <UserPlus className="w-3.5 h-3.5 text-muted-foreground" />
                                                                        <span className="text-muted-foreground">User {i + 1}</span>
                                                                    </div>
                                                                    <Badge
                                                                        variant="outline"
                                                                        className={`text-xs ${r.status === 'completed' ? 'text-emerald-500 border-emerald-500/40' :
                                                                            r.status === 'sending' ? 'text-blue-500 border-blue-500/40' :
                                                                                r.status === 'failed' ? 'text-destructive border-destructive/40' :
                                                                                    'text-muted-foreground border-border'
                                                                            }`}
                                                                    >
                                                                        {r.status === 'completed' && <CheckCircle2 className="w-3 h-3 mr-1" />}
                                                                        {r.status === 'sending' && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
                                                                        {r.status === 'connecting' && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
                                                                        {r.status === 'failed' && <AlertCircle className="w-3 h-3 mr-1" />}
                                                                        {r.status}
                                                                    </Badge>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}

                                                {/* Waiting indicator (only for non-MultiShare or when no receivers yet) */}
                                                {(!multiShareEnabled || multiShareReceivers.length === 0) && (
                                                    <div className="flex items-center justify-center gap-2 text-muted-foreground">
                                                        <Loader2 className="w-4 h-4 animate-spin" />
                                                        <span className="text-sm">Waiting for receiver to connect...</span>
                                                    </div>
                                                )}

                                                {/* Files being shared */}
                                                {selectedFiles.length > 0 && (
                                                    <div className="p-4 bg-secondary/30 rounded-xl">
                                                        <Label className="text-xs text-muted-foreground mb-2 block">Sharing:</Label>
                                                        <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
                                                            {selectedFiles.map((file, i) => {
                                                                const Icon = getFileIcon(file.name)
                                                                return (
                                                                    <div key={i} className="text-sm flex items-center gap-2">
                                                                        <Icon className="w-3 h-3 flex-shrink-0" />
                                                                        <span className="truncate">{file.name}</span>
                                                                        <span className="text-xs text-muted-foreground flex-shrink-0">
                                                                            ({formatBytes(file.size)})
                                                                        </span>
                                                                    </div>
                                                                )
                                                            })}
                                                            {linkUrl && (
                                                                <div className="text-sm flex items-center gap-2">
                                                                    <LinkIcon className="w-3 h-3 flex-shrink-0" />
                                                                    <span className="truncate">{linkUrl}</span>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                )}
                                            </>
                                        ) : (
                                            <>
                                                {/* Circular Progress / Success */}
                                                <div className="flex flex-col items-center gap-6">
                                                    <div className="relative">
                                                        {transferComplete ? (
                                                            <motion.div
                                                                initial={{ scale: 0 }}
                                                                animate={{ scale: 1 }}
                                                                className="w-20 h-20 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center glow-md shadow-lg shadow-emerald-500/20"
                                                            >
                                                                <CheckCircle2 className="w-10 h-10 text-white" />
                                                            </motion.div>
                                                        ) : (
                                                            <>
                                                                <svg className="w-32 h-32 -rotate-90" viewBox="0 0 100 100">
                                                                    <circle cx="50" cy="50" r="46" className="stroke-primary/20" strokeWidth="6" fill="none" />
                                                                    <circle
                                                                        cx="50"
                                                                        cy="50"
                                                                        r="46"
                                                                        className="stroke-primary transition-all duration-300"
                                                                        strokeWidth="6"
                                                                        strokeLinecap="round"
                                                                        fill="none"
                                                                        strokeDasharray={2 * Math.PI * 46}
                                                                        strokeDashoffset={(1 - uiUploadProgress / 100) * 2 * Math.PI * 46}
                                                                    />
                                                                </svg>
                                                                <div className="absolute inset-0 flex flex-col items-center justify-center">
                                                                    <div className="text-2xl font-bold text-primary">{Math.round(uiUploadProgress)}%</div>
                                                                </div>
                                                            </>
                                                        )}
                                                    </div>
                                                    {transferComplete && (
                                                        <p className="text-center text-lg font-semibold text-emerald-600 dark:text-emerald-400">
                                                            {codeShareMode && selectedFiles.length === 0 && !linkUrl
                                                                ? 'Code Transferred!'
                                                                : 'Files Transferred!'}
                                                        </p>
                                                    )}
                                                </div>

                                                <div className="space-y-2">
                                                    <Label className="text-xs text-muted-foreground">
                                                        {codeShareMode && selectedFiles.length === 0 && !linkUrl
                                                            ? (transferComplete ? 'Code Sent:' : 'Sending:')
                                                            : (transferComplete ? 'Files Sent:' : 'Sending:')}
                                                    </Label>
                                                    <div className="space-y-2 max-h-48 overflow-y-auto">
                                                        {/* Show code for code share mode */}
                                                        {codeShareMode && selectedFiles.length === 0 && !linkUrl && codeShareText && (
                                                            <div className="flex items-center gap-3 p-3 bg-slate-800 rounded-xl border border-slate-600">
                                                                <CodeIcon className="w-5 h-5 text-sky-400 flex-shrink-0" />
                                                                <div className="min-w-0 flex-1">
                                                                    <pre className="text-sm font-medium line-clamp-2 text-slate-200" style={{ fontFamily: 'Consolas, Monaco, monospace' }}>{codeShareText}</pre>
                                                                </div>
                                                                {transferComplete && <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />}
                                                            </div>
                                                        )}
                                                        {/* Show files */}
                                                        {selectedFiles.map((file, i) => {
                                                            const Icon = getFileIcon(file.name)
                                                            return (
                                                                <div key={i} className="flex items-center gap-3 p-3 bg-secondary/50 rounded-xl">
                                                                    <Icon className="w-5 h-5 text-primary flex-shrink-0" />
                                                                    <div className="min-w-0 flex-1">
                                                                        <p className="text-sm font-medium truncate">{file.name}</p>
                                                                        <p className="text-xs text-muted-foreground">{formatBytes(file.size)}</p>
                                                                    </div>
                                                                    {transferComplete && <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />}
                                                                </div>
                                                            )
                                                        })}
                                                        {linkUrl && (
                                                            <div className="flex items-center gap-3 p-3 bg-secondary/50 rounded-xl">
                                                                <LinkIcon className="w-5 h-5 text-primary flex-shrink-0" />
                                                                <div className="min-w-0 flex-1">
                                                                    <p className="text-sm font-medium truncate">{linkUrl}</p>
                                                                </div>
                                                                {transferComplete && <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </>
                                        )}

                                        <Button
                                            variant={transferComplete ? "default" : multiShareEnabled ? "destructive" : "outline"}
                                            className={`w-full ${transferComplete && !multiShareEnabled ? 'gradient-primary text-white' : ''}`}
                                            onClick={resetToSelect}
                                        >
                                            {multiShareEnabled ? (
                                                <><StopCircle className="w-4 h-4 mr-2" /> Stop Sharing</>
                                            ) : (
                                                transferComplete ? 'Share More' : 'Cancel'
                                            )}
                                        </Button>
                                    </CardContent>
                                </Card>
                            </motion.div>
                        )}

                        {/* Receive Mode */}
                        {mode === 'receive' && !sessionCode && (
                            <motion.div
                                key="receive"
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -20 }}
                            >
                                <Card className="glass-card border-0">
                                    <CardHeader>
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <CardTitle className="flex items-center gap-2 text-xl">
                                                    <Download className="w-5 h-5" />
                                                    Receive Files
                                                </CardTitle>
                                                <CardDescription>
                                                    Scan QR code or enter the 4-digit code
                                                </CardDescription>
                                            </div>
                                            <Button variant="ghost" size="sm" onClick={resetToSelect}>
                                                <X className="w-4 h-4" />
                                            </Button>
                                        </div>
                                    </CardHeader>
                                    <CardContent className="space-y-6">
                                        <Tabs value={receiveMethod} onValueChange={(v) => setReceiveMethod(v as any)}>
                                            <TabsList className="grid w-full grid-cols-2">
                                                <TabsTrigger value="code" className="gap-2">
                                                    <Hash className="w-4 h-4" />
                                                    Enter Code
                                                </TabsTrigger>
                                                <TabsTrigger value="scan" className="gap-2">
                                                    <QrCode className="w-4 h-4" />
                                                    Scan QR
                                                </TabsTrigger>
                                            </TabsList>

                                            <TabsContent value="code" className="mt-6">
                                                <div className="space-y-6">
                                                    <div className="text-center">
                                                        <Label className="text-muted-foreground mb-4 block">
                                                            Enter the 4-digit code
                                                        </Label>
                                                        <CodeInput
                                                            ref={codeInputRef}
                                                            onComplete={handleJoinSession}
                                                            disabled={isJoining}
                                                        />
                                                    </div>
                                                </div>
                                            </TabsContent>

                                            <TabsContent value="scan" className="mt-6">
                                                <QRCodeScanner
                                                    onScan={handleQRScan}
                                                    onError={(err) => setJoinError(err)}
                                                />
                                            </TabsContent>
                                        </Tabs>

                                        {/* Auto-download checkbox */}
                                        <div className="flex items-center gap-3 p-3 bg-secondary/30 rounded-xl">
                                            <Checkbox
                                                id="auto-download"
                                                checked={autoDownload}
                                                onCheckedChange={(checked) => setAutoDownload(checked === true)}
                                                className="rounded-full"
                                            />
                                            <label
                                                htmlFor="auto-download"
                                                className="text-sm cursor-pointer select-none"
                                            >
                                                Auto-download files after receiving
                                            </label>
                                        </div>

                                        {/* Error */}
                                        {joinError && (
                                            <div className="flex items-center gap-2 p-3 bg-destructive/10 text-destructive rounded-lg">
                                                <AlertCircle className="w-4 h-4" />
                                                <span className="text-sm">{joinError}</span>
                                            </div>
                                        )}

                                        {/* Joining indicator */}
                                        {isJoining && (
                                            <div className="flex items-center justify-center gap-2">
                                                <Loader2 className="w-4 h-4 animate-spin" />
                                                <span className="text-sm text-muted-foreground">Connecting...</span>
                                            </div>
                                        )}
                                    </CardContent>
                                </Card>
                            </motion.div>
                        )}

                        {/* Receive Mode - Receiving */}
                        {mode === 'receive' && sessionCode && (
                            <motion.div
                                key="receive-progress"
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -20 }}
                            >
                                <Card className="glass-card border-0">

                                    <CardContent className="space-y-6">
                                        {/* Success checkmark when complete */}
                                        {receiveComplete && (
                                            <div className="flex flex-col items-center gap-4 py-2">
                                                <motion.div
                                                    initial={{ scale: 0 }}
                                                    animate={{ scale: 1 }}
                                                    className="w-20 h-20 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center glow-md shadow-lg shadow-emerald-500/20"
                                                >
                                                    <CheckCircle2 className="w-10 h-10 text-white" />
                                                </motion.div>
                                                <p className="text-center text-lg font-semibold text-emerald-600 dark:text-emerald-400">
                                                    {receivedFiles.length === 0 && receivedMessage
                                                        ? 'Message Received!'
                                                        : 'Files Received!'}
                                                </p>

                                                {/* Click to see received message/code */}
                                                {receivedMessage && (
                                                    <motion.button
                                                        initial={{ opacity: 0, y: 10 }}
                                                        animate={{ opacity: 1, y: 0 }}
                                                        transition={{ delay: 0.3 }}
                                                        onClick={() => setMessageDialogOpen(true)}
                                                        className="flex items-center gap-2 px-4 py-2 mt-2 rounded-full bg-primary/10 hover:bg-primary/20 border border-primary/30 transition-all duration-300 group"
                                                    >
                                                        {receivedFiles.length === 0 ? (
                                                            <CodeIcon className="w-4 h-4 text-primary group-hover:scale-110 transition-transform" />
                                                        ) : (
                                                            <MessageCircle className="w-4 h-4 text-primary group-hover:scale-110 transition-transform" />
                                                        )}
                                                        <span className="text-sm text-primary font-medium">
                                                            {receivedFiles.length === 0
                                                                ? 'Click here to see the code'
                                                                : 'Click here to see attached message'}
                                                        </span>
                                                    </motion.button>
                                                )}
                                            </div>
                                        )}

                                        {/* Code Dialog */}
                                        <Dialog open={messageDialogOpen} onOpenChange={setMessageDialogOpen}>
                                            <DialogContent className="sm:max-w-2xl">
                                                <DialogHeader>
                                                    <DialogTitle className="flex items-center gap-2">
                                                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary/20 to-primary/10 flex items-center justify-center">
                                                            {receivedFiles.length === 0
                                                                ? <CodeIcon className="w-5 h-5 text-primary" />
                                                                : <MessageCircle className="w-5 h-5 text-primary" />}
                                                        </div>
                                                        {receivedFiles.length === 0 ? 'Code from Sender' : 'Message from Sender'}
                                                    </DialogTitle>
                                                    <DialogDescription>
                                                        {receivedFiles.length === 0
                                                            ? 'The sender shared this code snippet'
                                                            : 'The sender included this message with the shared content'}
                                                    </DialogDescription>
                                                </DialogHeader>
                                                <div className={`mt-4 p-4 rounded-xl border max-h-80 overflow-y-auto ${
                                                    receivedFiles.length === 0
                                                        ? 'bg-slate-800 border-slate-600'
                                                        : 'bg-secondary/50 border-border'
                                                }`}>
                                                    <pre className={`whitespace-pre-wrap leading-relaxed text-sm ${
                                                        receivedFiles.length === 0
                                                            ? 'text-slate-200'
                                                            : 'text-foreground'
                                                    }`} style={{ fontFamily: receivedFiles.length === 0 ? 'Consolas, Monaco, monospace' : 'inherit' }}>
                                                        {receivedMessage}
                                                    </pre>
                                                </div>
                                                <div className="mt-4 flex justify-center gap-3">
                                                    <Button
                                                        variant="outline"
                                                        onClick={() => {
                                                            if (receivedMessage) {
                                                                navigator.clipboard.writeText(receivedMessage)
                                                                setMessageCopied(true)
                                                                setTimeout(() => setMessageCopied(false), 2000)
                                                            }
                                                        }}
                                                        className="gap-2"
                                                    >
                                                        {messageCopied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                                                        {messageCopied ? 'Copied!' : (receivedFiles.length === 0 ? 'Copy Code' : 'Copy Message')}
                                                    </Button>
                                                    <Button onClick={() => setMessageDialogOpen(false)}>
                                                        Done
                                                    </Button>
                                                </div>
                                            </DialogContent>
                                        </Dialog>

                                        {/* Individual file progress bars (when receiving) */}
                                        {!receiveComplete && Object.keys(recvFileProgress).length > 0 && (
                                            <div className="space-y-3">
                                                <Label className="text-xs text-muted-foreground">Receiving Files:</Label>
                                                {Object.values(recvFileProgress).map((p, idx) => {
                                                    const Icon = getFileIcon(p.fileName)
                                                    return (
                                                        <div key={idx} className="overflow-hidden rounded-xl border border-border bg-secondary/30 p-3">
                                                            <div className="flex items-start gap-3">
                                                                <Icon className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                                                                <div className="flex-1 min-w-0">
                                                                    <p className="text-sm font-medium truncate" title={p.fileName}>{p.fileName}</p>
                                                                    <div className="mt-2 h-2 w-full rounded-full bg-neutral-200 dark:bg-neutral-700 overflow-hidden">
                                                                        {(() => {
                                                                            const pct = p.total ? Math.min(100, (p.received / p.total) * 100) : 0
                                                                            return <div style={{ width: pct + '%' }} className="h-full bg-[var(--primary)] transition-[width] duration-200 ease-out" />
                                                                        })()}
                                                                    </div>
                                                                    <div className="mt-1 text-[11px] text-muted-foreground flex justify-between">
                                                                        <span>{p.total ? Math.round((p.received / p.total) * 100) : 0}%</span>
                                                                        <span>{formatBytes(p.received)} / {formatBytes(p.total)}</span>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    )
                                                })}
                                            </div>
                                        )}

                                        {/* Waiting indicator */}
                                        {!receiveComplete && Object.keys(recvFileProgress).length === 0 && !isReceiving && (
                                            <div className="flex flex-col items-center gap-4 py-4">
                                                <div className="w-20 h-20 rounded-full bg-secondary/50 flex items-center justify-center">
                                                    <Loader2 className="w-8 h-8 animate-spin text-primary" />
                                                </div>
                                                <p className="text-sm text-muted-foreground">Waiting for files...</p>
                                            </div>
                                        )}

                                        {/* Received files */}
                                        {receivedFiles.length > 0 && (
                                            <div className="space-y-2">
                                                <Label className="text-xs text-muted-foreground">Received Files:</Label>
                                                <div className="space-y-2 max-h-48 overflow-y-auto">
                                                    {receivedFiles.map((file, index) => {
                                                        const Icon = file.type === 'link' ? LinkIcon : getFileIcon(file.name)
                                                        return (
                                                            <div
                                                                key={index}
                                                                className="flex items-center justify-between p-3 bg-secondary/50 rounded-xl"
                                                            >
                                                                <div className="flex items-center gap-3 min-w-0">
                                                                    <Icon className="w-5 h-5 text-primary flex-shrink-0" />
                                                                    <div className="min-w-0">
                                                                        <p className="text-sm font-medium truncate">{file.name}</p>
                                                                        {file.size > 0 && (
                                                                            <p className="text-xs text-muted-foreground">{formatBytes(file.size)}</p>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                                <Button
                                                                    size="sm"
                                                                    onClick={() => downloadFile(file)}
                                                                    className="gap-1 flex-shrink-0"
                                                                >
                                                                    {file.type === 'link' ? <ExternalLink className="w-4 h-4" /> : <Download className="w-4 h-4" />}
                                                                    {file.type === 'link' ? 'Open' : 'Save'}
                                                                </Button>
                                                            </div>
                                                        )
                                                    })}
                                                </div>
                                            </div>
                                        )}

                                        <Button
                                            variant={receiveComplete ? "default" : "outline"}
                                            className={`w-full ${receiveComplete ? 'gradient-primary text-white' : ''}`}
                                            onClick={resetToSelect}
                                        >
                                            {receiveComplete ? 'Receive More' : 'Cancel'}
                                        </Button>
                                    </CardContent>
                                </Card>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </main >

            {/* Offline Dialog */}
            <OfflineDialog isOnline={isOnline} />
        </div >
    )
}


// Main export with Suspense wrapper for useSearchParams

export default function OneSharePage() {
    return (
        <Suspense fallback={<FullPageLoader variant="oneshare" />}>
            <OneShareInner />
        </Suspense>
    )
}
