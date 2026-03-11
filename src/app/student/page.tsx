"use client"
export const runtime = 'edge'

import { generateGradient } from '@/lib/avatarUtils'
import { useState, useEffect, useRef, Suspense } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Progress } from '@/components/ui/progress'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Switch } from '@/components/ui/switch'
import {
  Upload,
  Send,
  Users,
  Printer,
  FileText,
  Link,
  Wifi,
  WifiOff,
  Download,
  ArrowDown,
  Eye,
  MessageSquare,
  Code,
  Folder,
  X,
  Plus,
  Share2,
  Search,
  Filter,
  Check,
  CheckCircle2,
  Copy,
  LogOut,
  AlertTriangle,
  Clock,
  Zap,
  Timer,
  FileUp,
  ArrowRight,
  History
} from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import { io } from 'socket.io-client'
import { connectSignaling } from '@/lib/wsClient'
import { getLabSignalingUrls } from '@/lib/signalingRouter'
import { useWebRTC } from '@/hooks/useWebRTC'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { GoogleDocsIcon, GoogleSheetsIcon, GoogleSlidesIcon, GoogleDriveIcon } from '@/components/GoogleIcons'
import { useDropzone } from 'react-dropzone'
import FilePreview from '@/components/FilePreview'
import LoadingSpinner from '@/components/LoadingSpinner'
import { ConnectionStatusBadge } from '@/components/ConnectionStatusBadge'
import { OfflineDialog } from '@/components/OfflineDialog'
import FullPageLoader from '@/components/FullPageLoader'
import { Virtuoso } from 'react-virtuoso'
import { toast } from '@/hooks/use-toast'
import { useNetworkStatus } from '@/hooks/useNetworkStatus'
import { formatBytes } from '@/lib/utils'
import { ToastAction } from '@/components/ui/toast'
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
import { trackEvent, AnalyticsEvent, trackFileSize } from '@/config/analytics'
import { URL_OBFUSCATION_ENABLED, encodeUrlData, decodeUrlData, installConsoleMask } from '@/config/urlObfuscation'

interface User {
  id: string
  name: string
  uniqueId: string
  roomNumber: string
  isOnline: boolean
}

interface FileShare {
  id: string
  fileName: string
  fileSize: number
  fileType: string
  fileData?: string
  fileUrl?: string
  isLink: boolean
  linkUrl?: string
  message?: string
  allowReshare?: boolean
  senderId: string
  receiverId: string
  // Extra display metadata
  senderName?: string
  senderUniqueId?: string
  recipients?: { id: string; name: string; uniqueId: string }[]
  method?: 'PW-RTC' | 'SW-RTC' | 'TW-RTC' | 'PW-RTC-F'
  fileId?: string
  timestamp: Date
}

