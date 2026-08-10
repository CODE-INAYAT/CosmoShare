"use client"

import { generateGradient } from '@/lib/avatarUtils'
import { useState, useEffect, useRef, Suspense, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useTheme } from 'next-themes'
import Image from 'next/image'
import NumberFlow from '@number-flow/react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { roomNumbers } from '@/config/rooms'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import {
  Printer,
  Users,
  FileText,
  Link,
  Wifi,
  WifiOff,
  Download,
  Eye,
  Check,
  X,
  RefreshCw,
  Folder,
  MessageSquare,
  Clock,
  Filter,
  Search,
  Plus,
  ArrowDown,
  ArrowRight,
  LogOut,
  AlertTriangle,
  Lock,
  Monitor,
  ChevronDown,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ArrowLeft,
  HelpCircle,
  Sun,
  Moon
} from 'lucide-react'
import { useSearchParams, useRouter } from 'next/navigation'
import { io } from 'socket.io-client'
import { connectSignaling } from '@/lib/wsClient'
import { getLabSignalingUrls } from '@/lib/signalingRouter'
import { useWebRTC } from '@/hooks/useWebRTC'
import { useSmartPrefill } from '@/hooks/useSmartPrefill'
import FilePreview from '@/components/FilePreview'
import { ConnectionStatusBadge } from '@/components/ConnectionStatusBadge'
import { OfflineDialog } from '@/components/OfflineDialog'
import FullPageLoader from '@/components/FullPageLoader'
import { Virtuoso } from 'react-virtuoso'
import { useToast } from '@/hooks/use-toast'
import { useNetworkStatus } from '@/hooks/useNetworkStatus'
import { formatBytes } from '@/lib/utils'
import { AUTO_LOGIN_ENABLED, AUTO_LOGIN_PASSWORD, hashPassword, verifyHash } from '@/config/autoLogin'
import { trackEvent, AnalyticsEvent, trackFileSize, setAnalyticsContext } from '@/config/analytics'
import { installConsoleMask } from '@/config/urlObfuscation'
import AnalyticsChart from '@/components/AnalyticsChart'
import { ENABLE_DUMMY_ANALYTICS, DUMMY_ANALYTICS_DATA } from '@/config/dummyAnalytics'
import { usePWAInstall } from '@/hooks/usePWAInstall'
import { PWAInstallModal } from '@/components/PWAInstallModal'
import { SupportDialog } from '@/components/SupportDialog'
import {
  saveRequestToDB,
  loadRequestsFromDB,
  updateRequestPrintedStatusInDB,
  deleteRequestFromDB,
  clearAllRequestsFromDB,
  updateDailyAnalyticsInDB,
  getAnalyticsForLastNDays,
  DailyAnalytics
} from '@/lib/storage'

interface PrintRequest {
  id: string
  fileName: string
  fileSize: number
  fileType: string
  fileData?: string
  isLink: boolean
  linkUrl?: string
  message?: string
  senderId: string
  senderName: string
  senderUniqueId: string
  timestamp: Date
  isPrinted: boolean
  printCopies?: number
  fileId?: string
  location?: { latitude: number; longitude: number; name: string; address: string }
  contact?: { name: string; phone: string }
}

interface OnlineUser {
  id: string
  name: string
  uniqueId: string
  roomNumber: string
  isOnline: boolean
}

// Theme Toggle — matching homepage
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

