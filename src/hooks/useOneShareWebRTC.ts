'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import SimplePeer from 'simple-peer'

type FileMetadata = {
    fileName: string
    fileSize: number
    fileType: string
    message?: string
    fileId?: string
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
}

export const useOneShareWebRTC = (
    socket: any,
    code: string | null,
    isSender: boolean,
    callbacks: ReceiveCallbacks = {}
) => {
    const [peer, setPeer] = useState<SimplePeer.Instance | null>(null)
    const [isConnected, setIsConnected] = useState(false)
    const [targetId, setTargetId] = useState<string | null>(null)
    const peerRef = useRef<SimplePeer.Instance | null>(null)
    const recvState = useRef<{ meta?: FileMetadata; buffers: BlobPart[]; received: number }>({
        buffers: [],
        received: 0
    })

    // Handle signaling events
    useEffect(() => {
        if (!socket || !code) return

        const handleReceiverJoined = (data: { receiverId: string }) => {
            console.log('Receiver joined:', data?.receiverId)
            setTargetId(data?.receiverId)
            // Sender initiates the connection
            if (isSender) {
                createPeer(true, data?.receiverId)
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

        const handleAnswer = (data: { answer: any }) => {
            console.log('Received answer')
            peerRef.current?.signal(data?.answer)
        }

        const handleIceCandidate = (data: { candidate: any }) => {
            peerRef.current?.signal(data?.candidate)
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
    }, [socket, code, isSender])

    const createPeer = (initiator: boolean, tid: string) => {
        if (peerRef.current) {
            peerRef.current.destroy()
        }

        // ICE servers for WebRTC
        const stunDefaults = [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' }
        ] as any[]

        const turnUrls = (process.env.NEXT_PUBLIC_TURN_URLS || '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        const turnUser = process.env.NEXT_PUBLIC_TURN_USERNAME
        const turnCred = process.env.NEXT_PUBLIC_TURN_CREDENTIAL

        if (turnUrls.length > 0) {
            stunDefaults.push({ urls: turnUrls, username: turnUser, credential: turnCred })
        }

        const newPeer = new SimplePeer({
            initiator,
            trickle: true,
            config: {
                iceServers: stunDefaults,
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
            console.log('WebRTC connected!')
            setIsConnected(true)
            callbacks.onConnect?.()

            // Tune data channel
            try {
                const ch: any = (newPeer as any)?._channel || (newPeer as any)?.channel
                if (ch) {
                    try { ch.binaryType = 'arraybuffer' } catch { }
                    try { ch.bufferedAmountLowThreshold = 64 * 1024 } catch { }
                }
            } catch { }
        })

        newPeer.on('data', async (data: any) => {
            // Handle control frames (JSON strings)
            if (typeof data === 'string') {
                try {
                    const obj = JSON.parse(data)
                    switch (obj.type) {
                        case 'file-metadata':
                            recvState.current = { meta: obj, buffers: [], received: 0 }
                            callbacks.onFileMetadata?.(obj)
                            return
                        case 'file-complete':
                            if (recvState.current.meta) {
                                const blob = new Blob(recvState.current.buffers, { type: recvState.current.meta.fileType })
                                const url = URL.createObjectURL(blob)
                                callbacks.onFileComplete?.(url, recvState.current.meta)
                                recvState.current = { buffers: [], received: 0 }
                            }
                            return
                        case 'link':
                            callbacks.onLink?.(obj.linkUrl, obj.message)
                            return
                        case 'message-only':
                            callbacks.onMessage?.(obj.message)
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
                        if (obj?.type === 'file-metadata') {
                            recvState.current = { meta: obj, buffers: [], received: 0 }
                            callbacks.onFileMetadata?.(obj)
                            return
                        }
                        if (obj?.type === 'file-complete') {
                            if (recvState.current.meta) {
                                const blob = new Blob(recvState.current.buffers, { type: recvState.current.meta.fileType })
                                const url = URL.createObjectURL(blob)
                                callbacks.onFileComplete?.(url, recvState.current.meta)
                                recvState.current = { buffers: [], received: 0 }
                            }
                            return
                        }
                        if (obj?.type === 'link') {
                            callbacks.onLink?.(obj.linkUrl, obj.message)
                            return
                        }
                        if (obj?.type === 'message-only') {
                            callbacks.onMessage?.(obj.message)
                            return
                        }
                    } catch {
                        // Fall through to binary handling
                    }
                }

                // File chunk - copy to ensure proper ArrayBuffer type
                recvState.current.buffers.push(u8.slice().buffer)
                recvState.current.received += u8.byteLength
                callbacks.onFileChunk?.(
                    recvState.current.meta?.fileName || '',
                    recvState.current.received,
                    recvState.current.meta?.fileSize || 0
                )
            }
        })

        newPeer.on('error', (err: any) => {
            console.error('Peer error:', err)
            const message = String(err?.message || '')
            callbacks.onSendFailed?.('', message || 'Connection error')
        })

        newPeer.on('close', () => {
            console.log('Peer closed')
            setIsConnected(false)
            callbacks.onClose?.()
        })

        peerRef.current = newPeer
        setPeer(newPeer)
        setTargetId(tid)
    }

    const sendFile = async (file: File, metadata?: { message?: string; fileId?: string }) => {
        const p = peerRef.current
        if (!p || p.destroyed || !(p as any).connected) {
            callbacks.onSendFailed?.(file.name, 'Not connected')
            return
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
        } catch { }

        const chunkSize = 32 * 1024
        let offset = 0
        callbacks.onSendStart?.(file.name, file.size)

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
            callbacks.onSendProgress?.(file.name, offset, file.size)
        }

        if (offset < file.size) {
            callbacks.onSendFailed?.(file.name, 'Transfer aborted')
            return
        }

        if (!p.destroyed && (p as any).connected) {
            try {
                p.send(JSON.stringify({ type: 'file-complete', fileName: file.name }))
            } catch { }
        }

        callbacks.onSendComplete?.(file.name)
    }

    const sendLink = async (linkUrl: string, message?: string) => {
        const p = peerRef.current
        if (!p || p.destroyed || !(p as any).connected) {
            callbacks.onSendFailed?.('link', 'Not connected')
            return
        }

        try {
            p.send(JSON.stringify({ type: 'link', linkUrl, message }))
            callbacks.onSendComplete?.('link')
        } catch {
            callbacks.onSendFailed?.('link', 'Failed to send link')
        }
    }

    const sendMessage = async (message: string) => {
        const p = peerRef.current
        if (!p || p.destroyed || !(p as any).connected) {
            callbacks.onSendFailed?.('message', 'Not connected')
            return
        }

        try {
            p.send(JSON.stringify({ type: 'message-only', message }))
            callbacks.onSendComplete?.('message')
        } catch {
            callbacks.onSendFailed?.('message', 'Failed to send message')
        }
    }

    const cleanup = useCallback(() => {
        if (peerRef.current) {
            peerRef.current.destroy()
            peerRef.current = null
        }
        setPeer(null)
        setIsConnected(false)
        setTargetId(null)
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
    }
}
