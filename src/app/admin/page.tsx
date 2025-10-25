"use client"
export const runtime = 'edge'

import { useState, useEffect, useRef, Suspense } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
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
  Filter
} from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import { io } from 'socket.io-client'
import { useWebRTC } from '@/hooks/useWebRTC'
import FilePreview from '@/components/FilePreview'

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

  const webrtc = useWebRTC(socketState, roomNumber, {
    onFileMetadata: (fromId, meta) => {
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
    onFileComplete: (fromId, base64, meta) => {
      const key = `${fromId}:${meta.fileName}:${meta.fileSize}`
      setRecvProgress(prev => {
        const { [key]: _, ...rest } = prev
        return rest
      })
      const sender = onlineUsers.find(u => u.id === fromId)
      const senderName = (meta as any)?.senderName || sender?.name || 'Student'
      const senderUniqueId = (meta as any)?.senderUniqueId || sender?.uniqueId || 'ID'
      const req: PrintRequest = {
        id: Date.now().toString() + Math.random(),
        fileName: meta.fileName,
        fileSize: meta.fileSize,
        fileType: meta.fileType,
        fileData: base64,
        isLink: false,
        senderId: fromId,
        senderName,
        senderUniqueId,
        timestamp: new Date(),
        isPrinted: false,
        message: meta.message,
      }
      setPrintRequests(prev => [req, ...prev])
    },
    onLink: (fromId, linkUrl, message, senderInfo?: { name?: string; uniqueId?: string }) => {
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
      }
      setPrintRequests(prev => [req, ...prev])
    }
  })

  // Handle browser back/navigation away: alert and disconnect to leave room
  useEffect(() => {
    const handleLeave = () => {
      try { socketRef.current?.disconnect() } catch {}
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
    }
  }, [])

  useEffect(() => {
    const roomParam = searchParams?.get('room')
    if (roomParam) {
      setRoomNumber(roomParam)
    }
  }, [searchParams])

  const initializeSocket = (user: any, roomNumber: string) => {
    // Initialize socket connection
  const base = process.env.NEXT_PUBLIC_SIGNALING_BASE_URL
  const socket = base ? io(base, { path: '/api/socketio' }) : io({ path: '/api/socketio' })
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
  }

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  const filteredRequests = printRequests.filter(req => {
    if (filter === 'pending') return !req.isPrinted
    if (filter === 'printed') return req.isPrinted
    return true
  })

  const pendingCount = printRequests.filter(req => !req.isPrinted).length
  const printedCount = printRequests.filter(req => req.isPrinted).length

  // No persistence: admin print requests are session-only

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 via-white to-blue-50 flex items-center justify-center">
        <Card className="w-full max-w-md shadow-xl">
          <CardHeader className="text-center">
            <div className="flex justify-center mb-4">
              <div className="p-3 bg-purple-600 rounded-xl">
                <Printer className="w-8 h-8 text-white" />
              </div>
            </div>
            <CardTitle className="text-2xl">Admin Portal</CardTitle>
            <CardDescription>
              Authenticate to access Lab {roomNumber} admin dashboard
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="password">Admin Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="Enter admin password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full"
                />
              </div>
              <Button type="submit" className="w-full">
                <Printer className="w-4 h-4 mr-2" />
                Access Admin Panel
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-white to-blue-50">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-purple-600 rounded-xl">
              <Printer className="w-8 h-8 text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-bold">Lab Admin Dashboard</h1>
              <p className="text-gray-600">Room {roomNumber} Management</p>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Badge variant={isConnected ? "default" : "destructive"} className="flex items-center gap-2">
                {isConnected ? <Wifi className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />}
                {isConnected ? 'Connected' : 'Disconnected'}
              </Badge>
              <Badge variant="outline" className="flex items-center gap-2">
                <Users className="w-4 h-4" />
                {onlineUsers.length} Students
              </Badge>
            </div>
            <Button variant="outline" size="sm">
              <RefreshCw className="w-4 h-4 mr-2" />
              Refresh
            </Button>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Total Requests</p>
                  <p className="text-2xl font-bold">{printRequests.length}</p>
                </div>
                <div className="p-2 bg-blue-100 rounded-lg">
                  <FileText className="w-6 h-6 text-blue-600" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Pending</p>
                  <p className="text-2xl font-bold text-orange-600">{pendingCount}</p>
                </div>
                <div className="p-2 bg-orange-100 rounded-lg">
                  <Clock className="w-6 h-6 text-orange-600" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Printed</p>
                  <p className="text-2xl font-bold text-green-600">{printedCount}</p>
                </div>
                <div className="p-2 bg-green-100 rounded-lg">
                  <Check className="w-6 h-6 text-green-600" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Online Now</p>
                  <p className="text-2xl font-bold">{onlineUsers.length}</p>
                </div>
                <div className="p-2 bg-purple-100 rounded-lg">
                  <Users className="w-6 h-6 text-purple-600" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Content - Print Requests */}
          <div className="lg:col-span-2">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Printer className="w-5 h-5" />
                      Print Requests
                    </CardTitle>
                    <CardDescription>
                      Manage student print requests and file sharing
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant={filter === 'all' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setFilter('all')}
                    >
                      All ({printRequests.length})
                    </Button>
                    <Button
                      variant={filter === 'pending' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setFilter('pending')}
                    >
                      Pending ({pendingCount})
                    </Button>
                    <Button
                      variant={filter === 'printed' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setFilter('printed')}
                    >
                      Printed ({printedCount})
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {/* In-progress incoming files */}
                {Object.keys(recvProgress).length > 0 && (
                  <div className="space-y-2 mb-4">
                    {Object.values(recvProgress).map((p, idx) => {
                      const percent = p.total ? Math.min(100, Math.round((p.received / p.total) * 100)) : 0
                      return (
                        <div key={idx} className="p-2 bg-blue-50 border border-blue-100 rounded">
                          <div className="flex items-center justify-between mb-1 text-sm text-blue-800">
                            <span>Receiving: {p.fileName}</span>
                            <span>{percent}%</span>
                          </div>
                          <div className="w-full h-2 bg-blue-100 rounded">
                            <div className="h-2 bg-blue-600 rounded" style={{ width: `${percent}%` }} />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}

                {filteredRequests.length === 0 ? (
                  <div className="text-center py-8">
                    <Printer className="w-12 h-12 mx-auto mb-4 text-gray-400" />
                    <p className="text-gray-500">
                      {filter === 'pending' ? 'No pending print requests' : 
                       filter === 'printed' ? 'No printed requests yet' : 
                       'No print requests yet'}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4 max-h-96 overflow-y-auto">
                    {filteredRequests.map((request) => (
                      <div key={request.id} className="border rounded-lg p-4 hover:bg-gray-50">
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex items-center gap-2">
                            {request.isPrinted && (
                              <Badge variant="default" className="bg-green-600">
                                <Check className="w-3 h-3 mr-1" />
                                Printed
                              </Badge>
                            )}
                            <span className="text-sm text-gray-600">
                              From: {request.senderName} ({request.senderUniqueId})
                            </span>
                            <span className="text-sm text-gray-500">
                              {new Date(request.timestamp).toLocaleTimeString()}
                            </span>
                          </div>
                          
                          {!request.isPrinted && (
                            <Dialog>
                              <DialogTrigger asChild>
                                <Button variant="default" size="sm">
                                  <Printer className="w-4 h-4 mr-1" />
                                  Print
                                </Button>
                              </DialogTrigger>
                              <DialogContent>
                                <DialogHeader>
                                  <DialogTitle>Print Document</DialogTitle>
                                  <DialogDescription>
                                    Confirm printing for "{request.fileName}"
                                  </DialogDescription>
                                </DialogHeader>
                                <div className="space-y-4">
                                  <div className="space-y-2">
                                    <Label htmlFor="copies">Number of Copies</Label>
                                    <Input
                                      id="copies"
                                      type="number"
                                      min="1"
                                      defaultValue="1"
                                      placeholder="Enter number of copies"
                                    />
                                  </div>
                                  <div className="flex gap-2">
                                    <Button 
                                      onClick={() => {
                                        const copies = parseInt((document.getElementById('copies') as HTMLInputElement)?.value || '1')
                                        handlePrintRequest(request.id, copies)
                                      }}
                                      className="flex-1"
                                    >
                                      <Check className="w-4 h-4 mr-2" />
                                      Confirm Print
                                    </Button>
                                    <Button variant="outline" className="flex-1">
                                      Cancel
                                    </Button>
                                  </div>
                                </div>
                              </DialogContent>
                            </Dialog>
                          )}
                        </div>
                        
                        {request.message && (
                          <div className="flex items-start gap-2 mb-3 p-2 bg-blue-50 rounded">
                            <MessageSquare className="w-4 h-4 text-blue-600 mt-0.5" />
                            <p className="text-sm text-blue-800">{request.message}</p>
                          </div>
                        )}
                        
                        <FilePreview
                          file={{
                            id: request.id,
                            fileName: request.fileName,
                            fileSize: request.fileSize,
                            fileType: request.fileType,
                            fileData: request.fileData,
                            isLink: request.isLink,
                            linkUrl: request.linkUrl,
                            message: request.message
                          }}
                          senderName={request.senderName}
                          timestamp={request.timestamp}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Right Panel - Online Students */}
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="w-5 h-5" />
                  Online Students
                </CardTitle>
                <CardDescription>
                  Students currently in Room {roomNumber}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3 max-h-64 overflow-y-auto">
                  {onlineUsers.map((user) => (
                    <div key={user.id} className="flex items-center gap-3 p-2 hover:bg-gray-50 rounded-lg">
                      <Avatar className="w-8 h-8">
                        <AvatarFallback className="bg-blue-600 text-white text-sm">
                          {user.name.charAt(0).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1">
                        <p className="font-medium text-sm">{user.name}</p>
                        <p className="text-xs text-gray-500">{user.uniqueId}</p>
                      </div>
                      <Badge variant="outline" className="text-green-600 border-green-600">
                        Online
                      </Badge>
                    </div>
                  ))}
                  
                  {onlineUsers.length === 0 && (
                    <p className="text-gray-500 text-center py-4">No students online</p>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Quick Actions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button variant="outline" className="w-full justify-start">
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Refresh Requests
                </Button>
                <Button variant="outline" className="w-full justify-start">
                  <Download className="w-4 h-4 mr-2" />
                  Download All Pending
                </Button>
                <Button variant="outline" className="w-full justify-start">
                  <Check className="w-4 h-4 mr-2" />
                  Mark All as Printed
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function AdminDashboard() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center">Loading...</div>}>
      <AdminDashboardInner />
    </Suspense>
  )
}