function AdminDashboardInner() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const { isLoaded, getPrefilledRoom, recordJoin } = useSmartPrefill()
  const [roomNumber, setRoomNumber] = useState('')

  useEffect(() => {
    if (isLoaded) {
      const pRoom = getPrefilledRoom(false, 'admin')
      if (pRoom && !roomNumber) setRoomNumber(pRoom)
    }
  }, [isLoaded, getPrefilledRoom])
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [password, setPassword] = useState('')

  // Generate a unique hash on every page load (client-only to avoid hydration mismatch)
  useEffect(() => {
    installConsoleMask()
    if (AUTO_LOGIN_ENABLED) setPassword(hashPassword())
  }, [])
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([])
  const [printRequests, setPrintRequests] = useState<PrintRequest[]>([])
  const [isConnected, setIsConnected] = useState(false)
  const [selectedRequest, setSelectedRequest] = useState<PrintRequest | null>(null)
  const [filter, setFilter] = useState<'all' | 'pending' | 'printed'>('all')
  const socketRef = useRef<any>(null)
  const [socketState, setSocketState] = useState<any>(null)
  const [recvProgress, setRecvProgress] = useState<Record<string, { fileName: string; fileType: string; total: number; received: number; fromId: string; message?: string }>>({})
  const [recvCounter, setRecvCounter] = useState<{ total: number; received: number }>({ total: 0, received: 0 })
  const blobUrlsRef = useRef<Set<string>>(new Set())
  const [adminUser, setAdminUser] = useState<any>(null)
  const [confirmMarkAllOpen, setConfirmMarkAllOpen] = useState(false)
  const [confirmClearAllOpen, setConfirmClearAllOpen] = useState(false)
  const [speedDialOpen, setSpeedDialOpen] = useState(false)
  const [leaveRoomDialogOpen, setLeaveRoomDialogOpen] = useState(false)
  const [isSidebarOpen, setIsSidebarOpen] = useState(true)
  const [supportOpen, setSupportOpen] = useState(false)

  // PWA standalone check
  const [isStandalone, setIsStandalone] = useState(false)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setIsStandalone(
        window.matchMedia('(display-mode: standalone)').matches ||
        window.matchMedia('(display-mode: fullscreen)').matches ||
        (window.navigator as any).standalone === true
      )
    }
  }, [])
  const { toast } = useToast()

  // Admin room selection dialog (matching student portal UI)
  const [adminRoomOpen, setAdminRoomOpen] = useState(false)
  const [adminLoginError, setAdminLoginError] = useState('')
  const [isAdminLoginLoading, setIsAdminLoginLoading] = useState(false)

  // PWA install for admin
  const { isInstallable, isInstalled, isIOS, promptInstall } = usePWAInstall()
  const [showIOSModal, setShowIOSModal] = useState(false)

  const handleAdminDownload = () => {
    if (isIOS) {
      setShowIOSModal(true)
      return
    }
    promptInstall('/manifest-admin.webmanifest')
  }

  const showAdminDownload = (isInstallable && !isInstalled) || isIOS

  // Network status
  const { isOnline } = useNetworkStatus()
  const [isPageLoading, setIsPageLoading] = useState(true)
  const [analyticsHistory, setAnalyticsHistory] = useState<DailyAnalytics[]>([])

  // Show loading screen for minimum 1 second
  useEffect(() => {
    const timer = setTimeout(() => {
      setIsPageLoading(false)
    }, 3000)
    return () => clearTimeout(timer)
  }, [])

  // Load initial requests from DB and set up auto-expiration
  useEffect(() => {
    const initDB = async () => {
      try {
        const stored = await loadRequestsFromDB()
        const now = Date.now()
        const validReqs: PrintRequest[] = []

        for (const req of stored) {
          const reqTime = new Date(req.timestamp).getTime()
          // 24 hours expiration
          if (now - reqTime > 86400000) {
            deleteRequestFromDB(req.id).catch(console.error)
          } else {
            let fileUrl: string | undefined = undefined
            if (req.blob) {
              fileUrl = URL.createObjectURL(req.blob)
              if (fileUrl) blobUrlsRef.current.add(fileUrl)
            }
            validReqs.push({
              ...req,
              timestamp: new Date(req.timestamp),
              // @ts-ignore
              fileUrl
            })
          }
        }
        setPrintRequests(validReqs)

        // Load 7-day analytics
        if (ENABLE_DUMMY_ANALYTICS) {
          setAnalyticsHistory(DUMMY_ANALYTICS_DATA)
        } else {
          const analyticsData = await getAnalyticsForLastNDays(7)
          setAnalyticsHistory(analyticsData)
        }
      } catch (err) {
        console.error('[Admin] Error loading DB:', err)
      }
    }
    initDB()

    const interval = setInterval(() => {
      const now = Date.now()
      setPrintRequests(prev => {
        const remaining = prev.filter(req => {
          const isExpired = (now - req.timestamp.getTime() > 86400000)
          if (isExpired) {
            deleteRequestFromDB(req.id).catch(console.error)
          }
          return !isExpired
        })
        return remaining.length !== prev.length ? remaining : prev
      })
    }, 60000) // check every minute

    return () => clearInterval(interval)
  }, [])

  const [downloadDialogOpen, setDownloadDialogOpen] = useState(false)
  // Search and sort state
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest')
  const [searchIndex, setSearchIndex] = useState<Map<string, string>>(new Map())
  const [typeFilter, setTypeFilter] = useState<'all' | 'files' | 'links'>('all')
  const [sortMenuOpen, setSortMenuOpen] = useState(false)
  // Receiving speed dial
  const [receiveDialogOpen, setReceiveDialogOpen] = useState(false)

  // Auto-download toggle (default: ON)
  const [autoDownload, setAutoDownload] = useState(true)
  const autoDownloadRef = useRef(true)
  useEffect(() => { autoDownloadRef.current = autoDownload }, [autoDownload])

  // Debounce search input
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(searchQuery.trim().toLowerCase()), 200)
    return () => clearTimeout(id)
  }, [searchQuery])

  // Build a lightweight search index to avoid lowercasing on every keystroke
  useEffect(() => {
    const idx = new Map<string, string>()
    for (const r of printRequests) {
      const text = [r.fileName, r.senderName, r.senderUniqueId, r.message || '', r.fileId || '']
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      idx.set(r.id, text)
    }
    setSearchIndex(idx)
  }, [printRequests])

  // Highlight helpers
  const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')
  const highlight = (text: string) => {
    if (!debouncedQuery || !text) return text
    try {
      const re = new RegExp(`(${escapeRegExp(debouncedQuery)})`, 'ig')
      const parts = text.split(re)
      return parts.map((part, i) => (
        i % 2 === 1
          ? (
            <mark
              key={i}
              className="bg-blue-200/60 dark:bg-blue-300/30 text-blue-900 dark:text-blue-50 rounded px-0.5 animate-in fade-in-0 duration-200"
            >
              {part}
            </mark>
          )
          : <span key={i}>{part}</span>
      ))
    } catch {
      return text
    }
  }

  const webrtc = useWebRTC(socketState, roomNumber, {
    onFileMetadata: (fromId, meta) => {
      // Initialize counter batch if fresh
      setRecvCounter(prev => {
        if (prev.total === 0 && prev.received === 0) {
          return { total: 1, received: 0 }
        }
        return { total: prev.total + 1, received: prev.received }
      })
      const key = `${fromId}:${meta.fileName}:${meta.fileSize}`
      setRecvProgress(prev => ({
        ...prev,
        [key]: { fileName: meta.fileName, fileType: meta.fileType, total: meta.fileSize, received: 0, fromId, message: meta.message }
      }))
    },
    onFileChunk: (fromId, receivedBytes, total) => {
      setRecvProgress(prev => {
        const next = { ...prev }
        for (const k of Object.keys(next)) {
          const entry = next[k]
          if (entry.fromId === fromId && entry.total === total) {
            next[k] = { ...entry, received: receivedBytes }
          }
        }
        return next
      })
    },
    onFileComplete: (fromId, fileUrl, meta, blob) => {
      const key = `${fromId}:${meta.fileName}:${meta.fileSize}`
      setRecvProgress(prev => {
        const { [key]: _, ...rest } = prev
        return rest
      })
      setRecvCounter(prev => {
        const next = { total: prev.total, received: Math.min(prev.total, prev.received + 1) }
        if (next.received >= next.total && next.total > 0) {
          // Allow speed dial to disappear first then reset counters
          setTimeout(() => setRecvCounter({ total: 0, received: 0 }), 600)
        }
        return next
      })
      const sender = onlineUsers.find(u => u.id === fromId)
      const senderName = (meta as any)?.senderName || sender?.name || 'Student'
      const senderUniqueId = (meta as any)?.senderUniqueId || sender?.uniqueId || ''
      const req: PrintRequest = {
        id: Date.now().toString() + Math.random(),
        fileName: meta.fileName,
        fileSize: meta.fileSize,
        fileType: meta.fileType,
        fileData: undefined,
        // prefer blob/object URL path
        isLink: false,
        linkUrl: undefined,
        // Store object URL for preview/download
        ...(fileUrl ? { /* @ts-ignore */ fileUrl } : {} as any),
        senderId: fromId,
        senderName,
        senderUniqueId,
        timestamp: new Date(),
        isPrinted: false,
        message: meta.message,
        fileId: (meta as any)?.fileId || makeFileId(false),
        location: (meta as any)?.location,
        contact: (meta as any)?.contact,
      }
      try { if (typeof fileUrl === 'string' && fileUrl.startsWith('blob:')) blobUrlsRef.current.add(fileUrl) } catch { }
      setPrintRequests(prev => [req, ...prev])

      // Save to IndexedDB
      saveRequestToDB({
        ...req,
        timestamp: req.timestamp.toISOString(),
        blob
      }).catch(console.error)
      updateDailyAnalyticsInDB({ totalRequests: 1, files: 1, pending: 1, totalBytes: meta.fileSize })
        .then(() => ENABLE_DUMMY_ANALYTICS ? setAnalyticsHistory(DUMMY_ANALYTICS_DATA) : getAnalyticsForLastNDays(7).then(setAnalyticsHistory))
        .catch(console.error)

      // Analytics: track file shared + file size
      trackEvent(AnalyticsEvent.FILE_SHARED)
      trackFileSize(meta.fileSize)

      // Auto-download if enabled
      if (autoDownloadRef.current && fileUrl && meta.fileType !== 'contact' && meta.fileType !== 'location') {
        try {
          const a = document.createElement('a')
          a.href = fileUrl as string
          a.download = meta.fileName || 'download'
          document.body.appendChild(a)
          a.click()
          document.body.removeChild(a)
          // Show toast notification
          toast({
            title: (
              <div className="flex items-center gap-2">
                <Download className="w-4 h-4 text-emerald-500" />
                <span>Auto-Downloaded</span>
              </div>
            ) as any,
            description: (
              <div className="flex flex-col gap-0.5">
                <span className="font-medium truncate max-w-[200px]">{meta.fileName || 'File'}</span>
                <span className="text-xs text-muted-foreground">{formatBytes(meta.fileSize)}</span>
              </div>
            ) as any,
            variant: 'default',
            duration: 3000,
          })
        } catch (e) {
          console.error('[AutoDownload] Failed to auto-download:', e)
        }
      }
    },
    onLink: (fromId, linkUrl, message, senderInfo?: { name?: string; uniqueId?: string; fileId?: string }) => {
      const sender = onlineUsers.find(u => u.id === fromId)
      const senderName = senderInfo?.name || sender?.name || 'Student'
      const senderUniqueId = senderInfo?.uniqueId || sender?.uniqueId || ''
      const req: PrintRequest = {
        id: Date.now().toString() + Math.random(),
        fileName: linkUrl,
        fileSize: 0,
        fileType: 'link',
        isLink: true,
        linkUrl,
        senderId: fromId,
        senderName,
        senderUniqueId,
        timestamp: new Date(),
        isPrinted: false,
        message,
        fileId: senderInfo?.fileId || makeFileId(true, linkUrl),
      }
      setPrintRequests(prev => [req, ...prev])
      saveRequestToDB({
        ...req,
        timestamp: req.timestamp.toISOString(),
      }).catch(console.error)
      updateDailyAnalyticsInDB({ totalRequests: 1, links: 1, pending: 1 })
        .then(() => ENABLE_DUMMY_ANALYTICS ? setAnalyticsHistory(DUMMY_ANALYTICS_DATA) : getAnalyticsForLastNDays(7).then(setAnalyticsHistory))
        .catch(console.error)

      // Analytics: track link shared
      trackEvent(AnalyticsEvent.LINK_SHARED)
      // Create transient progress entry so receiving dial appears
      const key = `${fromId}:link:${Date.now()}:${Math.random()}`
      setRecvProgress(prev => ({
        ...prev,
        [key]: { fileName: linkUrl, fileType: 'link', total: 1, received: 1, fromId, message }
      }))
      setRecvCounter(prev => {
        const next = { total: prev.total + 1, received: prev.received + 1 }
        if (next.received >= next.total && next.total > 0) {
          setTimeout(() => setRecvCounter({ total: 0, received: 0 }), 600)
        }
        return next
      })
      // Remove transient link progress after short delay
      setTimeout(() => {
        setRecvProgress(prev => {
          const { [key]: _omit, ...rest } = prev
          return rest
        })
      }, 700)
    },
    onTransferCancelled: (fromId, sender) => {
      // Clear any in-progress receive state for this sender
      setRecvProgress(prev => {
        const next = { ...prev }
        for (const key of Object.keys(next)) {
          if (next[key].fromId === fromId) {
            delete next[key]
          }
        }
        return next
      })

      // Hide speed dial by resetting received counter
      setRecvCounter({ total: 0, received: 0 })

      // Show persistent toast notification
      const senderName = sender?.name || 'Student'
      const senderUniqueId = sender?.uniqueId || ''
      toast({
        title: (
          <div className="flex items-center gap-2 text-red-600">
            <X className="w-4 h-4" />
            <span className="font-semibold">Transfer Cancelled</span>
          </div>
        ) as any,
        description: (
          <div className="mt-1.5 space-y-2">
            <div className="text-sm text-foreground">
              <span className="font-medium">{senderName}</span> {senderUniqueId ? `(${senderUniqueId})` : ''} stopped the transfer.
            </div>
            <div className="text-xs text-muted-foreground bg-muted/50 p-2.5 rounded-md border border-border/50 flex items-start gap-2">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-500" />
              <span>Any files fully received before cancellation are still available in your received list.</span>
            </div>
          </div>
        ) as any,
        variant: 'default',
        duration: Infinity,
      })

      // Analytics: track canceled transfer
      trackEvent(AnalyticsEvent.CANCELED_TRANSFER)
    }
  })

  // Handle browser back/navigation away: alert and disconnect to leave room
  useEffect(() => {
    const handleLeave = () => {
      try { socketRef.current?.disconnect() } catch { }
    }
    const cleanupBlobs = () => {
      try {
        blobUrlsRef.current.forEach((u) => { try { URL.revokeObjectURL(u as any) } catch { } })
        blobUrlsRef.current.clear()
      } catch { }
    }
    const handlePopState = () => {
      handleLeave()
      alert('All your data will be lost')
    }
    window.addEventListener('popstate', handlePopState)
    window.addEventListener('pagehide', handleLeave)
    window.addEventListener('beforeunload', handleLeave)
    return () => {
      window.removeEventListener('popstate', handlePopState)
      window.removeEventListener('pagehide', handleLeave)
      window.removeEventListener('beforeunload', handleLeave)
      cleanupBlobs()
    }
  }, [])

  // Reconnect socket when network comes back online
  useEffect(() => {
    if (isOnline && !isConnected && socketRef.current && adminUser) {
      console.log('[Admin] Network back online, attempting socket reconnect...')
      const sock = socketRef.current
      if (sock && typeof sock.connect === 'function') {
        try {
          sock.connect()
        } catch (e) {
          console.error('[Admin] Socket reconnect failed:', e)
        }
      }
    }
  }, [isOnline, isConnected, adminUser])


  useEffect(() => {
    const roomParam = searchParams?.get('room')
    if (roomParam) {
      setRoomNumber(roomParam)
    }
  }, [searchParams])

  const initializeSocket = (user: any, roomNumber: string) => {
    // Initialize socket connection using sharded signaling router (with auto-failover)
    const signalingUrls = getLabSignalingUrls(roomNumber)
    let socket: any
    const hfSignalingUrl = process.env.NEXT_PUBLIC_SIGNALING_HF?.trim()
    if (hfSignalingUrl) {
      // Connect to Hugging Face Spaces Socket.IO signaling server (supports private Spaces)
      const hfToken = process.env.NEXT_PUBLIC_HF_TOKEN?.trim()
      socket = io(hfSignalingUrl, {
        path: '/api/socket/io',
        ...(hfToken ? { extraHeaders: { Authorization: `Bearer ${hfToken}` } } : {}),
      })
    } else if (signalingUrls.length > 0) {
      socket = connectSignaling(signalingUrls)
    } else {
      // Fallback to Next.js Socket.IO route when no signaling Worker URL is set
      // Note: Pages build exposes this at /api/socket/io
      socket = io({ path: '/api/socket/io' })
    }
    socketRef.current = socket
    setSocketState(socket)

    socket.on('connect', () => {
      setIsConnected(true)
      socket.emit('admin-auth', { roomNumber, password: AUTO_LOGIN_PASSWORD, admin: user })
    })

    socket.on('disconnect', () => {
      setIsConnected(false)
    })

    socket.on('admin-auth-success', (data: any) => {
      setIsAuthenticated(true)
      socket.emit('join-room', { roomNumber, user })
      // Set analytics context for this session
      setAnalyticsContext({ roomNumber, userName: 'Lab Admin', isAdmin: true })
      // Analytics: track admin join + room join
      trackEvent(AnalyticsEvent.ADMIN_JOIN, 1, roomNumber)
      trackEvent(AnalyticsEvent.ROOM_JOIN)
    })

    socket.on('admin-auth-failed', () => {
      setIsAuthenticated(false)
    })

    socket.on('room-users', (users: OnlineUser[]) => {
      // Deduplicate by stable identity; prefer logicalId or uniqueId fallback
      const byKey: Record<string, OnlineUser> = {}
      for (const u of users) {
        const key = (u as any).logicalId || u.uniqueId || u.id
        byKey[key] = u as any
      }
      setOnlineUsers(Object.values(byKey))
    })

    socket.on('user-joined', (user: OnlineUser) => {
      setOnlineUsers(prev => {
        const key = (user as any).logicalId || user.uniqueId || user.id
        const exists = prev.some(u => ((u as any).logicalId || u.uniqueId || u.id) === key)
        return exists ? prev : [...prev, user]
      })
    })

    socket.on('user-left', (user: OnlineUser) => {
      const key = (user as any).logicalId || user.uniqueId || user.id
      setOnlineUsers(prev => prev.filter(u => ((u as any).logicalId || u.uniqueId || u.id) !== key))
    })

    // No longer listening for print-request via socket; using P2P
  }

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault()
    if (!roomNumber) {
      toast({
        title: 'Error',
        description: 'Please select a Lab Room.',
        variant: 'destructive'
      })
      return
    }
    if (password === AUTO_LOGIN_PASSWORD || (AUTO_LOGIN_ENABLED && verifyHash(password))) {
      const userData = {
        id: 'admin_' + Date.now(),
        name: 'Lab Admin',
        uniqueId: 'ADMIN',
        roomNumber,
        userType: 'admin'
      }
      setAdminUser(userData)
      recordJoin(roomNumber, false, 'admin')
      setIsAuthenticated(true)
      initializeSocket(userData, roomNumber)
    } else {
      alert('Invalid password')
    }
  }

  const handlePrintRequest = (requestId: string, copies: number = 1) => {
    setPrintRequests(prev =>
      prev.map(req =>
        req.id === requestId
          ? { ...req, isPrinted: true, printCopies: copies }
          : req
      )
    )
    
    updateRequestPrintedStatusInDB(requestId, true).catch(console.error)
    updateDailyAnalyticsInDB({ printed: 1, pending: -1 })
      .then(() => ENABLE_DUMMY_ANALYTICS ? setAnalyticsHistory(DUMMY_ANALYTICS_DATA) : getAnalyticsForLastNDays(7).then(setAnalyticsHistory))
      .catch(console.error)

    try {
      if (socketRef.current?.emit) {
        socketRef.current.emit('request-printed', { roomNumber, id: requestId })
      } else if (socketRef.current?.send) {
        socketRef.current.send(JSON.stringify({ type: 'request-printed', roomNumber, id: requestId }))
      }
    } catch (e) {
      console.error('Failed to emit printed event', e)
    }

    try {
      toast({ title: 'Marked as printed', description: 'Request marked as printed', variant: 'success' as any })
    } catch { }
  }

  const handleClearAllRequests = async () => {
    try {
      await clearAllRequestsFromDB()
      setPrintRequests([])
      toast({ title: 'Cleared', description: 'All received files and links have been cleared.', variant: 'default' as any })
    } catch (e) {
      console.error('Failed to clear requests', e)
    }
  }

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }
  // Fast ID helpers
  const random5 = () => String(Math.floor(10000 + Math.random() * 90000))
  const isGoogleDocs = (url?: string) => !!url && (url.includes('docs.google.com') || url.includes('drive.google.com'))
  const makeFileId = (isLink: boolean, linkUrl?: string) => (isLink ? (isGoogleDocs(linkUrl) ? 'D' : 'L') : 'F') + random5()

  const processedRequests = useMemo(() => {
    // Status filter first
    let arr = printRequests.filter(req => {
      if (filter === 'pending') return !req.isPrinted
      if (filter === 'printed') return req.isPrinted
      return true
    })
    // Type filter (files vs links)
    if (typeFilter === 'files') arr = arr.filter(r => !r.isLink)
    else if (typeFilter === 'links') arr = arr.filter(r => r.isLink)
    // Search via index (debounced)
    if (debouncedQuery) {
      const q = debouncedQuery
      arr = arr.filter(r => (searchIndex.get(r.id) || '').includes(q))
    }
    // Sort by timestamp
    arr = arr.slice().sort((a, b) => {
      const ta = new Date(a.timestamp).getTime()
      const tb = new Date(b.timestamp).getTime()
      return sortOrder === 'newest' ? tb - ta : ta - tb
    })
    return arr
  }, [printRequests, filter, typeFilter, debouncedQuery, searchIndex, sortOrder])

  // Active filters indicator (exclude search; only sort/type deviating from defaults)
  const hasActiveSortType = sortOrder !== 'newest' || typeFilter !== 'all'

  const pendingCount = printRequests.filter(req => !req.isPrinted).length
  const printedCount = printRequests.filter(req => req.isPrinted).length
  const pendingDownloadableCount = printRequests.filter(r => !r.isPrinted && !r.isLink && ((r as any).fileUrl || r.fileData)).length
  const allDownloadableCount = printRequests.filter(r => !r.isLink && ((r as any).fileUrl || r.fileData)).length

  // Derived today stats for KPIs
  const todayAnalytics = analyticsHistory.length > 0 ? analyticsHistory[analyticsHistory.length - 1] : null
  const todayTotal = todayAnalytics ? todayAnalytics.totalRequests : printRequests.length
  const todayPending = todayAnalytics ? todayAnalytics.pending : pendingCount
  const todayPrinted = todayAnalytics ? todayAnalytics.printed : printedCount
  const todayBytes = todayAnalytics ? todayAnalytics.totalBytes : 0
  const completionRate = todayTotal === 0 ? 0 : Math.round((todayPrinted / todayTotal) * 100)

  // Actions: refresh socket, batch download, mark all printed
  const handleRefreshSocket = () => {
    try {
      // Ask server for fresh room users list; if not supported, reconnect best-effort
      if (socketRef.current?.emit) {
        socketRef.current.emit('get-room-users', { roomNumber })
        if (adminUser) {
          socketRef.current.emit('admin-auth', { roomNumber, password: AUTO_LOGIN_PASSWORD, admin: adminUser })
          socketRef.current.emit('join-room', { roomNumber, user: adminUser })
        }
      } else if (socketRef.current?.close && adminUser) {
        // Best-effort reconnect for WS
        try { socketRef.current.close() } catch { }
        initializeSocket(adminUser, roomNumber)
      }
      toast({ title: 'Refreshed', description: 'Refresh successful.', variant: 'success' as any })
    } catch (e) {
      console.error('Refresh socket failed', e)
      toast({ title: 'Refresh failed', description: 'Could not refresh socket state.', variant: 'destructive' as any })
    }
  }

  const queueDownloads = async (mode: 'pending' | 'all') => {
    const items = printRequests.filter(r => (mode === 'pending' ? !r.isPrinted : true))
    // Only file-based items; skip links
    let delay = 0
    let queued = 0
    for (const r of items) {
      try {
        if (r.isLink) continue
        const href = (r as any).fileUrl || r.fileData
        if (!href) continue
        setTimeout(() => {
          const a = document.createElement('a')
          a.href = href as string
          a.download = r.fileName || 'file'
          document.body.appendChild(a)
          a.click()
          document.body.removeChild(a)
        }, delay)
        delay += 250
        queued += 1
      } catch (e) {
        console.error('Failed to queue download', r.fileName, e)
      }
    }
    if (queued === 0) {
      toast({ title: 'Nothing to download', description: mode === 'pending' ? 'No pending downloadable files found.' : 'No downloadable files found.', variant: 'warning' as any })
    } else {
      toast({ title: 'Downloads started', description: `Queued ${queued} file(s) for download.`, variant: 'info' as any })
    }
  }

  const handleMarkAllPrinted = () => {
    const before = pendingCount
    const pendingIds = printRequests.filter(r => !r.isPrinted).map(r => r.id)
    setPrintRequests(prev => prev.map(r => r.isPrinted ? r : ({ ...r, isPrinted: true, printCopies: r.printCopies ?? 1 })))
    setConfirmMarkAllOpen(false)

    // Emit socket events so clients can react in real-time
    try {
      if (pendingIds.length > 0) {
        if (socketRef.current?.emit) {
          // Socket.IO
          socketRef.current.emit('admin-mark-all-printed', { roomNumber, ids: pendingIds, count: pendingIds.length })
          for (const id of pendingIds) socketRef.current.emit('request-printed', { roomNumber, id })
        } else if (socketRef.current?.send) {
          // WS (e.g., Cloudflare Worker)
          const payload = { type: 'admin-mark-all-printed', roomNumber, ids: pendingIds, count: pendingIds.length }
          socketRef.current.send(JSON.stringify(payload))
          for (const id of pendingIds) socketRef.current.send(JSON.stringify({ type: 'request-printed', roomNumber, id }))
        }
      }
    } catch (e) {
      console.error('Failed to emit printed events', e)
    }

    toast({ title: 'Marked as printed', description: before > 0 ? `Marked ${before} request(s) as printed.` : 'No pending requests.', variant: before > 0 ? 'success' as any : 'warning' as any })
  }

  const handleLeaveRoom = () => {
    try { socketRef.current?.disconnect() } catch { }
    try {
      blobUrlsRef.current.forEach((u) => { try { URL.revokeObjectURL(u as any) } catch { } })
      blobUrlsRef.current.clear()
    } catch { }
    window.location.href = '/admin'
  }

  // No persistence: admin print requests are session-only

  if (isPageLoading) {
    return <FullPageLoader variant="admin" />
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background text-foreground overflow-y-auto flex flex-col">
        {/* Header with Home Button (Non-PWA only) */}
        {!isStandalone && (
          <div className="relative z-50 px-4 py-3 sm:py-4 shrink-0">
            <div className="max-w-7xl mx-auto flex items-center justify-between">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => router.push('/')}
                className="glass px-3.5 sm:px-4 py-2 text-foreground text-xs sm:text-sm font-medium rounded-xl transition duration-300 gap-1.5 sm:gap-2 hover:bg-accent/50 shadow-sm"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Home</span>
              </Button>
            </div>
          </div>
        )}

        {/* Minimal top bar with logo + theme toggle (PWA only) */}
        {isStandalone && (
          <div className="relative z-10 flex items-center justify-between px-6 py-4 shrink-0">
            <div className="flex items-center gap-3">
              <Image src="/logo.svg" alt="CosmoShare Logo" width={120} height={40} className="block dark:hidden h-8 sm:h-10 w-auto" priority />
              <Image src="/logoDark.svg" alt="CosmoShare Logo" width={120} height={40} className="hidden dark:block h-8 sm:h-10 w-auto" priority />
              <span className="text-xl font-bold gradient-text">CosmoShare</span>
            </div>
            <ThemeToggle />
          </div>
        )}

        <div className="flex-1 flex items-center justify-center p-4 sm:p-6">
          <div className="w-full max-w-md p-8 rounded-xl border border-border bg-card shadow-lg">
            <div className="text-center mb-8">
              <div className="flex justify-center mb-4">
                <div className="p-3 bg-muted rounded-xl">
                  <Printer className="w-8 h-8 text-primary" />
                </div>
              </div>
              <h2 className="text-2xl font-semibold mb-2">Admin Portal</h2>
              <p className="text-sm text-muted-foreground">
                {roomNumber ? `Authenticate to access Room ${roomNumber}` : 'Select a room and authenticate'}
              </p>
            </div>

            {AUTO_LOGIN_ENABLED && (
              <div className="flex items-center gap-2.5 px-3.5 py-2.5 mb-5 rounded-lg border border-amber-400/40 bg-amber-50/80 dark:bg-amber-950/30">
                <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse shrink-0" />
                <p className="text-xs font-medium text-amber-700 dark:text-amber-300">
                  Test mode — password pre-filled for testing purposes
                </p>
              </div>
            )}

            <form onSubmit={handleLogin} className="space-y-5" suppressHydrationWarning>
              {/* Room Selection — CommandDialog matching Student Portal */}
              <div className="space-y-2">
                <Label htmlFor="admin-room" className="text-sm font-medium">Lab Room Number</Label>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setAdminRoomOpen(true)}
                  className="w-full justify-between bg-secondary/20 dark:bg-secondary/10 border-border/80 hover:border-primary/50 text-foreground rounded-full h-11 hover:bg-secondary/40 transition-colors pl-4 pr-5 flex items-center"
                >
                  {roomNumber ? (
                    <span className="font-medium text-foreground">Room {roomNumber}</span>
                  ) : (
                    <span className="text-muted-foreground text-sm">Select Lab Room...</span>
                  )}
                  <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                </Button>
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className="text-sm font-medium">Admin Password</Label>
                <Input
                  id="password"
                  type={AUTO_LOGIN_ENABLED && verifyHash(password) ? 'text' : 'password'}
                  placeholder="Enter admin password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={`w-full h-11 ${AUTO_LOGIN_ENABLED && verifyHash(password) ? 'text-[10px] font-mono tracking-tight text-muted-foreground' : ''}`}
                  readOnly={AUTO_LOGIN_ENABLED && verifyHash(password)}
                  suppressHydrationWarning
                />
              </div>
              <Button
                type="submit"
                className="w-full h-11 bg-primary hover:bg-primary/90"
                suppressHydrationWarning
              >
                <Printer className="w-4 h-4 mr-2" />
                Access Admin Panel
              </Button>
            </form>
          </div>
        </div>

        {/* Room Selection CommandDialog */}
        <CommandDialog
          open={adminRoomOpen}
          onOpenChange={setAdminRoomOpen}
          title="Select Room"
          description="Choose your lab room"
        >
          <CommandInput placeholder="Search room..." />
          <CommandList className="max-h-[50vh] py-2">
            <CommandEmpty>
              <p className="py-4 text-sm text-muted-foreground text-center">No room found</p>
            </CommandEmpty>
            <CommandGroup>
              {roomNumbers.map((room) => (
                <CommandItem
                  key={room}
                  value={room}
                  onSelect={(currentValue) => {
                    setRoomNumber(currentValue)
                    setAdminRoomOpen(false)
                  }}
                  className={`flex items-center justify-between mx-2 px-3 py-2.5 rounded-lg cursor-pointer ${roomNumber === room ? 'bg-primary/10' : ''}`}
                >
                  <span className="flex items-center gap-3">
                    <Monitor className="w-4 h-4" />
                    <span className={roomNumber === room ? 'font-medium' : ''}>
                      Room {room}
                    </span>
                  </span>
                  {roomNumber === room && (
                    <CheckCircle2 className="w-4 h-4 text-primary" />
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </CommandDialog>

        {/* Floating Help Button */}
        <AnimatePresence>
          <motion.button
            id="support-fab"
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 20 }}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={() => setSupportOpen(true)}
            className="fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-50 w-11 h-11 sm:w-14 sm:h-14 rounded-full gradient-primary text-white shadow-lg glow-button flex items-center justify-center cursor-pointer"
            aria-label="Open support"
          >
            <HelpCircle className="w-5 h-5 sm:w-6 sm:h-6" />
          </motion.button>
        </AnimatePresence>
        
        {/* Footer (PWA only) */}
        {isStandalone && (
          <footer className="py-6 md:py-12 px-4 border-t border-border/50 shrink-0">
            <div className="max-w-6xl mx-auto">
              <div className="flex flex-col items-center justify-center gap-4">
                <p className="text-muted-foreground text-sm md:text-sm text-center" style={{ fontFamily: 'Consolas, monospace' }}>
                  Made With <svg className="mx-1 inline-block" style={{ height: '18px', width: '18px' }} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <g id="SVGRepo_bgCarrier" strokeWidth="0"></g>
                    <g id="SVGRepo_tracerCarrier" strokeLinecap="round" strokeLinejoin="round"></g>
                    <g id="SVGRepo_iconCarrier">
                      <path d="M2 9.1371C2 14 6.01943 16.5914 8.96173 18.9109C10 19.7294 11 20.5 12 20.5C13 20.5 14 19.7294 15.0383 18.9109C17.9806 16.5914 22 14 22 9.1371C22 4.27416 16.4998 0.825464 12 5.50063C7.50016 0.825464 2 4.27416 2 9.1371Z" fill="#e24040"></path>
                    </g>
                  </svg> By ISK
                </p>
                <SupportDialog externalOpen={supportOpen} onExternalOpenChange={setSupportOpen} hideTrigger={true} />
              </div>
            </div>
          </footer>
        )}
        
        {!isStandalone && (
          <SupportDialog externalOpen={supportOpen} onExternalOpenChange={setSupportOpen} hideTrigger={true} />
        )}
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="container mx-auto px-2 py-3 sm:px-4 sm:py-6">
        {/* Header */}
        <div className="dashboard-header p-3 sm:p-4 rounded-xl mb-4 sm:mb-6 flex flex-col items-center sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
          <div className="flex items-center gap-3 sm:gap-4 min-w-0 max-w-full">
            <div className="p-2 sm:p-2.5 bg-muted rounded-lg shrink-0">
              <Printer className="w-5 h-5 sm:w-6 sm:h-6 text-primary" />
            </div>
            <div className="min-w-0">
              <h1 className="text-base sm:text-xl font-semibold truncate">Lab Admin Dashboard</h1>
              <p className="text-xs sm:text-sm text-muted-foreground">Room {roomNumber} Management</p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
            <div className="flex items-center gap-1.5 sm:gap-2">
              <ConnectionStatusBadge
                isOnline={isOnline}
                isSocketConnected={isConnected}
              />
              <Badge variant="outline" className="flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-1 text-xs">
                <Users className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                <span className="flex items-center gap-1">
                  <NumberFlow value={onlineUsers.length} /> <span className="hidden sm:inline">Students</span>
                </span>
              </Badge>
            </div>
            <AlertDialog open={leaveRoomDialogOpen} onOpenChange={setLeaveRoomDialogOpen}>
              <AlertDialogTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 px-2 sm:px-3 border-red-400/50 text-red-700 dark:border-red-500/40 dark:text-red-400 hover:border-red-500 hover:text-red-600 hover:bg-red-50/50 dark:hover:bg-red-950/20 dark:hover:text-red-400 transition-all duration-200"
                >
                  <LogOut className="w-4 h-4 md:mr-2" />
                  <span className="hidden md:inline">Leave Room</span>
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent className="max-w-md">
                <AlertDialogHeader>
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-12 h-12 rounded-full bg-red-100 dark:bg-red-950/50 flex items-center justify-center shrink-0">
                      <AlertTriangle className="w-6 h-6 text-red-600 dark:text-red-400" />
                    </div>
                    <AlertDialogTitle className="text-lg">Leave Room?</AlertDialogTitle>
                  </div>
                  <AlertDialogDescription className="text-sm leading-relaxed">
                    You are about to leave <span className="font-medium text-foreground">Room {roomNumber}</span>. All received files, links, and session data will be permanently lost and cannot be recovered.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter className="mt-4 gap-2 sm:gap-0">
                  <AlertDialogCancel className="sm:mr-2">Stay in Room</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleLeaveRoom}
                    className="bg-red-600 hover:bg-red-700 text-white"
                  >
                    <LogOut className="w-4 h-4 mr-2" />
                    Leave Room
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            {/* Download (LabShare Admin) button */}
            {showAdminDownload && (
              <Button
                size="sm"
                onClick={handleAdminDownload}
                className="gradient-primary text-white glow-button hover:opacity-90 transition-all duration-300 rounded-full px-5 font-medium h-8 hidden md:flex items-center gap-2 border-0"
              >
                <Download className="w-4 h-4 group-hover:-translate-y-0.5 transition-transform duration-300" />
                <span>Install</span>
              </Button>
            )}
          </div>
        </div>

        {/* Tabs: Received Files | Analytics | Students */}
        <Tabs defaultValue="received" className="w-full">
          <TabsList className="mb-4 sm:mb-6 h-9 sm:h-10 p-1 bg-muted rounded-lg w-full sm:w-auto">
            <TabsTrigger value="received" className="flex items-center gap-1.5 sm:gap-2 rounded-md text-xs sm:text-sm">
              <Printer className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              <span className="hidden sm:inline">Received</span> Files
            </TabsTrigger>
            <TabsTrigger value="analytics" className="flex items-center gap-1.5 sm:gap-2 rounded-md text-xs sm:text-sm">
              <FileText className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              Analytics
            </TabsTrigger>
            <TabsTrigger value="students" className="flex items-center gap-1.5 sm:gap-2 rounded-md text-xs sm:text-sm">
              <Users className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              Students
            </TabsTrigger>
          </TabsList>

          {/* Received Files Tab */}
          <TabsContent value="received" className="animate-fade-in">
            <div className="grid grid-cols-1 gap-6">
              <div className="col-span-1">
                <Card className="gap-0">
                  <CardHeader className="pb-2 sm:pb-3 px-3 sm:px-6">
                    <CardTitle className="flex items-center gap-2 text-base sm:text-lg font-semibold">
                      <Printer className="w-4 h-4 sm:w-5 sm:h-5 text-primary" />
                      Print Requests
                    </CardTitle>
                    <p className="text-xs sm:text-sm text-muted-foreground">
                      Manage student print requests
                    </p>
                  </CardHeader>
                  <CardContent className="px-2 sm:px-6">
                    {/* Sticky toolbar */}
                    <div className="sticky top-0 z-20 space-y-2 md:space-y-0 md:flex md:items-center md:justify-between bg-card border rounded-lg p-2 mb-3">
                      {/* Search + Filter */}
                      <div className="flex items-center gap-2 w-full md:w-auto">
                        <div className="flex-1 md:flex-initial relative">
                          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                          <Input
                            placeholder="Search files, names, ID"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="h-9 pl-9 bg-secondary/50 border-border focus:ring-primary/50 focus:border-primary/50 w-full md:w-64 rounded-lg"
                          />
                        </div>
                        <TooltipProvider>
                          <Popover open={sortMenuOpen} onOpenChange={setSortMenuOpen}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <PopoverTrigger asChild>
                                  <Button
                                    variant={hasActiveSortType ? 'default' : 'outline'}
                                    size="sm"
                                    className="h-9 shrink-0"
                                  >
                                    <div className="relative">
                                      <Filter className="w-4 h-4" />
                                      {hasActiveSortType && (
                                        <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-white ring-1 ring-primary-foreground" />
                                      )}
                                    </div>
                                  </Button>
                                </PopoverTrigger>
                              </TooltipTrigger>
                              <TooltipContent side="bottom">Sort & filter</TooltipContent>
                            </Tooltip>
                            <PopoverContent align="end" className="w-64 p-2 glass-card border-border">
                              <div className="px-1 py-1.5 text-xs text-muted-foreground font-semibold uppercase tracking-wider">Sort order</div>
                              <div className="flex flex-col gap-1 mb-2">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="justify-start hover:bg-secondary"
                                  onClick={() => setSortOrder('newest')}
                                >
                                  {sortOrder === 'newest' && <Check className="w-4 h-4 mr-2 text-primary" />}
                                  Newest first
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="justify-start hover:bg-secondary"
                                  onClick={() => setSortOrder('oldest')}
                                >
                                  {sortOrder === 'oldest' && <Check className="w-4 h-4 mr-2 text-primary" />}
                                  Oldest first
                                </Button>
                              </div>
                              <div className="border-t border-border my-2" />
                              <div className="px-1 py-1.5 text-xs text-muted-foreground font-semibold uppercase tracking-wider">Types</div>
                              <div className="flex flex-col gap-1">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="justify-start hover:bg-secondary"
                                  onClick={() => setTypeFilter('all')}
                                >
                                  {typeFilter === 'all' && <Check className="w-4 h-4 mr-2 text-primary" />}
                                  All types
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="justify-start hover:bg-secondary"
                                  onClick={() => setTypeFilter('files')}
                                >
                                  {typeFilter === 'files' && <Check className="w-4 h-4 mr-2 text-primary" />}
                                  Files only
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="justify-start hover:bg-secondary"
                                  onClick={() => setTypeFilter('links')}
                                >
                                  {typeFilter === 'links' && <Check className="w-4 h-4 mr-2 text-primary" />}
                                  Links only
                                </Button>
                              </div>
                            </PopoverContent>
                          </Popover>
                        </TooltipProvider>
                      </div>
                      {/* Status tabs + Auto-download */}
                      <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-2">
                        <div className="flex bg-muted rounded-lg p-1 gap-0.5 w-full md:w-auto">
                          <button
                            onClick={() => setFilter('all')}
                            className={`flex-1 md:flex-initial h-7 sm:h-8 px-2 sm:px-3 rounded-md text-xs sm:text-sm font-medium transition-all duration-150 ${filter === 'all'
                              ? 'bg-primary text-primary-foreground shadow-sm'
                              : 'text-muted-foreground hover:text-foreground hover:bg-muted-foreground/10'
                              }`}
                          >
                            All
                          </button>
                          <button
                            onClick={() => setFilter('pending')}
                            className={`flex-1 md:flex-initial h-7 sm:h-8 px-2 sm:px-3 rounded-md text-xs sm:text-sm font-medium transition-all duration-150 ${filter === 'pending'
                              ? 'bg-amber-500 text-white shadow-sm'
                              : 'text-muted-foreground hover:text-foreground hover:bg-muted-foreground/10'
                              }`}
                          >
                            Pending
                          </button>
                          <button
                            onClick={() => setFilter('printed')}
                            className={`flex-1 md:flex-initial h-7 sm:h-8 px-2 sm:px-3 rounded-md text-xs sm:text-sm font-medium transition-all duration-150 ${filter === 'printed'
                              ? 'bg-primary text-primary-foreground shadow-sm'
                              : 'text-muted-foreground hover:text-foreground hover:bg-muted-foreground/10'
                              }`}
                          >
                            Printed
                          </button>
                        </div>
                        <div className="w-fit">
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div className={`inline-flex items-center gap-1.5 sm:gap-2 px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-lg border shadow-sm transition-colors ${autoDownload
                                  ? 'bg-emerald-50 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-800'
                                  : 'bg-card'
                                  }`}>
                                  <Download className={`w-3 h-3 sm:w-3.5 sm:h-3.5 transition-colors ${autoDownload ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'
                                    }`} />
                                  <span className={`text-xs font-medium transition-colors ${autoDownload ? 'text-emerald-700 dark:text-emerald-300' : ''
                                    }`}>Auto-Download</span>
                                  <Switch
                                    id="auto-download-admin"
                                    checked={autoDownload}
                                    onCheckedChange={setAutoDownload}
                                    className="scale-75"
                                  />
                                </div>
                              </TooltipTrigger>
                              <TooltipContent side="bottom" className="max-w-[200px] text-center">
                                <p className="text-xs">When enabled, received files are automatically downloaded to your device</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </div>
                      </div>
                    </div>
                    {/* Inline receiving removed (handled via speed dial) */}

                    {processedRequests.length === 0 ? (
                      <div className="text-center py-10 sm:py-16 animate-in fade-in-0 zoom-in-95">
                        {/* Choose icon based on type filter */}
                        {typeFilter === 'links' ? (
                          <div className="p-4 bg-blue-500/10 rounded-full inline-block mb-4">
                            <Link className="w-12 h-12 text-blue-500 animate-pulse" />
                          </div>
                        ) : typeFilter === 'files' ? (
                          <div className="p-4 bg-secondary rounded-full inline-block mb-4">
                            <FileText className="w-12 h-12 text-muted-foreground animate-pulse" />
                          </div>
                        ) : (
                          <div className="p-4 bg-secondary rounded-full inline-block mb-4">
                            <Printer className="w-12 h-12 text-muted-foreground animate-pulse" />
                          </div>
                        )}
                        <div className="space-y-2">
                          <p className="text-lg font-medium">
                            {(() => {
                              const typeLabel = typeFilter === 'links' ? 'links' : typeFilter === 'files' ? 'files' : 'files or links'
                              const statusLabel = filter === 'pending' ? 'pending' : filter === 'printed' ? 'printed' : 'any'
                              if (debouncedQuery) {
                                return (
                                  <>
                                    No {typeLabel} match <span className="text-accent">"{debouncedQuery}"</span> in {statusLabel} requests.
                                  </>
                                )
                              }
                              if (filter === 'pending') return <>No pending {typeLabel}.</>
                              if (filter === 'printed') return <>No printed {typeLabel} yet.</>
                              return <>No {typeLabel} yet.</>
                            })()}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            Try adjusting filters or clearing the search.
                          </p>
                          <div className="flex items-center justify-center gap-2 mt-4">
                            {debouncedQuery && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setSearchQuery('')}
                                className="transition hover:scale-[1.02]"
                              >
                                Clear search
                              </Button>
                            )}
                            {(filter !== 'all' || typeFilter !== 'all') && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => { setTypeFilter('all'); setFilter('all') }}
                                className="transition hover:scale-[1.02]"
                              >
                                Reset filters
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div>
                        <Virtuoso
                          style={{ height: 'calc(100vh - 12rem)' }}
                          data={processedRequests}
                          totalCount={processedRequests.length}
                          overscan={8}
                          itemContent={(index, request) => {
                            return (
                              <div className={`p-1.5 sm:p-3 transition-colors ${debouncedQuery ? 'animate-in fade-in-0 zoom-in-95' : ''}`}>
                                <FilePreview
                                  file={{
                                    id: request.id,
                                    fileName: request.fileName,
                                    fileSize: request.fileSize,
                                    fileType: request.fileType,
                                    fileData: request.fileData,
                                    // @ts-ignore optional: pass through object URL if present
                                    fileUrl: (request as any).fileUrl,
                                    isLink: request.isLink,
                                    linkUrl: request.linkUrl,
                                    message: request.message,
                                    fileId: request.fileId
                                  }}
                                  senderName={request.senderName}
                                  senderUniqueId={request.senderUniqueId}
                                  timestamp={request.timestamp}
                                  highlightQuery={debouncedQuery}
                                  onMarkPrinted={!request.isPrinted ? () => handlePrintRequest(request.id, 1) : undefined}
                                  isPrinted={request.isPrinted}
                                />
                              </div>
                            )
                          }}
                        />
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>

          {/* Analytics Tab */}
          <TabsContent value="analytics" className="animate-fade-in">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 sm:gap-6">
              <div className="stat-card p-3 sm:p-5 rounded-xl sm:rounded-2xl flex flex-col justify-between">
                <div className="flex items-start justify-between">
                  <p className="text-xs sm:text-sm font-medium text-muted-foreground">Today's Total</p>
                  <div className="p-1.5 sm:p-2 bg-primary/10 rounded-lg">
                    <FileText className="w-4 h-4 text-primary" />
                  </div>
                </div>
                <p className="text-2xl sm:text-3xl font-bold mt-2">
                  <NumberFlow value={todayTotal} />
                </p>
              </div>

              <div className="stat-card p-3 sm:p-5 rounded-xl sm:rounded-2xl flex flex-col justify-between">
                <div className="flex items-start justify-between">
                  <p className="text-xs sm:text-sm font-medium text-muted-foreground">Pending</p>
                  <div className="p-1.5 sm:p-2 bg-orange-500/10 rounded-lg">
                    <Clock className="w-4 h-4 text-orange-500" />
                  </div>
                </div>
                <p className="text-2xl sm:text-3xl font-bold text-orange-500 mt-2">
                  <NumberFlow value={todayPending} />
                </p>
              </div>

              <div className="stat-card p-3 sm:p-5 rounded-xl sm:rounded-2xl flex flex-col justify-between relative overflow-hidden group">
                <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent" />
                <div className="flex items-center justify-between relative z-10 h-full">
                  <div className="flex flex-col justify-between h-full">
                    <p className="text-xs sm:text-sm font-medium text-muted-foreground">Print Progress</p>
                    <div className="mt-2 space-y-0.5">
                      <p className="text-sm font-semibold text-foreground">
                        {todayPrinted} <span className="text-xs font-normal text-muted-foreground">/ {todayTotal}</span>
                      </p>
                      <p className="text-xs font-medium text-orange-500 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse" />
                        {todayPending} Pending
                      </p>
                    </div>
                  </div>
                  
                  <div className="relative w-14 h-14 sm:w-16 sm:h-16 flex-shrink-0">
                    <svg className="w-full h-full transform -rotate-90 drop-shadow-sm" viewBox="0 0 36 36">
                      {/* Background Track */}
                      <path
                        className="text-border/50"
                        d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3.5"
                      />
                      {/* Progress Track */}
                      <path
                        className="text-primary transition-all duration-1000 ease-out"
                        strokeDasharray={`${completionRate}, 100`}
                        d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3.5"
                        strokeLinecap="round"
                      />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-xs sm:text-sm font-bold text-foreground">
                        <NumberFlow value={completionRate} />%
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="stat-card p-3 sm:p-5 rounded-xl sm:rounded-2xl flex flex-col justify-between">
                <div className="flex items-start justify-between">
                  <p className="text-xs sm:text-sm font-medium text-muted-foreground">Online Now</p>
                  <div className="p-1.5 sm:p-2 bg-accent/10 rounded-lg">
                    <Users className="w-4 h-4 text-accent" />
                  </div>
                </div>
                <p className="text-2xl sm:text-3xl font-bold mt-2">
                  <NumberFlow value={onlineUsers.length} />
                </p>
              </div>
            </div>

            {analyticsHistory.length > 0 && (
              <AnalyticsChart data={analyticsHistory} />
            )}
          </TabsContent>

          {/* Students Tab */}
          <TabsContent value="students" className="mt-3 sm:mt-4">
            <Card>
              <CardHeader className="pb-3 sm:pb-4 px-3 sm:px-6">
                <CardTitle className="flex items-center gap-2 text-base sm:text-lg font-semibold">
                  <Users className="w-4 h-4 sm:w-5 sm:h-5" />
                  Online Students
                </CardTitle>
                <CardDescription className="text-xs sm:text-sm">
                  Students currently in Room {roomNumber}
                </CardDescription>
              </CardHeader>
              <CardContent className="px-3 sm:px-6">
                <div className="space-y-2">
                  {onlineUsers.length === 0 ? (
                    <div className="text-center py-12">
                      <div className="p-4 bg-muted rounded-full inline-block mb-4">
                        <Users className="w-10 h-10 text-muted-foreground opacity-50" />
                      </div>
                      <p className="text-muted-foreground">No students online</p>
                    </div>
                  ) : (
                    <div className="max-h-96 overflow-y-auto scrollbar-thin scrollbar-thumb-muted-foreground/20 scrollbar-track-transparent">
                      <Virtuoso
                        style={{ height: '24rem' }}
                        totalCount={onlineUsers.length}
                        overscan={8}
                        itemContent={(index) => {
                          const user = onlineUsers[index]
                          return (
                            <div key={user.id} className="flex items-center gap-2 sm:gap-3 p-2 sm:p-3 hover:bg-muted/50 rounded-lg transition-colors">
                              <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center text-white font-semibold text-xs sm:text-sm shrink-0" style={{ backgroundImage: generateGradient(user.name) }}>
                                {user.name.charAt(0).toUpperCase()}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="font-medium text-xs sm:text-sm overflow-x-auto whitespace-nowrap scrollbar-thin">{user.name}</p>
                                <p className="text-xs text-muted-foreground truncate">{user.uniqueId}</p>
                              </div>
                              <Badge className="hidden sm:inline-flex bg-primary hover:bg-primary text-primary-foreground text-xs shrink-0">Online</Badge>
                            </div>
                          )
                        }}
                      />
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
        {/* Floating Speed Dial */}
        <TooltipProvider>
          <Popover open={speedDialOpen} onOpenChange={setSpeedDialOpen}>
            <Tooltip>
              <TooltipTrigger asChild>
                <PopoverTrigger asChild>
                  <Button
                    className="fixed bottom-6 right-6 h-14 w-14 rounded-full shadow-lg gradient-primary text-white z-50"
                    size="icon"
                    aria-label={speedDialOpen ? 'Close quick actions' : 'Open quick actions'}
                  >
                    <Plus className={`w-6 h-6 transition-transform duration-200 ${speedDialOpen ? 'rotate-45' : ''}`} />
                  </Button>
                </PopoverTrigger>
              </TooltipTrigger>
              <TooltipContent side="left" align="center">Quick actions</TooltipContent>
            </Tooltip>
            <PopoverContent align="end" className="w-60 p-2 mr-4 mb-2">
              <div className="flex flex-col gap-1">
                <Button
                  variant="ghost"
                  className="justify-start hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                  onClick={() => { handleRefreshSocket(); setSpeedDialOpen(false) }}
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Refresh
                </Button>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <div>
                      <Button
                        variant="ghost"
                        className="justify-start hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                        disabled={allDownloadableCount === 0}
                        onClick={() => { setDownloadDialogOpen(true) }}
                      >
                        <Download className="w-4 h-4 mr-2" />
                        Download files
                      </Button>
                    </div>
                  </TooltipTrigger>
                  {allDownloadableCount === 0 && (
                    <TooltipContent side="left" align="center">No downloadable files</TooltipContent>
                  )}
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <div>
                      <Button
                        variant="ghost"
                        className="justify-start hover:bg-black/5 dark:hover:bg-white/10 transition-colors text-orange-500 hover:text-orange-600 dark:hover:text-orange-400"
                        disabled={pendingCount === 0}
                        onClick={() => { setConfirmMarkAllOpen(true); setSpeedDialOpen(false) }}
                      >
                        <Check className="w-4 h-4 mr-2" />
                        Mark all as printed
                      </Button>
                    </div>
                  </TooltipTrigger>
                  {pendingCount === 0 && (
                    <TooltipContent side="left" align="center">No pending requests to mark</TooltipContent>
                  )}
                </Tooltip>

                <div className="my-1 border-t border-black/10 dark:border-white/10" />

                <Tooltip>
                  <TooltipTrigger asChild>
                    <div>
                      <Button
                        variant="ghost"
                        className="justify-start hover:bg-black/5 dark:hover:bg-white/10 transition-colors text-red-500 hover:text-red-600 dark:hover:text-red-400"
                        disabled={printRequests.length === 0}
                        onClick={() => { setConfirmClearAllOpen(true); setSpeedDialOpen(false) }}
                      >
                        <X className="w-4 h-4 mr-2" />
                        Clear all files
                      </Button>
                    </div>
                  </TooltipTrigger>
                  {printRequests.length === 0 && (
                    <TooltipContent side="left" align="center">No files to clear</TooltipContent>
                  )}
                </Tooltip>
              </div>
            </PopoverContent>
          </Popover>
        </TooltipProvider>

        {/* Global Modals for Quick Actions (extracted to root level to prevent z-index/portal bugs) */}
        <AlertDialog open={confirmMarkAllOpen} onOpenChange={setConfirmMarkAllOpen}>
          <AlertDialogContent className="bg-card text-card-foreground border-border shadow-2xl">
            <AlertDialogHeader>
              <AlertDialogTitle>Mark all pending as printed?</AlertDialogTitle>
              <AlertDialogDescription>
                This will mark <span className="inline-flex items-center"><NumberFlow value={pendingCount} /></span> pending request(s) as printed. You can’t undo this action.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="bg-white/5 border-white/10 hover:bg-white/10">Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => { handleMarkAllPrinted() }} className="bg-accent hover:bg-accent/90">Confirm</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={confirmClearAllOpen} onOpenChange={setConfirmClearAllOpen}>
          <AlertDialogContent className="bg-card text-card-foreground border-border shadow-2xl">
            <AlertDialogHeader>
              <AlertDialogTitle>Clear all received files and links?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete all <span className="inline-flex items-center"><NumberFlow value={printRequests.length} /></span> received files and links from this device. Analytics data will be preserved. You can’t undo this action.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="bg-white/5 border-white/10 hover:bg-white/10">Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => { handleClearAllRequests() }} className="bg-red-500 hover:bg-red-600">Clear All</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        {/* Receiving Speed Dial above quick actions */}
        {(Object.keys(recvProgress).length > 0 || (recvCounter.total > 0 && recvCounter.received < recvCounter.total)) && (
          <div className="fixed bottom-24 right-6 z-50">
            <Button
              className="relative h-14 w-14 rounded-full shadow-lg gradient-primary text-white hover:opacity-90 active:scale-95 transition-all overflow-visible"
              size="icon"
              aria-label="Receiving files"
              onClick={() => setReceiveDialogOpen(true)}
            >
              <ArrowDown className="relative animate-arrow-drop" style={{ height: '20px', width: '20px' }} />
              <span className="absolute -top-1 -right-1">
                <span className="inline-block w-3 h-3 rounded-full bg-white ring-2 ring-primary shadow-md animate-badge-pulse-blink" />
              </span>
            </Button>
          </div>
        )}
        <Dialog open={receiveDialogOpen} onOpenChange={setReceiveDialogOpen}>
          <DialogContent className="bg-card border-border shadow-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                Receiving files
              </DialogTitle>
              <DialogDescription>Files currently being received.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3 max-w-full">
              {Object.values(recvProgress).map((p, idx) => (
                <div key={idx} className="group relative overflow-hidden rounded-xl border border-white/10 bg-white/5 p-3 shadow-sm max-w-full">
                  <div className="flex items-start gap-3 max-w-full">
                    <div className="mt-0.5 flex-1 min-w-0 max-w-full">
                      <p className="text-sm font-medium flex items-center gap-2 max-w-full">
                        <span className="truncate max-w-full" title={p.fileName}>{p.fileName}</span>
                      </p>
                      <div className="mt-2 h-2 w-full rounded-full bg-white/10 overflow-hidden">
                        {(() => {
                          const pct = p.total ? Math.min(100, (p.received / p.total) * 100) : 0
                          return <div style={{ width: pct + '%' }} className="h-full bg-primary transition-[width] duration-300 ease-out" />
                        })()}
                      </div>
                      <div className="mt-1 text-[11px] text-muted-foreground flex justify-between">
                        {(() => {
                          const pct = p.total ? Math.min(100, Math.round((p.received / p.total) * 100)) : 0
                          return <span className="inline-flex items-center"><NumberFlow value={pct} />%</span>
                        })()}
                        <span>{p.fileType === 'link' ? '' : (p.total ? `${formatBytes(p.received)} / ${formatBytes(p.total)}` : '')}</span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
              {Object.keys(recvProgress).length === 0 && (
                <div className="flex flex-col items-center justify-center py-6 text-center border border-dashed border-white/10 rounded-lg">
                  <p className="text-sm text-muted-foreground">All files received.</p>
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
        {/* Download selection dialog */}
        <Dialog open={downloadDialogOpen} onOpenChange={setDownloadDialogOpen}>
          <DialogContent className="bg-card border-border shadow-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Download className="w-5 h-5" />
                Download files
              </DialogTitle>
              <DialogDescription>
                Choose which files to download.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  disabled={pendingDownloadableCount === 0}
                  onClick={() => { queueDownloads('pending'); setDownloadDialogOpen(false); setSpeedDialOpen(false) }}
                  className="justify-start bg-white/5 border-white/10 hover:bg-white/10"
                >
                  <Clock className="w-4 h-4 mr-2" />
                  Pending only
                  <span className="ml-auto text-xs text-muted-foreground flex items-center"><NumberFlow value={pendingDownloadableCount} /></span>
                </Button>
                <Button
                  onClick={() => { queueDownloads('all'); setDownloadDialogOpen(false); setSpeedDialOpen(false) }}
                  disabled={allDownloadableCount === 0}
                  className="justify-start bg-accent hover:bg-accent/90"
                >
                  <Download className="w-4 h-4 mr-2" />
                  All files
                  <span className="ml-auto text-xs text-muted-foreground flex items-center"><NumberFlow value={allDownloadableCount} /></span>
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Links are skipped; only files with available data are downloaded.
              </p>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* iOS PWA Install Instructions Modal */}
      <PWAInstallModal
        open={showIOSModal}
        onOpenChange={setShowIOSModal}
        variant="admin"
      />

      {/* Offline Dialog */}
      <OfflineDialog isOnline={isOnline} />
    </div >
  )
}


export default function AdminDashboard() {
  return (
    <Suspense fallback={<FullPageLoader variant="admin" />}>
      <AdminDashboardInner />
    </Suspense>
  )
}
