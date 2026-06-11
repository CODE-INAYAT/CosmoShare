'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import SimplePeer from 'simple-peer'

type FileMetadata = {
    fileName: string
    fileSize: number
    fileType: string
    message?: string
    fileId?: string
    location?: { latitude: number; longitude: number; name: string; address: string }
    contact?: { name: string; phone: string }
}

type ReceiveCallbacks = {
    onFileMetadata?: (meta: FileMetadata) => void
    onFileChunk?: (fileName: string, receivedBytes: number, total: number) => void
    onFileComplete?: (fileUrl: string, meta: FileMetadata) => void
    onLink?: (linkUrl: string, message?: string) => void
    onMessage?: (message: string) => void
    onConnect?: () => void
    onClose?: () => void
    onSendStart?: (fileName: string, totalBytes: number) => void
    onSendProgress?: (fileName: string, sentBytes: number, totalBytes: number) => void
    onSendComplete?: (fileName: string) => void
    onSendFailed?: (fileName: string, reason?: string) => void
    // MultiShare callbacks
    onReceiverConnected?: (receiverId: string) => void
    onReceiverDisconnected?: (receiverId: string) => void
}

export const useOneShareWebRTC = (
    socket: any,
    code: string | null,
    isSender: boolean,
    callbacks: ReceiveCallbacks = {},
    multiShare: boolean = false,
) => {
    const [peer, setPeer] = useState<SimplePeer.Instance | null>(null)
    const [isConnected, setIsConnected] = useState(false)
    const [targetId, setTargetId] = useState<string | null>(null)
    const peerRef = useRef<SimplePeer.Instance | null>(null)
    const recvState = useRef<{ meta?: FileMetadata; buffers: BlobPart[]; received: number }>({
        buffers: [],
        received: 0
    })
    // Message receive state for chunked messages
    const msgRecvState = useRef<{ totalSize: number; chunks: string[]; received: number } | null>(null)

    // MultiShare: map of receiverId -> peer for sender
    const peersMapRef = useRef<Map<string, SimplePeer.Instance>>(new Map())
    const [connectedReceivers, setConnectedReceivers] = useState<string[]>([])

    // Store callbacks in ref to avoid stale closures
    const callbacksRef = useRef(callbacks)
    callbacksRef.current = callbacks

    // ICE servers config
    const getIceServers = () => {
        const iceServers: any[] = [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
        ]

        const turnUrls = (process.env.NEXT_PUBLIC_TURN_URLS || '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
            // Filter out invalid TURNS-over-UDP (TURNS is TLS, always TCP)
            .filter((u) => !(u.startsWith('turns:') && u.includes('transport=udp')))
        const turnUser = process.env.NEXT_PUBLIC_TURN_USERNAME
        const turnCred = process.env.NEXT_PUBLIC_TURN_CREDENTIAL

        // Each TURN URL as its own entry — mobile browsers resolve separate entries more reliably
        for (const url of turnUrls) {
            iceServers.push({ urls: url, username: turnUser, credential: turnCred })
        }

        return iceServers
    }

    // Setup data handler for a peer (receiver side or individual peer)
    const setupDataHandler = (p: SimplePeer.Instance) => {
        p.on('data', async (data: any) => {
            // Handle control frames (JSON strings)
            if (typeof data === 'string') {
                try {
                    const obj = JSON.parse(data)
                    switch (obj.type) {
                        case 'contact-share':
                            callbacksRef.current.onFileComplete?.(
                                `tel:${obj.phone}`,
                                { fileName: obj.name, fileSize: 0, fileType: 'contact', fileId: obj.fileId, contact: { name: obj.name, phone: obj.phone } }
                            )
                            return
                        case 'location-share':
                            callbacksRef.current.onFileComplete?.(
                                `https://www.google.com/maps?q=${obj.latitude},${obj.longitude}`,
                                { fileName: obj.name, fileSize: 0, fileType: 'location', fileId: obj.fileId, location: { latitude: obj.latitude, longitude: obj.longitude, name: obj.name, address: obj.address } }
                            )
                            return
                        case 'file-metadata':
                            recvState.current = { meta: obj, buffers: [], received: 0 }
                            callbacksRef.current.onFileMetadata?.(obj)
                            return
                        case 'file-complete':
                            if (recvState.current.meta) {
                                const blob = new Blob(recvState.current.buffers, { type: recvState.current.meta.fileType })
                                const url = URL.createObjectURL(blob)
                                callbacksRef.current.onFileComplete?.(url, recvState.current.meta)
                                recvState.current = { buffers: [], received: 0 }
                            }
                            return
                        case 'link':
                            callbacksRef.current.onLink?.(obj.linkUrl, obj.message)
                            return
                        case 'message-only':
                            callbacksRef.current.onMessage?.(obj.message)
                            return
                        case 'msg-metadata':
                            msgRecvState.current = { totalSize: obj.totalSize, chunks: [], received: 0 }
                            return
                        case 'msg-chunk':
                            if (msgRecvState.current) {
                                msgRecvState.current.chunks.push(obj.data)
                                msgRecvState.current.received += obj.data.length
                            }
                            return
                        case 'msg-complete':
                            if (msgRecvState.current) {
                                const fullMessage = msgRecvState.current.chunks.join('')
                                callbacksRef.current.onMessage?.(fullMessage)
                                msgRecvState.current = null
                            }
                            return
                    }
                } catch {
                    // Ignore malformed
                }
            }

            // Binary chunk handling
            let u8: Uint8Array | null = null
            if (data instanceof ArrayBuffer) {
                u8 = new Uint8Array(data)
            } else if (ArrayBuffer.isView(data)) {
                const view = data as ArrayBufferView
                u8 = new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
            } else if (typeof Blob !== 'undefined' && data instanceof Blob) {
                const buf = await data.arrayBuffer()
                u8 = new Uint8Array(buf)
            }

            if (u8) {
                // Check if it's a small JSON control frame
                const firstByte = u8.byteLength > 0 ? u8[0] : 0
                const looksJson = (firstByte === 0x7b || firstByte === 0x5b)
                if (looksJson && u8.byteLength <= 8 * 1024) {
                    try {
                        const text = new TextDecoder().decode(u8)
                        const obj = JSON.parse(text)
                        if (obj?.type === 'contact-share') {
                            callbacksRef.current.onFileComplete?.(
                                `tel:${obj.phone}`,
                                { fileName: obj.name, fileSize: 0, fileType: 'contact', fileId: obj.fileId, contact: { name: obj.name, phone: obj.phone } }
                            )
                            return
                        }
                        if (obj?.type === 'location-share') {
                            callbacksRef.current.onFileComplete?.(
                                `https://www.google.com/maps?q=${obj.latitude},${obj.longitude}`,
                                { fileName: obj.name, fileSize: 0, fileType: 'location', fileId: obj.fileId, location: { latitude: obj.latitude, longitude: obj.longitude, name: obj.name, address: obj.address } }
                            )
                            return
                        }
                        if (obj?.type === 'file-metadata') {
                            recvState.current = { meta: obj, buffers: [], received: 0 }
                            callbacksRef.current.onFileMetadata?.(obj)
                            return
                        }
                        if (obj?.type === 'file-complete') {
                            if (recvState.current.meta) {
                                const blob = new Blob(recvState.current.buffers, { type: recvState.current.meta.fileType })
                                const url = URL.createObjectURL(blob)
                                callbacksRef.current.onFileComplete?.(url, recvState.current.meta)
                                recvState.current = { buffers: [], received: 0 }
                            }
                            return
                        }
                        if (obj?.type === 'link') {
                            callbacksRef.current.onLink?.(obj.linkUrl, obj.message)
                            return
                        }
                        if (obj?.type === 'message-only') {
                            callbacksRef.current.onMessage?.(obj.message)
                            return
                        }
                        if (obj?.type === 'msg-metadata') {
                            msgRecvState.current = { totalSize: obj.totalSize, chunks: [], received: 0 }
                            return
                        }
                        if (obj?.type === 'msg-chunk') {
                            if (msgRecvState.current) {
                                msgRecvState.current.chunks.push(obj.data)
                                msgRecvState.current.received += obj.data.length
                            }
                            return
                        }
                        if (obj?.type === 'msg-complete') {
                            if (msgRecvState.current) {
                                const fullMessage = msgRecvState.current.chunks.join('')
                                callbacksRef.current.onMessage?.(fullMessage)
                                msgRecvState.current = null
                            }
                            return
                        }
                    } catch {
                        // Fall through to binary handling
                    }
                }

                // File chunk - copy to ensure proper ArrayBuffer type
                recvState.current.buffers.push(u8.slice().buffer)
                recvState.current.received += u8.byteLength
                callbacksRef.current.onFileChunk?.(
                    recvState.current.meta?.fileName || '',
                    recvState.current.received,
                    recvState.current.meta?.fileSize || 0
                )
            }
        })
    }

    // Create a peer for a specific target (used by both regular & MultiShare)
    const createPeerForTarget = (initiator: boolean, tid: string) => {
        const newPeer = new SimplePeer({
            initiator,
            trickle: true,
            config: {
                iceServers: getIceServers(),
                iceCandidatePoolSize: 4,
                bundlePolicy: 'max-bundle',
            }
        })

        newPeer.on('signal', (data: any) => {
            if (!socket || !code) return

            if (data.type === 'offer') {
                socket.emit('oneshare-offer', { targetId: tid, offer: data, code })
            } else if (data.type === 'answer') {
                socket.emit('oneshare-answer', { targetId: tid, answer: data, code })
            } else if ((data as any).candidate) {
                socket.emit('oneshare-ice-candidate', { targetId: tid, candidate: data, code })
            }
        })

        newPeer.on('connect', () => {
            console.log(`WebRTC connected with ${tid}!`)
            // Tune data channel
            try {
                const ch: any = (newPeer as any)?._channel || (newPeer as any)?.channel
                if (ch) {
                    try { ch.binaryType = 'arraybuffer' } catch { }
                    try { ch.bufferedAmountLowThreshold = 64 * 1024 } catch { }
                }
            } catch { }

            if (multiShare && isSender) {
                // MultiShare sender: track this receiver
                setConnectedReceivers(prev => [...prev, tid])
                callbacksRef.current.onReceiverConnected?.(tid)
            } else {
                // Regular: single peer behavior
                setIsConnected(true)
                callbacksRef.current.onConnect?.()
            }
        })

        // Setup data handler for receiver side
        if (!isSender) {
            setupDataHandler(newPeer)
        }

        newPeer.on('error', (err: any) => {
            console.error('Peer error:', err)
            const message = String(err?.message || '')
            if (!multiShare || !isSender) {
                callbacksRef.current.onSendFailed?.('', message || 'Connection error')
            }
        })

        newPeer.on('close', () => {
            console.log(`Peer closed: ${tid}`)
            if (multiShare && isSender) {
                // Remove from map
                peersMapRef.current.delete(tid)
                setConnectedReceivers(prev => prev.filter(id => id !== tid))
                callbacksRef.current.onReceiverDisconnected?.(tid)
            } else {
                setIsConnected(false)
                callbacksRef.current.onClose?.()
            }
        })

        return newPeer
    }

    // Handle signaling events
    useEffect(() => {
        if (!socket || !code) return

        const handleReceiverJoined = (data: { receiverId: string }) => {
            console.log('Receiver joined:', data?.receiverId)
            setTargetId(data?.receiverId)
            // Sender initiates the connection
            if (isSender) {
                if (multiShare) {
                    // MultiShare: create a NEW peer for this receiver (don't destroy existing ones)
                    const newPeer = createPeerForTarget(true, data.receiverId)
                    peersMapRef.current.set(data.receiverId, newPeer)
                } else {
                    // Regular: single peer
                    createPeer(true, data.receiverId)
                }
            }
        }

        const handleJoined = (data: { senderId: string }) => {
            console.log('Joined OneShare session, sender:', data?.senderId)
            setTargetId(data?.senderId)
            // Receiver waits for offer
        }

        const handleOffer = (data: { offer: any; senderId: string }) => {
            console.log('Received offer from:', data?.senderId)
            if (!isSender && !peerRef.current) {
                createPeer(false, data?.senderId)
            }
            peerRef.current?.signal(data?.offer)
        }

        const handleAnswer = (data: { answer: any; senderId?: string }) => {
            console.log('Received answer from:', data?.senderId)
            if (multiShare && isSender && data?.senderId) {
                // MultiShare: route answer to the correct peer
                const p = peersMapRef.current.get(data.senderId)
                p?.signal(data.answer)
            } else {
                peerRef.current?.signal(data?.answer)
            }
        }

        const handleIceCandidate = (data: { candidate: any; senderId?: string }) => {
            if (multiShare && isSender && data?.senderId) {
                // MultiShare: route ICE candidate to correct peer
                const p = peersMapRef.current.get(data.senderId)
                p?.signal(data.candidate)
            } else {
                peerRef.current?.signal(data?.candidate)
            }
        }

        const handleCancelled = (data: { reason?: string }) => {
            console.log('Session cancelled:', data?.reason)
            cleanup()
        }

        socket.on('oneshare-receiver-joined', handleReceiverJoined)
        socket.on('oneshare-joined', handleJoined)
        socket.on('oneshare-offer', handleOffer)
        socket.on('oneshare-answer', handleAnswer)
        socket.on('oneshare-ice-candidate', handleIceCandidate)
        socket.on('oneshare-cancelled', handleCancelled)

        return () => {
            socket.off('oneshare-receiver-joined', handleReceiverJoined)
            socket.off('oneshare-joined', handleJoined)
            socket.off('oneshare-offer', handleOffer)
            socket.off('oneshare-answer', handleAnswer)
            socket.off('oneshare-ice-candidate', handleIceCandidate)
            socket.off('oneshare-cancelled', handleCancelled)
        }
    }, [socket, code, isSender, multiShare])

    // Regular single-peer creation (for non-MultiShare or receiver)
    const createPeer = (initiator: boolean, tid: string) => {
        if (peerRef.current) {
            peerRef.current.destroy()
        }

        const newPeer = createPeerForTarget(initiator, tid)
        peerRef.current = newPeer
        setPeer(newPeer)
        setTargetId(tid)
    }

    // Detect connection type from peer stats for adaptive chunk sizing
    const detectConnectionType = async (p: SimplePeer.Instance): Promise<'host' | 'srflx' | 'relay' | 'unknown'> => {
        try {
            const pc: RTCPeerConnection | undefined = (p as any)?._pc || (p as any)?.peerConnection || (p as any)?.pc
            if (!pc || pc.signalingState === 'closed') return 'unknown'
            const stats = await pc.getStats()
            const candidates: Record<string, any> = {}
            let selectedPairId: string | undefined
            stats.forEach((report: any) => {
                if (report.type === 'local-candidate' || report.type === 'remote-candidate') {
                    candidates[report.id] = report
                }
                if (report.type === 'transport' && report.selectedCandidatePairId) {
                    selectedPairId = report.selectedCandidatePairId
                }
                if (report.type === 'candidate-pair' && (report.selected || report.nominated)) {
                    selectedPairId = report.id
                }
            })
            if (selectedPairId) {
                const pair: any = Array.from(stats.values()).find((r: any) => r.id === selectedPairId)
                const local = candidates[pair?.localCandidateId]
                const remote = candidates[pair?.remoteCandidateId]
                const types = [local?.candidateType, remote?.candidateType].filter(Boolean)
                if (types.includes('relay')) return 'relay'
                if (types.includes('srflx') || types.includes('prflx')) return 'srflx'
                if (types.includes('host')) return 'host'
            }
            return 'unknown'
        } catch { return 'unknown' }
    }

    // Send file to a specific peer (for MultiShare)
    const sendFileToPeer = async (p: SimplePeer.Instance, file: File, metadata?: { message?: string; fileId?: string }, progressCb?: (sent: number, total: number) => void) => {
        if (!p || p.destroyed || !(p as any).connected) {
            return false
        }

        const meta = {
            type: 'file-metadata',
            fileName: file.name,
            fileSize: file.size,
            fileType: file.type,
            message: metadata?.message,
            fileId: metadata?.fileId,
        }

        try {
            p.send(JSON.stringify(meta))
        } catch { return false }

        // Detect connection type for optimal chunk sizing
        const connType = await detectConnectionType(p)
        // Max 64KB — Safari/mobile WebKit SCTP caps single-message at 64KB;
        // exceeding it silently kills the data channel.
        let chunkSize = 64 * 1024 // default (srflx / unknown)
        if (connType === 'host') chunkSize = 64 * 1024
        else if (connType === 'relay') chunkSize = 48 * 1024
        let offset = 0

        while (offset < file.size) {
            if (p.destroyed || !(p as any).connected) break

            const next = Math.min(offset + chunkSize, file.size)
            const chunk = await file.slice(offset, next).arrayBuffer()
            const u8 = new Uint8Array(chunk)

            let ok: any = true
            try {
                ok = (p as any).write ? (p as any).write(u8) : p.send(u8)
            } catch {
                break
            }

            if (ok === false && (p as any).once) {
                await new Promise<void>(res => (p as any).once('drain', () => res()))
            }

            // Backpressure handling
            try {
                const ch: any = (p as any)?._channel || (p as any)?.channel
                if (ch && typeof ch.bufferedAmount === 'number') {
                    const MAX_BUFFER = 512 * 1024
                    const LOW_WATER = 256 * 1024
                    if (ch.bufferedAmount > MAX_BUFFER) {
                        await new Promise<void>((resolve) => {
                            let done = false
                            const clearAll = () => {
                                done = true
                                try { ch.removeEventListener?.('bufferedamountlow', onLow) } catch { }
                                try { clearInterval(timer) } catch { }
                                try { clearTimeout(tmo) } catch { }
                            }
                            const onLow = () => { if (done) return; clearAll(); resolve() }
                            const poll = () => { if (done) return; if (ch.bufferedAmount <= LOW_WATER) { clearAll(); resolve() } }
                            const timer = setInterval(poll, 50)
                            const tmo = setTimeout(() => { if (done) return; clearAll(); resolve() }, 2000)
                            try { ch.addEventListener?.('bufferedamountlow', onLow, { once: true }) } catch { }
                        })
                    }
                }
            } catch { }

            offset = next
            progressCb?.(offset, file.size)
        }

        if (offset < file.size) {
            return false
        }

        if (!p.destroyed && (p as any).connected) {
            try {
                p.send(JSON.stringify({ type: 'file-complete', fileName: file.name }))
            } catch { }
        }

        return true
    }

    // Send link to a specific peer
    const sendLinkToPeer = async (p: SimplePeer.Instance, linkUrl: string, message?: string) => {
        if (!p || p.destroyed || !(p as any).connected) return false
        try {
            p.send(JSON.stringify({ type: 'link', linkUrl, message }))
            return true
        } catch {
            return false
        }
    }

    // Send message to a specific peer
    const sendMessageToPeer = async (p: SimplePeer.Instance, message: string) => {
        if (!p || p.destroyed || !(p as any).connected) return false
        try {
            const CHUNK_SIZE = 6 * 1024

            if (message.length <= CHUNK_SIZE) {
                p.send(JSON.stringify({ type: 'message-only', message }))
            } else {
                const totalSize = message.length
                p.send(JSON.stringify({ type: 'msg-metadata', totalSize, timestamp: Date.now() }))

                let offset = 0
                while (offset < message.length) {
                    const chunk = message.slice(offset, offset + CHUNK_SIZE)
                    p.send(JSON.stringify({ type: 'msg-chunk', data: chunk }))
                    offset += CHUNK_SIZE
                    await new Promise(r => setTimeout(r, 5))
                }

                p.send(JSON.stringify({ type: 'msg-complete' }))
            }
            return true
        } catch {
            return false
        }
    }

    // Public API: Send file (uses single peer for regular, specific peer for MultiShare)
    const sendFile = async (file: File, metadata?: { message?: string; fileId?: string }) => {
        const p = peerRef.current
        if (!p || p.destroyed || !(p as any).connected) {
            callbacks.onSendFailed?.(file.name, 'Not connected')
            return
        }

        callbacks.onSendStart?.(file.name, file.size)

        const ok = await sendFileToPeer(p, file, metadata, (sent, total) => {
            callbacks.onSendProgress?.(file.name, sent, total)
        })

        if (ok) {
            callbacks.onSendComplete?.(file.name)
        } else {
            callbacks.onSendFailed?.(file.name, 'Transfer aborted')
        }
    }

    const sendLink = async (linkUrl: string, message?: string) => {
        const p = peerRef.current
        if (!p || p.destroyed || !(p as any).connected) {
            callbacks.onSendFailed?.('link', 'Not connected')
            return
        }

        const ok = await sendLinkToPeer(p, linkUrl, message)
        if (ok) {
            callbacks.onSendComplete?.('link')
        } else {
            callbacks.onSendFailed?.('link', 'Failed to send link')
        }
    }

    const sendMessage = async (message: string) => {
        const p = peerRef.current
        if (!p || p.destroyed || !(p as any).connected) {
            callbacks.onSendFailed?.('message', 'Not connected')
            return
        }

        const ok = await sendMessageToPeer(p, message)
        if (ok) {
            callbacks.onSendComplete?.('message')
        } else {
            callbacks.onSendFailed?.('message', 'Failed to send message')
        }
    }

    // MultiShare: send all content to a specific receiver
    const sendToReceiver = async (
        receiverId: string,
        files: File[],
        linkUrl?: string,
        message?: string,
        codeShareMode?: boolean,
        progressCb?: (sent: number, total: number) => void
    ) => {
        const p = peersMapRef.current.get(receiverId)
        if (!p || p.destroyed || !(p as any).connected) {
            return false
        }

        const totalBytes = files.reduce((sum, f) => sum + f.size, 0)
        let bytesSent = 0

        try {
            // Send files
            for (const file of files) {
                const ok = await sendFileToPeer(p, file, { message }, (sent) => {
                    progressCb?.(bytesSent + sent, totalBytes || 1)
                })
                if (!ok) return false
                bytesSent += file.size
            }

            // Send link if present
            if (linkUrl) {
                const ok = await sendLinkToPeer(p, linkUrl, message)
                if (!ok) return false
            }

            // Send code if in code share mode with no files/links
            if (codeShareMode && files.length === 0 && !linkUrl && message) {
                const ok = await sendMessageToPeer(p, message)
                if (!ok) return false
            }

            return true
        } catch {
            return false
        }
    }

    // Get peer for a specific receiver (MultiShare)
    const getPeerForReceiver = (receiverId: string) => {
        return peersMapRef.current.get(receiverId) || null
    }

    const cleanup = useCallback(() => {
        // Cleanup single peer
        if (peerRef.current) {
            peerRef.current.destroy()
            peerRef.current = null
        }
        // Cleanup all MultiShare peers
        peersMapRef.current.forEach((p) => {
            try { p.destroy() } catch { }
        })
        peersMapRef.current.clear()
        setPeer(null)
        setIsConnected(false)
        setTargetId(null)
        setConnectedReceivers([])
    }, [])

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            cleanup()
        }
    }, [cleanup])

    // Direct connection check - bypasses React state timing issues
    const isConnectedNow = useCallback(() => {
        const p = peerRef.current
        return !!(p && !p.destroyed && (p as any).connected)
    }, [])

    return {
        peer,
        isConnected,
        targetId,
        sendFile,
        sendLink,
        sendMessage,
        cleanup,
        isConnectedNow,
        // MultiShare exports
        connectedReceivers,
        sendToReceiver,
        getPeerForReceiver,
    }
}
