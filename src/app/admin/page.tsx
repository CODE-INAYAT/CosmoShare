"use client"
export const runtime = 'edge'

import { generateGradient } from '@/lib/avatarUtils'
import { useState, useEffect, useRef, Suspense, useMemo } from 'react'
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
  ArrowDown
} from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import { io } from 'socket.io-client'
import { connectSignaling } from '@/lib/wsClient'
import { useWebRTC } from '@/hooks/useWebRTC'
import FilePreview from '@/components/FilePreview'
import { ConnectionStatusBadge } from '@/components/ConnectionStatusBadge'
import { OfflineDialog } from '@/components/OfflineDialog'
import { Virtuoso } from 'react-virtuoso'
import { useToast } from '@/hooks/use-toast'
import { useNetworkStatus } from '@/hooks/useNetworkStatus'
import { formatBytes } from '@/lib/utils'

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
}

interface OnlineUser {
  id: string
  name: string
  uniqueId: string
  roomNumber: string
  isOnline: boolean
}

function AdminDashboardInner() {
  const searchParams = useSearchParams()
  const [roomNumber, setRoomNumber] = useState('')
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [password, setPassword] = useState('')
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
  const [speedDialOpen, setSpeedDialOpen] = useState(false)
  const { toast } = useToast()

  // Network status
  const { isOnline } = useNetworkStatus()

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
    onFileComplete: (fromId, fileUrl, meta) => {
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
      const senderUniqueId = (meta as any)?.senderUniqueId || sender?.uniqueId || 'ID'
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
      }
      try { if (typeof fileUrl === 'string' && fileUrl.startsWith('blob:')) blobUrlsRef.current.add(fileUrl) } catch { }
      setPrintRequests(prev => [req, ...prev])

      // Auto-download if enabled
      if (autoDownloadRef.current && fileUrl) {
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
      const senderUniqueId = senderInfo?.uniqueId || sender?.uniqueId || 'ID'
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
    // Initialize socket connection
    const base = process.env.NEXT_PUBLIC_SIGNALING_BASE_URL
    let socket: any
    if (base) {
      const wsBase = (base.endsWith('/ws') || base.includes('/ws?')) ? base : `${base.replace(/\/$/, '')}/ws`
      const url = `${wsBase}?room=${encodeURIComponent(roomNumber)}`
      socket = connectSignaling(url)
    } else {
      // Fallback to Next.js Socket.IO route when no signaling Worker URL is set
      // Note: Pages build exposes this at /api/socket/io
      socket = io({ path: '/api/socket/io' })
    }
    socketRef.current = socket
    setSocketState(socket)

    socket.on('connect', () => {
      setIsConnected(true)
      socket.emit('admin-auth', { roomNumber, password: 'admin123', admin: user })
    })

    socket.on('disconnect', () => {
      setIsConnected(false)
    })

    socket.on('admin-auth-success', (data: any) => {
      setIsAuthenticated(true)
      socket.emit('join-room', { roomNumber, user })
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
    if (password === 'admin123') {
      const userData = {
        id: 'admin_' + Date.now(),
        name: 'Lab Admin',
        uniqueId: 'ADMIN',
        roomNumber,
        userType: 'admin'
      }
      setAdminUser(userData)
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

  // Actions: refresh socket, batch download, mark all printed
  const handleRefreshSocket = () => {
    try {
      // Ask server for fresh room users list; if not supported, reconnect best-effort
      if (socketRef.current?.emit) {
        socketRef.current.emit('get-room-users', { roomNumber })
        if (adminUser) {
          socketRef.current.emit('admin-auth', { roomNumber, password: 'admin123', admin: adminUser })
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

  // No persistence: admin print requests are session-only

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background text-foreground flex flex-col">
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="w-full max-w-md p-8 rounded-xl border border-border bg-card shadow-lg">
            <div className="text-center mb-8">
              <div className="flex justify-center mb-4">
                <div className="p-3 bg-muted rounded-xl">
                  <Printer className="w-8 h-8 text-primary" />
                </div>
              </div>
              <h2 className="text-2xl font-semibold mb-2">Admin Portal</h2>
              <p className="text-sm text-muted-foreground">
                Authenticate to access Lab {roomNumber} admin dashboard
              </p>
            </div>

            <form onSubmit={handleLogin} className="space-y-5" suppressHydrationWarning>
              <div className="space-y-2">
                <Label htmlFor="password" className="text-sm font-medium">Admin Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="Enter admin password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full h-11"
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
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="container mx-auto px-4 py-6">
        {/* Header */}
        <div className="dashboard-header p-4 rounded-xl mb-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="p-2.5 bg-muted rounded-lg">
              <Printer className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-semibold">Lab Admin Dashboard</h1>
              <p className="text-sm text-muted-foreground">Room {roomNumber} Management</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <ConnectionStatusBadge
                isOnline={isOnline}
                isSocketConnected={isConnected}
              />
              <Badge variant="outline" className="flex items-center gap-1.5 px-2.5 py-1 text-xs">
                <Users className="w-3.5 h-3.5" />
                {onlineUsers.length} Students
              </Badge>
            </div>
            <Button variant="outline" size="sm" onClick={handleRefreshSocket}>
              <RefreshCw className="w-4 h-4 mr-2" />
              Refresh
            </Button>
          </div>
        </div>

        {/* Tabs: Received Files | Analytics | Students */}
        <Tabs defaultValue="received" className="w-full">
          <TabsList className="mb-6 h-10 p-1 bg-muted rounded-lg">
            <TabsTrigger value="received" className="flex items-center gap-2 rounded-md text-sm">
              <Printer className="w-4 h-4" />
              Received Files
            </TabsTrigger>
            <TabsTrigger value="analytics" className="flex items-center gap-2 rounded-md text-sm">
              <FileText className="w-4 h-4" />
              Analytics
            </TabsTrigger>
            <TabsTrigger value="students" className="flex items-center gap-2 rounded-md text-sm">
              <Users className="w-4 h-4" />
              Students
            </TabsTrigger>
          </TabsList>

          {/* Received Files Tab */}
          <TabsContent value="received" className="animate-fade-in">
            <div className="grid grid-cols-1 gap-6">
              <div className="col-span-1">
                <Card>
                  <CardHeader className="pb-4 sticky top-0 z-20 bg-card border-b">
                    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                      <div className="flex items-center gap-4">
                        <div>
                          <CardTitle className="flex items-center gap-2 text-lg font-semibold">
                            <Printer className="w-5 h-5 text-primary" />
                            Print Requests
                          </CardTitle>
                          <p className="text-sm text-muted-foreground">
                            Manage student print requests and file sharing
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 w-full md:w-auto">
                        <div className="flex-1 md:flex-initial relative">
                          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                          <Input
                            placeholder="Search files..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="h-10 pl-9 bg-secondary/50 border-border focus:ring-primary/50 focus:border-primary/50 w-full md:w-64 rounded-lg"
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
                                    className="h-9"
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
                        <div className="flex bg-muted rounded-lg p-1 gap-1">
                          <button
                            onClick={() => setFilter('all')}
                            className={`h-8 px-3 rounded-md text-sm font-medium transition-all duration-150 ${filter === 'all'
                              ? 'bg-primary text-primary-foreground shadow-sm'
                              : 'text-muted-foreground hover:text-foreground hover:bg-muted-foreground/10'
                              }`}
                          >
                            All
                          </button>
                          <button
                            onClick={() => setFilter('pending')}
                            className={`h-8 px-3 rounded-md text-sm font-medium transition-all duration-150 ${filter === 'pending'
                              ? 'bg-amber-500 text-white shadow-sm'
                              : 'text-muted-foreground hover:text-foreground hover:bg-muted-foreground/10'
                              }`}
                          >
                            Pending
                          </button>
                          <button
                            onClick={() => setFilter('printed')}
                            className={`h-8 px-3 rounded-md text-sm font-medium transition-all duration-150 ${filter === 'printed'
                              ? 'bg-primary text-primary-foreground shadow-sm'
                              : 'text-muted-foreground hover:text-foreground hover:bg-muted-foreground/10'
                              }`}
                          >
                            Printed
                          </button>
                        </div>
                        {/* Auto-Download Toggle with Tooltip */}
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border shadow-sm transition-colors ${autoDownload
                                ? 'bg-emerald-50 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-800'
                                : 'bg-card'
                                }`}>
                                <Download className={`w-3.5 h-3.5 transition-colors ${autoDownload ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'
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
                  </CardHeader>
                  <CardContent>
                    {/* Inline receiving removed (handled via speed dial) */}

                    {processedRequests.length === 0 ? (
                      <div className="text-center py-16 animate-in fade-in-0 zoom-in-95">
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
                              <div className={`p-3 transition-colors ${debouncedQuery ? 'animate-in fade-in-0 zoom-in-95' : ''}`}>
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
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <div className="stat-card p-6 rounded-2xl">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Total Requests</p>
                    <p className="text-3xl font-bold mt-1">{printRequests.length}</p>
                  </div>
                  <div className="p-3 bg-primary/10 rounded-xl">
                    <FileText className="w-6 h-6 text-primary" />
                  </div>
                </div>
              </div>

              <div className="stat-card p-6 rounded-2xl">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Pending</p>
                    <p className="text-3xl font-bold text-orange-500 mt-1">{pendingCount}</p>
                  </div>
                  <div className="p-3 bg-orange-500/10 rounded-xl">
                    <Clock className="w-6 h-6 text-orange-500" />
                  </div>
                </div>
              </div>

              <div className="stat-card p-6 rounded-2xl">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Printed</p>
                    <p className="text-3xl font-bold text-green-500 mt-1">{printedCount}</p>
                  </div>
                  <div className="p-3 bg-green-500/10 rounded-xl">
                    <Check className="w-6 h-6 text-green-500" />
                  </div>
                </div>
              </div>

              <div className="stat-card p-6 rounded-2xl">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Online Now</p>
                    <p className="text-3xl font-bold mt-1">{onlineUsers.length}</p>
                  </div>
                  <div className="p-3 bg-accent/10 rounded-xl">
                    <Users className="w-6 h-6 text-accent" />
                  </div>
                </div>
              </div>
            </div>
          </TabsContent>

          {/* Students Tab */}
          <TabsContent value="students" className="mt-4">
            <Card>
              <CardHeader className="pb-4">
                <CardTitle className="flex items-center gap-2 text-lg font-semibold">
                  <Users className="w-5 h-5" />
                  Online Students
                </CardTitle>
                <CardDescription>
                  Students currently in Room {roomNumber}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {onlineUsers.length === 0 ? (
                    <div className="text-center py-12">
                      <div className="p-4 bg-muted rounded-full inline-block mb-4">
                        <Users className="w-10 h-10 text-muted-foreground opacity-50" />
                      </div>
                      <p className="text-muted-foreground">No students online</p>
                    </div>
                  ) : (
                    <div className="max-h-96">
                      <Virtuoso
                        style={{ height: '24rem' }}
                        totalCount={onlineUsers.length}
                        overscan={8}
                        itemContent={(index) => {
                          const user = onlineUsers[index]
                          return (
                            <div key={user.id} className="flex items-center gap-3 p-3 hover:bg-muted/50 rounded-lg transition-colors">
                              <div className="w-8 h-8 rounded-full flex items-center justify-center text-white font-semibold text-sm" style={{ backgroundImage: generateGradient(user.name) }}>
                                {user.name.charAt(0).toUpperCase()}
                              </div>
                              <div className="flex-1">
                                <p className="font-medium text-sm">{user.name}</p>
                                <p className="text-xs text-muted-foreground">{user.uniqueId}</p>
                              </div>
                              <Badge className="bg-primary hover:bg-primary text-primary-foreground text-xs">Online</Badge>
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
                  className="justify-start hover:bg-white/10 transition-colors"
                  onClick={() => { handleRefreshSocket(); setSpeedDialOpen(false) }}
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Refresh socket state
                </Button>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <div>
                      <Button
                        variant="ghost"
                        className="justify-start hover:bg-white/10 transition-colors"
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
                      <AlertDialog open={confirmMarkAllOpen} onOpenChange={setConfirmMarkAllOpen}>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost"
                            className="justify-start hover:bg-white/10 transition-colors text-orange-500 hover:text-orange-400"
                            disabled={pendingCount === 0}
                          >
                            <Check className="w-4 h-4 mr-2" />
                            Mark all as printed
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent className="glass border-white/10">
                          <AlertDialogHeader>
                            <AlertDialogTitle>Mark all pending as printed?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This will mark {pendingCount} pending request(s) as printed. You can’t undo this action.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel className="bg-white/5 border-white/10 hover:bg-white/10">Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => { handleMarkAllPrinted(); setSpeedDialOpen(false) }} className="bg-accent hover:bg-accent/90">Confirm</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </TooltipTrigger>
                  {pendingCount === 0 && (
                    <TooltipContent side="left" align="center">No pending requests to mark</TooltipContent>
                  )}
                </Tooltip>
              </div>
            </PopoverContent>
          </Popover>
        </TooltipProvider>
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
          <DialogContent className="glass border-white/10">
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
                          return <span>{pct}%</span>
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
          <DialogContent className="glass border-white/10">
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
                  <span className="ml-auto text-xs text-muted-foreground">{pendingDownloadableCount}</span>
                </Button>
                <Button
                  onClick={() => { queueDownloads('all'); setDownloadDialogOpen(false); setSpeedDialOpen(false) }}
                  disabled={allDownloadableCount === 0}
                  className="justify-start bg-accent hover:bg-accent/90"
                >
                  <Download className="w-4 h-4 mr-2" />
                  All files
                  <span className="ml-auto text-xs text-muted-foreground">{allDownloadableCount}</span>
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Links are skipped; only files with available data are downloaded.
              </p>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Offline Dialog */}
      <OfflineDialog isOnline={isOnline} />
    </div >
  )
}

export default function AdminDashboard() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center">Loading...</div>}>
      <AdminDashboardInner />
    </Suspense>
  )
}
