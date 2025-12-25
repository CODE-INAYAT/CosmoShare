'use client'

import { useEffect, useRef, useState } from 'react'
import SimplePeer from 'simple-peer'

type ReceiveCallbacks = {
  onFileMetadata?: (fromId: string, meta: { fileName: string; fileSize: number; fileType: string; message?: string; senderName?: string; senderUniqueId?: string; allowReshare?: boolean; fileId?: string }) => void
  onFileChunk?: (fromId: string, receivedBytes: number, total: number) => void
  onFileComplete?: (fromId: string, fileBase64: string, meta: { fileName: string; fileSize: number; fileType: string; message?: string; senderName?: string; senderUniqueId?: string; allowReshare?: boolean; fileId?: string }) => void
  onMessage?: (fromId: string, message: string, sender?: { name?: string; uniqueId?: string; allowReshare?: boolean }) => void
  onLink?: (
    fromId: string,
    linkUrl: string,
    message?: string,
    sender?: { name?: string; uniqueId?: string; allowReshare?: boolean; fileId?: string }
  ) => void
  onConnect?: (peerId: string) => void
  onClose?: (peerId: string) => void
  onSendStart?: (targetId: string, fileName: string, totalBytes: number) => void
  onSendProgress?: (targetId: string, fileName: string, sentBytes: number, totalBytes: number) => void
  onSendComplete?: (targetId: string, fileName: string) => void
  onSendFailed?: (targetId: string, fileName: string, reason?: string) => void
}

