"use client"

import { useState, useEffect, useRef, Suspense } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Progress } from '@/components/ui/progress'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
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
  Eye,
  MessageSquare,
  Folder,
  X,
  Plus,
  Share2,
  Search
} from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import { io } from 'socket.io-client'
import { useWebRTC } from '@/hooks/useWebRTC'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { useDropzone } from 'react-dropzone'
import FilePreview from '@/components/FilePreview'
import LoadingSpinner from '@/components/LoadingSpinner'

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
  timestamp: Date
}

function StudentDashboardInner() {
  const searchParams = useSearchParams()
  const [userData, setUserData] = useState<any>(null)
  const [onlineUsers, setOnlineUsers] = useState<User[]>([])
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [linkUrl, setLinkUrl] = useState('')
  const [message, setMessage] = useState('')
  const [allowReshare, setAllowReshare] = useState(true)
  // Multi-recipient selection
  const [selectedRecipients, setSelectedRecipients] = useState<string[]>([])
  const [selectModalOpen, setSelectModalOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [isConnected, setIsConnected] = useState(false)
  const [receivedFiles, setReceivedFiles] = useState<FileShare[]>([])
  const [sentFiles, setSentFiles] = useState<FileShare[]>([])
  const [isUploading, setIsUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
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
  // Preflight modal for offline recipients
  const [offlineModalOpen, setOfflineModalOpen] = useState(false)
  const [offlineUsersInfo, setOfflineUsersInfo] = useState<{ id: string; name: string; uniqueId: string }[]>([])
  const [pendingTargets, setPendingTargets] = useState<string[]>([])
  const [preflightIsPrint, setPreflightIsPrint] = useState(false)
  // Error modal for share failures
  const [errorModalOpen, setErrorModalOpen] = useState(false)
  const [errorModalMessage, setErrorModalMessage] = useState('')
  // Track current send target count to tailor error messages
  const sendingTargetsCountRef = useRef(0)
  // Cache recipient info at selection time for better labels even if they go offline
  const recipientInfoRef = useRef<Record<string, { name: string; uniqueId: string }>>({})

  // Helper to update combined batch progress (files bytes + links as unit weight)
  const updateBatchProgress = () => {
    const denom = batchTotalRef.current + linkCountRef.current
    if (denom <= 0) return
    const numer = batchCompletedRef.current + currentFileSentRef.current + linksCompletedRef.current
    const pct = Math.min(100, Math.round((numer / denom) * 100))
    setUploadProgress(pct)
  }

  const webrtc = useWebRTC(socketState, userData?.roomNumber || '', {
    onFileMetadata: (fromId, meta) => {
      const key = `${fromId}:${meta.fileName}:${meta.fileSize}`
      setRecvProgress(prev => ({
        ...prev,
        [key]: { fileName: meta.fileName, fileType: meta.fileType, total: meta.fileSize, received: 0, fromId, message: meta.message }
      }))
    },
    onFileChunk: (fromId, receivedBytes, total) => {
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
  onFileComplete: (fromId, fileBase64, meta) => {
      const key = `${fromId}:${meta.fileName}:${meta.fileSize}`
      setRecvProgress(prev => {
        const { [key]: _, ...rest } = prev
        return rest
      })
  const sender = onlineUsers.find(u => u.id === fromId)
  const senderName = (meta as any)?.senderName || sender?.name || (fromId === adminId ? `Lab Admin (Room ${adminRoom || userData?.roomNumber || ''})` : 'Unknown')
  const senderUniqueId = (meta as any)?.senderUniqueId || sender?.uniqueId || (fromId === adminId ? 'ADMIN' : '')
      setReceivedFiles(prev => [{
        id: Date.now().toString() + Math.random(),
        fileName: meta.fileName,
        fileSize: meta.fileSize,
        fileType: meta.fileType,
        fileData: fileBase64,
        isLink: false,
        message: meta.message,
        allowReshare: (meta as any)?.allowReshare ?? true,
        senderId: fromId,
        receiverId: userData?.id || '',
        senderName,
        senderUniqueId,
        timestamp: new Date()
      }, ...prev])
    },
    onLink: (fromId, linkUrl, message, senderInfo) => {
      const sender = onlineUsers.find(u => u.id === fromId)
      const senderName = senderInfo?.name || sender?.name || (fromId === adminId ? `Lab Admin (Room ${adminRoom || userData?.roomNumber || ''})` : 'Unknown')
      const senderUniqueId = senderInfo?.uniqueId || sender?.uniqueId || (fromId === adminId ? 'ADMIN' : '')
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
        timestamp: new Date()
      }, ...prev])
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
      // Show tailored message based on how many targets we intended to send to
      const multi = sendingTargetsCountRef.current > 1
      const base = multi ? 'Some or all recipient might got offline' : 'Recipient might got offline'
      const extra = reason ? `\n\nDetails: ${reason}` : ''
      setErrorModalMessage(`${base}\n\nMake Sure Recepient Is Live${extra}`)
      setErrorModalOpen(true)
      // Do not reset selected files; just stop the upload progress
      setIsUploading(false)
      setUploadProgress(0)
      batchTotalRef.current = 0
      batchCompletedRef.current = 0
      currentFileTotalRef.current = 0
      currentFileSentRef.current = 0
      linkCountRef.current = 0
      linksCompletedRef.current = 0
    }
  })

  useEffect(() => {
    const userParam = searchParams?.get('user')
    const roomParam = searchParams?.get('room')

    // Use only URL params (no browser storage)
    if (userParam && roomParam) {
      try {
        const user = JSON.parse(decodeURIComponent(userParam))
        setUserData(user)
        initializeSocket(user, roomParam)
      } catch (error) {
        console.error('Failed to parse user data:', error)
      }
    }
  }, [searchParams])

  // No local/session storage: keep history/UI only in memory for this session

  const initializeSocket = (user: any, roomNumber: string) => {
    // Initialize socket connection
  const base = process.env.NEXT_PUBLIC_SIGNALING_BASE_URL
  const socket = base ? io(base, { path: '/api/socketio' }) : io({ path: '/api/socketio' })
    socketRef.current = socket
  setSocketState(socket)

    socket.on('connect', () => {
      setIsConnected(true)
      socket.emit('join-room', { roomNumber, user })
    })

    socket.on('disconnect', () => {
      setIsConnected(false)
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
      try { socketRef.current?.disconnect() } catch {}
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

  // Helper to resolve recipient labels
  const getRecipientInfo = (id: string): { id: string; name: string; uniqueId: string } => {
    if (id === 'admin') {
      return { id: 'admin', name: `Lab Admin (Room ${adminRoom || userData?.roomNumber || ''})`, uniqueId: 'ADMIN' }
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
  }

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
    }

    try {
      const filesToShare: FileShare[] = []

      // Build recipients info for UI display based on targets
      const recipientsInfo: { id: string; name: string; uniqueId: string }[] = targets.map((tid) => {
        if (adminId && tid === adminId) return { id: tid, name: 'Lab Admin', uniqueId: 'ADMIN' }
        const u = onlineUsers.find((ou) => ou.id === tid)
        if (u) return { id: u.id, name: u.name, uniqueId: u.uniqueId }
        const cached = recipientInfoRef.current[tid]
        if (cached) return { id: tid, name: cached.name, uniqueId: cached.uniqueId }
        return { id: tid, name: 'User', uniqueId: tid.slice(-6) }
      })

      // Handle file uploads
      for (const file of selectedFiles) {
        const fileData = await readFileAsBase64(file)
        filesToShare.push({
          id: Date.now().toString() + Math.random(),
          fileName: file.name,
          fileSize: file.size,
          fileType: file.type,
          fileData,
          isLink: false,
          message,
          allowReshare,
          senderId: userData.id,
          receiverId: isPrintRequest ? 'admin' : 'multi',
          recipients: recipientsInfo,
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
          timestamp: new Date()
        })
      }

      // Send P2P via WebRTC to all targets sequentially (by target then files)
      for (const targetId of targets) {
        webrtc.ensureConnection(targetId)
        for (const entry of filesToShare) {
          if (!entry.isLink) {
            const fileObj = selectedFiles.find(f => f.name === entry.fileName && f.size === entry.fileSize)
            if (fileObj) {
              await webrtc.sendFile(targetId, fileObj, { message: entry.message, senderName: userData.name, senderUniqueId: userData.uniqueId, allowReshare })
            }
          } else if (entry.isLink && entry.linkUrl) {
            await webrtc.sendLink(targetId, entry.linkUrl, entry.message, { name: userData.name, uniqueId: userData.uniqueId }, allowReshare)
            linksCompletedRef.current += 1
            const doneBytes = batchCompletedRef.current >= batchTotalRef.current
            const doneLinks = linksCompletedRef.current >= linkCountRef.current
            if (batchTotalRef.current + linkCountRef.current > 0 && doneBytes && doneLinks) {
              setUploadProgress(100)
              setTimeout(() => {
                resetUploadState()
              }, 400)
            } else {
              updateBatchProgress()
            }
          }
        }
      }

      // Update local history
      setSentFiles(prev => [...filesToShare, ...prev])
      setSelectedFiles([])
      setLinkUrl('')
      setMessage('')
      setSelectedRecipients([])
      setAllowReshare(true)
    } catch (error) {
      console.error('Failed to share files:', error)
      resetUploadState()
      setErrorModalMessage(
        'We could not complete the file share. This can happen if the connection drops or the recipient goes offline.\n\nMake Sure Recepient Is Live'
      )
      setErrorModalOpen(true)
    } finally {
      // Keep the hook’s onSendComplete in control of the progress bar cleanup
    }
  }

  // Preflight: check recipients are online; show modal if some are offline
  const preflightAndMaybeShare = (isPrintRequest: boolean) => {
    if (selectedFiles.length === 0 && !linkUrl) return

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

  const readFileAsBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  const removeFile = (index: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index))
  }

  // Reshare: bring user to Share tab and prefill file/link
  const handleResharePrefill = async (item: { fileName: string; fileType: string; fileSize: number; fileData?: string; linkUrl?: string }) => {
    setActiveTab('share')
    if (item.linkUrl) {
      setShareMode('links')
      setLinkUrl(item.linkUrl)
    } else if (item.fileData) {
      try {
        setShareMode('files')
        // Convert dataURL back to File
        const base64 = item.fileData
        const arr = base64.split(',')
        const mime = arr[0].match(/:(.*?);/)?.[1] || item.fileType
        const bstr = atob(arr[1])
        let n = bstr.length
        const u8arr = new Uint8Array(n)
        while (n--) u8arr[n] = bstr.charCodeAt(n)
        const f = new File([u8arr], item.fileName, { type: mime })
        setSelectedFiles([f])
      } catch (e) {
        console.error('Failed to prefill file for reshare:', e)
      }
    }
    // Clear previous recipients and message to avoid accidental broadcast
    setSelectedRecipients([])
    setMessage('')
  }

  if (!userData) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">Loading...</h1>
          <p>Please wait while we set up your session.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <Avatar className="w-12 h-12">
              <AvatarFallback className="bg-blue-600 text-white">
                {userData.name.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div>
              <h1 className="text-2xl font-bold">{userData.name}</h1>
              <p className="text-gray-600">ID: {userData.uniqueId} | Room {userData.roomNumber}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={isConnected ? 'default' : 'destructive'} className="flex items-center gap-2">
              {isConnected ? <Wifi className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />}
              {isConnected ? 'Connected' : 'Disconnected'}
            </Badge>
            <Badge variant="outline" className="flex items-center gap-2">
              <Users className="w-4 h-4" />
              {onlineUsers.length + 1 + (adminId ? 1 : 0)} Online
            </Badge>
          </div>
        </div>

        {/* Top-level tabs */}
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="share">Share Files</TabsTrigger>
            <TabsTrigger value="history">File History</TabsTrigger>
            <TabsTrigger value="users">Online Users</TabsTrigger>
          </TabsList>

          {/* Share Files Tab */}
          <TabsContent value="share" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Share2 className="w-5 h-5" />
                  Share Files
                </CardTitle>
                <CardDescription>Upload files or share links with friends or submit for printing</CardDescription>
              </CardHeader>
              <CardContent>
                <Tabs value={shareMode} onValueChange={(v) => setShareMode(v as any)} className="w-full">
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="files">Files</TabsTrigger>
                    <TabsTrigger value="links">Links</TabsTrigger>
                  </TabsList>

                  <TabsContent value="files" className="space-y-4">
                    {/* Dropzone */}
                    <div
                      {...getRootProps()}
                      className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
                        isDragActive ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400'
                      }`}
                    >
                      <input {...getInputProps()} />
                      <Upload className="w-12 h-12 mx-auto mb-4 text-gray-400" />
                      {isDragActive ? (
                        <p className="text-blue-600">Drop the files here...</p>
                      ) : (
                        <div>
                          <p className="text-gray-600 mb-2">Drag & drop files here, or click to select</p>
                          <p className="text-sm text-gray-500">Support for multiple files</p>
                        </div>
                      )}
                    </div>

                    {/* Selected files below dropzone */}
                    {selectedFiles.length > 0 && (
                      <div className="space-y-2">
                        <Label>Selected Files:</Label>
                        <div className="max-h-32 overflow-y-auto space-y-2">
                          {selectedFiles.map((file, index) => (
                            <div key={index} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                              <div className="flex items-center gap-2">
                                <FileText className="w-4 h-4" />
                                <span className="text-sm truncate">{file.name}</span>
                                <span className="text-xs text-gray-500">({formatFileSize(file.size)})</span>
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
                    <div className="space-y-2">
                      <Label htmlFor="message">Message (Optional)</Label>
                      <Textarea
                        id="message"
                        placeholder="Add a message like '2 copies for printout'..."
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        rows={3}
                      />
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
                            <span>{selectedRecipients.length > 0 ? `${selectedRecipients.length} recipient${selectedRecipients.length>1?'s':''} selected` : 'Select recipients'}</span>
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
                            {/* Online Users tab with search and multi-select */}
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
                                  // Hide Lab Admin from Online Users tab in Select Recipients (Files)
                                  .filter(u => u.uniqueId !== 'ADMIN' && u.id !== adminId)
                                  .filter(u => (u.name + ' ' + u.uniqueId).toLowerCase().includes(searchQuery.toLowerCase()))
                                  .map(u => {
                                    const checked = selectedRecipients.includes(u.id)
                                    return (
                                      <label key={u.id} className={`flex items-center gap-3 p-2 rounded border ${checked ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                                        <input
                                          type="checkbox"
                                          className="accent-blue-600"
                                          checked={checked}
                                          onChange={(e) => {
                                            setSelectedRecipients(prev => {
                                              const next = e.target.checked ? Array.from(new Set([...prev, u.id])) : prev.filter(id => id !== u.id)
                                              // cache info for label if user goes offline before sending
                                              recipientInfoRef.current[u.id] = { name: u.name, uniqueId: u.uniqueId }
                                              return next
                                            })
                                          }}
                                        />
                                        <div className="flex items-center gap-3">
                                          <Avatar className="w-8 h-8"><AvatarFallback>{u.name.charAt(0).toUpperCase()}</AvatarFallback></Avatar>
                                          <div>
                                            <p className="text-sm font-medium">{u.name}</p>
                                            <p className="text-xs text-gray-500">{u.uniqueId}</p>
                                          </div>
                                        </div>
                                      </label>
                                    )
                                  })}
                                {onlineUsers.length === 0 && (
                                  <p className="text-sm text-gray-500">No users online</p>
                                )}
                              </div>
                            </TabsContent>
                            {/* Lab Rooms tab (current room admin) */}
                            <TabsContent value="labs" className="space-y-3">
                              <div className="max-h-64 overflow-y-auto space-y-2">
                                <label className={`flex items-center gap-3 p-2 rounded border ${selectedRecipients.includes('admin') ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                                  <input
                                    type="checkbox"
                                    className="accent-blue-600"
                                    checked={selectedRecipients.includes('admin')}
                                    onChange={(e) => {
                                      setSelectedRecipients(prev => {
                                        const next = e.target.checked ? Array.from(new Set([...prev, 'admin'])) : prev.filter(id => id !== 'admin')
                                        recipientInfoRef.current['admin'] = { name: `Lab Admin (Room ${adminRoom || userData?.roomNumber || ''})`, uniqueId: 'ADMIN' }
                                        return next
                                      })
                                    }}
                                  />
                                  <div className="flex items-center gap-2">
                                    <Printer className="w-4 h-4" />
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
                    {isUploading && (
                      <div className="space-y-2">
                        <Label>Upload Progress</Label>
                        <Progress value={uploadProgress} className="w-full" />
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex gap-2">
                      <Button
                        onClick={() => preflightAndMaybeShare(false)}
                        disabled={isUploading || (selectedFiles.length === 0 && !linkUrl) || selectedRecipients.length === 0}
                        className="flex-1"
                      >
                        <Send className="w-4 h-4 mr-2" />
                        Share Files
                      </Button>
                      <Button
                        onClick={() => preflightAndMaybeShare(true)}
                        disabled={isUploading || (selectedFiles.length === 0 && !linkUrl) || !adminId}
                        variant="outline"
                        className="flex-1"
                      >
                        <Printer className="w-4 h-4 mr-2" />
                        {`Submit For Print (Lab ${userData.roomNumber})`}
                      </Button>
                    </div>
                  </TabsContent>

                  <TabsContent value="links" className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="link">Share Link</Label>
                      <Input
                        id="link"
                        type="url"
                        placeholder="https://docs.google.com/document/d/..."
                        value={linkUrl}
                        onChange={(e) => setLinkUrl(e.target.value)}
                      />
                      <p className="text-sm text-gray-500">Share Google Docs, Drive links, or any other web links</p>
                    </div>

                    {/* Message below link input */}
                    <div className="space-y-2">
                      <Label htmlFor="message-link">Message (Optional)</Label>
                      <Textarea
                        id="message-link"
                        placeholder="Add a message like '2 copies for printout'..."
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        rows={3}
                      />
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
                            <span>{selectedRecipients.length > 0 ? `${selectedRecipients.length} recipient${selectedRecipients.length>1?'s':''} selected` : 'Select recipients'}</span>
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
                                      <label key={u.id} className={`flex items-center gap-3 p-2 rounded border ${checked ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                                        <input
                                          type="checkbox"
                                          className="accent-blue-600"
                                          checked={checked}
                                          onChange={(e) => {
                                            setSelectedRecipients(prev => e.target.checked ? Array.from(new Set([...prev, u.id])) : prev.filter(id => id !== u.id))
                                          }}
                                        />
                                        <div className="flex items-center gap-3">
                                          <Avatar className="w-8 h-8"><AvatarFallback>{u.name.charAt(0).toUpperCase()}</AvatarFallback></Avatar>
                                          <div>
                                            <p className="text-sm font-medium">{u.name}</p>
                                            <p className="text-xs text-gray-500">{u.uniqueId}</p>
                                          </div>
                                        </div>
                                      </label>
                                    )
                                  })}
                                {onlineUsers.length === 0 && (
                                  <p className="text-sm text-gray-500">No users online</p>
                                )}
                              </div>
                            </TabsContent>
                            <TabsContent value="labs" className="space-y-3">
                              <div className="max-h-64 overflow-y-auto space-y-2">
                                <label className={`flex items-center gap-3 p-2 rounded border ${selectedRecipients.includes('admin') ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                                  <input
                                    type="checkbox"
                                    className="accent-blue-600"
                                    checked={selectedRecipients.includes('admin')}
                                    onChange={(e) => {
                                      setSelectedRecipients(prev => e.target.checked ? Array.from(new Set([...prev, 'admin'])) : prev.filter(id => id !== 'admin'))
                                    }}
                                  />
                                  <div className="flex items-center gap-2">
                                    <Printer className="w-4 h-4" />
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
                    {isUploading && (
                      <div className="space-y-2">
                        <Label>Upload Progress</Label>
                        <Progress value={uploadProgress} className="w-full" />
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex gap-2">
                      <Button
                        onClick={() => preflightAndMaybeShare(false)}
                        disabled={isUploading || (selectedFiles.length === 0 && !linkUrl) || selectedRecipients.length === 0}
                        className="flex-1"
                      >
                        <Send className="w-4 h-4 mr-2" />
                        Share Files
                      </Button>
                      <Button
                        onClick={() => preflightAndMaybeShare(true)}
                        disabled={isUploading || (selectedFiles.length === 0 && !linkUrl) || !adminId}
                        variant="outline"
                        className="flex-1"
                      >
                        <Printer className="w-4 h-4 mr-2" />
                        {`Submit For Print (Lab ${userData.roomNumber})`}
                      </Button>
                    </div>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </TabsContent>

          {/* File History Tab */}
          <TabsContent value="history" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>File History</CardTitle>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue="received" className="w-full">
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="received">Received</TabsTrigger>
                    <TabsTrigger value="sent">Sent</TabsTrigger>
                  </TabsList>

                  <TabsContent value="received" className="space-y-2">
                    {Object.keys(recvProgress).length > 0 && (
                      <div className="space-y-2">
                        {Object.values(recvProgress).map((p, idx) => {
                          const percent = p.total ? Math.min(100, Math.round((p.received / p.total) * 100)) : 0
                          return (
                            <div key={idx} className="p-2 bg-blue-50 border border-blue-100 rounded">
                              <div className="flex items-center justify-between mb-1 text-sm text-blue-800">
                                <span>Receiving: {p.fileName}</span>
                                <span>{percent}%</span>
                              </div>
                              <Progress value={percent} />
                            </div>
                          )
                        })}
                      </div>
                    )}

                    {receivedFiles.length === 0 && Object.keys(recvProgress).length === 0 ? (
                      <p className="text-gray-500 text-center py-4">No files received yet</p>
                    ) : (
                      <div className="space-y-3 max-h-96 overflow-y-auto">
                        {receivedFiles.map((file) => (
                          <FilePreview
                            key={file.id}
                            file={file}
                            senderName={file.senderName}
                            senderUniqueId={file.senderUniqueId}
                            recipients={undefined}
                            timestamp={file.timestamp}
                            onReshare={handleResharePrefill}
                          />
                        ))}
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="sent" className="space-y-2">
                    {sentFiles.length === 0 ? (
                      <p className="text-gray-500 text-center py-4">No files sent yet</p>
                    ) : (
                      <div className="space-y-3 max-h-96 overflow-y-auto">
                        {sentFiles.map((file) => (
                          <FilePreview
                            key={file.id}
                            file={file}
                            senderName={`${userData.name}`}
                            senderUniqueId={userData.uniqueId}
                            recipients={file.recipients}
                            timestamp={file.timestamp}
                            onReshare={handleResharePrefill}
                            isOwnItem
                          />
                        ))}
                      </div>
                    )}
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Online Users Tab */}
          <TabsContent value="users" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="w-5 h-5" />
                  Online Users
                </CardTitle>
                <CardDescription>Students currently in Room {userData.roomNumber}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex items-center gap-3 p-2 bg-blue-50 rounded-lg">
                    <Avatar className="w-8 h-8">
                      <AvatarFallback className="bg-blue-600 text-white text-sm">
                        {userData.name.charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1">
                      <p className="font-medium text-sm">{userData.name}</p>
                      <p className="text-xs text-gray-500">{userData.uniqueId} (You)</p>
                    </div>
                    <Badge variant="default">Online</Badge>
                  </div>

                  {/* Lab Admin shown at top if online */}
                  {adminId && (
                    <div className="flex items-center gap-3 p-2 hover:bg-gray-50 rounded-lg">
                      <Avatar className="w-8 h-8">
                        <AvatarFallback className="bg-gray-700 text-white text-sm">
                          A
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1">
                        <p className="font-medium text-sm">Lab Admin (Room {adminRoom || userData.roomNumber})</p>
                        <p className="text-xs text-gray-500">ADMIN</p>
                      </div>
                      <Badge variant="outline">Online</Badge>
                    </div>
                  )}

                  {onlineUsers.map((user) => (
                    <div key={user.id} className="flex items-center gap-3 p-2 hover:bg-gray-50 rounded-lg">
                      <Avatar className="w-8 h-8">
                        <AvatarFallback className="bg-gray-600 text-white text-sm">
                          {user.name.charAt(0).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1">
                        <p className="font-medium text-sm">{user.name}</p>
                        <p className="text-xs text-gray-500">{user.uniqueId}</p>
                      </div>
                      <Badge variant="outline">Online</Badge>
                    </div>
                  ))}

                  {onlineUsers.length === 0 && !adminId && (
                    <p className="text-gray-500 text-center py-4">No other users online</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Offline recipients modal */}
        <Dialog open={offlineModalOpen} onOpenChange={setOfflineModalOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-yellow-100 text-yellow-700">
                  {/* alert icon */}
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5"><path d="M10.3 2.7c.9-1.6 3.5-1.6 4.4 0l8.3 15.1c.8 1.5-.3 3.2-2.2 3.2H4.2c-1.9 0-3.1-1.7-2.2-3.2L10.3 2.7zM12 8c-.6 0-1 .4-1 1v4c0 .6.4 1 1 1s1-.4 1-1V9c0-.6-.4-1-1-1zm0 8.5a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5z"/></svg>
                </span>
                Some recipients are offline
              </DialogTitle>
              <DialogDescription className="text-gray-600">
                These recipients are currently offline and won’t receive the file right now.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {offlineUsersInfo.map(u => (
                <div key={u.id} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                  <div className="flex items-center gap-2">
                    <Avatar className="w-8 h-8"><AvatarFallback>{u.name.charAt(0).toUpperCase()}</AvatarFallback></Avatar>
                    <div>
                      <p className="text-sm font-medium">{u.name}</p>
                      <p className="text-xs text-gray-500">{u.uniqueId}</p>
                    </div>
                  </div>
                  <Badge variant="destructive">Offline</Badge>
                </div>
              ))}
              {offlineUsersInfo.length === 0 && (
                <p className="text-sm text-gray-500">No offline recipients detected.</p>
              )}
            </div>
            {pendingTargets.length > 0 && (selectedRecipients.length > 1 || (offlineUsersInfo.length > 0)) && (
              <div className="mt-3 flex items-start gap-2 rounded-md border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-800">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 mt-0.5"><path d="M10.3 2.7c.9-1.6 3.5-1.6 4.4 0l8.3 15.1c.8 1.5-.3 3.2-2.2 3.2H4.2c-1.9 0-3.1-1.7-2.2-3.2L10.3 2.7zM12 8c-.6 0-1 .4-1 1v4c0 .6.4 1 1 1s1-.4 1-1V9c0-.6-.4-1-1-1zm0 8.5a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5z"/></svg>
                <p>File will be shared with other online recipients.</p>
              </div>
            )}
            <div className="flex flex-col sm:flex-row sm:justify-end gap-2 mt-4">
              <Button variant="outline" onClick={() => setOfflineModalOpen(false)}>Cancel</Button>
              <Button
                disabled={pendingTargets.length === 0}
                onClick={() => { sendingTargetsCountRef.current = pendingTargets.length; performShare(pendingTargets, preflightIsPrint); setOfflineModalOpen(false) }}
              >
                Proceed
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Error modal */}
        <Dialog open={errorModalOpen} onOpenChange={setErrorModalOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-red-100 text-red-700">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5"><path d="M10.29 3.86c.9-1.53 3.12-1.53 4.02 0l7.69 13.1c.88 1.5-.21 3.39-2.01 3.39H4.61c-1.8 0-2.88-1.89-2.01-3.39l7.69-13.1zM12 8a1 1 0 0 0-1 1v4a1 1 0 1 0 2 0V9a1 1 0 0 0-1-1zm0 8.25a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5z"/></svg>
                </span>
                Couldn’t complete your share
              </DialogTitle>
              <DialogDescription className="text-gray-600">
                Something interrupted the transfer. Please review the notes below and try again.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="whitespace-pre-line text-sm text-gray-800 bg-gray-50 p-3 rounded border border-gray-200">
                {errorModalMessage}
              </div>
              <ul className="text-sm text-gray-700 list-disc pl-5 space-y-1">
                <li>Check that the recipient is online and in the same room.</li>
                <li>Keep this page open during the transfer.</li>
                <li>Try again with a stable connection.</li>
              </ul>
            </div>
            <div className="flex flex-col sm:flex-row sm:justify-end gap-2 mt-4">
              <Button onClick={() => setErrorModalOpen(false)}>Close</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}

export default function StudentPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><LoadingSpinner /></div>}>
      <StudentDashboardInner />
    </Suspense>
  )
}