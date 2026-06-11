'use client'

import { useEffect, useRef, useState } from 'react'
import SimplePeer from 'simple-peer'

type ReceiveCallbacks = {
  onFileMetadata?: (fromId: string, meta: { fileName: string; fileSize: number; fileType: string; message?: string; senderName?: string; senderUniqueId?: string; allowReshare?: boolean; fileId?: string; location?: { latitude: number; longitude: number; name: string; address: string }; contact?: { name: string; phone: string } }) => void
  onFileChunk?: (fromId: string, receivedBytes: number, total: number) => void
  onFileComplete?: (fromId: string, fileBase64: string, meta: { fileName: string; fileSize: number; fileType: string; message?: string; senderName?: string; senderUniqueId?: string; allowReshare?: boolean; fileId?: string; location?: { latitude: number; longitude: number; name: string; address: string }; contact?: { name: string; phone: string } }) => void
  onMessage?: (fromId: string, message: string, sender?: { name?: string; uniqueId?: string; allowReshare?: boolean }) => void
  onLink?: (
    fromId: string,
    linkUrl: string,
    message?: string,
    sender?: { name?: string; uniqueId?: string; allowReshare?: boolean; fileId?: string }
  ) => void
  onTransferCancelled?: (fromId: string, sender?: { name?: string; uniqueId?: string }) => void
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

    const onTransferCancelled = (data: { senderId: string; senderName?: string; senderUniqueId?: string }) => {
      const sender = { name: data.senderName, uniqueId: data.senderUniqueId }
      if (data.senderId) {
        recvState.current.delete(data.senderId)
        callbacks.onTransferCancelled?.(data.senderId, sender)
      }
    }
    socket.on('transfer-cancelled', onTransferCancelled)

    return () => {
      socket.off('webrtc-offer', onOffer)
      socket.off('webrtc-answer', onAnswer)
      socket.off('webrtc-ice-candidate', onIce)
      socket.off('transfer-cancelled', onTransferCancelled)
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

    const peer = new SimplePeer({
      initiator,
      trickle: true,
      config: {
        iceServers,
        iceCandidatePoolSize: 4,
        bundlePolicy: 'max-bundle',
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
          // Low threshold so 'bufferedamountlow' fires early for responsive backpressure
          try { ch.bufferedAmountLowThreshold = 64 * 1024 } catch { }
        }
      } catch { }
    })

    peer.on('data', async (data: any) => {
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

      // Control frames: primarily strings, but some browsers can deliver as UTF-8 bytes.
      let obj: any = null
      if (typeof data === 'string') {
        try { obj = JSON.parse(data) } catch { }
      } else if (u8) {
        // If it looks like a small JSON control frame (starts with '{' or '['), try to parse as control
        const firstByte = u8.byteLength > 0 ? u8[0] : 0
        const looksJson = (firstByte === 0x7b /* '{' */ || firstByte === 0x5b /* '[' */)
        if (looksJson && u8.byteLength <= 8 * 1024) {
          try {
            const text = new TextDecoder().decode(u8)
            obj = JSON.parse(text)
          } catch { }
        }
      }

      if (obj && obj.type) {
        switch (obj.type) {
          case 'contact-share': {
            callbacks.onFileComplete?.(targetId, `tel:${obj.phone}`, {
              fileName: obj.name,
              fileSize: 0,
              fileType: 'contact',
              senderName: obj.senderName,
              senderUniqueId: obj.senderUniqueId,
              fileId: obj.fileId,
              contact: { name: obj.name, phone: obj.phone },
            })
            return
          }
          case 'location-share': {
            callbacks.onFileComplete?.(targetId, `https://www.google.com/maps?q=${obj.latitude},${obj.longitude}`, {
              fileName: obj.name,
              fileSize: 0,
              fileType: 'location',
              senderName: obj.senderName,
              senderUniqueId: obj.senderUniqueId,
              fileId: obj.fileId,
              location: { latitude: obj.latitude, longitude: obj.longitude, name: obj.name, address: obj.address },
            })
            return
          }
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
            callbacks.onMessage?.(targetId, obj.message, { name: obj.senderName, uniqueId: obj.senderUniqueId, allowReshare: obj.allowReshare })
            return
          case 'msg-metadata': {
            // Start receiving chunked message (preserve sender info for callback on completion)
            msgRecvState.current.set(targetId, { totalSize: obj.totalSize, chunks: [], received: 0, senderName: obj.senderName, senderUniqueId: obj.senderUniqueId, allowReshare: obj.allowReshare })
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
              callbacks.onMessage?.(targetId, fullMessage, { name: msgState.senderName, uniqueId: msgState.senderUniqueId, allowReshare: msgState.allowReshare })
              msgRecvState.current.delete(targetId)
            }
            return
          }
          case 'link':
            callbacks.onLink?.(targetId, obj.linkUrl, obj.message, { name: obj.senderName, uniqueId: obj.senderUniqueId, allowReshare: obj.allowReshare })
            return
          case 'transfer-cancelled':
            // Clear any in-progress receive state for this sender
            recvState.current.delete(targetId)
            callbacks.onTransferCancelled?.(targetId, { name: obj.senderName, uniqueId: obj.senderUniqueId })
            return
        }
      }

      // Handle binary file data if not a control frame
      if (u8) {
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

  const sendFile = async (
    targetId: string,
    file: File,
    metadata?: { message?: string; senderName?: string; senderUniqueId?: string; allowReshare?: boolean; fileId?: string },
    resolveTargetId?: () => string | undefined, // Callback to get latest socket ID (for retry with refreshed user)
    isCancelled?: () => boolean // Callback to check if transfer was cancelled externally
  ): Promise<'PW-RTC' | 'SW-RTC' | 'TW-RTC' | 'PW-RTC-F' | void> => {
    const MAX_RETRIES = 3
    const ATTEMPT_TIMEOUT = 5000 // 5 seconds per attempt
    let peer: SimplePeer.Instance | undefined
    let connected = false
    let currentTargetId = targetId

    console.log(`[sendFile] Starting transfer to ${targetId}, file: ${file.name}`)

    // IMMEDIATELY resolve to latest socket ID (user may have refreshed before transfer started)
    if (resolveTargetId) {
      const latestId = resolveTargetId()
      if (latestId && latestId !== currentTargetId) {
        console.log(`[sendFile] Using LATEST socket ID: ${latestId} (originally ${currentTargetId})`)
        currentTargetId = latestId
      }
    }

    // Try to establish connection up to 3 times
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      // Store old ID before potentially updating (needed for cleanup)
      const oldTargetId = currentTargetId

      // Before each retry, get the latest socket ID (user may have refreshed)
      if (attempt > 1 && resolveTargetId) {
        const newTargetId = resolveTargetId()
        if (newTargetId && newTargetId !== currentTargetId) {
          console.log(`[sendFile] User came back with new ID: ${newTargetId} (was ${currentTargetId})`)
          currentTargetId = newTargetId
        } else if (!newTargetId) {
          console.log(`[sendFile] User not found online, will retry with same ID`)
        } else {
          console.log(`[sendFile] User still has same ID: ${currentTargetId}`)
        }
      }

      console.log(`[sendFile] Attempt ${attempt}/${MAX_RETRIES} for ${currentTargetId}`)

      // Destroy previous peer if exists and failed - USE OLD ID for cleanup!
      if (peer && (peer.destroyed || !(peer as any).connected)) {
        console.log(`[sendFile] Destroying failed peer for ${oldTargetId}`)
        try { peer.destroy() } catch { }
        peersRef.current.delete(oldTargetId) // Delete OLD peer, not new one!
      }

      peer = peersRef.current.get(currentTargetId)
      if (!peer) {
        console.log(`[sendFile] Creating new peer for ${currentTargetId}`)
        peer = createPeer(currentTargetId, true)
      } else {
        console.log(`[sendFile] Reusing existing peer for ${currentTargetId}`)
      }

      if (peer.destroyed) {
        console.log(`[sendFile] Peer destroyed immediately, retrying...`)
        continue
      }

      // Wait for connection with event-based detection AND timeout
      if (!(peer as any).connected) {
        console.log(`[sendFile] Waiting for connection (timeout: ${ATTEMPT_TIMEOUT}ms)...`)
        const result = { connected: false }

        await new Promise<void>((resolve) => {
          const timeoutId = setTimeout(() => {
            console.log(`[sendFile] Attempt ${attempt} timed out`)
            peer!.off('connect', onConnect)
            peer!.off('error', onConnectError)
            peer!.off('close', onClose)
            resolve()
          }, ATTEMPT_TIMEOUT)

          const onConnect = () => {
            console.log(`[sendFile] Connected on attempt ${attempt}`)
            clearTimeout(timeoutId)
            peer!.off('error', onConnectError)
            peer!.off('close', onClose)
            result.connected = true
            resolve()
          }
          const onConnectError = (err: any) => {
            console.log(`[sendFile] Error on attempt ${attempt}:`, err?.message || err)
            clearTimeout(timeoutId)
            peer!.off('connect', onConnect)
            peer!.off('close', onClose)
            resolve()
          }
          const onClose = () => {
            console.log(`[sendFile] Peer closed on attempt ${attempt}`)
            clearTimeout(timeoutId)
            peer!.off('connect', onConnect)
            peer!.off('error', onConnectError)
            resolve()
          }
          peer!.once('connect', onConnect)
          peer!.once('error', onConnectError)
          peer!.once('close', onClose)
        })

        if (!result.connected) {
          console.log(`[sendFile] Attempt ${attempt} failed, will retry...`)
          continue // Retry
        }
      }

      if (!peer.destroyed && (peer as any).connected) {
        console.log(`[sendFile] Connection established on attempt ${attempt}`)
        connected = true
        break // Connection successful
      }
    }

    // All retries failed
    if (!connected || !peer || peer.destroyed || !(peer as any).connected) {
      console.log(`[sendFile] All ${MAX_RETRIES} attempts failed, showing Unreachable dialog`)
      return // undefined triggers Unreachable dialog
    }

    // Event-based disconnect detection for during-transfer drops
    let disconnected = false
    let disconnectResolver: (() => void) | null = null
    const disconnectPromise = new Promise<void>(resolve => { disconnectResolver = resolve })
    const onDisconnect = () => { disconnected = true; disconnectResolver?.() }
    peer.on('close', onDisconnect)
    peer.on('error', onDisconnect)
    const cleanup = () => { peer?.off('close', onDisconnect); peer?.off('error', onDisconnect) }

    try {

      // Determine connection method now that we're connected
      const method = await getPeerMethod(currentTargetId)

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
      } catch { cleanup(); return }

      // Adaptive chunk size per connection type
      // Max 64KB — Safari/mobile WebKit SCTP caps single-message at 64KB;
      // exceeding it silently kills the data channel.
      let chunkSize = 64 * 1024            // SW-RTC default
      if (method === 'PW-RTC') chunkSize = 64 * 1024   // direct / same-network
      if (method === 'TW-RTC') chunkSize = 48 * 1024   // TURN relay (was 16KB, now 48KB — 3× faster)
      let offset = 0
      callbacks.onSendStart?.(currentTargetId, file.name, file.size)
      sendState.current.set(currentTargetId, { fileName: file.name, total: file.size, sent: 0 })

      const readSlice = async (start: number, end: number): Promise<ArrayBuffer> => {
        return await file.slice(start, end).arrayBuffer()
      }

      let loopCounter = 0
      while (offset < file.size) {
        // High-frequency check for cancellation at start of iteration
        if (isCancelled?.() || peer.destroyed || !(peer as any).connected || disconnected) {
          break
        }

        const next = Math.min(offset + chunkSize, file.size)
        // Read file slice asynchronously - this already yields but maybe not enough if disk I/O is fast/cached
        const chunk = await readSlice(offset, next)

        // Re-check after async read
        if (isCancelled?.()) break

        const u8 = new Uint8Array(chunk)
        let ok: any = true
        try {
          ok = (peer as any).write ? (peer as any).write(u8) : (peer as any).send(u8)
        } catch (e) {
          break // Channel closing mid-send
        }

        // Honor stream backpressure - race against disconnect (not timeout)
        if (ok === false && (peer as any).once) {
          await Promise.race([
            new Promise<void>(res => (peer as any).once('drain', () => res())),
            disconnectPromise
          ])
          if (disconnected || peer.destroyed || !(peer as any).connected || isCancelled?.()) {
            break
          }
        }

        // RTCDataChannel backpressure for mobile - race against disconnect
        try {
          const ch: any = (peer as any)?._channel || (peer as any)?.channel || (peer as any)?.dataChannel
          if (ch && typeof ch.bufferedAmount === 'number') {
            const MAX_BUFFER = 512 * 1024
            const LOW_WATER = 256 * 1024

            // Check cancellation before potentially waiting
            if (isCancelled?.()) break

            if (ch.bufferedAmount > MAX_BUFFER) {
              try { if (!ch.bufferedAmountLowThreshold || ch.bufferedAmountLowThreshold > LOW_WATER) ch.bufferedAmountLowThreshold = LOW_WATER } catch { }
              await Promise.race([
                new Promise<void>((resolve) => {
                  let done = false
                  const onLow = () => { if (done) return; done = true; try { ch.removeEventListener?.('bufferedamountlow', onLow) } catch { }; try { clearInterval(timer) } catch { }; resolve() }
                  // Poll more frequently (20ms) for better responsiveness, but check cancellation inside poll
                  const poll = () => {
                    if (done) return;
                    if (ch.bufferedAmount <= LOW_WATER || disconnected || isCancelled?.()) { onLow() }
                  }
                  const timer = setInterval(poll, 20)
                  try { ch.addEventListener?.('bufferedamountlow', onLow, { once: true }) } catch { }
                }),
                disconnectPromise
              ])

              if (disconnected || isCancelled?.()) break
            }
          }
        } catch { }

        offset = next
        callbacks.onSendProgress?.(currentTargetId, file.name, offset, file.size)
        const s = sendState.current.get(currentTargetId)
        if (s) { s.sent = offset; sendState.current.set(currentTargetId, s) }

        // Explicitly yield to main thread every few chunks to allow UI events (like Cancel click) to process
        loopCounter++
        if (loopCounter % 4 === 0) {
          await new Promise<void>(r => setTimeout(r, 0))
        }
      }

      if (offset < file.size) {
        callbacks.onSendFailed?.(currentTargetId, file.name, 'Transfer aborted')
        sendState.current.delete(currentTargetId)
        cleanup()
        return
      }

      if (!peer.destroyed && (peer as any).connected && !disconnected) {
        try {
          peer.send(JSON.stringify({ type: 'file-complete', fileName: file.name }))
        } catch { }
      }
      callbacks.onSendComplete?.(currentTargetId, file.name)
      sendState.current.delete(currentTargetId)
      cleanup()
      return method
    } catch (e) {
      cleanup()
      return
    }
  }

  const sendMessage = async (targetId: string, message: string, sender?: { name?: string; uniqueId?: string; allowReshare?: boolean }) => {
    const peer = peersRef.current.get(targetId)
    if (!peer || peer.destroyed) return

    // Event-based disconnect detection (100% reliable, no timeouts)
    let disconnected = false
    const onDisconnect = () => { disconnected = true }
    peer.on('close', onDisconnect)
    peer.on('error', onDisconnect)
    const cleanup = () => {
      peer?.off('close', onDisconnect)
      peer?.off('error', onDisconnect)
    }

    try {
      if (!(peer as any).connected) {
        await new Promise<void>((resolve) => {
          const onConnect = () => { peer!.off('error', onConnectError); resolve() }
          const onConnectError = () => { peer!.off('connect', onConnect); disconnected = true; resolve() }
          peer!.once('connect', onConnect)
          peer!.once('error', onConnectError)
        })
      }
      if (peer.destroyed || !(peer as any).connected || disconnected) { cleanup(); return }

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
          if (disconnected || peer.destroyed || !(peer as any).connected) break
          const chunk = message.slice(offset, offset + CHUNK_SIZE)
          peer.send(JSON.stringify({ type: 'msg-chunk', data: chunk }))
          offset += CHUNK_SIZE
          // Small delay to prevent buffer overflow
          await new Promise(r => setTimeout(r, 5))
        }

        // Send completion signal
        if (!disconnected && !peer.destroyed && (peer as any).connected) {
          peer.send(JSON.stringify({ type: 'msg-complete' }))
        }
      }
      cleanup()
    } catch {
      cleanup()
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

    // Event-based disconnect detection (100% reliable, no timeouts)
    let disconnected = false
    const onDisconnect = () => { disconnected = true }
    peer.on('close', onDisconnect)
    peer.on('error', onDisconnect)
    const cleanup = () => {
      peer?.off('close', onDisconnect)
      peer?.off('error', onDisconnect)
    }

    try {
      if (!(peer as any).connected) {
        await new Promise<void>((resolve) => {
          const onConnect = () => { peer!.off('error', onConnectError); resolve() }
          const onConnectError = () => { peer!.off('connect', onConnect); disconnected = true; resolve() }
          peer!.once('connect', onConnect)
          peer!.once('error', onConnectError)
        })
      }
      if (peer.destroyed || !(peer as any).connected || disconnected) { cleanup(); return }

      const method = await getPeerMethod(targetId)
      peer.send(JSON.stringify({ type: 'link', linkUrl, message, senderName: sender?.name, senderUniqueId: sender?.uniqueId, allowReshare, method, fileId }))
      cleanup()
      return method
    } catch {
      cleanup()
      return
    }
  }


  const sendCancellation = (targetId: string, sender?: { name?: string; uniqueId?: string }) => {
    // 1. Send via Socket (Reliable, Immediate)
    if (socket && socket.connected) {
      socket.emit('transfer-cancelled', {
        targetId,
        senderName: sender?.name,
        senderUniqueId: sender?.uniqueId
      })
    }

    const peer = peersRef.current.get(targetId)
    if (!peer || peer.destroyed || !(peer as any).connected) return

    try {
      const payload = JSON.stringify({
        type: 'transfer-cancelled',
        senderName: sender?.name,
        senderUniqueId: sender?.uniqueId
      })
      if ((peer as any).write) (peer as any).write(payload)
      else peer.send(payload)
    } catch (e) {
      console.error('Failed to send cancellation:', e)
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
    sendCancellation,
    closeConnection,
    closeAllConnections,
    getPeerMethod,
  }
}