export const useWebRTC = (socket: any, roomNumber: string, callbacks: ReceiveCallbacks = {}) => {
  const [peers, setPeers] = useState<Map<string, SimplePeer.Instance>>(new Map())
  const peersRef = useRef<Map<string, SimplePeer.Instance>>(new Map())
  // Receiver assembly buffers (store BlobPart to avoid extra copies)
  const recvState = useRef<Map<string, { meta?: any; buffers: BlobPart[]; received: number }>>(new Map())
  // Sender in-flight state per peer
  const sendState = useRef<Map<string, { fileName: string; total: number; sent: number }>>(new Map())
  // Message receive state for chunked messages
  const msgRecvState = useRef<Map<string, { totalSize: number; chunks: string[]; received: number; senderName?: string; senderUniqueId?: string; allowReshare?: boolean }>>(new Map())
  // Cache method per connected peer: PW-RTC | SW-RTC | TW-RTC
  const peerMethodRef = useRef<Map<string, 'PW-RTC' | 'SW-RTC' | 'TW-RTC' | 'PW-RTC-F'>>(new Map())

  useEffect(() => {
    if (!socket) return

    const onOffer = ({ offer, senderId }: { offer: any; senderId: string }) => {
      handleOffer(offer, senderId)
    }
    const onAnswer = ({ answer, senderId }: { answer: any; senderId: string }) => {
      handleAnswer(answer, senderId)
    }
    const onIce = ({ candidate, senderId }: { candidate: any; senderId: string }) => {
      handleIceCandidate(candidate, senderId)
    }

    socket.on('webrtc-offer', onOffer)
    socket.on('webrtc-answer', onAnswer)
    socket.on('webrtc-ice-candidate', onIce)

    return () => {
      socket.off('webrtc-offer', onOffer)
      socket.off('webrtc-answer', onAnswer)
      socket.off('webrtc-ice-candidate', onIce)
    }
  }, [socket])

  const inferMethodFromStats = async (peer: any): Promise<'PW-RTC' | 'SW-RTC' | 'TW-RTC' | 'PW-RTC-F'> => {
    try {
      const pc: RTCPeerConnection | undefined = (peer as any)?._pc || (peer as any)?.peerConnection || (peer as any)?.pc
      if (!pc || pc.signalingState === 'closed') return 'PW-RTC-F'
      const stats = await pc.getStats()
      let selectedPairId: string | undefined
      const candidates: Record<string, any> = {}
      let determined = false
      stats.forEach((report: any) => {
        if (report.type === 'local-candidate' || report.type === 'remote-candidate' || report.type === 'candidate') {
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
        if (types.includes('relay')) { determined = true; return 'TW-RTC' }
        if (types.includes('srflx') || types.includes('prflx')) { determined = true; return 'SW-RTC' }
        if (types.includes('host')) { determined = true; return 'PW-RTC' }
      }
      // Fallback: look at any candidate types
      const anyTypes = Object.values(candidates).map((c: any) => c?.candidateType)
      if (anyTypes.includes('relay')) { determined = true; return 'TW-RTC' }
      if (anyTypes.includes('srflx') || anyTypes.includes('prflx')) { determined = true; return 'SW-RTC' }
      if (anyTypes.includes('host')) { determined = true; return 'PW-RTC' }
      return determined ? 'PW-RTC' : 'PW-RTC-F'
    } catch {
      return 'PW-RTC-F'
    }
  }

  const getPeerMethod = async (targetId: string): Promise<'PW-RTC' | 'SW-RTC' | 'TW-RTC' | 'PW-RTC-F'> => {
    const cached = peerMethodRef.current.get(targetId)
    if (cached) return cached
    const peer = peersRef.current.get(targetId)
    if (!peer) return 'PW-RTC-F'
    const method = await inferMethodFromStats(peer as any)
    peerMethodRef.current.set(targetId, method)
    return method
  }

  const createPeer = (targetId: string, initiator: boolean = false): SimplePeer.Instance => {
    // Build ICE servers with optional TURN from env for cross-network connectivity
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

    const peer = new SimplePeer({
      initiator,
      trickle: true,
      config: {
        iceServers: stunDefaults,
      }
    })

    peer.on('signal', (data: any) => {
      if (data.type === 'offer') {
        socket?.emit('webrtc-offer', { targetId, offer: data, roomNumber })
      } else if (data.type === 'answer') {
        socket?.emit('webrtc-answer', { targetId, answer: data, roomNumber })
      } else if ((data as any).candidate) {
        socket?.emit('webrtc-ice-candidate', { targetId, candidate: data, roomNumber })
      }
    })

    peer.on('connect', () => {
      callbacks.onConnect?.(targetId)
      // Determine and cache method on connect
      setTimeout(async () => {
        const method = await getPeerMethod(targetId)
        peerMethodRef.current.set(targetId, method)
      }, 0)

      // Tune underlying RTCDataChannel for binary throughput on mobile
      try {
        const ch: any = (peer as any)?._channel || (peer as any)?.channel || (peer as any)?.dataChannel
        if (ch) {
          // Prefer ArrayBuffer to avoid Blob/TypedArray conversions
          try { ch.binaryType = 'arraybuffer' } catch { }
          // Set a reasonable low threshold so 'bufferedamountlow' fires earlier
          // Mobile browsers benefit from smaller thresholds
          try { ch.bufferedAmountLowThreshold = 64 * 1024 } catch { }
        }
      } catch { }
    })

    peer.on('data', async (data: any) => {
      // Control frames: primarily strings, but some browsers can deliver as UTF-8 bytes.
      if (typeof data === 'string') {
        try {
          const obj = JSON.parse(data)
          switch (obj.type) {
            case 'file-metadata': {
              recvState.current.set(targetId, { meta: obj, buffers: [], received: 0 })
              callbacks.onFileMetadata?.(targetId, obj)
              return
            }
            case 'file-complete': {
              const state = recvState.current.get(targetId)
              if (state && state.meta) {
                const blob = new Blob(state.buffers as BlobPart[], { type: state.meta.fileType })
                const url = URL.createObjectURL(blob)
                callbacks.onFileComplete?.(targetId, url, state.meta)
                recvState.current.delete(targetId)
              }
              return
            }
            case 'message':
              callbacks.onMessage?.(targetId, obj.message)
              return
            case 'msg-metadata': {
              // Start receiving chunked message
              msgRecvState.current.set(targetId, { totalSize: obj.totalSize, chunks: [], received: 0 })
              return
            }
            case 'msg-chunk': {
              const msgState = msgRecvState.current.get(targetId)
              if (msgState) {
                msgState.chunks.push(obj.data)
                msgState.received += obj.data.length
              }
              return
            }
            case 'msg-complete': {
              const msgState = msgRecvState.current.get(targetId)
              if (msgState) {
                const fullMessage = msgState.chunks.join('')
                callbacks.onMessage?.(targetId, fullMessage)
                msgRecvState.current.delete(targetId)
              }
              return
            }
            case 'link':
              callbacks.onLink?.(targetId, obj.linkUrl, obj.message, { name: obj.senderName, uniqueId: obj.senderUniqueId, allowReshare: obj.allowReshare })
              return
          }
        } catch {
          // ignore malformed control frames
        }
      }

      // Binary chunk path (ArrayBuffer, TypedArray, or Blob). Heuristic decode for small JSON control frames.
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
        // If it looks like a small JSON control frame (starts with '{' or '['), try to parse as control
        const firstByte = u8.byteLength > 0 ? u8[0] : 0
        const looksJson = (firstByte === 0x7b /* '{' */ || firstByte === 0x5b /* '[' */)
        if (looksJson && u8.byteLength <= 8 * 1024) {
          try {
            const text = new TextDecoder().decode(u8)
            const obj = JSON.parse(text)
            if (obj && obj.type) {
              if (obj.type === 'file-metadata') {
                recvState.current.set(targetId, { meta: obj, buffers: [], received: 0 })
                callbacks.onFileMetadata?.(targetId, obj)
                return
              }
              if (obj.type === 'file-complete') {
                const state = recvState.current.get(targetId)
                if (state && state.meta) {
                  const blob = new Blob(state.buffers as BlobPart[], { type: state.meta.fileType })
                  const url = URL.createObjectURL(blob)
                  callbacks.onFileComplete?.(targetId, url, state.meta)
                  recvState.current.delete(targetId)
                }
                return
              }
              if (obj.type === 'message') { callbacks.onMessage?.(targetId, obj.message, { name: obj.senderName, uniqueId: obj.senderUniqueId, allowReshare: obj.allowReshare }); return }
              if (obj.type === 'msg-metadata') {
                msgRecvState.current.set(targetId, { totalSize: obj.totalSize, chunks: [], received: 0, senderName: obj.senderName, senderUniqueId: obj.senderUniqueId, allowReshare: obj.allowReshare })
                return
              }
              if (obj.type === 'msg-chunk') {
                const msgState = msgRecvState.current.get(targetId)
                if (msgState) {
                  msgState.chunks.push(obj.data)
                  msgState.received += obj.data.length
                }
                return
              }
              if (obj.type === 'msg-complete') {
                const msgState = msgRecvState.current.get(targetId)
                if (msgState) {
                  const fullMessage = msgState.chunks.join('')
                  callbacks.onMessage?.(targetId, fullMessage, { name: msgState.senderName, uniqueId: msgState.senderUniqueId, allowReshare: msgState.allowReshare })
                  msgRecvState.current.delete(targetId)
                }
                return
              }
              if (obj.type === 'link') { callbacks.onLink?.(targetId, obj.linkUrl, obj.message, { name: obj.senderName, uniqueId: obj.senderUniqueId, allowReshare: obj.allowReshare }); return }
            }
          } catch {
            // fall through to binary handling
          }
        }
        const state = recvState.current.get(targetId)
        if (state) {
          // Avoid extra copies; store the Uint8Array directly (BlobPart)
          state.buffers.push(u8 as unknown as BlobPart)
          state.received += u8.byteLength
          callbacks.onFileChunk?.(targetId, state.received, state.meta?.fileSize || 0)
        }
      }
    })

    peer.on('error', (err: any) => {
      // Treat user-initiated/remote closes as benign and avoid noisy errors
      const message = String(err?.message || '')
      const name = String(err?.name || '')
      const reason = String(err?.reason || '')
      const isBenignClose =
        name === 'OperationError' && (/Abort/i.test(message) || /Close called/i.test(message) || /Close/i.test(reason))
      if (isBenignClose || peer.destroyed) {
        console.warn('Peer closed', targetId, reason || message)
        const inflight = sendState.current.get(targetId)
        if (inflight) {
          callbacks.onSendFailed?.(targetId, inflight.fileName, reason || message)
          sendState.current.delete(targetId)
        }
        return
      }
      console.error('Peer error', targetId, err)
      const inflight = sendState.current.get(targetId)
      if (inflight) {
        callbacks.onSendFailed?.(targetId, inflight.fileName, message || 'Peer error')
        sendState.current.delete(targetId)
      }
    })

    peer.on('close', () => {
      peersRef.current.delete(targetId)
      setPeers(new Map(peersRef.current))
      const inflight = sendState.current.get(targetId)
      if (inflight) {
        callbacks.onSendFailed?.(targetId, inflight.fileName, 'Peer closed')
        sendState.current.delete(targetId)
      }
      callbacks.onClose?.(targetId)
    })

    peersRef.current.set(targetId, peer)
    setPeers(new Map(peersRef.current))
    return peer
  }

  const ensureConnection = (targetId: string) => {
    if (!peersRef.current.has(targetId)) {
      createPeer(targetId, true)
    }
    return peersRef.current.get(targetId)!
  }

  const handleOffer = (offer: any, senderId: string) => {
    let peer = peersRef.current.get(senderId)
    if (!peer) peer = createPeer(senderId, false)
    peer.signal(offer)
  }

  const handleAnswer = (answer: any, senderId: string) => {
    const peer = peersRef.current.get(senderId)
    if (peer) peer.signal(answer)
  }

  const handleIceCandidate = (candidate: any, senderId: string) => {
    const peer = peersRef.current.get(senderId)
    if (peer) peer.signal(candidate)
  }

  const sendFile = async (targetId: string, file: File, metadata?: { message?: string; senderName?: string; senderUniqueId?: string; allowReshare?: boolean; fileId?: string }): Promise<'PW-RTC' | 'SW-RTC' | 'TW-RTC' | 'PW-RTC-F' | void> => {
    let peer = peersRef.current.get(targetId)
    if (!peer) {
      peer = createPeer(targetId, true)
    }

    // Wait for data channel to be ready
    if (peer.destroyed) return
    if (!(peer as any).connected) {
      await new Promise<void>((resolve, reject) => {
        const onConnect = () => {
          peer!.off('error', onError)
          resolve()
        }
        const onError = (e: any) => {
          peer!.off('connect', onConnect)
          reject(e)
        }
        peer!.once('connect', onConnect)
        peer!.once('error', onError)
      }).catch(() => { })
    }
    if (peer.destroyed || !(peer as any).connected) return

    // Determine connection method now that we're connected
    const method = await getPeerMethod(targetId)

    const meta = {
      type: 'file-metadata',
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type,
      message: metadata?.message,
      senderName: metadata?.senderName,
      senderUniqueId: metadata?.senderUniqueId,
      allowReshare: metadata?.allowReshare,
      fileId: metadata?.fileId,
      method,
    }
    try {
      peer.send(JSON.stringify(meta))
    } catch { }

    // Adaptive chunk size per connection type (32 = SW-RTC) 
    let chunkSize = 32 * 1024
    if (method === 'PW-RTC') chunkSize = 60 * 1024
    if (method === 'TW-RTC') chunkSize = 16 * 1024
    let offset = 0
    callbacks.onSendStart?.(targetId, file.name, file.size)
    sendState.current.set(targetId, { fileName: file.name, total: file.size, sent: 0 })

    const readSlice = async (start: number, end: number): Promise<ArrayBuffer> => {
      // Use Blob.arrayBuffer() to avoid FileReader overhead on mobile
      return await file.slice(start, end).arrayBuffer()
    }

    while (offset < file.size) {
      if (peer.destroyed || !(peer as any).connected) {
        // Abort gracefully if connection drops
        break
      }
      const next = Math.min(offset + chunkSize, file.size)
      const chunk = await readSlice(offset, next)
      // Use stream write for backpressure
      const u8 = new Uint8Array(chunk)
      let ok: any = true
      try {
        ok = (peer as any).write ? (peer as any).write(u8) : (peer as any).send(u8)
      } catch (e) {
        // Likely channel closing mid-send; exit loop
        break
      }
      // Honor stream backpressure via simple-peer 'drain'
      if (ok === false && (peer as any).once) {
        await new Promise<void>(res => (peer as any).once('drain', () => res()))
      }
      // Additional RTCDataChannel backpressure for mobile devices with robust fallback
      try {
        const ch: any = (peer as any)?._channel || (peer as any)?.channel || (peer as any)?.dataChannel
        if (ch && typeof ch.bufferedAmount === 'number') {
          const MAX_BUFFER = 512 * 1024 // 512KB cap for mobile
          const LOW_WATER = 256 * 1024
          if (ch.bufferedAmount > MAX_BUFFER) {
            try { if (!ch.bufferedAmountLowThreshold || ch.bufferedAmountLowThreshold > LOW_WATER) ch.bufferedAmountLowThreshold = LOW_WATER } catch { }
            // Wait using both event and polling with timeout to avoid hangs on browsers not firing the event
            await new Promise<void>((resolve) => {
              let done = false
              const clearAll = () => { done = true; try { ch.removeEventListener?.('bufferedamountlow', onLow as any) } catch { }; try { clearInterval(timer) } catch { }; try { clearTimeout(tmo) } catch { } }
              const onLow = () => { if (done) return; clearAll(); resolve() }
              const poll = () => { if (done) return; if (ch.bufferedAmount <= LOW_WATER) { clearAll(); resolve() } }
              let timer: any = setInterval(poll, 50)
              let tmo: any = setTimeout(() => { if (done) return; clearAll(); resolve() }, 2000)
              try { ch.addEventListener?.('bufferedamountlow', onLow as any, { once: true }) } catch { }
            })
          }
        }
      } catch { }
      offset = next
      callbacks.onSendProgress?.(targetId, file.name, offset, file.size)
      const s = sendState.current.get(targetId)
      if (s) { s.sent = offset; sendState.current.set(targetId, s) }
    }
    if (offset < file.size) {
      // Aborted before completion
      callbacks.onSendFailed?.(targetId, file.name, 'Transfer aborted')
      sendState.current.delete(targetId)
      return
    }
    if (!peer.destroyed && (peer as any).connected) {
      try {
        peer.send(JSON.stringify({ type: 'file-complete', fileName: file.name }))
      } catch { }
    }
    callbacks.onSendComplete?.(targetId, file.name)
    sendState.current.delete(targetId)
    return method
  }

  const sendMessage = async (targetId: string, message: string, sender?: { name?: string; uniqueId?: string; allowReshare?: boolean }) => {
    const peer = peersRef.current.get(targetId)
    if (!peer || peer.destroyed) return
    if (!(peer as any).connected) {
      await new Promise<void>((resolve) => {
        const onConnect = () => resolve()
          ; (peer as any).once?.('connect', onConnect)
      })
    }
    if (!peer.destroyed && (peer as any).connected) {
      try {
        const CHUNK_SIZE = 6 * 1024 // 6KB chunks - stays under 8KB binary JSON limit with overhead

        if (message.length <= CHUNK_SIZE) {
          // Small message - send directly with sender info and allowReshare
          peer.send(JSON.stringify({ type: 'message', message, senderName: sender?.name, senderUniqueId: sender?.uniqueId, allowReshare: sender?.allowReshare, timestamp: Date.now() }))
        } else {
          // Large message - send in chunks
          const totalSize = message.length

          // Send metadata with sender info and allowReshare
          peer.send(JSON.stringify({ type: 'msg-metadata', totalSize, senderName: sender?.name, senderUniqueId: sender?.uniqueId, allowReshare: sender?.allowReshare, timestamp: Date.now() }))

          // Send chunks
          let offset = 0
          while (offset < message.length) {
            const chunk = message.slice(offset, offset + CHUNK_SIZE)
            peer.send(JSON.stringify({ type: 'msg-chunk', data: chunk }))
            offset += CHUNK_SIZE
            // Small delay to prevent buffer overflow
            await new Promise(r => setTimeout(r, 5))
          }

          // Send completion signal
          peer.send(JSON.stringify({ type: 'msg-complete' }))
        }
      } catch { }
    }
  }

  const sendLink = async (
    targetId: string,
    linkUrl: string,
    message?: string,
    sender?: { name?: string; uniqueId?: string },
    allowReshare?: boolean,
    fileId?: string
  ): Promise<'PW-RTC' | 'SW-RTC' | 'TW-RTC' | 'PW-RTC-F' | void> => {
    const peer = peersRef.current.get(targetId)
    if (!peer || peer.destroyed) return
    if (!(peer as any).connected) {
      await new Promise<void>((resolve) => {
        const onConnect = () => resolve()
          ; (peer as any).once?.('connect', onConnect)
      })
    }
    if (!peer.destroyed && (peer as any).connected) {
      try {
        const method = await getPeerMethod(targetId)
        peer.send(JSON.stringify({ type: 'link', linkUrl, message, senderName: sender?.name, senderUniqueId: sender?.uniqueId, allowReshare, method, fileId }))
        return method
      } catch { }
    }
  }

  const closeConnection = (targetId: string) => {
    const peer = peersRef.current.get(targetId)
    if (peer) {
      peer.destroy()
      peersRef.current.delete(targetId)
      setPeers(new Map(peersRef.current))
    }
  }

  const closeAllConnections = () => {
    peersRef.current.forEach((p) => p.destroy())
    peersRef.current.clear()
    setPeers(new Map())
  }

  return {
    peers,
    ensureConnection,
    sendFile,
    sendMessage,
    sendLink,
    closeConnection,
    closeAllConnections,
    getPeerMethod,
  }
}