function StudentDashboardInner() {
  const searchParams = useSearchParams()
  const [userData, setUserData] = useState<any>(null)
  const [onlineUsers, setOnlineUsers] = useState<User[]>([])
  const onlineUsersRef = useRef<User[]>([]) // Ref for resolveTargetId callback to avoid closure issues
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [linkUrl, setLinkUrl] = useState('')
  const [message, setMessage] = useState('')
  const [codeShareText, setCodeShareText] = useState('')
  const [allowReshare, setAllowReshare] = useState(true)
  // Multi-recipient selection
  const [selectedRecipients, setSelectedRecipients] = useState<string[]>([])
  const [selectModalOpen, setSelectModalOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [isConnected, setIsConnected] = useState(false)
  const [receivedFiles, setReceivedFiles] = useState<FileShare[]>([])

  // Network status
  const { isOnline } = useNetworkStatus()
  const [sentFiles, setSentFiles] = useState<FileShare[]>([])
  const [isPageLoading, setIsPageLoading] = useState(true)

  // Show loading screen for minimum 1 second
  useEffect(() => {
    const timer = setTimeout(() => {
      setIsPageLoading(false)
    }, 3000)
    return () => clearTimeout(timer)
  }, [])

  // Keep ref in sync with state (for callbacks that need current value)
  useEffect(() => {
    onlineUsersRef.current = onlineUsers
  }, [onlineUsers])
  const [isUploading, setIsUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [googleWarningOpen, setGoogleWarningOpen] = useState(false)
  const [googleLinkType, setGoogleLinkType] = useState<'docs' | 'sheets' | 'slides' | 'drive' | null>(null)
  const [pendingShareIsPrint, setPendingShareIsPrint] = useState<boolean | null>(null)
  const socketRef = useRef<any>(null)
  const [socketState, setSocketState] = useState<any>(null)
  const [adminId, setAdminId] = useState<string | null>(null)
  const [adminRoom, setAdminRoom] = useState<string | null>(null)
  const [recvProgress, setRecvProgress] = useState<Record<string, { fileName: string; fileType: string; total: number; received: number; fromId: string; message?: string }>>({})
  // Aggregate sender-side batch progress
  const batchTotalRef = useRef(0)
  const batchCompletedRef = useRef(0)
  const currentFileTotalRef = useRef(0)
  const currentFileSentRef = useRef(0)
  const linkCountRef = useRef(0)
  const linksCompletedRef = useRef(0)
  // Tabs control for programmatic switching (reshare flow)
  const [activeTab, setActiveTab] = useState<'share' | 'history' | 'users'>('share')
  const [shareMode, setShareMode] = useState<'files' | 'links'>('files')
  const [codeShareMode, setCodeShareMode] = useState(false)
  // Nested File History sub-tab
  const [historySubTab, setHistorySubTab] = useState<'received' | 'sent'>('received')
  // Preflight modal for offline recipients
  const [offlineModalOpen, setOfflineModalOpen] = useState(false)
  const [offlineUsersInfo, setOfflineUsersInfo] = useState<{ id: string; name: string; uniqueId: string }[]>([])
  const [pendingTargets, setPendingTargets] = useState<string[]>([])
  const [preflightIsPrint, setPreflightIsPrint] = useState(false)

  // Auto-Share (Admin) – queue files and auto-send when admin comes online
  const [autoShareActive, setAutoShareActive] = useState(false)
  const autoShareActiveRef = useRef(false)
  useEffect(() => { autoShareActiveRef.current = autoShareActive }, [autoShareActive])
  const autoShareDataRef = useRef<{ files: File[]; linkUrl: string; message: string; codeText: string; allowReshare: boolean; codeMode: boolean } | null>(null)
  const autoShareExpiryRef = useRef(0)
  const [autoShareTimeLeft, setAutoShareTimeLeft] = useState(0)
  const [autoShareSummary, setAutoShareSummary] = useState<{ fileCount: number; hasLink: boolean; hasCode: boolean; totalSize: string } | null>(null)
  const performShareRef = useRef<any>(null)
  const autoShareBannerRef = useRef<HTMLDivElement>(null)

  // Track current send target count to tailor error messages
  const sendingTargetsCountRef = useRef(0)
  // Track per-recipient transfer status for multi-recipient transfers
  const [transferRecipients, setTransferRecipients] = useState<{ id: string; name: string; uniqueId: string; status: 'pending' | 'sending' | 'completed' | 'skipped' }[]>([])
  // Cache recipient info at selection time for better labels even if they go offline
  const recipientInfoRef = useRef<Record<string, { name: string; uniqueId: string }>>({})
  // Skip/Cancel dialog for transfer failures
  const [skipDialogOpen, setSkipDialogOpen] = useState(false)
  const [failingRecipient, setFailingRecipient] = useState<{ id: string; name: string; uniqueId: string } | null>(null)
  const [isMultiRecipientTransfer, setIsMultiRecipientTransfer] = useState(false)
  const [remainingRecipientsCount, setRemainingRecipientsCount] = useState(0)
  const skipDecisionResolverRef = useRef<((decision: 'skip' | 'cancel') => void) | null>(null)
  const [skippedRecipients, setSkippedRecipients] = useState<{ name: string; uniqueId: string }[]>([])
  const [successfulRecipients, setSuccessfulRecipients] = useState<{ name: string; uniqueId: string }[]>([])
  const transferCancelledRef = useRef(false)
  // Success + progress dialogs
  const [successModalOpen, setSuccessModalOpen] = useState(false)
  const [showAllSkippedRecipients, setShowAllSkippedRecipients] = useState(false) // Dialog for viewing all skipped recipients
  const [successInfo, setSuccessInfo] = useState<null | {
    mode: 'sent' | 'received'
    outcome?: 'complete' | 'partial' | 'failed' // Transfer outcome (only for sent mode)
    to: string
    from: string
    totalSize: string
    totalFiles: number
    totalLinks: number
    totalCodes?: number // CodeShare: 1 when code was shared
    recipients: { name: string; uniqueId: string }[]
    successfulRecipients?: { name: string; uniqueId: string }[] // NEW: Who actually received files
    senders?: { name: string; uniqueId: string }[]
    skippedRecipients?: { name: string; uniqueId: string }[]
  }>(null)
  const [showAllRecipients, setShowAllRecipients] = useState(false)
  const [uiProgress, setUiProgress] = useState(0)
  const uiProgressRef = useRef(0)
  useEffect(() => { uiProgressRef.current = uiProgress }, [uiProgress])
  const uploadStartAtRef = useRef<number | null>(null)
  const [forceProgress, setForceProgress] = useState(false)
  // Receiving speed dial state
  const [receiveDialogOpen, setReceiveDialogOpen] = useState(false)
  const [leaveRoomDialogOpen, setLeaveRoomDialogOpen] = useState(false)
  // Receiving counters for badge (received/total)
  const [recvCounter, setRecvCounter] = useState<{ total: number; received: number }>({ total: 0, received: 0 })
  // Guard to deduplicate cancel tracking (fires from both socket + data channel)
  const lastCancelTrackedRef = useRef<number>(0)
  // Track current receive batch items & senders
  const receiveBatchItemsRef = useRef<any[]>([])
  const receiveBatchSendersRef = useRef<Map<string, { name: string; uniqueId: string }>>(new Map())
  // Gating state: defer received success modal until speed dial fully hides
  const [receivedBatchCompletePending, setReceivedBatchCompletePending] = useState(false)
  const receivedBatchCompleteTimerRef = useRef<any>(null)
  // Track last receive-side activity to enforce an inactivity settle window
  const lastRecvActivityAtRef = useRef<number>(0)
  const noteRecvActivity = () => {
    lastRecvActivityAtRef.current = Date.now()
    // If a new activity occurs while a completion is pending, cancel the pending flag
    // so that the summary will only show after the next true completion.
    if (receivedBatchCompletePending) setReceivedBatchCompletePending(false)
  }

  // Ensure progress visibly reaches 100% before showing success
  const ensureProgressComplete = async (minVisibleMs = 1200) => {
    const startedAt = uploadStartAtRef.current || performance.now()
    setForceProgress(true)
    setIsUploading(true)
    setUploadProgress(100)
    return new Promise<void>((resolve) => {
      const check = () => {
        const elapsed = performance.now() - startedAt
        const uiDone = uiProgressRef.current >= 99.8
        if (elapsed >= minVisibleMs && uiDone) {
          resolve()
        } else {
          requestAnimationFrame(check)
        }
      }
      requestAnimationFrame(check)
    })
  }

  // History: Received controls
  const [rSearchQuery, setRSearchQuery] = useState('')
  const [rDebouncedQuery, setRDebouncedQuery] = useState('')
  const [rSortOrder, setRSortOrder] = useState<'newest' | 'oldest'>('newest')
  const [rTypeFilter, setRTypeFilter] = useState<'all' | 'files' | 'links' | 'code'>('all')
  const [rSortMenuOpen, setRSortMenuOpen] = useState(false)
  const [rIndex, setRIndex] = useState<Map<string, string>>(new Map())

  // Auto-download toggle (default: ON)
  const [autoDownload, setAutoDownload] = useState(true)
  const autoDownloadRef = useRef(true)
  useEffect(() => { autoDownloadRef.current = autoDownload }, [autoDownload])

  // History: Sent controls
  const [sSearchQuery, setSSearchQuery] = useState('')
  const [sDebouncedQuery, setSDebouncedQuery] = useState('')
  const [sSortOrder, setSSortOrder] = useState<'newest' | 'oldest'>('newest')
  const [sTypeFilter, setSTypeFilter] = useState<'all' | 'files' | 'links' | 'code'>('all')
  const [sSortMenuOpen, setSSortMenuOpen] = useState(false)
  const [sIndex, setSIndex] = useState<Map<string, string>>(new Map())

  // Debouncers
  useEffect(() => { const id = setTimeout(() => setRDebouncedQuery(rSearchQuery.trim().toLowerCase()), 200); return () => clearTimeout(id) }, [rSearchQuery])
  useEffect(() => { const id = setTimeout(() => setSDebouncedQuery(sSearchQuery.trim().toLowerCase()), 200); return () => clearTimeout(id) }, [sSearchQuery])

  // Build indices
  useEffect(() => {
    const idx = new Map<string, string>()
    for (const it of receivedFiles) {
      const text = [it.fileName, it.senderName || '', it.senderUniqueId || '', it.message || '', it.fileId || '']
        .join(' ')
        .toLowerCase()
      idx.set(it.id, text)
    }
    setRIndex(idx)
  }, [receivedFiles])
  useEffect(() => {
    const idx = new Map<string, string>()
    for (const it of sentFiles) {
      const recips = (it.recipients || []).map(r => `${r.name} ${r.uniqueId}`).join(' ')
      const text = [it.fileName, recips, it.message || '', it.fileId || '']
        .join(' ')
        .toLowerCase()
      idx.set(it.id, text)
    }
    setSIndex(idx)
  }, [sentFiles])

  const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')
  const highlightWith = (query: string, text: string) => {
    if (!query || !text) return text
    try {
      const re = new RegExp(`(${escapeRegExp(query)})`, 'ig')
      const parts = text.split(re)
      return parts.map((p, i) => i % 2 === 1
        ? <mark key={i} className="bg-blue-200/60 dark:bg-blue-300/30 text-blue-900 dark:text-blue-50 rounded px-0.5 animate-in fade-in-0 duration-200">{p}</mark>
        : <span key={i}>{p}</span>)
    } catch {
      return text
    }
  }

  // Moved up so metrics can call it safely before declaration
  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  // ID helpers
  const random5 = () => String(Math.floor(10000 + Math.random() * 90000))
  const isGoogleDocs = (url?: string) => !!url && (url.includes('docs.google.com') || url.includes('drive.google.com'))
  const makeFileId = (isLink: boolean, linkUrl?: string) => {
    if (isLink) return (isGoogleDocs(linkUrl) ? 'D' : 'L') + random5()
    return 'F' + random5()
  }

  const rProcessed = (() => {
    let arr = receivedFiles
    if (rTypeFilter === 'files') arr = arr.filter(a => !a.isLink && a.fileType !== 'code')
    else if (rTypeFilter === 'links') arr = arr.filter(a => a.isLink)
    else if (rTypeFilter === 'code') arr = arr.filter(a => a.fileType === 'code')
    if (rDebouncedQuery) arr = arr.filter(a => (rIndex.get(a.id) || '').includes(rDebouncedQuery))
    arr = arr.slice().sort((a, b) => rSortOrder === 'newest' ? +new Date(b.timestamp) - +new Date(a.timestamp) : +new Date(a.timestamp) - +new Date(b.timestamp))
    return arr
  })()

  const sProcessed = (() => {
    let arr = sentFiles
    if (sTypeFilter === 'files') arr = arr.filter(a => !a.isLink && a.fileType !== 'code')
    else if (sTypeFilter === 'links') arr = arr.filter(a => a.isLink)
    else if (sTypeFilter === 'code') arr = arr.filter(a => a.fileType === 'code')
    if (sDebouncedQuery) arr = arr.filter(a => (sIndex.get(a.id) || '').includes(sDebouncedQuery))
    arr = arr.slice().sort((a, b) => sSortOrder === 'newest' ? +new Date(b.timestamp) - +new Date(a.timestamp) : +new Date(a.timestamp) - +new Date(b.timestamp))
    return arr
  })()

  // Metrics for processed (visible) lists
  const rFilesCount = rProcessed.filter(f => !f.isLink && f.fileType !== 'code').length
  const rLinksCount = rProcessed.filter(f => f.isLink).length
  const rCodeCount = rProcessed.filter(f => f.fileType === 'code').length
  const rTotalSize = formatFileSize(rProcessed.reduce((sum, f) => sum + (f.isLink ? 0 : f.fileSize), 0))
  const sFilesCount = sProcessed.filter(f => !f.isLink && f.fileType !== 'code').length
  const sLinksCount = sProcessed.filter(f => f.isLink).length
  const sCodeCount = sProcessed.filter(f => f.fileType === 'code').length
  const sTotalSize = formatFileSize(sProcessed.reduce((sum, f) => sum + (f.isLink ? 0 : f.fileSize), 0))
  // Active filter indicators (ignore search; only sort/type deviations)
  const rHasActiveFilters = rSortOrder !== 'newest' || rTypeFilter !== 'all'
  const sHasActiveFilters = sSortOrder !== 'newest' || sTypeFilter !== 'all'

  // Helper to update combined batch progress (files bytes + links as unit weight)
  const updateBatchProgress = () => {
    const denom = batchTotalRef.current + linkCountRef.current
    if (denom <= 0) return
    const numer = batchCompletedRef.current + currentFileSentRef.current + linksCompletedRef.current
    const pct = Math.min(100, Math.round((numer / denom) * 100))
    setUploadProgress(pct)
  }
  // Smooth progress for better UX on small files: continuous ramp towards true progress
  useEffect(() => {
    if (!isUploading && !forceProgress) return
    let raf: number
    let running = true
    let last = performance.now()
    const tick = (now?: number) => {
      const t = now ?? performance.now()
      const dt = Math.min(100, Math.max(0, t - last)) // cap dt to avoid jumps
      last = t
      setUiProgress(prev => {
        // Never go backwards
        const target = forceProgress ? 100 : Math.max(prev, uploadProgress)
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
  }, [isUploading, uploadProgress, forceProgress])

  const blobUrlsRef = useRef<Set<string>>(new Set())
  // Recycle bin for undo (holds items briefly until permanent delete)
  const recycleRef = useRef<Map<string, { item: FileShare; timer: any; list: 'received' | 'sent' }>>(new Map())
  const UNDO_MS = 30000

  const webrtc = useWebRTC(socketState, userData?.roomNumber || '', {
    onFileMetadata: (fromId, meta) => {
      noteRecvActivity()
      // Count total incoming files for session badge
      setRecvCounter(prev => {
        // Initialize new batch if starting fresh
        if (prev.total === 0 && prev.received === 0) {
          receiveBatchItemsRef.current = []
          receiveBatchSendersRef.current.clear()
        }
        return { ...prev, total: prev.total + 1 }
      })
      const key = `${fromId}:${meta.fileName}:${meta.fileSize}`
      setRecvProgress(prev => ({
        ...prev,
        [key]: { fileName: meta.fileName, fileType: meta.fileType, total: meta.fileSize, received: 0, fromId, message: meta.message }
      }))
    },
    onFileChunk: (fromId, receivedBytes, total) => {
      noteRecvActivity()
      // Update all entries from this sender that match total size
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
      noteRecvActivity()
      const key = `${fromId}:${meta.fileName}:${meta.fileSize}`
      setRecvProgress(prev => {
        const { [key]: _, ...rest } = prev
        return rest
      })
      // Increment received count; when all reached, reset after a short delay
      setRecvCounter(prev => {
        const next = { total: prev.total, received: Math.min(prev.total, prev.received + 1) }
        // Track this completed file for batch success summary
        try {
          receiveBatchItemsRef.current.push({ fileName: meta.fileName, fileSize: meta.fileSize, isLink: false })
          const sender = onlineUsers.find(u => u.id === fromId)
          const senderName = (meta as any)?.senderName || sender?.name || 'Unknown'
          const senderUniqueId = (meta as any)?.senderUniqueId || sender?.uniqueId || ''
          if (!receiveBatchSendersRef.current.has(fromId)) {
            receiveBatchSendersRef.current.set(fromId, { name: senderName, uniqueId: senderUniqueId })
          }
        } catch { }
        if (next.received >= next.total && next.total > 0) {
          // Build & store summary, but defer showing modal until speed dial hides
          const totalBytes = receiveBatchItemsRef.current.reduce((sum, f: any) => sum + (f.fileSize || 0), 0)
          const totalFiles = receiveBatchItemsRef.current.filter(f => !f.isLink).length
          const totalLinks = receiveBatchItemsRef.current.filter(f => f.isLink).length
          const senders = Array.from(receiveBatchSendersRef.current.values())
          const fromStr = senders.length === 1
            ? `${senders[0].name} (${senders[0].uniqueId || '—'})`
            : senders.slice(0, 3).map(s => `${s.name} (${s.uniqueId || '—'})`).join(', ') + (senders.length > 3 ? ` +${senders.length - 3} more` : '')
          const toStr = `${userData?.name || 'You'} (${userData?.uniqueId || '—'}) (You)`
          setSuccessInfo({
            mode: 'received',
            to: toStr,
            from: fromStr,
            totalSize: formatFileSize(totalBytes),
            totalFiles,
            totalLinks,
            recipients: [{ name: userData?.name || 'You', uniqueId: userData?.uniqueId || '—' }],
            senders: senders
          })
          // Flag pending completion; effect will open modal once speed dial auto-hides
          setReceivedBatchCompletePending(true)
        }
        return next
      })
      const sender = onlineUsers.find(u => u.id === fromId)
      const senderName = (meta as any)?.senderName || sender?.name || (fromId === adminId ? `Lab Admin (Room ${adminRoom || userData?.roomNumber || ''})` : 'Unknown')
      const senderUniqueId = (meta as any)?.senderUniqueId || sender?.uniqueId || (fromId === adminId ? 'ADMIN' : '')
      // Track blob URL for cleanup
      try { if (fileUrl?.startsWith('blob:')) blobUrlsRef.current.add(fileUrl) } catch { }
      setReceivedFiles(prev => [{
        id: Date.now().toString() + Math.random(),
        fileName: meta.fileName,
        fileSize: meta.fileSize,
        fileType: meta.fileType,
        fileUrl: fileUrl,
        isLink: false,
        message: meta.message,
        allowReshare: (meta as any)?.allowReshare ?? true,
        senderId: fromId,
        receiverId: userData?.id || '',
        senderName,
        senderUniqueId,
        fileId: (meta as any)?.fileId || makeFileId(false),
        method: (meta as any)?.method,
        timestamp: new Date()
      }, ...prev])

      // Analytics: track file shared + file size
      trackEvent(AnalyticsEvent.FILE_SHARED)
      trackFileSize(meta.fileSize)

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
    onLink: (fromId, linkUrl, message, senderInfo) => {
      noteRecvActivity()
      const sender = onlineUsers.find(u => u.id === fromId)
      const senderName = senderInfo?.name || sender?.name || (fromId === adminId ? `Lab Admin (Room ${adminRoom || userData?.roomNumber || ''})` : 'Unknown')
      const senderUniqueId = senderInfo?.uniqueId || sender?.uniqueId || (fromId === adminId ? 'ADMIN' : '')

      // Add to history immediately
      setReceivedFiles(prev => [{
        id: Date.now().toString() + Math.random(),
        fileName: linkUrl,
        fileSize: 0,
        fileType: 'link',
        isLink: true,
        linkUrl,
        message,
        allowReshare: senderInfo?.allowReshare ?? true,
        senderId: fromId,
        receiverId: userData?.id || '',
        senderName,
        senderUniqueId,
        fileId: (senderInfo as any)?.fileId || makeFileId(true, linkUrl),
        method: (senderInfo as any)?.method,
        timestamp: new Date()
      }, ...prev])

      // Analytics: track link shared
      trackEvent(AnalyticsEvent.LINK_SHARED)

      // Treat link as an instant progress item so the speed dial and dialog appear
      const key = `${fromId}:link:${Date.now()}:${Math.random()}`
      setRecvProgress(prev => ({
        ...prev,
        [key]: { fileName: linkUrl, fileType: 'link', total: 1, received: 1, fromId, message }
      }))

      // Initialize new batch if starting fresh and track for success summary
      setRecvCounter(prev => {
        if (prev.total === 0 && prev.received === 0) {
          receiveBatchItemsRef.current = []
          receiveBatchSendersRef.current.clear()
        }
        // Track this completed link for batch summary
        try {
          receiveBatchItemsRef.current.push({ fileName: linkUrl, fileSize: 0, isLink: true })
          if (!receiveBatchSendersRef.current.has(fromId)) {
            receiveBatchSendersRef.current.set(fromId, { name: senderName, uniqueId: senderUniqueId })
          }
        } catch { }

        const next = { total: prev.total + 1, received: prev.received + 1 }
        if (next.received >= next.total && next.total > 0) {
          // Build & store summary, but defer showing modal until speed dial hides
          const totalBytes = receiveBatchItemsRef.current.reduce((sum, f: any) => sum + (f.fileSize || 0), 0)
          const totalFiles = receiveBatchItemsRef.current.filter(f => !f.isLink).length
          const totalLinks = receiveBatchItemsRef.current.filter(f => f.isLink).length
          const senders = Array.from(receiveBatchSendersRef.current.values())
          const fromStr = senders.length === 1
            ? `${senders[0].name} (${senders[0].uniqueId || '—'})`
            : senders.slice(0, 3).map(s => `${s.name} (${s.uniqueId || '—'})`).join(', ') + (senders.length > 3 ? ` +${senders.length - 3} more` : '')
          const toStr = `${userData?.name || 'You'} (${userData?.uniqueId || '—'}) (You)`
          setSuccessInfo({
            mode: 'received',
            to: toStr,
            from: fromStr,
            totalSize: formatFileSize(totalBytes),
            totalFiles,
            totalLinks,
            recipients: [{ name: userData?.name || 'You', uniqueId: userData?.uniqueId || '—' }],
            senders: senders
          })
          setReceivedBatchCompletePending(true)
        }
        return next
      })

      // Hold the link entry briefly so the FAB/dialog are visible, then remove it
      setTimeout(() => {
        setRecvProgress(prev => {
          const { [key]: _omit, ...rest } = prev
          return rest
        })
      }, 700)
    },
    // Sender-side progress (aggregated across batch)
    onSendStart: (_to, _name, total) => {
      currentFileTotalRef.current = total
      currentFileSentRef.current = 0
      // If this is the first file in the batch, show bar from 0
      setIsUploading(true)
      if (batchCompletedRef.current === 0) setUploadProgress(0)
    },
    onSendProgress: (_to, _name, sent, _total) => {
      currentFileSentRef.current = sent
      updateBatchProgress()
    },
    onSendComplete: () => {
      batchCompletedRef.current += currentFileTotalRef.current
      currentFileSentRef.current = 0
      const doneBytes = batchCompletedRef.current >= batchTotalRef.current
      const doneLinks = linksCompletedRef.current >= linkCountRef.current
      if (batchTotalRef.current + linkCountRef.current > 0 && doneBytes && doneLinks) {
        setUploadProgress(100)
        setTimeout(() => {
          setIsUploading(false)
          setUploadProgress(0)
          batchTotalRef.current = 0
          batchCompletedRef.current = 0
          currentFileTotalRef.current = 0
          currentFileSentRef.current = 0
          linkCountRef.current = 0
          linksCompletedRef.current = 0
        }, 400)
      } else {
        updateBatchProgress()
      }
    },
    onSendFailed: (_to, _name, reason) => {
      console.log('Send failed:', reason)
    }, onMessage: (fromId, messageContent, sender) => {
      noteRecvActivity()
      // Use sender info from message if available, otherwise fallback to lookup
      const senderName = sender?.name || (onlineUsers.find(u => u.id === fromId)?.name) || (fromId === adminId ? `Lab Admin (Room ${adminRoom || userData?.roomNumber || ''})` : 'Unknown')
      const senderUniqueId = sender?.uniqueId || (onlineUsers.find(u => u.id === fromId)?.uniqueId) || (fromId === adminId ? 'ADMIN' : '')

      // Add to received files as a code entry
      setReceivedFiles(prev => [{
        id: Date.now().toString() + Math.random(),
        fileName: messageContent.slice(0, 50) + (messageContent.length > 50 ? '...' : ''),
        fileSize: messageContent.length,
        fileType: 'code',
        isLink: false,
        message: messageContent,
        allowReshare: sender?.allowReshare ?? true,
        senderId: fromId,
        receiverId: userData?.id || '',
        senderName,
        senderUniqueId,
        fileId: 'C' + Math.floor(10000 + Math.random() * 90000),
        timestamp: new Date()
      }, ...prev])

      // Analytics: track code shared
      trackEvent(AnalyticsEvent.CODE_SHARED)

      // Track for batch summary
      setRecvCounter(prev => {
        if (prev.total === 0 && prev.received === 0) {
          receiveBatchItemsRef.current = []
          receiveBatchSendersRef.current.clear()
        }
        receiveBatchItemsRef.current.push({ fileName: 'Message', fileSize: messageContent.length, isLink: false, isMessage: true })
        if (!receiveBatchSendersRef.current.has(fromId)) {
          receiveBatchSendersRef.current.set(fromId, { name: senderName, uniqueId: senderUniqueId })
        }
        const next = { total: prev.total + 1, received: prev.received + 1 }
        if (next.received >= next.total && next.total > 0) {
          const senders = Array.from(receiveBatchSendersRef.current.values())
          const fromStr = senders.length === 1
            ? `${senders[0].name} (${senders[0].uniqueId || '—'})`
            : senders.slice(0, 3).map(s => `${s.name} (${s.uniqueId || '—'})`).join(', ') + (senders.length > 3 ? ` +${senders.length - 3} more` : '')
          const toStr = `${userData?.name || 'You'} (${userData?.uniqueId || '—'}) (You)`
          setSuccessInfo({
            mode: 'received',
            to: toStr,
            from: fromStr,
            totalSize: formatFileSize(messageContent.length),
            totalFiles: 0,
            totalLinks: 0,
            totalCodes: 1,
            recipients: [{ name: userData?.name || 'You', uniqueId: userData?.uniqueId || '—' }],
            senders
          })
          setReceivedBatchCompletePending(true)
        }
        return next
      })
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

      // Analytics: track canceled transfer (deduplicate — fires from both socket + data channel)
      const now = Date.now()
      if (now - lastCancelTrackedRef.current > 5000) {
        lastCancelTrackedRef.current = now
        trackEvent(AnalyticsEvent.CANCELED_TRANSFER)
      }

      // Show permanent toast instead of dialog
      const senderName = sender?.name || 'Sender'
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
              <span className="font-medium">{senderName}</span> ({senderUniqueId}) stopped the transfer.
            </div>
            <div className="text-xs text-muted-foreground bg-muted/50 p-2.5 rounded-md border border-border/50 flex items-start gap-2">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-500" />
              <span>Any files fully received before cancellation are still available in your history.</span>
            </div>
          </div>
        ) as any,
        variant: 'default',
        duration: Infinity,
      })
    }
  })

  // Effect: when received batch is marked complete AND speed dial visibility condition becomes false, show success modal.
  useEffect(() => {
    if (!receivedBatchCompletePending) return
    const speedDialVisible = (Object.keys(recvProgress).length > 0 || (recvCounter.total > 0 && recvCounter.received < recvCounter.total))
    const settleMs = 800
    const now = Date.now()
    const sinceLast = now - (lastRecvActivityAtRef.current || 0)
    const ready = !speedDialVisible && sinceLast >= settleMs && successInfo?.mode === 'received'

    if (ready) {
      setReceiveDialogOpen(false)
      setSuccessModalOpen(true)
      setReceivedBatchCompletePending(false)
      setRecvCounter({ total: 0, received: 0 })
      return
    }

    // Otherwise, wait for whichever condition isn't yet satisfied
    if (receivedBatchCompleteTimerRef.current) clearTimeout(receivedBatchCompleteTimerRef.current)
    const delay = Math.max(0, settleMs - sinceLast, 200)
    receivedBatchCompleteTimerRef.current = setTimeout(() => {
      const stillHidden = !(Object.keys(recvProgress).length > 0 || (recvCounter.total > 0 && recvCounter.received < recvCounter.total))
      const inactive = (Date.now() - (lastRecvActivityAtRef.current || 0)) >= settleMs
      if (receivedBatchCompletePending && stillHidden && inactive && successInfo?.mode === 'received') {
        setReceiveDialogOpen(false)
        setSuccessModalOpen(true)
        setReceivedBatchCompletePending(false)
        setRecvCounter({ total: 0, received: 0 })
      }
    }, delay)
  }, [receivedBatchCompletePending, recvProgress, recvCounter, successInfo])

  // Cleanup timer on unmount
  useEffect(() => {
    return () => { if (receivedBatchCompleteTimerRef.current) clearTimeout(receivedBatchCompleteTimerRef.current) }
  }, [])

  // Install console mask on mount (hides wss:// URLs from DevTools Console)
  useEffect(() => {
    installConsoleMask()
  }, [])

  useEffect(() => {
    // Obfuscated URL: single `s` param containing encoded room + user
    const obfuscatedParam = searchParams?.get('s')
    if (URL_OBFUSCATION_ENABLED && obfuscatedParam) {
      try {
        const decoded = decodeUrlData(obfuscatedParam) as { room: string; user: any }
        setUserData(decoded.user)
        initializeSocket(decoded.user, decoded.room)

        // Replace address bar with the opaque hash (strip any readable fallback params)
        if (typeof window !== 'undefined') {
          window.history.replaceState({}, '', `/student?s=${obfuscatedParam}`)
        }
      } catch (error) {
        console.error('Failed to decode session data:', error)
      }
      return
    }

    // Legacy / obfuscation-off fallback: plain room + user params
    const userParam = searchParams?.get('user')
    const roomParam = searchParams?.get('room')
    if (userParam && roomParam) {
      try {
        const user = JSON.parse(decodeURIComponent(userParam))
        setUserData(user)
        initializeSocket(user, roomParam)

        // Root-level fix: if obfuscation is enabled but we received plain params
        // (e.g. homepage bundle was cached), re-encode the URL now so the address
        // bar never shows readable data.
        if (URL_OBFUSCATION_ENABLED && typeof window !== 'undefined') {
          const token = encodeUrlData({ room: roomParam, user })
          window.history.replaceState({}, '', `/student?s=${token}`)
        }
      } catch (error) {
        console.error('Failed to parse user data:', error)
      }
    }
  }, [searchParams])

  // No local/session storage: keep history/UI only in memory for this session
  // Cleanup blob URLs on unmount
  useEffect(() => {
    return () => {
      try {
        blobUrlsRef.current.forEach((u) => { try { URL.revokeObjectURL(u) } catch { } })
        blobUrlsRef.current.clear()
      } catch { }
    }
  }, [])

  // Delete with confirm is handled in FilePreview; here we implement Undo window and delayed revoke
  const schedulePermanentDelete = (id: string, list: 'received' | 'sent', item: FileShare) => {
    const timer = setTimeout(() => {
      // Finalize: revoke object URL if applicable
      try {
        if (item?.fileUrl && item.fileUrl.startsWith('blob:')) {
          URL.revokeObjectURL(item.fileUrl)
          blobUrlsRef.current.delete(item.fileUrl)
        }
      } catch { }
      recycleRef.current.delete(id)
    }, UNDO_MS)
    recycleRef.current.set(id, { item, timer, list })
  }

  const deleteReceived = (id: string) => {
    let removed: FileShare | undefined
    setReceivedFiles(prev => {
      removed = prev.find(f => f.id === id)
      return prev.filter(f => f.id !== id)
    })
    if (!removed) return
    schedulePermanentDelete(id, 'received', removed)
    let t: any
    t = toast({
      title: 'Item deleted',
      description: 'You can undo this action for the next 30 seconds.',
      action: (
        <ToastAction altText="Undo delete" onClick={() => {
          const rec = recycleRef.current.get(id)
          if (rec) {
            clearTimeout(rec.timer)
            recycleRef.current.delete(id)
            setReceivedFiles(prev => [rec.item, ...prev])
          }
          try { t?.dismiss?.() } catch { }
        }}>Undo</ToastAction>
      ),
    })
  }

  const deleteSent = (id: string) => {
    let removed: FileShare | undefined
    setSentFiles(prev => {
      removed = prev.find(f => f.id === id)
      return prev.filter(f => f.id !== id)
    })
    if (!removed) return
    schedulePermanentDelete(id, 'sent', removed)
    let t: any
    t = toast({
      title: 'Item deleted',
      description: 'You can undo this action for the next 30 seconds.',
      action: (
        <ToastAction altText="Undo delete" onClick={() => {
          const rec = recycleRef.current.get(id)
          if (rec) {
            clearTimeout(rec.timer)
            recycleRef.current.delete(id)
            setSentFiles(prev => [rec.item, ...prev])
          }
          try { t?.dismiss?.() } catch { }
        }}>Undo</ToastAction>
      ),
    })
  }

  const initializeSocket = (user: any, roomNumber: string) => {
    // Initialize socket connection using sharded signaling router (with auto-failover)
    const signalingUrls = getLabSignalingUrls(roomNumber)
    let socket: any
    if (signalingUrls.length > 0) {
      socket = connectSignaling(signalingUrls)
    } else {
      // Fallback to Next.js Socket.IO route when no signaling Worker URL is set
      // Note: Pages build exposes this at /api/socket/io
      socket = io({ path: '/api/socket/io' })
    }
    socketRef.current = socket
    setSocketState(socket)

    let presenceTimer: any = null

    socket.on('connect', () => {
      setIsConnected(true)
      socket.emit('join-room', { roomNumber, user })
      // Analytics: track student join + room join
      trackEvent(AnalyticsEvent.STUDENT_JOIN, 1, roomNumber)
      trackEvent(AnalyticsEvent.ROOM_JOIN)
      // Periodically request fresh roster to purge stale users server-side
      try { if (presenceTimer) clearInterval(presenceTimer) } catch { }
      presenceTimer = setInterval(() => {
        try { socket.emit('get-room-users', { roomNumber }) } catch { }
      }, 20000)
    })

    socket.on('disconnect', () => {
      setIsConnected(false)
      try { if (presenceTimer) clearInterval(presenceTimer); presenceTimer = null } catch { }
    })

    socket.on('room-users', (users: User[]) => {
      // Filter out Lab Admin entirely from student online users view
      const filtered = users.filter(u => (u as any).uniqueId !== 'ADMIN' && u.id !== adminId)
      // Deduplicate by stable identity; prefer logicalId or uniqueId fallback
      const byKey: Record<string, User> = {}
      for (const u of filtered) {
        const key = (u as any).logicalId || u.uniqueId || u.id
        byKey[key] = u as any
      }
      setOnlineUsers(Object.values(byKey))
    })

    socket.on('user-joined', (user: User) => {
      // Ignore Lab Admin in student online users view
      if ((user as any).uniqueId === 'ADMIN' || user.id === adminId) return
      setOnlineUsers(prev => {
        const key = (user as any).logicalId || user.uniqueId || user.id
        const exists = prev.some(u => ((u as any).logicalId || u.uniqueId || u.id) === key)
        return exists ? prev : [...prev, user]
      })
    })

    socket.on('user-left', (user: User) => {
      const key = (user as any).logicalId || user.uniqueId || user.id
      setOnlineUsers(prev => prev.filter(u => ((u as any).logicalId || u.uniqueId || u.id) !== key))
    })

    // Admin presence
    socket.on('admin-online', (data: { adminId: string; roomNumber: string }) => {
      setAdminId(data.adminId)
      setAdminRoom(data.roomNumber)
    })
    socket.on('admin-offline', () => { setAdminId(null); setAdminRoom(null) })

    // Safety: clear presence timer on unmount of this initializer lifecycle
    // Note: this function is not a React effect; ensure timers cleared on disconnect above
  }

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: (acceptedFiles) => {
      setSelectedFiles(prev => [...prev, ...acceptedFiles])
    },
    multiple: true
  })

  // Handle browser back/navigation away: alert and disconnect to leave room
  useEffect(() => {
    const handleLeave = () => {
      try { socketRef.current?.disconnect() } catch { }
    }
    const handlePopState = () => {
      // Remove user instantly, then alert
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
    }
  }, [])

  // Reconnect socket when network comes back online
  useEffect(() => {
    if (isOnline && !isConnected && socketRef.current && userData) {
      console.log('[LabRoom] Network back online, attempting socket reconnect...')
      const sock = socketRef.current
      if (sock && typeof sock.connect === 'function') {
        try {
          sock.connect()
        } catch (e) {
          console.error('[LabRoom] Socket reconnect failed:', e)
        }
      }
    }
  }, [isOnline, isConnected, userData])

  // Helper to resolve recipient labels
  const getRecipientInfo = (id: string): { id: string; name: string; uniqueId: string } => {
    if (id === 'admin' || (adminId && id === adminId)) {
      return { id, name: `Lab Admin (Room ${adminRoom || userData?.roomNumber || ''})`, uniqueId: 'ADMIN' }
    }
    const u = onlineUsers.find(u => u.id === id)
    if (u) return { id: u.id, name: u.name, uniqueId: u.uniqueId }
    const cached = recipientInfoRef.current[id]
    if (cached) return { id, name: cached.name, uniqueId: cached.uniqueId }
    return { id, name: 'User', uniqueId: id.slice(-6) }
  }

  // Perform share to provided targets (socket ids)
  const resetUploadState = () => {
    setIsUploading(false)
    setUploadProgress(0)
    batchTotalRef.current = 0
    batchCompletedRef.current = 0
    currentFileTotalRef.current = 0
    currentFileSentRef.current = 0
    linkCountRef.current = 0
    linksCompletedRef.current = 0
    setTransferRecipients([])
    setSkippedRecipients([])
    setSuccessfulRecipients([])
    setSkipDialogOpen(false)
    setFailingRecipient(null)
    transferCancelledRef.current = false
  }

  // Skip decision handlers for transfer failures
  const waitForSkipDecision = (): Promise<'skip' | 'cancel'> => {
    return new Promise((resolve) => {
      skipDecisionResolverRef.current = resolve
    })
  }

  const handleSkipDecision = (decision: 'skip' | 'cancel') => {
    if (skipDecisionResolverRef.current) {
      skipDecisionResolverRef.current(decision)
      skipDecisionResolverRef.current = null
    }
    setSkipDialogOpen(false)
    setFailingRecipient(null)
  }

  // --- Auto-Share (Admin) functions ---
  const activateAutoShare = () => {
    const data = {
      files: [...selectedFiles],
      linkUrl,
      message,
      codeText: codeShareText,
      allowReshare,
      codeMode: codeShareMode,
    }
    autoShareDataRef.current = data
    autoShareExpiryRef.current = Date.now() + 15 * 60 * 1000
    setAutoShareTimeLeft(15 * 60)
    setAutoShareActive(true)
    autoShareActiveRef.current = true
    setAutoShareSummary({
      fileCount: data.files.length,
      hasLink: !!data.linkUrl,
      hasCode: data.codeMode && !!data.codeText,
      totalSize: formatFileSize(data.files.reduce((s, f) => s + f.size, 0)),
    })
    setOfflineModalOpen(false)
    // Clear current selection (files are now queued)
    setSelectedFiles([])
    setLinkUrl('')
    setMessage('')
    setCodeShareText('')
    toast({
      title: (
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-full bg-primary/15 flex items-center justify-center">
            <Timer className="w-3 h-3 text-primary" />
          </div>
          <span className="font-semibold">Auto-Share Queued</span>
        </div>
      ) as any,
      description: (
        <div className="space-y-1">
          <p>Files will be sent automatically when admin comes online.</p>
          <p className="text-xs text-muted-foreground">15-minute window • Keep this tab open</p>
        </div>
      ) as any,
      duration: 5000,
    })
    // Scroll to the auto-share banner after a short delay for state to flush
    setTimeout(() => {
      autoShareBannerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 100)
  }

  const cancelAutoShare = (reason: 'manual' | 'expired') => {
    setAutoShareActive(false)
    autoShareActiveRef.current = false
    autoShareExpiryRef.current = 0
    setAutoShareTimeLeft(0)
    autoShareDataRef.current = null
    setAutoShareSummary(null)
    if (reason === 'expired') {
      toast({
        title: (
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-full bg-amber-500/15 flex items-center justify-center">
              <Clock className="w-3 h-3 text-amber-600 dark:text-amber-400" />
            </div>
            <span className="font-semibold">Auto-Share Expired</span>
          </div>
        ) as any,
        description: (
          <div className="space-y-1.5">
            <p>The 15-minute window has passed. Admin did not come online.</p>
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <ArrowRight className="w-3 h-3" />
              Select your files again and try once more.
            </p>
          </div>
        ) as any,
        variant: 'default',
        duration: 10000,
      })
    } else {
      toast({
        title: 'Auto-Share Cancelled',
        description: 'Your queued files have been removed.',
        duration: 3000,
      })
    }
  }

  // Auto-Share countdown timer
  useEffect(() => {
    if (!autoShareActive) return
    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((autoShareExpiryRef.current - Date.now()) / 1000))
      setAutoShareTimeLeft(remaining)
      if (remaining <= 0) {
        clearInterval(interval)
        cancelAutoShare('expired')
      }
    }, 1000)
    return () => clearInterval(interval)
  }, [autoShareActive])

  // Auto-Share: trigger transfer when admin comes online
  useEffect(() => {
    if (!autoShareActive || !adminId) return
    const data = autoShareDataRef.current
    if (!data) return
    // Admin is now online – trigger auto-share!
    const capturedAdminId = adminId
    setAutoShareActive(false)
    autoShareActiveRef.current = false
    autoShareExpiryRef.current = 0
    setAutoShareTimeLeft(0)
    setAutoShareSummary(null)
    // Restore share state for performShare
    setSelectedFiles(data.files)
    setLinkUrl(data.linkUrl)
    setMessage(data.message)
    setCodeShareText(data.codeText)
    setAllowReshare(data.allowReshare)
    setCodeShareMode(data.codeMode)
    autoShareDataRef.current = null
    toast({
      title: (
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-full bg-emerald-500/15 flex items-center justify-center">
            <Zap className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
          </div>
          <span className="font-semibold">Admin is Online!</span>
        </div>
      ) as any,
      description: (
        <p>Initiating auto-share transfer now…</p>
      ) as any,
      duration: 4000,
    })
    // Allow state to flush then call performShare via ref (captures latest closure)
    setTimeout(() => {
      sendingTargetsCountRef.current = 1
      performShareRef.current?.([capturedAdminId], true)
      // Analytics: track auto-share performed
      trackEvent(AnalyticsEvent.AUTO_SHARE)
    }, 200)
  }, [adminId, autoShareActive])

  const performShare = async (targets: string[], isPrintRequest: boolean) => {
    if (targets.length === 0) return

    // Initialize batch aggregation across all targets
    const bytesPerBatch = selectedFiles.reduce((sum, f) => sum + f.size, 0)
    batchTotalRef.current = bytesPerBatch * targets.length
    batchCompletedRef.current = 0
    currentFileTotalRef.current = 0
    currentFileSentRef.current = 0
    // links counted per target
    linkCountRef.current = linkUrl ? targets.length : 0
    linksCompletedRef.current = 0
    if (batchTotalRef.current > 0 || linkCountRef.current > 0) {
      setIsUploading(true)
      setUploadProgress(0)
      setUiProgress(0)
      uploadStartAtRef.current = performance.now()
    }
    // Reset previous success info
    setSuccessInfo(null)
    setSuccessModalOpen(false)

    // Build recipients info (Hoisted for try/catch scope)
    const recipientsInfo: { id: string; name: string; uniqueId: string }[] = targets.map((tid) => {
      if (adminId && tid === adminId) return { id: tid, name: 'Lab Admin', uniqueId: 'ADMIN' }
      const u = onlineUsers.find((ou) => ou.id === tid)
      if (u) return { id: u.id, name: u.name, uniqueId: u.uniqueId }
      const cached = recipientInfoRef.current[tid]
      if (cached) return { id: tid, name: cached.name, uniqueId: cached.uniqueId }
      return { id: tid, name: 'User', uniqueId: tid.slice(-6) }
    })
    const localSuccessfulRecipients: { name: string; uniqueId: string }[] = []
    const localSkippedRecipients: { name: string; uniqueId: string }[] = []

    try {
      const filesToShare: FileShare[] = []
      // Track aggregate method across recipients: PW-RTC(-F) < SW-RTC < TW-RTC
      const rank: Record<string, number> = { 'PW-RTC-F': 1, 'PW-RTC': 1, 'SW-RTC': 2, 'TW-RTC': 3 }
      let aggregateMethod: 'PW-RTC' | 'SW-RTC' | 'TW-RTC' | 'PW-RTC-F' | undefined

      // Initialize recipient transfer status tracking (all pending initially)
      setTransferRecipients(recipientsInfo.map(r => ({ ...r, status: 'pending' as const })))

      // Handle file uploads
      for (const file of selectedFiles) {
        const fileUrlLocal = URL.createObjectURL(file)
        try { blobUrlsRef.current.add(fileUrlLocal) } catch { }
        filesToShare.push({
          id: Date.now().toString() + Math.random(),
          fileName: file.name,
          fileSize: file.size,
          fileType: file.type,
          fileUrl: fileUrlLocal,
          isLink: false,
          message,
          allowReshare,
          senderId: userData.id,
          receiverId: isPrintRequest ? 'admin' : 'multi',
          recipients: recipientsInfo,
          fileId: makeFileId(false),
          timestamp: new Date()
        })
      }

      // Handle link sharing
      if (linkUrl) {
        filesToShare.push({
          id: Date.now().toString() + Math.random(),
          fileName: linkUrl,
          fileSize: 0,
          fileType: 'link',
          isLink: true,
          linkUrl,
          message,
          allowReshare,
          senderId: userData.id,
          receiverId: isPrintRequest ? 'admin' : 'multi',
          recipients: recipientsInfo,
          fileId: makeFileId(true, linkUrl),
          timestamp: new Date()
        })
      }

      // Handle code share mode
      if (codeShareMode && selectedFiles.length === 0 && !linkUrl && codeShareText.trim()) {
        // Show progress for code sending
        setUploadProgress(30)

        // Reset state for per-recipient tracking
        transferCancelledRef.current = false
        setSuccessfulRecipients([])
        setSkippedRecipients([])
        setTransferRecipients(recipientsInfo.map(r => ({ ...r, status: 'pending' as const })))

        const codeLocalSuccessful: { name: string; uniqueId: string }[] = []
        const codeLocalSkipped: { name: string; uniqueId: string }[] = []

        for (let targetIndex = 0; targetIndex < targets.length; targetIndex++) {
          const targetId = targets[targetIndex]

          // Check if transfer was cancelled
          if (transferCancelledRef.current) break

          // Mark this recipient as 'sending'
          setTransferRecipients(prev => prev.map(r => r.id === targetId ? { ...r, status: 'sending' as const } : r))

          const recipientInfo = getRecipientInfo(targetId)
          let recipientFailed = false

          try {
            webrtc.ensureConnection(targetId)
            await webrtc.sendMessage(targetId, codeShareText, { name: userData.name, uniqueId: userData.uniqueId, allowReshare })
          } catch (error) {
            console.error('CodeShare error for recipient:', targetId, error)
            recipientFailed = true
          }

          // If cancelled mid-transfer, mark current recipient as skipped and break
          if (transferCancelledRef.current && !recipientFailed) {
            setTransferRecipients(prev => prev.map(r => r.id === targetId ? { ...r, status: 'skipped' as const } : r))
            codeLocalSkipped.push({ name: recipientInfo.name, uniqueId: recipientInfo.uniqueId })
            setSkippedRecipients(prev => [...prev, { name: recipientInfo.name, uniqueId: recipientInfo.uniqueId }])
            break
          }

          // Handle failure: show skip/cancel dialog
          if (recipientFailed) {
            const remainingCount = targets.length - targetIndex - 1 - codeLocalSkipped.length
            const isMulti = targets.length > 1

            setFailingRecipient({ id: targetId, name: recipientInfo.name, uniqueId: recipientInfo.uniqueId })
            setRemainingRecipientsCount(Math.max(0, remainingCount))
            setIsMultiRecipientTransfer(isMulti)
            setSkipDialogOpen(true)

            const decision = await waitForSkipDecision()

            setTransferRecipients(prev => prev.map(r => r.id === targetId ? { ...r, status: 'skipped' as const } : r))
            codeLocalSkipped.push({ name: recipientInfo.name, uniqueId: recipientInfo.uniqueId })
            setSkippedRecipients(prev => [...prev, { name: recipientInfo.name, uniqueId: recipientInfo.uniqueId }])

            if (decision === 'cancel') {
              transferCancelledRef.current = true
              break
            } else {
              continue
            }
          }

          // Mark this recipient as 'completed'
          setTransferRecipients(prev => prev.map(r => r.id === targetId ? { ...r, status: 'completed' as const } : r))
          codeLocalSuccessful.push({ name: recipientInfo.name, uniqueId: recipientInfo.uniqueId })
          setSuccessfulRecipients(prev => [...prev, { name: recipientInfo.name, uniqueId: recipientInfo.uniqueId }])
        }

        // If cancelled, mark remaining unprocessed recipients as skipped
        if (transferCancelledRef.current) {
          const processedIds = new Set([
            ...codeLocalSuccessful.map(r => r.uniqueId),
            ...codeLocalSkipped.map(r => r.uniqueId)
          ])
          for (const recipient of recipientsInfo) {
            if (!processedIds.has(recipient.uniqueId)) {
              codeLocalSkipped.push({ name: recipient.name, uniqueId: recipient.uniqueId })
              setSkippedRecipients(prev => [...prev, { name: recipient.name, uniqueId: recipient.uniqueId }])
              setTransferRecipients(prev => prev.map(r => r.id === recipient.id ? { ...r, status: 'skipped' as const } : r))
            }
          }
        }

        // Determine outcome
        const hasSuccessful = codeLocalSuccessful.length > 0
        const hasSkipped = codeLocalSkipped.length > 0
        const allSkipped = codeLocalSkipped.length === targets.length

        let codeOutcome: 'complete' | 'partial' | 'failed'
        if (allSkipped || !hasSuccessful) {
          codeOutcome = 'failed'
        } else if (hasSkipped) {
          codeOutcome = 'partial'
        } else {
          codeOutcome = 'complete'
        }

        setUploadProgress(100)

        // Add to sent history only if at least one succeeded
        if (hasSuccessful) {
          const codeEntry: FileShare = {
            id: Date.now().toString() + Math.random(),
            fileName: codeShareText.slice(0, 50) + (codeShareText.length > 50 ? '...' : ''),
            fileSize: codeShareText.length,
            fileType: 'code',
            isLink: false,
            message: codeShareText,
            allowReshare,
            senderId: userData.id,
            receiverId: isPrintRequest ? 'admin' : 'multi',
            recipients: recipientsInfo,
            fileId: 'C' + Math.floor(10000 + Math.random() * 90000),
            timestamp: new Date()
          }
          setSentFiles(prev => [codeEntry, ...prev])
        }

        setCodeShareText('')
        setSelectedRecipients([])
        setCodeShareMode(false)

        // Show result
        await ensureProgressComplete(codeOutcome === 'failed' ? 400 : 1200)
        setForceProgress(false)
        setIsUploading(false)
        setUiProgress(0)
        setUploadProgress(0)
        setTransferRecipients([])
        setSkipDialogOpen(false)
        setFailingRecipient(null)

        setSuccessInfo({
          mode: 'sent',
          outcome: codeOutcome,
          to: codeLocalSuccessful.length > 0
            ? codeLocalSuccessful.map(r => `${r.name} (${r.uniqueId})`).join(', ')
            : (isPrintRequest ? `Lab Admin (Room ${adminRoom || userData.roomNumber})` : '—'),
          from: `${userData.name} (${userData.uniqueId}) (You)`,
          totalSize: formatFileSize(codeShareText.length),
          totalFiles: 0,
          totalLinks: 0,
          totalCodes: 1,
          recipients: recipientsInfo.map(r => ({ name: r.name, uniqueId: r.uniqueId })),
          successfulRecipients: codeLocalSuccessful.length > 0 ? codeLocalSuccessful : undefined,
          skippedRecipients: codeLocalSkipped.length > 0 ? codeLocalSkipped : undefined
        })
        setSuccessModalOpen(true)
        return
      }

      // Send P2P via WebRTC to all targets sequentially (by target then files)
      // Reset state at start
      transferCancelledRef.current = false
      setSuccessfulRecipients([])
      setSkippedRecipients([])

      // Track successful transfers locally (for use after loop)
      // (Locals hoisted to outer scope)

      for (let targetIndex = 0; targetIndex < targets.length; targetIndex++) {
        const targetId = targets[targetIndex]

        // Check if transfer was cancelled
        if (transferCancelledRef.current) break

        // Mark this recipient as 'sending'
        setTransferRecipients(prev => prev.map(r => r.id === targetId ? { ...r, status: 'sending' as const } : r))

        let recipientFailed = false
        const recipientInfo = getRecipientInfo(targetId)

        try {
          webrtc.ensureConnection(targetId)

          for (const entry of filesToShare) {
            if (recipientFailed || transferCancelledRef.current) break

            if (!entry.isLink) {
              const fileObj = selectedFiles.find(f => f.name === entry.fileName && f.size === entry.fileSize)
              if (fileObj) {
                // Callback to resolve current socket ID (user may have refreshed and have new socket ID)
                // Uses ref to ALWAYS get latest onlineUsers (avoids closure capturing stale state)
                const resolveTargetId = () => {
                  const user = onlineUsersRef.current.find(u => u.uniqueId === recipientInfo.uniqueId)
                  return user?.id
                }
                const m = await webrtc.sendFile(targetId, fileObj, { message: entry.message, senderName: userData.name, senderUniqueId: userData.uniqueId, allowReshare, fileId: entry.fileId }, resolveTargetId, () => transferCancelledRef.current)

                // If sendFile returned undefined, check if it's due to cancellation or connection failure
                if (!m) {
                  // If cancelled by user, don't mark as failed - just break out to show summary
                  if (transferCancelledRef.current) break
                  recipientFailed = true
                  break
                }
                if (m && (!aggregateMethod || rank[m] > rank[aggregateMethod])) aggregateMethod = m
              }
            } else if (entry.isLink && entry.linkUrl) {
              const m = await webrtc.sendLink(targetId, entry.linkUrl, entry.message, { name: userData.name, uniqueId: userData.uniqueId }, allowReshare, entry.fileId)

              // If sendLink returned undefined, connection failed (recipient unreachable)
              if (!m) {
                recipientFailed = true
                break
              }
              if (m && (!aggregateMethod || rank[m] > rank[aggregateMethod])) aggregateMethod = m
              linksCompletedRef.current += 1
              const doneBytes = batchCompletedRef.current >= batchTotalRef.current
              const doneLinks = linksCompletedRef.current >= linkCountRef.current
              if (batchTotalRef.current + linkCountRef.current > 0 && doneBytes && doneLinks) {
                setUploadProgress(100)
              } else {
                updateBatchProgress()
              }
            }
          }
        } catch (error) {
          console.error('Transfer error for recipient:', targetId, error)
          recipientFailed = true
        }

        // If cancelled mid-transfer, mark current recipient as skipped and break without showing dialog
        if (transferCancelledRef.current && !recipientFailed) {
          // Mark current recipient as skipped (transfer was interrupted)
          setTransferRecipients(prev => prev.map(r => r.id === targetId ? { ...r, status: 'skipped' as const } : r))
          localSkippedRecipients.push({ name: recipientInfo.name, uniqueId: recipientInfo.uniqueId })
          setSkippedRecipients(prev => [...prev, { name: recipientInfo.name, uniqueId: recipientInfo.uniqueId }])
          break
        }

        // Handle failure: show skip/cancel dialog for user decision
        if (recipientFailed) {
          // Calculate remaining recipients based on array position (not stale state!)
          // Remaining = recipients after current index that haven't been skipped yet
          const remainingCount = targets.length - targetIndex - 1 - localSkippedRecipients.length
          const isMulti = targets.length > 1

          // Set up skip dialog state
          setFailingRecipient({ id: targetId, name: recipientInfo.name, uniqueId: recipientInfo.uniqueId })
          setRemainingRecipientsCount(Math.max(0, remainingCount))
          setIsMultiRecipientTransfer(isMulti)
          setSkipDialogOpen(true)

          // Wait for user decision
          const decision = await waitForSkipDecision()

          // Mark this recipient as skipped
          setTransferRecipients(prev => prev.map(r => r.id === targetId ? { ...r, status: 'skipped' as const } : r))
          localSkippedRecipients.push({ name: recipientInfo.name, uniqueId: recipientInfo.uniqueId })
          setSkippedRecipients(prev => [...prev, { name: recipientInfo.name, uniqueId: recipientInfo.uniqueId }])

          if (decision === 'cancel') {
            // Abort entire transfer
            transferCancelledRef.current = true
            break // Exit the loop
          } else {
            // Continue to next recipient
            continue
          }
        }

        // Mark this recipient as 'completed' and track success
        setTransferRecipients(prev => prev.map(r => r.id === targetId ? { ...r, status: 'completed' as const } : r))
        localSuccessfulRecipients.push({ name: recipientInfo.name, uniqueId: recipientInfo.uniqueId })
        setSuccessfulRecipients(prev => [...prev, { name: recipientInfo.name, uniqueId: recipientInfo.uniqueId }])
      }

      // If cancelled, mark any remaining unprocessed recipients as skipped
      if (transferCancelledRef.current) {
        const processedIds = new Set([
          ...localSuccessfulRecipients.map(r => r.uniqueId),
          ...localSkippedRecipients.map(r => r.uniqueId)
        ])
        for (const recipient of recipientsInfo) {
          if (!processedIds.has(recipient.uniqueId)) {
            localSkippedRecipients.push({ name: recipient.name, uniqueId: recipient.uniqueId })
            setSkippedRecipients(prev => [...prev, { name: recipient.name, uniqueId: recipient.uniqueId }])
            setTransferRecipients(prev => prev.map(r => r.id === recipient.id ? { ...r, status: 'skipped' as const } : r))
          }
        }
      }

      // Determine transfer outcome based on results
      const hasSuccessful = localSuccessfulRecipients.length > 0
      const hasSkipped = localSkippedRecipients.length > 0
      const allSkipped = localSkippedRecipients.length === targets.length

      let outcome: 'complete' | 'partial' | 'failed'
      if (allSkipped || !hasSuccessful) {
        outcome = 'failed'
      } else if (hasSkipped) {
        outcome = 'partial'
      } else {
        outcome = 'complete'
      }

      // Only update history if at least one transfer succeeded
      if (hasSuccessful) {
        if (aggregateMethod) {
          filesToShare.forEach(f => { (f as any).method = aggregateMethod })
        }
        setSentFiles(prev => [...filesToShare, ...prev])
      }

      // Clear selection state
      setSelectedFiles([])
      setLinkUrl('')
      setMessage('')
      setSelectedRecipients([])
      setAllowReshare(true)

      // Prepare feedback info based on outcome
      const totalBytes = hasSuccessful ? filesToShare.filter(f => !f.isLink).reduce((sum, f) => sum + f.fileSize, 0) : 0
      const totalFiles = hasSuccessful ? filesToShare.filter(f => !f.isLink).length : 0
      const totalLinks = hasSuccessful ? filesToShare.filter(f => f.isLink).length : 0
      const fromInfo = `${userData.name} (${userData.uniqueId})`

      setSuccessInfo({
        mode: 'sent',
        outcome,
        to: localSuccessfulRecipients.length > 0
          ? localSuccessfulRecipients.map(r => `${r.name} (${r.uniqueId})`).join(', ')
          : (isPrintRequest ? `Lab Admin (Room ${adminRoom || userData.roomNumber})` : '—'),
        from: `${fromInfo} (You)`,
        totalSize: formatFileSize(totalBytes),
        totalFiles,
        totalLinks,
        recipients: (filesToShare[0]?.recipients || []).map(r => ({ name: r.name, uniqueId: r.uniqueId })),
        successfulRecipients: localSuccessfulRecipients.length > 0 ? localSuccessfulRecipients : undefined,
        skippedRecipients: localSkippedRecipients.length > 0 ? localSkippedRecipients : undefined
      })

      // Ensure progress animation completes (shorter for failed transfers)
      await ensureProgressComplete(outcome === 'failed' ? 400 : 1200)

      // End of progress & open result modal
      setIsUploading(false)
      setForceProgress(false)
      setTransferRecipients([])
      setSkipDialogOpen(false)
      setFailingRecipient(null)
      setSuccessModalOpen(true)
    } catch (error) {
      console.error('Failed to share files:', error)

      // On any error/crash, first show the Unreachable dialog to let user decide
      // Find which recipient was being processed (the one marked as 'sending')
      const currentRecipient = recipientsInfo.find(r => {
        const tr = transferRecipients.find(t => t.id === r.id && t.status === 'sending')
        return !!tr
      }) || recipientsInfo[0] // Fallback to first recipient if none found

      if (currentRecipient) {
        // Calculate remaining recipients
        const processedCount = localSuccessfulRecipients.length + localSkippedRecipients.length
        const remainingCount = Math.max(0, recipientsInfo.length - processedCount - 1)
        const isMulti = recipientsInfo.length > 1

        // Show the Unreachable dialog
        setFailingRecipient({
          id: currentRecipient.id,
          name: currentRecipient.name,
          uniqueId: currentRecipient.uniqueId
        })
        setRemainingRecipientsCount(remainingCount)
        setIsMultiRecipientTransfer(isMulti)
        setSkipDialogOpen(true)

        // Wait for user decision
        const decision = await waitForSkipDecision()

        // Mark as skipped
        localSkippedRecipients.push({ name: currentRecipient.name, uniqueId: currentRecipient.uniqueId })
        setSkippedRecipients(prev => [...prev, { name: currentRecipient.name, uniqueId: currentRecipient.uniqueId }])
      }

      // Now determine outcome and show summary
      const hasSuccessful = localSuccessfulRecipients.length > 0
      const allSkipped = localSkippedRecipients.length >= recipientsInfo.length

      let outcome: 'complete' | 'partial' | 'failed'
      if (allSkipped || !hasSuccessful) {
        outcome = 'failed'
      } else {
        outcome = 'partial'
      }

      setSuccessInfo({
        mode: 'sent',
        outcome,
        to: localSuccessfulRecipients.length > 0
          ? localSuccessfulRecipients.map(r => `${r.name} (${r.uniqueId})`).join(', ')
          : (isPrintRequest ? `Lab Admin (Room ${adminRoom || userData.roomNumber})` : '—'),
        from: `${userData.name} (${userData.uniqueId}) (You)`,
        totalSize: formatFileSize(selectedFiles.reduce((acc, f) => acc + f.size, 0)),
        totalFiles: selectedFiles.length,
        totalLinks: selectedFiles.filter(f => f.type === 'text/uri-list').length,
        recipients: recipientsInfo.map(r => ({ name: r.name, uniqueId: r.uniqueId })),
        successfulRecipients: localSuccessfulRecipients.length > 0 ? localSuccessfulRecipients : undefined,
        skippedRecipients: localSkippedRecipients.length > 0 ? localSkippedRecipients : undefined
      })

      setIsUploading(false)
      setForceProgress(false)
      setTransferRecipients([])
      setSkipDialogOpen(false)
      setFailingRecipient(null)
      setSuccessModalOpen(true)
    } finally {
      // Keep the hook’s onSendComplete in control of the progress bar cleanup
    }
  }
  // Keep ref pointing to latest performShare for auto-share callback
  performShareRef.current = performShare

  // Preflight: check recipients are online; show modal if some are offline
  const preflightAndMaybeShare = (isPrintRequest: boolean, bypassGoogleCheck = false) => {
    // Block if auto-share is already queued for admin
    if (isPrintRequest && autoShareActive) {
      toast({
        title: 'Auto-Share Already Active',
        description: 'Files are already queued for auto-share to admin. Cancel the existing one first.',
        duration: 4000,
      })
      return
    }
    // Allow proceeding if:
    // 1. Has files OR has link OR (codeShareMode is enabled AND has code)
    if (selectedFiles.length === 0 && !linkUrl && !(codeShareMode && codeShareText.trim())) return

    // Google Link Check
    if (!bypassGoogleCheck && linkUrl) {
      let type: 'docs' | 'sheets' | 'slides' | 'drive' | null = null
      const lowerUrl = linkUrl.toLowerCase()

      if (lowerUrl.includes('docs.google.com/spreadsheets') || lowerUrl.includes('sheets.google.com')) {
        type = 'sheets'
      } else if (lowerUrl.includes('docs.google.com/presentation') || lowerUrl.includes('slides.google.com')) {
        type = 'slides'
      } else if (lowerUrl.includes('docs.google.com/document') || lowerUrl.includes('docs.google.com')) {
        type = 'docs'
      } else if (lowerUrl.includes('drive.google.com')) {
        type = 'drive'
      }

      if (type) {
        setGoogleLinkType(type)
        setPendingShareIsPrint(isPrintRequest)
        setGoogleWarningOpen(true)
        return
      }
    }

    // Determine intended recipients in selection form (keep 'admin' placeholder)
    const intended = isPrintRequest ? ['admin'] : selectedRecipients
    if (intended.length === 0) {
      alert(isPrintRequest ? 'Admin is not online yet.' : 'Please select at least one recipient.')
      return
    }

    // Evaluate online status now
    const online: string[] = [] // actual socket ids
    const offline: string[] = [] // ids or 'admin'
    for (const rid of intended) {
      if (rid === 'admin') {
        if (adminId) online.push(adminId)
        else offline.push('admin')
      } else {
        const isOnline = onlineUsers.some(u => u.id === rid)
        if (isOnline) online.push(rid)
        else offline.push(rid)
      }
    }

    if (offline.length > 0) {
      // Prepare modal data
      const info = offline.map(id => getRecipientInfo(id))
      setOfflineUsersInfo(info)
      setPendingTargets(online)
      sendingTargetsCountRef.current = online.length
      setPreflightIsPrint(isPrintRequest)
      setOfflineModalOpen(true)
      // Also prune selection to online-only for clarity in UI
      setSelectedRecipients(prev => prev.filter(id => (id === 'admin' ? !!adminId : onlineUsers.some(u => u.id === id))))
      return
    }

    // All online – proceed immediately
    sendingTargetsCountRef.current = online.length
    performShare(online, isPrintRequest)
  }

  // Legacy helper kept for compatibility if needed
  const readFileAsBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }


  const removeFile = (index: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index))
  }

  // Reshare: bring user to Share tab and prefill file/link/code
  const handleResharePrefill = async (item: { fileName: string; fileType: string; fileSize: number; fileData?: string; fileUrl?: string; linkUrl?: string; message?: string }) => {
    setActiveTab('share')

    // Handle code type reshare
    if (item.fileType === 'code' && item.message) {
      setCodeShareMode(true)
      setCodeShareText(item.message)
      setMessage('')
      setSelectedRecipients([])
      return
    }

    // Handle link reshare
    if (item.linkUrl) {
      setCodeShareMode(false)
      setShareMode('links')
      setLinkUrl(item.linkUrl)
    } else if (item.fileUrl || item.fileData) {
      // Handle file reshare
      try {
        setCodeShareMode(false)
        setShareMode('files')
        let blob: Blob
        if (item.fileUrl) {
          // Fetch blob from object URL
          const resp = await fetch(item.fileUrl)
          blob = await resp.blob()
        } else {
          // Convert dataURL back to Blob
          const base64 = item.fileData as string
          const arr = base64.split(',')
          const mime = arr[0].match(/:(.*?);/)?.[1] || item.fileType
          const bstr = atob(arr[1])
          let n = bstr.length
          const u8arr = new Uint8Array(n)
          while (n--) u8arr[n] = bstr.charCodeAt(n)
          blob = new Blob([u8arr], { type: mime })
        }
        const f = new File([blob], item.fileName, { type: item.fileType })
        setSelectedFiles([f])
      } catch (e) {
        console.error('Failed to prefill file for reshare:', e)
      }
    }
    // Clear previous recipients and message to avoid accidental broadcast
    setSelectedRecipients([])
    setMessage('')
    setCodeShareText('')
  }

  const handleLeaveRoom = () => {
    try { socketRef.current?.disconnect() } catch { }
    try {
      blobUrlsRef.current.forEach((u) => { try { URL.revokeObjectURL(u) } catch { } })
      blobUrlsRef.current.clear()
    } catch { }
    window.location.href = '/'
  }

  if (!userData || isPageLoading) {
    return <FullPageLoader variant="labroom" />
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="container mx-auto px-2 py-3 sm:px-4 sm:py-6">
        {/* Header */}
        <div className="dashboard-header p-3 sm:p-4 rounded-xl mb-4 sm:mb-6 flex flex-col md:flex-row items-center justify-between gap-3 sm:gap-4 overflow-hidden">
          <div className="flex items-center gap-3 sm:gap-4 min-w-0 max-w-full">
            <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-full flex items-center justify-center text-white font-semibold text-base sm:text-lg shrink-0" style={{ backgroundImage: generateGradient(userData.name) }}>
              {userData.name.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 overflow-hidden">
              <h1 className="text-base sm:text-xl font-semibold text-foreground truncate max-w-[55vw] sm:max-w-none">{userData.name}</h1>
              <p className="text-xs sm:text-sm text-muted-foreground truncate">ID: {userData.uniqueId} • Room {userData.roomNumber}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap justify-center">
            <ConnectionStatusBadge
              isOnline={isOnline}
              isSocketConnected={isConnected}
            />
            <Badge variant="outline" className="flex items-center gap-1.5 px-2.5 py-1 text-xs">
              <Users className="w-3.5 h-3.5" />
              {onlineUsers.length + 1 + (adminId ? 1 : 0)} Online
            </Badge>
            <AlertDialog open={leaveRoomDialogOpen} onOpenChange={setLeaveRoomDialogOpen}>
              <AlertDialogTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="border-red-400/50 text-red-700 dark:border-red-500/40 dark:text-red-400 hover:border-red-500 hover:text-red-600 hover:bg-red-50/50 dark:hover:bg-red-950/20 dark:hover:text-red-400 transition-all duration-200"
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
                    You are about to leave <span className="font-medium text-foreground">Room {userData.roomNumber}</span> as <span className="font-medium text-foreground">{userData.name}</span>. All your files, shared links, and session data will be permanently lost.
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
          </div>
        </div>

        {/* Top-level tabs */}
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="w-full">
          <TabsList className="grid w-full grid-cols-3 h-9 sm:h-10 p-1 bg-muted rounded-lg">
            <TabsTrigger value="share" className="text-xs sm:text-sm px-1 sm:px-3">Share Files</TabsTrigger>
            <TabsTrigger value="history" className="text-xs sm:text-sm px-1 sm:px-3">File History</TabsTrigger>
            <TabsTrigger value="users" className="text-xs sm:text-sm px-1 sm:px-3">Online Users</TabsTrigger>
          </TabsList>

          {/* Share Files Tab */}
          <TabsContent value="share" className="mt-3 sm:mt-4">
            <Card className="py-3 sm:py-4">
              <CardHeader className="pb-3 sm:pb-4 px-3 sm:px-6">
                <CardTitle className="flex items-center gap-2 text-base sm:text-lg font-semibold">
                  <Share2 className="w-4 h-4 sm:w-5 sm:h-5" />
                  Share Files
                </CardTitle>
                <CardDescription className="text-xs sm:text-sm">Upload files or share links with friends or submit for printing</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 sm:space-y-4 px-3 sm:px-6">
                {/* Auto-Share (Admin) Active Banner */}
                <AnimatePresence>
                  {autoShareActive && autoShareSummary && (
                    <motion.div
                      ref={autoShareBannerRef}
                      initial={{ opacity: 0, y: -12, scale: 0.97 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -8, scale: 0.97 }}
                      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                    >
                      <div className="relative overflow-hidden rounded-xl border border-primary/20 bg-card shadow-sm">
                        {/* Top accent line */}
                        <div className="h-[2px] bg-primary/30" />

                        <div className="p-4 max-sm:p-3">
                          {/* Header row: title + status badge */}
                          <div className="flex items-center justify-between mb-3 max-sm:mb-2.5">
                            <div className="flex items-center gap-2">
                              <Timer className="w-4 h-4 text-primary" />
                              <h4 className="text-sm font-semibold text-foreground">Auto-Share</h4>
                            </div>
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 text-primary text-xs max-sm:text-[10px] font-medium px-2.5 max-sm:px-2 py-1 max-sm:py-0.5">
                              <span className="relative flex h-1.5 w-1.5">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-primary" />
                              </span>
                              Waiting for Admin
                            </span>
                          </div>

                          {/* Main content: side-by-side (default), stacked on mobile */}
                          <div className="flex flex-row items-center gap-4 max-sm:flex-col max-sm:gap-3">
                            {/* SVG Countdown Ring */}
                            <div className="relative shrink-0">
                              <svg className="w-[88px] h-[88px] max-sm:w-16 max-sm:h-16 -rotate-90" viewBox="0 0 88 88">
                                <circle cx="44" cy="44" r="38" className="fill-none stroke-muted/30" strokeWidth="4" />
                                <circle
                                  cx="44" cy="44" r="38"
                                  className={`fill-none ${autoShareTimeLeft <= 60 ? 'stroke-red-500' : autoShareTimeLeft <= 300 ? 'stroke-amber-500' : 'stroke-primary'}`}
                                  strokeWidth="4"
                                  strokeLinecap="round"
                                  strokeDasharray={`${2 * Math.PI * 38}`}
                                  strokeDashoffset={`${2 * Math.PI * 38 * (1 - autoShareTimeLeft / 900)}`}
                                  style={{ transition: 'stroke-dashoffset 1s linear' }}
                                />
                              </svg>
                              <div className="absolute inset-0 flex flex-col items-center justify-center">
                                <span className={`text-base max-sm:text-sm font-mono font-bold leading-none ${autoShareTimeLeft <= 60 ? 'text-red-500' : autoShareTimeLeft <= 300 ? 'text-amber-500' : 'text-foreground'}`}>
                                  {Math.floor(autoShareTimeLeft / 60)}:{(autoShareTimeLeft % 60).toString().padStart(2, '0')}
                                </span>
                                <span className="text-[10px] max-sm:text-[8px] text-muted-foreground leading-none mt-1 max-sm:mt-0.5">remaining</span>
                              </div>
                            </div>

                            {/* Details column */}
                            <div className="flex-1 min-w-0 space-y-2.5 max-sm:w-full max-sm:space-y-2">
                              {/* Queued items */}
                              <div className="space-y-1">
                                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide max-sm:text-center">Queued</p>
                                <div className="flex items-center gap-2 flex-wrap max-sm:justify-center">
                                  {autoShareSummary.fileCount > 0 && (
                                    <span className="inline-flex items-center gap-1.5 rounded-md bg-secondary/80 px-2 py-1 text-xs font-medium text-foreground">
                                      <FileUp className="w-3 h-3 text-muted-foreground" />
                                      {autoShareSummary.fileCount} file{autoShareSummary.fileCount > 1 ? 's' : ''}
                                      <span className="text-muted-foreground font-normal">({autoShareSummary.totalSize})</span>
                                    </span>
                                  )}
                                  {autoShareSummary.hasLink && (
                                    <span className="inline-flex items-center gap-1.5 rounded-md bg-secondary/80 px-2 py-1 text-xs font-medium text-foreground">
                                      <Link className="w-3 h-3 text-muted-foreground" />
                                      1 link
                                    </span>
                                  )}
                                  {autoShareSummary.hasCode && (
                                    <span className="inline-flex items-center gap-1.5 rounded-md bg-secondary/80 px-2 py-1 text-xs font-medium text-foreground">
                                      <Code className="w-3 h-3 text-muted-foreground" />
                                      Code snippet
                                    </span>
                                  )}
                                </div>
                              </div>

                              {/* Action row */}
                              <div className="flex flex-row items-center justify-between max-sm:flex-col max-sm:gap-1.5">
                                <p className="text-xs max-sm:text-[10px] text-muted-foreground max-sm:text-center">Will send instantly when admin connects</p>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                                  onClick={() => cancelAutoShare('manual')}
                                >
                                  <X className="w-3 h-3 mr-1" />
                                  Cancel
                                </Button>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Code Share Toggle */}
                <div className="flex items-center justify-between p-2.5 sm:p-3 bg-secondary/50 dark:bg-secondary/30 rounded-xl border border-border/50">
                  <div className="flex items-center gap-2.5 sm:gap-3">
                    <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg bg-gradient-to-br from-emerald-500/30 to-cyan-500/30 dark:from-emerald-500/20 dark:to-cyan-500/20 flex items-center justify-center shrink-0">
                      <Code className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-emerald-500" />
                    </div>
                    <div>
                      <label htmlFor="code-share-toggle" className="text-sm font-medium cursor-pointer">
                        Code Share
                      </label>
                      <p className="text-xs text-muted-foreground">Share code snippets directly</p>
                    </div>
                  </div>
                  <Switch
                    id="code-share-toggle"
                    checked={codeShareMode}
                    onCheckedChange={setCodeShareMode}
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
                          placeholder="// Paste your code here...&#10;function example() {&#10;  return 'Hello World';&#10;}"
                          value={codeShareText}
                          onChange={(e) => setCodeShareText(e.target.value)}
                          rows={6}
                          className="resize-none font-mono text-xs sm:text-sm bg-slate-800 text-slate-200 dark:bg-slate-900 dark:text-slate-100 border-slate-600 overflow-auto"
                          style={{ fontFamily: 'Consolas, Monaco, monospace', maxHeight: '200px' }}
                        />
                        <p className="text-xs text-muted-foreground">
                          Share code snippets that receivers can copy directly
                        </p>
                      </div>

                      {/* Allow reshare toggle */}
                      <div className="flex items-center justify-between">
                        <Label htmlFor="allow-reshare-msg">Allow recipients to reshare</Label>
                        <Switch id="allow-reshare-msg" checked={allowReshare} onCheckedChange={(v) => setAllowReshare(!!v)} />
                      </div>

                      {/* Share To selector */}
                      <div className="space-y-2">
                        <Label>Share To:</Label>
                        <Dialog open={selectModalOpen} onOpenChange={setSelectModalOpen}>
                          <DialogTrigger asChild>
                            <Button variant="outline" className="justify-between w-full">
                              <span>{selectedRecipients.length > 0 ? `${selectedRecipients.length} recipient${selectedRecipients.length > 1 ? 's' : ''} selected` : 'Select recipients'}</span>
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="sm:max-w-2xl p-0 gap-0 overflow-hidden flex flex-col max-h-[85vh]">
                            {/* Fixed Header */}
                            <div className="p-6 pb-4 shrink-0">
                              <DialogHeader>
                                <DialogTitle>Select Recipients</DialogTitle>
                                <DialogDescription>Choose one or more recipients to share with.</DialogDescription>
                              </DialogHeader>
                            </div>

                            {/* Scrollable Content Area */}
                            <div className="flex-1 overflow-y-auto px-6 min-h-0">
                              <Tabs defaultValue="users" className="w-full">
                                <TabsList className="w-full sticky top-0 bg-background z-10">
                                  <TabsTrigger value="users" className="flex-1">Online Users</TabsTrigger>
                                </TabsList>
                                <TabsContent value="users" className="space-y-3 mt-3">
                                  <div className="relative">
                                    <Input
                                      placeholder="Search users by name or ID"
                                      value={searchQuery}
                                      onChange={(e) => setSearchQuery(e.target.value)}
                                      className="pl-9"
                                    />
                                    <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                                  </div>
                                  {/* Select All Row */}
                                  {(() => {
                                    const filteredUsers = onlineUsers
                                      .filter(u => u.uniqueId !== 'ADMIN' && u.id !== adminId)
                                      .filter(u => (u.name + ' ' + u.uniqueId).toLowerCase().includes(searchQuery.toLowerCase()))
                                    const allFilteredIds = filteredUsers.map(u => u.id)
                                    const allSelected = filteredUsers.length > 0 && allFilteredIds.every(id => selectedRecipients.includes(id))

                                    if (filteredUsers.length === 0) return null

                                    return (
                                      <div
                                        className={`flex items-center justify-between py-2 px-3 rounded-lg cursor-pointer transition-colors ${allSelected ? 'bg-primary/8' : 'hover:bg-muted/50'}`}
                                        onClick={() => {
                                          if (allSelected) {
                                            setSelectedRecipients(prev => prev.filter(id => !allFilteredIds.includes(id)))
                                          } else {
                                            setSelectedRecipients(prev => {
                                              const newSet = new Set([...prev, ...allFilteredIds])
                                              allFilteredIds.forEach(id => {
                                                const user = filteredUsers.find(u => u.id === id)
                                                if (user) recipientInfoRef.current[id] = { name: user.name, uniqueId: user.uniqueId }
                                              })
                                              return Array.from(newSet)
                                            })
                                          }
                                        }}
                                      >
                                        <div className="flex items-center gap-2">
                                          <span className="text-sm font-medium">{allSelected ? 'Deselect All' : 'Select All'}</span>
                                          <span className="text-xs text-muted-foreground">({filteredUsers.length} users)</span>
                                        </div>
                                        <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 transition-colors ${allSelected ? 'bg-primary' : 'border-2 border-muted-foreground/30'}`}>
                                          {allSelected && <Check className="w-3 h-3 text-primary-foreground" />}
                                        </div>
                                      </div>
                                    )
                                  })()}
                                  {/* User List */}
                                  <div className="space-y-1 pb-2">
                                    {onlineUsers
                                      .filter(u => u.uniqueId !== 'ADMIN' && u.id !== adminId)
                                      .filter(u => (u.name + ' ' + u.uniqueId).toLowerCase().includes(searchQuery.toLowerCase()))
                                      .map((user) => (
                                        <div
                                          key={user.id}
                                          className={`flex items-center gap-3 py-2.5 px-3 rounded-lg cursor-pointer transition-colors ${selectedRecipients.includes(user.id) ? 'bg-primary/8' : 'hover:bg-muted/50'}`}
                                          onClick={() => {
                                            setSelectedRecipients(prev =>
                                              prev.includes(user.id)
                                                ? prev.filter(id => id !== user.id)
                                                : [...prev, user.id]
                                            )
                                            recipientInfoRef.current[user.id] = { name: user.name, uniqueId: user.uniqueId }
                                          }}
                                        >
                                          <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-medium" style={{ backgroundImage: generateGradient(user.name) }}>
                                            {user.name.charAt(0).toUpperCase()}
                                          </div>
                                          <div className="flex-1 min-w-0">
                                            <p className="text-sm font-medium truncate">{user.name}</p>
                                            <p className="text-xs text-muted-foreground">{user.uniqueId}</p>
                                          </div>
                                          <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 transition-colors ${selectedRecipients.includes(user.id) ? 'bg-primary' : 'border-2 border-muted-foreground/30'}`}>
                                            {selectedRecipients.includes(user.id) && <Check className="w-3 h-3 text-primary-foreground" />}
                                          </div>
                                        </div>
                                      ))}
                                    {onlineUsers.filter(u => u.uniqueId !== 'ADMIN' && u.id !== adminId).length === 0 && (
                                      <p className="text-center text-muted-foreground py-4">No other users online</p>
                                    )}
                                  </div>
                                </TabsContent>
                              </Tabs>
                            </div>

                            {/* Fixed Footer */}
                            <div className="p-6 pt-4 border-t shrink-0 bg-background">
                              <div className="flex justify-end gap-2">
                                <Button variant="outline" onClick={() => setSelectModalOpen(false)}>Cancel</Button>
                                <Button onClick={() => setSelectModalOpen(false)}>Confirm ({selectedRecipients.length})</Button>
                              </div>
                            </div>
                          </DialogContent>
                        </Dialog>
                      </div>

                      {/* Actions */}
                      <div className="flex flex-col sm:flex-row gap-2">
                        <Button
                          onClick={() => preflightAndMaybeShare(false)}
                          disabled={isUploading || !codeShareText.trim() || selectedRecipients.length === 0}
                          className="flex-1 text-sm"
                        >
                          <Send className="w-4 h-4 mr-2" />
                          Send Message
                        </Button>
                        {/* No Submit For Print button for Code Share - code cannot be sent to Lab Admin */}
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
                    >
                      <Tabs value={shareMode} onValueChange={(v) => setShareMode(v as any)} className="w-full">
                        <TabsList className="grid w-full grid-cols-2 h-9 p-1 bg-muted rounded-lg">
                          <TabsTrigger value="files">Files</TabsTrigger>
                          <TabsTrigger value="links">Links</TabsTrigger>
                        </TabsList>

                        <TabsContent value="files" className="space-y-3 sm:space-y-4">
                          {/* Dropzone */}
                          <div
                            {...getRootProps()}
                            className={`dropzone p-5 sm:p-8 text-center cursor-pointer ${isDragActive ? 'dropzone-active border-primary' : ''
                              }`}
                          >
                            <input {...getInputProps()} />
                            <Upload className="w-8 h-8 sm:w-12 sm:h-12 mx-auto mb-3 sm:mb-4 text-muted-foreground" />
                            {isDragActive ? (
                              <p className="text-primary text-sm sm:text-base">Drop the files here...</p>
                            ) : (
                              <div>
                                <p className="text-muted-foreground mb-1.5 sm:mb-2 text-sm sm:text-base">Drag & drop files here, or click to select</p>
                                <p className="text-xs sm:text-sm text-muted-foreground">Support for multiple files</p>
                              </div>
                            )}
                          </div>

                          {/* Selected files below dropzone */}
                          {selectedFiles.length > 0 && (
                            <div className="space-y-2">
                              <Label>
                                {`Selected ${selectedFiles.length === 1 ? 'File' : 'Files'} (${selectedFiles.length} total, ${formatFileSize(selectedFiles.reduce((sum, f) => sum + f.size, 0))})`}
                              </Label>
                              <div className="max-h-32 overflow-y-auto space-y-2">
                                {selectedFiles.map((file, index) => (
                                  <div key={index} className="flex items-center justify-between p-2 bg-muted/50 rounded-full">
                                    <div className="flex items-center gap-2 min-w-0 flex-1">
                                      <FileText className="w-4 h-4 shrink-0" />
                                      <span className="text-xs sm:text-sm truncate">{file.name}</span>
                                      <span className="text-[10px] sm:text-xs text-muted-foreground shrink-0">({formatFileSize(file.size)})</span>
                                    </div>
                                    <Button variant="ghost" size="sm" onClick={() => removeFile(index)}>
                                      <X className="w-4 h-4" />
                                    </Button>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Message below selected files */}
                          <div className="space-y-1">
                            <Label htmlFor="message">Message (Optional)</Label>
                            <Textarea
                              id="message"
                              placeholder="Add a message like '2 copies for printout'..."
                              value={message}
                              onChange={(e) => setMessage(e.target.value.slice(0, 200))}
                              maxLength={200}
                              rows={3}
                              className={`resize-none overflow-y-auto max-h-24 ${message.length >= 200 ? 'border-red-400 focus-visible:ring-red-400' : ''}`}
                            />
                            <span className={`text-xs text-right block ${message.length > 180 ? 'text-red-500' : 'text-muted-foreground'}`}>
                              {message.length}/200
                            </span>
                          </div>

                          {/* Allow reshare toggle */}
                          <div className="flex items-center justify-between">
                            <Label htmlFor="allow-reshare">Allow recipients to reshare</Label>
                            <Switch id="allow-reshare" checked={allowReshare} onCheckedChange={(v) => setAllowReshare(!!v)} />
                          </div>

                          {/* Share To selector as modal trigger */}
                          <div className="space-y-2">
                            <Label>Share To:</Label>
                            <Dialog open={selectModalOpen} onOpenChange={setSelectModalOpen}>
                              <DialogTrigger asChild>
                                <Button variant="outline" className="justify-between w-full">
                                  <span>{selectedRecipients.length > 0 ? `${selectedRecipients.length} recipient${selectedRecipients.length > 1 ? 's' : ''} selected` : 'Select recipients'}</span>
                                </Button>
                              </DialogTrigger>
                              <DialogContent className="sm:max-w-2xl p-0 gap-0 overflow-hidden flex flex-col max-h-[85vh]">
                                {/* Fixed Header */}
                                <div className="p-6 pb-4 shrink-0">
                                  <DialogHeader>
                                    <DialogTitle>Select Recipients</DialogTitle>
                                    <DialogDescription>Choose one or more recipients to share with.</DialogDescription>
                                  </DialogHeader>
                                </div>

                                {/* Scrollable Content Area */}
                                <div className="flex-1 overflow-y-auto px-6 min-h-0">
                                  <Tabs defaultValue="users" className="w-full">
                                    <TabsList className="grid grid-cols-2 w-full sticky top-0 bg-background z-10">
                                      <TabsTrigger value="users">Online Users</TabsTrigger>
                                      <TabsTrigger value="labs">Lab Rooms</TabsTrigger>
                                    </TabsList>
                                    {/* Online Users tab with search and multi-select */}
                                    <TabsContent value="users" className="space-y-3 mt-3">
                                      <div className="relative">
                                        <Input
                                          placeholder="Search users by name or ID"
                                          value={searchQuery}
                                          onChange={(e) => setSearchQuery(e.target.value)}
                                          className="pl-9"
                                        />
                                        <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                                      </div>
                                      {/* Select All Row */}
                                      {(() => {
                                        const filteredUsers = onlineUsers
                                          .filter(u => u.uniqueId !== 'ADMIN' && u.id !== adminId)
                                          .filter(u => (u.name + ' ' + u.uniqueId).toLowerCase().includes(searchQuery.toLowerCase()))
                                        const allFilteredIds = filteredUsers.map(u => u.id)
                                        const allSelected = filteredUsers.length > 0 && allFilteredIds.every(id => selectedRecipients.includes(id))

                                        if (filteredUsers.length === 0) return null

                                        return (
                                          <div
                                            className={`flex items-center justify-between py-2 px-3 rounded-lg cursor-pointer transition-colors ${allSelected ? 'bg-primary/8' : 'hover:bg-muted/50'}`}
                                            onClick={() => {
                                              if (allSelected) {
                                                setSelectedRecipients(prev => prev.filter(id => !allFilteredIds.includes(id)))
                                              } else {
                                                setSelectedRecipients(prev => {
                                                  const newSet = new Set([...prev, ...allFilteredIds])
                                                  allFilteredIds.forEach(id => {
                                                    const user = filteredUsers.find(u => u.id === id)
                                                    if (user) recipientInfoRef.current[id] = { name: user.name, uniqueId: user.uniqueId }
                                                  })
                                                  return Array.from(newSet)
                                                })
                                              }
                                            }}
                                          >
                                            <div className="flex items-center gap-2">
                                              <span className="text-sm font-medium">{allSelected ? 'Deselect All' : 'Select All'}</span>
                                              <span className="text-xs text-muted-foreground">({filteredUsers.length} users)</span>
                                            </div>
                                            <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 transition-colors ${allSelected ? 'bg-primary' : 'border-2 border-muted-foreground/30'}`}>
                                              {allSelected && <Check className="w-3 h-3 text-primary-foreground" />}
                                            </div>
                                          </div>
                                        )
                                      })()}
                                      {/* User List */}
                                      <div className="space-y-1">
                                        {onlineUsers
                                          .filter(u => u.uniqueId !== 'ADMIN' && u.id !== adminId)
                                          .filter(u => (u.name + ' ' + u.uniqueId).toLowerCase().includes(searchQuery.toLowerCase()))
                                          .map(user => {
                                            const checked = selectedRecipients.includes(user.id)
                                            return (
                                              <div
                                                key={user.id}
                                                className={`flex items-center gap-3 py-2.5 px-3 rounded-lg cursor-pointer transition-colors ${checked ? 'bg-primary/8' : 'hover:bg-muted/50'}`}
                                                onClick={() => {
                                                  setSelectedRecipients(prev => {
                                                    const isSelected = prev.includes(user.id)
                                                    const next = isSelected ? prev.filter(id => id !== user.id) : [...prev, user.id]
                                                    recipientInfoRef.current[user.id] = { name: user.name, uniqueId: user.uniqueId }
                                                    return next
                                                  })
                                                }}
                                              >
                                                <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-medium shrink-0" style={{ backgroundImage: generateGradient(user.name) }}>
                                                  {user.name.charAt(0).toUpperCase()}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                  <p className="text-sm font-medium truncate">{user.name}</p>
                                                  <p className="text-xs text-muted-foreground">{user.uniqueId}</p>
                                                </div>
                                                <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 transition-colors ${checked ? 'bg-primary' : 'border-2 border-muted-foreground/30'}`}>
                                                  {checked && <Check className="w-3 h-3 text-primary-foreground" />}
                                                </div>
                                              </div>
                                            )
                                          })}
                                        {onlineUsers.filter(u => u.uniqueId !== 'ADMIN' && u.id !== adminId).length === 0 && (
                                          <p className="text-center text-muted-foreground py-4">No users online</p>
                                        )}
                                      </div>
                                    </TabsContent>
                                    {/* Lab Rooms tab */}
                                    <TabsContent value="labs" className="space-y-3 mt-3">
                                      <div className="space-y-1">
                                        {adminId ? (
                                          <div
                                            className={`flex items-center gap-3 py-2.5 px-3 rounded-lg cursor-pointer transition-colors ${selectedRecipients.includes('admin') ? 'bg-primary/8' : 'hover:bg-muted/50'}`}
                                            onClick={() => {
                                              setSelectedRecipients(prev => {
                                                const next = prev.includes('admin') ? prev.filter(id => id !== 'admin') : [...prev, 'admin']
                                                recipientInfoRef.current['admin'] = { name: `Lab Admin (Room ${adminRoom || userData?.roomNumber || ''})`, uniqueId: 'ADMIN' }
                                                return next
                                              })
                                            }}
                                          >
                                            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-400 to-cyan-500 flex items-center justify-center text-white shrink-0">
                                              <Printer className="w-3.5 h-3.5" />
                                            </div>
                                            <div className="flex-1">
                                              <p className="text-sm font-medium">Lab Admin</p>
                                              <p className="text-xs text-muted-foreground">Room {adminRoom || userData.roomNumber}</p>
                                            </div>
                                            <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 transition-colors ${selectedRecipients.includes('admin') ? 'bg-primary' : 'border-2 border-muted-foreground/30'}`}>
                                              {selectedRecipients.includes('admin') && <Check className="w-3 h-3 text-primary-foreground" />}
                                            </div>
                                          </div>
                                        ) : (
                                          <p className="text-center text-muted-foreground py-4">No lab admin online</p>
                                        )}
                                      </div>
                                    </TabsContent>
                                  </Tabs>
                                </div>

                                {/* Fixed Footer */}
                                <div className="p-6 pt-4 border-t shrink-0 bg-background">
                                  <div className="flex justify-end gap-2">
                                    <Button variant="outline" onClick={() => setSelectModalOpen(false)}>Cancel</Button>
                                    <Button onClick={() => setSelectModalOpen(false)}>Confirm ({selectedRecipients.length})</Button>
                                  </div>
                                </div>
                              </DialogContent>
                            </Dialog>
                          </div>

                          {/* Progress */}
                          {/* Progress moved to global dialog */}

                          {/* Actions */}
                          <div className="flex flex-col sm:flex-row gap-2">
                            <Button
                              onClick={() => preflightAndMaybeShare(false)}
                              disabled={isUploading || (selectedFiles.length === 0 && !linkUrl) || selectedRecipients.length === 0}
                              className="flex-1 text-sm"
                            >
                              <Send className="w-4 h-4 mr-2" />
                              Share Files
                            </Button>
                            <Button
                              onClick={() => preflightAndMaybeShare(true)}
                              disabled={isUploading || (selectedFiles.length === 0 && !linkUrl) || autoShareActive}
                              variant="outline"
                              className="flex-1 text-sm"
                            >
                              <Printer className="w-4 h-4 mr-2" />
                              {`Submit For Print (Lab ${userData.roomNumber})`}
                            </Button>
                          </div>
                        </TabsContent>

                        <TabsContent value="links" className="space-y-3 sm:space-y-4">
                          <div className="space-y-2">
                            <Label htmlFor="link">Share Link</Label>
                            <Input
                              id="link"
                              type="url"
                              placeholder="https://docs.google.com/document/d/..."
                              value={linkUrl}
                              onChange={(e) => setLinkUrl(e.target.value)}
                            />
                            <p className="text-sm text-muted-foreground">Share Google Docs, Drive links, or any other web links</p>
                          </div>

                          {/* Message below link input */}
                          <div className="space-y-1">
                            <Label htmlFor="message-link">Message (Optional)</Label>
                            <Textarea
                              id="message-link"
                              placeholder="Add a message like '2 copies for printout'..."
                              value={message}
                              onChange={(e) => setMessage(e.target.value.slice(0, 200))}
                              maxLength={200}
                              rows={3}
                              className={`resize-none overflow-y-auto max-h-24 ${message.length >= 200 ? 'border-red-400 focus-visible:ring-red-400' : ''}`}
                            />
                            <span className={`text-xs text-right block ${message.length > 180 ? 'text-red-500' : 'text-muted-foreground'}`}>
                              {message.length}/200
                            </span>
                          </div>

                          {/* Allow reshare toggle */}
                          <div className="flex items-center justify-between">
                            <Label htmlFor="allow-reshare-link">Allow recipients to reshare</Label>
                            <Switch id="allow-reshare-link" checked={allowReshare} onCheckedChange={(v) => setAllowReshare(!!v)} />
                          </div>

                          {/* Share To selector as modal trigger (same as Files tab) */}
                          <div className="space-y-2">
                            <Label>Share To:</Label>
                            <Dialog open={selectModalOpen} onOpenChange={setSelectModalOpen}>
                              <DialogTrigger asChild>
                                <Button variant="outline" className="justify-between w-full">
                                  <span>{selectedRecipients.length > 0 ? `${selectedRecipients.length} recipient${selectedRecipients.length > 1 ? 's' : ''} selected` : 'Select recipients'}</span>
                                </Button>
                              </DialogTrigger>
                              <DialogContent className="sm:max-w-2xl">
                                <DialogHeader>
                                  <DialogTitle>Select Recipients</DialogTitle>
                                  <DialogDescription>Choose one or more recipients to share with.</DialogDescription>
                                </DialogHeader>
                                <Tabs defaultValue="users" className="w-full mt-2">
                                  <TabsList className="grid grid-cols-2 w-full">
                                    <TabsTrigger value="users">Online Users</TabsTrigger>
                                    <TabsTrigger value="labs">Lab Rooms</TabsTrigger>
                                  </TabsList>
                                  <TabsContent value="users" className="space-y-3">
                                    <div className="relative">
                                      <Input
                                        placeholder="Search users by name or ID"
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        className="pl-9"
                                      />
                                      <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                                    </div>
                                    <div className="max-h-64 overflow-y-auto space-y-2">
                                      {onlineUsers
                                        // Hide Lab Admin from Online Users tab in Select Recipients
                                        .filter(u => u.uniqueId !== 'ADMIN' && u.id !== adminId)
                                        .filter(u => (u.name + ' ' + u.uniqueId).toLowerCase().includes(searchQuery.toLowerCase()))
                                        .map(u => {
                                          const checked = selectedRecipients.includes(u.id)
                                          return (
                                            <label key={u.id} className={`flex items-center gap-3 p-2 rounded border ${checked ? 'border-blue-500 bg-primary/5' : 'border-gray-200 hover:bg-muted/50'}`}>
                                              <input
                                                type="checkbox"
                                                className="accent-blue-600"
                                                checked={checked}
                                                onChange={(e) => {
                                                  setSelectedRecipients(prev => e.target.checked ? Array.from(new Set([...prev, u.id])) : prev.filter(id => id !== u.id))
                                                }}
                                              />
                                              <div className="flex items-center gap-3">
                                                <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-medium" style={{ backgroundImage: generateGradient(u.name) }}>{u.name.charAt(0).toUpperCase()}</div>
                                                <div>
                                                  <p className="text-sm font-medium">{u.name}</p>
                                                  <p className="text-xs text-muted-foreground">{u.uniqueId}</p>
                                                </div>
                                              </div>
                                            </label>
                                          )
                                        })}
                                      {onlineUsers.length === 0 && (
                                        <p className="text-sm text-muted-foreground">No users online</p>
                                      )}
                                    </div>
                                  </TabsContent>
                                  <TabsContent value="labs" className="space-y-3">
                                    <div className="max-h-64 overflow-y-auto space-y-2">
                                      <label className={`flex items-center gap-3 p-2 rounded border ${selectedRecipients.includes('admin') ? 'border-blue-500 bg-primary/5' : 'border-gray-200 hover:bg-muted/50'}`}>
                                        <input
                                          type="checkbox"
                                          className="accent-blue-600"
                                          checked={selectedRecipients.includes('admin')}
                                          onChange={(e) => {
                                            setSelectedRecipients(prev => e.target.checked ? Array.from(new Set([...prev, 'admin'])) : prev.filter(id => id !== 'admin'))
                                          }}
                                        />
                                        <div className="flex items-center gap-3">
                                          <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-medium" style={{ backgroundImage: 'linear-gradient(135deg, #34d399, #06b6d4)' }}>
                                            <Printer className="w-4 h-4" />
                                          </div>
                                          <span>Lab Admin (Room {adminRoom || userData.roomNumber})</span>
                                        </div>
                                      </label>
                                      {!adminId && <p className="text-xs text-orange-600">Admin is currently offline.</p>}
                                    </div>
                                  </TabsContent>
                                </Tabs>
                                <div className="flex justify-end">
                                  <Button onClick={() => setSelectModalOpen(false)}>Done</Button>
                                </div>
                              </DialogContent>
                            </Dialog>
                          </div>

                          {/* Progress */}
                          {/* Progress moved to global dialog */}

                          {/* Actions */}
                          <div className="flex flex-col sm:flex-row gap-2">
                            <Button
                              onClick={() => preflightAndMaybeShare(false)}
                              disabled={isUploading || (selectedFiles.length === 0 && !linkUrl) || selectedRecipients.length === 0}
                              className="flex-1 text-sm"
                            >
                              <Send className="w-4 h-4 mr-2" />
                              Share Files
                            </Button>
                            <Button
                              onClick={() => preflightAndMaybeShare(true)}
                              disabled={isUploading || (selectedFiles.length === 0 && !linkUrl) || autoShareActive}
                              variant="outline"
                              className="flex-1 text-sm"
                            >
                              <Printer className="w-4 h-4 mr-2" />
                              {`Submit For Print (Lab ${userData.roomNumber})`}
                            </Button>
                          </div>
                        </TabsContent>
                      </Tabs>
                    </motion.div>
                  )}
                </AnimatePresence>
              </CardContent>
            </Card>
          </TabsContent>

          {/* File History Tab */}
          <TabsContent value="history" className="mt-3 sm:mt-4">
            <Card className="py-3 sm:py-4">
              <CardHeader className="pb-3 sm:pb-4 px-3 sm:px-6">
                <CardTitle className="flex items-center gap-2 text-base sm:text-lg font-semibold">
                  <History className="w-4 h-4 sm:w-5 sm:h-5" />
                  File History
                </CardTitle>
                <CardDescription className="text-xs sm:text-sm">View your sent and received files</CardDescription>
              </CardHeader>
              <CardContent className="px-3 sm:px-6">
                <Tabs value={historySubTab} onValueChange={(v) => setHistorySubTab(v as any)} className="w-full">
                  <TabsList className="grid w-full grid-cols-2 h-9 p-1 bg-muted rounded-lg">
                    <TabsTrigger value="received">Received</TabsTrigger>
                    <TabsTrigger value="sent">Sent</TabsTrigger>
                  </TabsList>

                  <TabsContent value="received" className="space-y-2">
                    {/* Unified toolbar */}
                    <div className="sticky top-0 z-10 space-y-2 md:space-y-0 md:flex md:items-center md:justify-between bg-card border rounded-md p-2">
                      <div className="flex items-center gap-2 w-full md:w-auto">
                        <div className="flex-1 md:flex-initial relative">
                          <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                          <Input
                            placeholder="Search files, names, IDs, messages"
                            value={rSearchQuery}
                            onChange={(e) => setRSearchQuery(e.target.value)}
                            className="h-9 pl-8"
                          />
                        </div>
                        <TooltipProvider>
                          <Popover open={rSortMenuOpen} onOpenChange={setRSortMenuOpen}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <PopoverTrigger asChild>
                                  <Button variant={rHasActiveFilters ? 'default' : 'outline'} size="sm" className="h-9">
                                    <div className="relative">
                                      <Filter className="w-4 h-4" />
                                      {rHasActiveFilters && (
                                        <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-white ring-1 ring-primary-foreground" />
                                      )}
                                    </div>
                                  </Button>
                                </PopoverTrigger>
                              </TooltipTrigger>
                              <TooltipContent side="bottom">Sort & filter</TooltipContent>
                            </Tooltip>
                            <PopoverContent align="end" className="w-64 p-2">
                              <div className="px-1 py-1.5 text-xs text-muted-foreground">Sort order</div>
                              <div className="flex flex-col gap-1 mb-2">
                                <Button variant="ghost" size="sm" className="justify-start" onClick={() => setRSortOrder('newest')}>
                                  {rSortOrder === 'newest' && <Check className="w-4 h-4 mr-2" />} Newest first
                                </Button>
                                <Button variant="ghost" size="sm" className="justify-start" onClick={() => setRSortOrder('oldest')}>
                                  {rSortOrder === 'oldest' && <Check className="w-4 h-4 mr-2" />} Oldest first
                                </Button>
                              </div>
                              <div className="border-t my-2" />
                              <div className="px-1 py-1.5 text-xs text-muted-foreground">Types</div>
                              <div className="flex flex-col gap-1">
                                <Button variant="ghost" size="sm" className="justify-start" onClick={() => setRTypeFilter('all')}>
                                  {rTypeFilter === 'all' && <Check className="w-4 h-4 mr-2" />} All types
                                </Button>
                                <Button variant="ghost" size="sm" className="justify-start" onClick={() => setRTypeFilter('files')}>
                                  {rTypeFilter === 'files' && <Check className="w-4 h-4 mr-2" />} Files only
                                </Button>
                                <Button variant="ghost" size="sm" className="justify-start" onClick={() => setRTypeFilter('links')}>
                                  {rTypeFilter === 'links' && <Check className="w-4 h-4 mr-2" />} Links only
                                </Button>
                                <Button variant="ghost" size="sm" className="justify-start" onClick={() => setRTypeFilter('code')}>
                                  {rTypeFilter === 'code' && <Check className="w-4 h-4 mr-2" />} Code only
                                </Button>
                              </div>
                            </PopoverContent>
                          </Popover>
                        </TooltipProvider>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 justify-start md:justify-end">
                        <div className="px-2 py-1 rounded-full border bg-muted/40 flex items-center gap-1 text-xs">
                          <FileText className="w-3 h-3" /> {rFilesCount} Files
                        </div>
                        <div className="px-2 py-1 rounded-full border bg-muted/40 flex items-center gap-1 text-xs">
                          <Link className="w-3 h-3" /> {rLinksCount} Links
                        </div>
                        <div className="px-2 py-1 rounded-full border bg-muted/40 flex items-center gap-1 text-xs">
                          <Code className="w-3 h-3" /> {rCodeCount} Code
                        </div>
                        <div className="px-2 py-1 rounded-full border bg-muted/40 flex items-center gap-1 text-xs">
                          <Folder className="w-3 h-3" /> {rTotalSize}
                        </div>
                        {/* Auto-Download Toggle with Tooltip */}
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className={`flex items-center gap-2 px-2.5 py-1 rounded-lg border shadow-sm transition-colors ${autoDownload
                                ? 'bg-emerald-50 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-800'
                                : 'bg-card'
                                }`}>
                                <Download className={`w-3.5 h-3.5 transition-colors ${autoDownload ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'
                                  }`} />
                                <span className={`text-xs font-medium transition-colors ${autoDownload ? 'text-emerald-700 dark:text-emerald-300' : ''
                                  }`}>Auto-Download</span>
                                <Switch
                                  id="auto-download-student"
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
                    {/* Inline receiving progress removed in favor of floating dial */}

                    {rProcessed.length === 0 && Object.keys(recvProgress).length === 0 ? (
                      <div className="text-center py-8 animate-in fade-in-0 zoom-in-95">
                        {rTypeFilter === 'links' ? (
                          <Link className="w-12 h-12 mx-auto mb-4 text-blue-500 animate-pulse" />
                        ) : rTypeFilter === 'files' ? (
                          <FileText className="w-12 h-12 mx-auto mb-4 text-gray-400 animate-pulse" />
                        ) : (
                          <FileText className="w-12 h-12 mx-auto mb-4 text-gray-400 animate-pulse" />
                        )}
                        <p className="text-muted-foreground font-medium">
                          {rDebouncedQuery ? (
                            <>No matches for {highlightWith(rDebouncedQuery, `"${rDebouncedQuery}"`)}.</>
                          ) : (
                            <>No items yet.</>
                          )}
                        </p>
                        <div className="flex items-center justify-center gap-2 mt-2">
                          {rDebouncedQuery && (
                            <Button variant="outline" size="sm" onClick={() => setRSearchQuery('')} className="transition hover:scale-[1.02]">Clear search</Button>
                          )}
                          {(rTypeFilter !== 'all') && (
                            <Button variant="outline" size="sm" onClick={() => setRTypeFilter('all')} className="transition hover:scale-[1.02]">Reset filters</Button>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="max-h-96">
                        <Virtuoso
                          style={{ height: '24rem' }}
                          totalCount={rProcessed.length}
                          itemContent={(index) => {
                            const file = rProcessed[index]
                            return (
                              <div className={`mb-3 ${rDebouncedQuery ? 'animate-in fade-in-0 zoom-in-95' : ''}`}>
                                <FilePreview
                                  key={file.id}
                                  file={file}
                                  senderName={file.senderName}
                                  senderUniqueId={file.senderUniqueId}
                                  recipients={undefined}
                                  timestamp={file.timestamp}
                                  onReshare={handleResharePrefill}
                                  onDelete={() => deleteReceived(file.id)}
                                  highlightQuery={rDebouncedQuery}
                                />
                              </div>
                            )
                          }}
                          overscan={8}
                        />
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="sent" className="space-y-2">
                    {/* Unified toolbar */}
                    <div className="sticky top-0 z-10 space-y-2 md:space-y-0 md:flex md:items-center md:justify-between bg-card border rounded-md p-2">
                      <div className="flex items-center gap-2 w-full md:w-auto">
                        <div className="flex-1 md:flex-initial relative">
                          <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                          <Input
                            placeholder="Search files, recipients, messages"
                            value={sSearchQuery}
                            onChange={(e) => setSSearchQuery(e.target.value)}
                            className="h-9 pl-8"
                          />
                        </div>
                        <TooltipProvider>
                          <Popover open={sSortMenuOpen} onOpenChange={setSSortMenuOpen}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <PopoverTrigger asChild>
                                  <Button variant={sHasActiveFilters ? 'default' : 'outline'} size="sm" className="h-9">
                                    <div className="relative">
                                      <Filter className="w-4 h-4" />
                                      {sHasActiveFilters && (
                                        <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-white ring-1 ring-primary-foreground" />
                                      )}
                                    </div>
                                  </Button>
                                </PopoverTrigger>
                              </TooltipTrigger>
                              <TooltipContent side="bottom">Sort & filter</TooltipContent>
                            </Tooltip>
                            <PopoverContent align="end" className="w-64 p-2">
                              <div className="px-1 py-1.5 text-xs text-muted-foreground">Sort order</div>
                              <div className="flex flex-col gap-1 mb-2">
                                <Button variant="ghost" size="sm" className="justify-start" onClick={() => setSSortOrder('newest')}>
                                  {sSortOrder === 'newest' && <Check className="w-4 h-4 mr-2" />} Newest first
                                </Button>
                                <Button variant="ghost" size="sm" className="justify-start" onClick={() => setSSortOrder('oldest')}>
                                  {sSortOrder === 'oldest' && <Check className="w-4 h-4 mr-2" />} Oldest first
                                </Button>
                              </div>
                              <div className="border-t my-2" />
                              <div className="px-1 py-1.5 text-xs text-muted-foreground">Types</div>
                              <div className="flex flex-col gap-1">
                                <Button variant="ghost" size="sm" className="justify-start" onClick={() => setSTypeFilter('all')}>
                                  {sTypeFilter === 'all' && <Check className="w-4 h-4 mr-2" />} All types
                                </Button>
                                <Button variant="ghost" size="sm" className="justify-start" onClick={() => setSTypeFilter('files')}>
                                  {sTypeFilter === 'files' && <Check className="w-4 h-4 mr-2" />} Files only
                                </Button>
                                <Button variant="ghost" size="sm" className="justify-start" onClick={() => setSTypeFilter('links')}>
                                  {sTypeFilter === 'links' && <Check className="w-4 h-4 mr-2" />} Links only
                                </Button>
                                <Button variant="ghost" size="sm" className="justify-start" onClick={() => setSTypeFilter('code')}>
                                  {sTypeFilter === 'code' && <Check className="w-4 h-4 mr-2" />} Code only
                                </Button>
                              </div>
                            </PopoverContent>
                          </Popover>
                        </TooltipProvider>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 justify-start md:justify-end">
                        <div className="px-2 py-1 rounded-full border bg-muted/40 flex items-center gap-1 text-xs">
                          <FileText className="w-3 h-3" /> {sFilesCount} Files
                        </div>
                        <div className="px-2 py-1 rounded-full border bg-muted/40 flex items-center gap-1 text-xs">
                          <Link className="w-3 h-3" /> {sLinksCount} Links
                        </div>
                        <div className="px-2 py-1 rounded-full border bg-muted/40 flex items-center gap-1 text-xs">
                          <Code className="w-3 h-3" /> {sCodeCount} Code
                        </div>
                        <div className="px-2 py-1 rounded-full border bg-muted/40 flex items-center gap-1 text-xs">
                          <Folder className="w-3 h-3" /> {sTotalSize}
                        </div>
                      </div>
                    </div>
                    {sProcessed.length === 0 ? (
                      <div className="text-center py-8 animate-in fade-in-0 zoom-in-95">
                        {sTypeFilter === 'links' ? (
                          <Link className="w-12 h-12 mx-auto mb-4 text-blue-500 animate-pulse" />
                        ) : sTypeFilter === 'files' ? (
                          <FileText className="w-12 h-12 mx-auto mb-4 text-gray-400 animate-pulse" />
                        ) : (
                          <FileText className="w-12 h-12 mx-auto mb-4 text-gray-400 animate-pulse" />
                        )}
                        <p className="text-muted-foreground font-medium">
                          {sDebouncedQuery ? (
                            <>No matches for {highlightWith(sDebouncedQuery, `"${sDebouncedQuery}"`)}.</>
                          ) : (
                            <>No items yet.</>
                          )}
                        </p>
                        <div className="flex items-center justify-center gap-2 mt-2">
                          {sDebouncedQuery && (
                            <Button variant="outline" size="sm" onClick={() => setSSearchQuery('')} className="transition hover:scale-[1.02]">Clear search</Button>
                          )}
                          {(sTypeFilter !== 'all') && (
                            <Button variant="outline" size="sm" onClick={() => setSTypeFilter('all')} className="transition hover:scale-[1.02]">Reset filters</Button>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="max-h-96">
                        <Virtuoso
                          style={{ height: '24rem' }}
                          totalCount={sProcessed.length}
                          itemContent={(index) => {
                            const file = sProcessed[index]
                            return (
                              <div className={`mb-3 ${sDebouncedQuery ? 'animate-in fade-in-0 zoom-in-95' : ''}`}>
                                <FilePreview
                                  key={file.id}
                                  file={file}
                                  senderName={`${userData.name}`}
                                  senderUniqueId={userData.uniqueId}
                                  recipients={file.recipients}
                                  timestamp={file.timestamp}
                                  onReshare={handleResharePrefill}
                                  isOwnItem
                                  onDelete={() => deleteSent(file.id)}
                                  highlightQuery={sDebouncedQuery}
                                />
                              </div>
                            )
                          }}
                          overscan={8}
                        />
                      </div>
                    )}
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Online Users Tab */}
          <TabsContent value="users" className="mt-3 sm:mt-4">
            <Card className="py-3 sm:py-4">
              <CardHeader className="pb-3 sm:pb-4 px-3 sm:px-6">
                <CardTitle className="flex items-center gap-2 text-base sm:text-lg font-semibold">
                  <Users className="w-4 h-4 sm:w-5 sm:h-5" />
                  Online Users
                </CardTitle>
                <CardDescription className="text-xs sm:text-sm">Students currently in Room {userData.roomNumber}</CardDescription>
              </CardHeader>
              <CardContent className="px-3 sm:px-6">
                <div className="space-y-2">
                  <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-medium shrink-0" style={{ backgroundImage: generateGradient(userData.name) }}>
                      {userData.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm overflow-x-auto whitespace-nowrap scrollbar-thin">{userData.name}</p>
                      <p className="text-xs text-muted-foreground truncate">{userData.uniqueId} (You)</p>
                    </div>
                    <Badge className="bg-primary hover:bg-primary text-primary-foreground text-xs shrink-0 hidden sm:inline-flex">Online</Badge>
                  </div>

                  {/* Lab Admin shown at top if online */}
                  {adminId && (
                    <div className="flex items-center gap-3 p-3 hover:bg-muted/50 rounded-lg transition-colors">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-400 to-cyan-500 flex items-center justify-center text-white shadow-sm shrink-0">
                        <Printer className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm overflow-x-auto whitespace-nowrap scrollbar-thin">Lab Admin (Room {adminRoom || userData.roomNumber})</p>
                        <p className="text-xs text-muted-foreground truncate">ADMIN</p>
                      </div>
                      <Badge className="bg-primary hover:bg-primary text-primary-foreground text-xs shrink-0 hidden sm:inline-flex">Online</Badge>
                    </div>
                  )}

                  <div className="max-h-96 overflow-y-auto scrollbar-thin scrollbar-thumb-muted-foreground/20 scrollbar-track-transparent">
                    <Virtuoso
                      style={{ height: '24rem' }}
                      totalCount={onlineUsers.length}
                      itemContent={(index) => {
                        const user = onlineUsers[index]
                        return (
                          <div key={user.id} className="flex items-center gap-3 p-3 hover:bg-muted/50 rounded-lg transition-colors">
                            <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-medium shrink-0" style={{ backgroundImage: generateGradient(user.name) }}>
                              {user.name.charAt(0).toUpperCase()}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-sm overflow-x-auto whitespace-nowrap scrollbar-thin">{user.name}</p>
                              <p className="text-xs text-muted-foreground truncate">{user.uniqueId}</p>
                            </div>
                            <Badge className="bg-primary hover:bg-primary text-primary-foreground text-xs shrink-0 hidden sm:inline-flex">Online</Badge>
                          </div>
                        )
                      }}
                      overscan={8}
                    />
                  </div>

                  {onlineUsers.length === 0 && !adminId && (
                    <p className="text-muted-foreground text-center py-4">No other users online</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Google Link Warning Dialog */}
        <Dialog open={googleWarningOpen} onOpenChange={setGoogleWarningOpen}>
          <DialogContent className="sm:max-w-[500px] p-0 overflow-hidden border-none shadow-lg">
            {/* Top colored bar */}
            <div className={`h-2 w-full ${googleLinkType === 'sheets' ? 'bg-[#0F9D58]' :
              googleLinkType === 'slides' ? 'bg-[#F4B400]' :
                googleLinkType === 'docs' ? 'bg-[#4285F4]' :
                  'bg-[#4285F4]'
              }`} />

            <div className="p-6 flex flex-col gap-6">
              {/* Header with Icon */}
              <div className="flex items-start gap-4">
                <div className="p-3 bg-muted/50 rounded-full shrink-0">
                  {googleLinkType === 'sheets' ? (
                    <GoogleSheetsIcon className="w-8 h-8" />
                  ) : googleLinkType === 'slides' ? (
                    <GoogleSlidesIcon className="w-8 h-8" />
                  ) : googleLinkType === 'docs' ? (
                    <GoogleDocsIcon className="w-8 h-8" />
                  ) : (
                    <GoogleDriveIcon className="w-8 h-8" />
                  )}
                </div>
                <div className="space-y-1 pt-1">
                  <DialogTitle className="text-lg font-semibold text-foreground">
                    {googleLinkType === 'sheets' ? 'Google Sheets Detected' :
                      googleLinkType === 'slides' ? 'Google Slides Detected' :
                        googleLinkType === 'docs' ? 'Google Docs Detected' :
                          'Google Drive Link Detected'}
                  </DialogTitle>
                  <DialogDescription className="text-sm text-muted-foreground">
                    Check sharing permissions
                  </DialogDescription>
                </div>
              </div>

              {/* Content */}
              <div className="text-muted-foreground text-sm leading-relaxed">
                You are sharing a <span className="font-medium text-foreground">
                  {googleLinkType === 'sheets' ? 'Google Sheet' :
                    googleLinkType === 'slides' ? 'Google Slide' :
                      googleLinkType === 'docs' ? 'Google Doc' :
                        'Google Drive File'}
                </span>.
                <br />
                Please ensure that the link has <span className="font-bold text-foreground italic">"Anyone with the link"</span> access enabled so recipients can view it without requesting permission.
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end gap-3 pt-2">
                <Button
                  variant="outline"
                  onClick={() => setGoogleWarningOpen(false)}
                  className="border-gray-200 hover:bg-muted/50 text-foreground font-medium"
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => {
                    setGoogleWarningOpen(false)
                    if (pendingShareIsPrint !== null) {
                      preflightAndMaybeShare(pendingShareIsPrint, true)
                    }
                  }}
                  className={`font-medium text-white shadow-sm ${googleLinkType === 'sheets' ? 'bg-[#0F9D58] hover:bg-[#0B8043]' :
                    googleLinkType === 'slides' ? 'bg-[#F4B400] hover:bg-[#F09300]' :
                      googleLinkType === 'docs' ? 'bg-[#4285F4] hover:bg-[#3367D6]' :
                        'bg-[#4285F4] hover:bg-[#3367D6]'
                    }`}
                >
                  I've Checked, Continue
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Offline recipients modal */}
        <Dialog open={offlineModalOpen} onOpenChange={setOfflineModalOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-yellow-100 text-yellow-700">
                  {/* alert icon */}
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5"><path d="M10.3 2.7c.9-1.6 3.5-1.6 4.4 0l8.3 15.1c.8 1.5-.3 3.2-2.2 3.2H4.2c-1.9 0-3.1-1.7-2.2-3.2L10.3 2.7zM12 8c-.6 0-1 .4-1 1v4c0 .6.4 1 1 1s1-.4 1-1V9c0-.6-.4-1-1-1zm0 8.5a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5z" /></svg>
                </span>
                Some recipients are offline
              </DialogTitle>
              <DialogDescription className="text-muted-foreground">
                These recipients are currently offline and won’t receive the file right now.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {offlineUsersInfo.map(u => (
                <div key={u.id} className="flex items-center justify-between p-2 bg-muted/50 rounded">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-medium" style={{ backgroundImage: generateGradient(u.name) }}>{u.name.charAt(0).toUpperCase()}</div>
                    <div>
                      <p className="text-sm font-medium">{u.name}</p>
                      <p className="text-xs text-muted-foreground">{u.uniqueId}</p>
                    </div>
                  </div>
                  <Badge variant="destructive">Offline</Badge>
                </div>
              ))}
              {offlineUsersInfo.length === 0 && (
                <p className="text-sm text-muted-foreground">No offline recipients detected.</p>
              )}
            </div>
            {pendingTargets.length > 0 && (selectedRecipients.length > 1 || (offlineUsersInfo.length > 0)) && (
              <div className="mt-3 flex items-start gap-2 rounded-md border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-800">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 mt-0.5"><path d="M10.3 2.7c.9-1.6 3.5-1.6 4.4 0l8.3 15.1c.8 1.5-.3 3.2-2.2 3.2H4.2c-1.9 0-3.1-1.7-2.2-3.2L10.3 2.7zM12 8c-.6 0-1 .4-1 1v4c0 .6.4 1 1 1s1-.4 1-1V9c0-.6-.4-1-1-1zm0 8.5a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5z" /></svg>
                <p>File will be shared with other online recipients.</p>
              </div>
            )}
            {/* Auto-Share option when admin is offline for print */}
            {preflightIsPrint && offlineUsersInfo.some(u => u.uniqueId === 'ADMIN') && pendingTargets.length === 0 && !autoShareActive && (
              <div className="mt-3 rounded-xl border border-primary/20 bg-primary/[0.03] dark:bg-primary/[0.06]">
                <div className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center shrink-0">
                      <Timer className="w-5 h-5 text-primary" />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-foreground">Auto-Share</p>
                      <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                        Queue your files and they'll be sent to admin automatically the moment they come online.
                      </p>
                      <div className="flex items-center gap-3 mt-2.5">
                        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                          <Clock className="w-3 h-3" />
                          <span>15 min window</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                          <Zap className="w-3 h-3" />
                          <span>Instant transfer</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
            <div className="flex flex-col sm:flex-row sm:justify-end gap-2 mt-4">
              <Button variant="outline" onClick={() => setOfflineModalOpen(false)}>Cancel</Button>
              {preflightIsPrint && offlineUsersInfo.some(u => u.uniqueId === 'ADMIN') && pendingTargets.length === 0 && !autoShareActive && (
                <Button
                  onClick={activateAutoShare}
                >
                  <Timer className="w-4 h-4 mr-2" />
                  Enable Auto-Share
                </Button>
              )}
              {pendingTargets.length > 0 && (
                <Button
                  onClick={() => { sendingTargetsCountRef.current = pendingTargets.length; performShare(pendingTargets, preflightIsPrint); setOfflineModalOpen(false) }}
                >
                  Proceed
                </Button>
              )}
            </div>
          </DialogContent>
        </Dialog>

        {/* Upload progress dialog (circular redesigned) */}
        <Dialog open={isUploading || forceProgress}>
          <DialogContent className="max-w-md border-primary/20 overflow-hidden">
            <DialogHeader>
              <DialogTitle className="text-lg text-center font-semibold flex items-center justify-center gap-2 text-primary">
                <Upload className="w-5 h-5" />
                Transferring...
              </DialogTitle>
              <DialogDescription className="text-sm text-center text-muted-foreground">
                Keep this tab open until your files finish sending.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col items-center gap-6 py-4 w-full overflow-hidden">
              <div className="relative">
                <svg className="w-36 h-36 -rotate-90" viewBox="0 0 100 100">
                  <circle cx="50" cy="50" r="46" className="stroke-primary/20" strokeWidth="8" fill="none" />
                  <circle
                    cx="50"
                    cy="50"
                    r="46"
                    className="stroke-primary"
                    strokeWidth="8"
                    strokeLinecap="round"
                    fill="none"
                    strokeDasharray={2 * Math.PI * 46}
                    strokeDashoffset={(1 - uiProgress / 100) * 2 * Math.PI * 46}
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <div className="text-2xl font-bold text-primary">{Math.round(uiProgress)}%</div>
                  <div className="text-xs tracking-wide text-muted-foreground mt-1">SENDING</div>
                </div>
              </div>

              {/* Cancel Transfer Button - Now between progress bar and recipients */}
              <Button
                variant="outline"
                size="sm"
                className="text-red-600 border-red-200 hover:bg-red-50 hover:border-red-300"
                onClick={() => {
                  // Notify all recipients about cancellation (current sending and pending)
                  transferRecipients
                    .filter(r => r.status === 'sending' || r.status === 'pending')
                    .forEach(r => {
                      webrtc.sendCancellation(r.id, { name: userData?.name, uniqueId: userData?.uniqueId })
                    })

                  transferCancelledRef.current = true
                  // If skip dialog is waiting, resolve with cancel
                  if (skipDecisionResolverRef.current) {
                    skipDecisionResolverRef.current('cancel')
                    skipDecisionResolverRef.current = null
                  }
                  setSkipDialogOpen(false)
                  // Don't reset state here - let the loop handle cancellation gracefully
                  // so we can show the proper summary dialog (Failed/Partial).
                }}
              >
                <X className="w-3.5 h-3.5 mr-1.5" />
                Cancel Transfer
              </Button>

              {/* Recipients Status List */}
              {transferRecipients.length > 0 && (
                <div className="w-full space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Recipients</span>
                    <span className="text-xs text-muted-foreground">
                      {transferRecipients.filter(r => r.status === 'completed').length}/{transferRecipients.length}
                    </span>
                  </div>
                  <div className="max-h-36 overflow-y-auto space-y-1.5">
                    {transferRecipients.map((recipient) => (
                      <div
                        key={recipient.id}
                        className={`flex items-center gap-2 py-2 px-3 rounded-lg transition-colors overflow-hidden ${recipient.status === 'sending'
                          ? 'bg-primary/8 border border-primary/30'
                          : recipient.status === 'completed'
                            ? 'bg-muted/40'
                            : 'bg-muted/20'
                          }`}
                      >
                        <div
                          className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-medium shrink-0"
                          style={{ backgroundImage: recipient.uniqueId === 'ADMIN' ? 'linear-gradient(135deg, #34d399, #06b6d4)' : generateGradient(recipient.name) }}
                        >
                          {recipient.uniqueId === 'ADMIN' ? <Printer className="w-3.5 h-3.5" /> : recipient.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1 overflow-hidden">
                          <p className="text-sm font-medium truncate">{recipient.name}</p>
                          <p className="text-xs text-muted-foreground truncate">{recipient.uniqueId}</p>
                        </div>
                        <div className="shrink-0">
                          {recipient.status === 'pending' && (
                            <span className="text-xs text-muted-foreground">Queued</span>
                          )}
                          {recipient.status === 'sending' && (
                            <div className="flex items-center gap-1.5">
                              <div className="w-3.5 h-3.5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                              <span className="text-xs font-medium text-primary">Sending</span>
                            </div>
                          )}
                          {recipient.status === 'completed' && (
                            <div className="flex items-center gap-1">
                              <Check className="w-3.5 h-3.5 text-emerald-600" />
                              <span className="text-xs font-medium text-emerald-600">Done</span>
                            </div>
                          )}
                          {recipient.status === 'skipped' && (
                            <div className="flex items-center gap-1">
                              <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                              <span className="text-xs font-medium text-amber-600">Skipped</span>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>

        {/* Success feedback dialog (enhanced) */}
        <Dialog open={successModalOpen} onOpenChange={setSuccessModalOpen}>
          <DialogContent className="sm:max-w-lg p-0 overflow-hidden max-h-[85vh] flex flex-col">
            <DialogHeader className="sr-only">
              <DialogTitle>Transfer complete summary</DialogTitle>
              <DialogDescription>Summary of recently completed file/link transfer</DialogDescription>
            </DialogHeader>
            {successInfo && (
              <div className="p-3 sm:p-5 overflow-y-auto flex-1">
                <div className="flex items-center justify-between mb-3 sm:mb-4">
                  <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
                    {/* Icon based on outcome */}
                    {successInfo.mode === 'received' || successInfo.outcome === 'complete' ? (
                      <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                        <CheckCircle2 className="w-5 h-5 sm:w-6 sm:h-6" />
                      </div>
                    ) : successInfo.outcome === 'partial' ? (
                      <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
                        <AlertTriangle className="w-5 h-5 sm:w-6 sm:h-6" />
                      </div>
                    ) : (
                      <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-red-100 text-red-700 flex items-center justify-center shrink-0">
                        <X className="w-5 h-5 sm:w-6 sm:h-6" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <h3 className="text-sm sm:text-base font-semibold leading-none">
                        {successInfo.mode === 'received'
                          ? (successInfo.totalCodes ? 'Code received' : 'Files received')
                          : successInfo.totalCodes
                            ? (successInfo.outcome === 'complete'
                              ? 'CodeShare complete'
                              : successInfo.outcome === 'partial'
                                ? 'CodeShare partially complete'
                                : 'CodeShare failed')
                            : (successInfo.outcome === 'complete'
                              ? 'Transfer complete'
                              : successInfo.outcome === 'partial'
                                ? 'Transfer partially complete'
                                : 'Transfer failed')}
                      </h3>
                      <p className="text-xs text-muted-foreground">
                        {successInfo.mode === 'received'
                          ? (successInfo.totalCodes ? 'Your code was received successfully' : 'Your items were received successfully')
                          : successInfo.totalCodes
                            ? (successInfo.outcome === 'complete'
                              ? 'Your code was delivered successfully'
                              : successInfo.outcome === 'partial'
                                ? 'Some recipients did not receive the code'
                                : 'Code was not shared')
                            : (successInfo.outcome === 'complete'
                              ? 'Your items were delivered successfully'
                              : successInfo.outcome === 'partial'
                                ? 'Some recipients did not receive the files'
                                : 'No files were transferred')}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="rounded-md border bg-white dark:bg-neutral-900">
                  <div className="grid grid-cols-3 gap-3 sm:gap-4 p-3 sm:p-4">
                    {successInfo.mode === 'sent' ? (
                      <>
                        <div className="col-span-3">
                          <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
                            {successInfo.outcome === 'failed' ? 'Intended Recipients' : 'Sent To'}
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {/* Show successful recipients if any, otherwise show original recipients for failed */}
                            {((successInfo.outcome === 'failed' ? successInfo.recipients : successInfo.successfulRecipients) || successInfo.recipients).slice(0, 6).map((r, i) => {
                              const isSelf = r.uniqueId === userData.uniqueId
                              const isAdmin = r.uniqueId === 'ADMIN'
                              const displayName = isAdmin ? `Lab Admin (Room ${userData.roomNumber})` : r.name
                              const isFailed = successInfo.outcome === 'failed'
                              return (
                                <span key={r.uniqueId + i} className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs ${isFailed ? 'border-red-200 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400' : 'bg-muted/50 dark:bg-neutral-800'
                                  }`}>
                                  <span className="inline-flex w-5 h-5 items-center justify-center rounded-full text-white text-[10px] font-medium" style={{ backgroundImage: isAdmin ? 'linear-gradient(135deg, #34d399, #06b6d4)' : generateGradient(displayName) }}>
                                    {isAdmin ? <Printer className="w-3 h-3" /> : r.name.charAt(0).toUpperCase()}
                                  </span>
                                  {isAdmin ? displayName : `${r.name} (${r.uniqueId})`}
                                  {isSelf ? ' (You)' : ''}
                                </span>
                              )
                            })}
                            {((successInfo.outcome === 'failed' ? successInfo.recipients : successInfo.successfulRecipients) || successInfo.recipients).length > 6 && (
                              <span className="inline-flex items-center rounded-full border px-2.5 py-1 text-xs bg-muted/50 dark:bg-neutral-800">
                                +{((successInfo.outcome === 'failed' ? successInfo.recipients : successInfo.successfulRecipients) || successInfo.recipients).length - 6} more
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="col-span-3 border-t my-1" />
                        <div className={`col-span-3 grid ${successInfo.totalCodes ? 'grid-cols-2' : 'grid-cols-2'} gap-4`}>
                          <div>
                            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">From</div>
                            <div className="text-sm font-medium truncate">{successInfo.from}</div>
                          </div>
                          <div>
                            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Total Size</div>
                            <div className="text-sm font-medium">{successInfo.totalSize}</div>
                          </div>
                          {successInfo.totalCodes ? (
                            <div>
                              <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Code</div>
                              <div className="text-sm font-medium">{successInfo.totalCodes}</div>
                            </div>
                          ) : (
                            <>
                              <div>
                                <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Files</div>
                                <div className="text-sm font-medium">{successInfo.totalFiles}</div>
                              </div>
                              <div>
                                <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Links</div>
                                <div className="text-sm font-medium">{successInfo.totalLinks}</div>
                              </div>
                            </>
                          )}
                        </div>
                        {/* Skipped Recipients Section - Only show for multi-recipient transfers */}
                        {successInfo.skippedRecipients && successInfo.skippedRecipients.length > 0 && successInfo.recipients.length > 1 && (() => {
                          const maxShow = 5
                          const skipped = successInfo.skippedRecipients
                          const remaining = skipped.length - maxShow
                          return (
                            <>
                              <div className="col-span-3 border-t my-1" />
                              <div className="col-span-3">
                                <div className="text-xs uppercase tracking-wide text-amber-600 mb-1 flex items-center gap-1">
                                  <AlertTriangle className="w-3 h-3" />
                                  Skipped Recipients ({skipped.length})
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                  {skipped.slice(0, maxShow).map((r, i) => (
                                    <span key={r.uniqueId + i} className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 dark:bg-amber-900/20 px-2.5 py-1 text-xs text-amber-700 dark:text-amber-400">
                                      <span className="inline-flex w-5 h-5 items-center justify-center rounded-full bg-amber-200 text-amber-700 text-[10px] font-medium">
                                        {r.name.charAt(0).toUpperCase()}
                                      </span>
                                      {r.name} ({r.uniqueId})
                                    </span>
                                  ))}
                                  {remaining > 0 && (
                                    <button
                                      onClick={() => setShowAllSkippedRecipients(true)}
                                      className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-100 dark:bg-amber-900/30 px-2.5 py-1 text-xs text-amber-700 dark:text-amber-400 hover:bg-amber-200 dark:hover:bg-amber-900/50 transition-colors cursor-pointer font-medium"
                                    >
                                      +{remaining} more
                                    </button>
                                  )}
                                </div>
                              </div>
                              {/* Dialog for viewing all skipped recipients */}
                              <Dialog open={showAllSkippedRecipients} onOpenChange={setShowAllSkippedRecipients}>
                                <DialogContent className="max-w-md">
                                  <DialogHeader>
                                    <DialogTitle className="flex items-center gap-2 text-amber-600">
                                      <AlertTriangle className="w-5 h-5" />
                                      Skipped Recipients ({skipped.length})
                                    </DialogTitle>
                                  </DialogHeader>
                                  <div className="space-y-2 max-h-80 overflow-y-auto">
                                    {skipped.map((r, i) => (
                                      <div key={r.uniqueId + i} className="flex items-center gap-3 p-2 rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-900/20">
                                        <span className="inline-flex w-8 h-8 items-center justify-center rounded-full bg-amber-200 text-amber-700 text-sm font-medium flex-shrink-0">
                                          {r.name.charAt(0).toUpperCase()}
                                        </span>
                                        <div className="flex-1 min-w-0">
                                          <span className="text-sm font-medium text-amber-700 dark:text-amber-400 block truncate">{r.name}</span>
                                          <span className="text-xs text-amber-600/70 dark:text-amber-500">{r.uniqueId}</span>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </DialogContent>
                              </Dialog>
                            </>
                          )
                        })()}
                      </>
                    ) : (
                      <>
                        <div className="col-span-3">
                          <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">From</div>
                          <div className="flex flex-wrap gap-1.5">
                            {(successInfo.senders || []).slice(0, 6).map((s, i) => {
                              const isSelf = s.uniqueId === userData.uniqueId
                              const isAdmin = s.uniqueId === 'ADMIN'
                              const displayName = isAdmin ? `Lab Admin (Room ${userData.roomNumber})` : (s.name || 'Unknown')
                              return (
                                <span key={(s.uniqueId || '') + i} className="inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs bg-muted/50 dark:bg-neutral-800">
                                  <span className="inline-flex w-5 h-5 items-center justify-center rounded-full text-white text-[10px] font-medium" style={{ backgroundImage: isAdmin ? 'linear-gradient(135deg, #34d399, #06b6d4)' : generateGradient(displayName) }}>
                                    {isAdmin ? <Printer className="w-3 h-3" /> : (s.name?.charAt(0).toUpperCase() || '?')}
                                  </span>
                                  {isAdmin ? displayName : `${s.name} (${s.uniqueId || '—'})`}
                                  {isSelf ? ' (You)' : ''}
                                </span>
                              )
                            })}
                            {successInfo.senders && successInfo.senders.length > 6 && (
                              <span className="inline-flex items-center rounded-full border px-2.5 py-1 text-xs bg-muted/50 dark:bg-neutral-800">+{successInfo.senders.length - 6} more</span>
                            )}
                            {!successInfo.senders?.length && (
                              <span className="text-sm font-medium">{successInfo.from}</span>
                            )}
                          </div>
                        </div>
                        <div className="col-span-3 border-t my-1" />
                        <div className="col-span-3 grid grid-cols-2 gap-4">
                          <div>
                            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">To</div>
                            <div className="text-sm font-medium truncate">{userData.name} ({userData.uniqueId}) (You)</div>
                          </div>
                          <div>
                            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Total Size</div>
                            <div className="text-sm font-medium">{successInfo.totalSize}</div>
                          </div>
                          {successInfo.totalCodes ? (
                            <div>
                              <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Code</div>
                              <div className="text-sm font-medium">{successInfo.totalCodes}</div>
                            </div>
                          ) : (
                            <>
                              <div>
                                <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Files</div>
                                <div className="text-sm font-medium">{successInfo.totalFiles}</div>
                              </div>
                              <div>
                                <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Links</div>
                                <div className="text-sm font-medium">{successInfo.totalLinks}</div>
                              </div>
                            </>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                  {/* Footer message with outcome-based background */}
                  <div className={`border-t p-3 sm:p-4 text-xs text-muted-foreground dark:text-gray-400 ${successInfo.mode === 'received' || successInfo.outcome === 'complete'
                    ? 'bg-emerald-50/50 dark:bg-emerald-900/10'
                    : successInfo.outcome === 'partial'
                      ? 'bg-amber-50/50 dark:bg-amber-900/10'
                      : 'bg-red-50/50 dark:bg-red-900/10'
                    }`}>
                    {successInfo.totalCodes
                      ? (successInfo.mode === 'received'
                        ? 'Your code was received successfully. Check the File History tab to view or reshare it.'
                        : (successInfo.outcome === 'failed'
                          ? 'Code was not shared. The transfer failed because all recipients were unreachable.'
                          : successInfo.outcome === 'partial'
                            ? 'Not all recipients received the code. Check skipped recipients above.'
                            : 'Your code was shared successfully. Check the File History tab to view or reshare it.'))
                      : (successInfo.outcome === 'failed'
                        ? 'No files were shared. The transfer failed because all recipients were unreachable.'
                        : successInfo.outcome === 'partial'
                          ? 'Not all files were shared. The transfer was partially completed. Check skipped recipients above.'
                          : 'Each item gets a unique File ID. Check the File History tab to view and use them for tracking or resharing.')}
                  </div>
                </div>

                {/* Buttons based on outcome */}
                <div className="mt-3 sm:mt-4 flex flex-wrap gap-2.5 sm:gap-4 justify-center">
                  {successInfo.outcome === 'failed' ? (
                    <Button size="sm" onClick={() => setSuccessModalOpen(false)}>Retry</Button>
                  ) : successInfo.outcome === 'partial' ? (
                    <>
                      <Button size="sm" variant="outline" onClick={() => setSuccessModalOpen(false)}>Retry</Button>
                      <Button size="sm" onClick={() => { setActiveTab('history'); setHistorySubTab('sent'); setSuccessModalOpen(false) }}>Open File History</Button>
                    </>
                  ) : (
                    <>
                      <Button size="sm" variant="outline" onClick={() => { setActiveTab('history'); setHistorySubTab(successInfo.mode === 'received' ? 'received' : 'sent'); setSuccessModalOpen(false) }}>Open File History</Button>
                      <Button size="sm" onClick={() => setSuccessModalOpen(false)}>Done</Button>
                    </>
                  )}
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>



        {/* Skip/Cancel Transfer AlertDialog */}
        <AlertDialog open={skipDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-amber-100 text-amber-700">
                  <AlertTriangle className="w-5 h-5" />
                </span>
                Recipient Unreachable
              </AlertDialogTitle>
              <AlertDialogDescription className="text-muted-foreground">
                {failingRecipient && (
                  <span>
                    <strong>{failingRecipient.name} ({failingRecipient.uniqueId})</strong> appears to be offline or unreachable.
                  </span>
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>

            <div className="py-2">
              {isMultiRecipientTransfer && remainingRecipientsCount > 0 ? (
                <p className="text-sm text-muted-foreground">
                  You can skip this recipient and continue sending to the remaining {remainingRecipientsCount} recipient{remainingRecipientsCount > 1 ? 's' : ''}, or cancel the entire transfer.
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  The transfer cannot continue. Please check if the recipient is online and try again.
                </p>
              )}
            </div>

            <AlertDialogFooter>
              {/* Show Cancel Transfer normally, unless it's the last user in a multi-recipient transfer */}
              {!isMultiRecipientTransfer || remainingRecipientsCount > 0 ? (
                <AlertDialogCancel onClick={() => handleSkipDecision('cancel')}>
                  Cancel Transfer
                </AlertDialogCancel>
              ) : null}
              {/* Always show Skip User for multi-recipient transfers */}
              {isMultiRecipientTransfer && (
                <AlertDialogAction onClick={() => handleSkipDecision('skip')}>
                  Skip User
                </AlertDialogAction>
              )}
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
      {/* Receiving Speed Dial (bottom-right) */}
      {
        (Object.keys(recvProgress).length > 0 || (recvCounter.total > 0 && recvCounter.received < recvCounter.total)) && (
          <div className="fixed bottom-6 right-6 z-50">
            <Button
              className="relative h-14 w-14 rounded-full shadow-lg gradient-primary text-white hover:opacity-90 active:scale-95 transition-all overflow-visible"
              size="icon"
              aria-label="Receiving files"
              onClick={() => setReceiveDialogOpen(true)}
            >
              {/* Animated receiving icon */}
              <ArrowDown className="relative animate-arrow-drop" style={{ height: '20px', width: '20px' }} />
              {/* Pulse + blink badge */}
              <span className="absolute -top-1 right-0">
                <span className="inline-block w-3 h-3 rounded-full bg-white ring-2 ring-primary shadow-md animate-badge-pulse-blink" />
              </span>
            </Button>
          </div>
        )
      }

      {/* Receiving details dialog */}
      <Dialog open={receiveDialogOpen} onOpenChange={setReceiveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Download className="w-5 h-5" />
              Receiving files
            </DialogTitle>
            <DialogDescription>Files currently being received.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 max-w-full">
            {Object.values(recvProgress).map((p, idx) => (
              <div key={idx} className="group relative overflow-hidden rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white/70 dark:bg-neutral-900/60 p-3 shadow-sm max-w-full">
                <div className="flex items-start gap-3 max-w-full">
                  <div className="mt-0.5 flex-1 min-w-0 max-w-full">
                    <p className="text-sm font-medium flex items-center gap-2 max-w-full">
                      <span className="truncate max-w-full" title={p.fileName}>{p.fileName}</span>
                    </p>
                    <div className="mt-2 h-2 w-full rounded-full bg-neutral-200 dark:bg-neutral-700 overflow-hidden">
                      {(() => {
                        const pct = p.total ? Math.min(100, (p.received / p.total) * 100) : 0
                        return <div style={{ width: pct + '%' }} className="h-full bg-emerald-700 transition-[width] duration-300 ease-out" />
                      })()}
                    </div>
                    <div className="mt-1 text-xs text-neutral-600 dark:text-neutral-400 flex justify-between">
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
              <div className="flex flex-col items-center justify-center py-6 text-center border border-dashed border-neutral-300 dark:border-neutral-700 rounded-lg">
                <p className="text-sm text-muted-foreground">All files received.</p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
      {/* Animations moved to global utilities in globals.css */}

      {/* Offline Dialog */}
      <OfflineDialog isOnline={isOnline} />
    </div >
  )
}


export default function StudentPage() {
  return (
    <Suspense fallback={<FullPageLoader variant="labroom" />}>
      <StudentDashboardInner />
    </Suspense>
  )
}
