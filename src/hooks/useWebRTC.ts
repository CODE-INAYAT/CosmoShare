'use client'

import { useEffect, useRef, useState } from 'react'
import SimplePeer from 'simple-peer'

type ReceiveCallbacks = {
  onFileMetadata?: (fromId: string, meta: { fileName: string; fileSize: number; fileType: string; message?: string; senderName?: string; senderUniqueId?: string; allowReshare?: boolean }) => void
  onFileChunk?: (fromId: string, receivedBytes: number, total: number) => void
  onFileComplete?: (fromId: string, fileBase64: string, meta: { fileName: string; fileSize: number; fileType: string; message?: string; senderName?: string; senderUniqueId?: string; allowReshare?: boolean }) => void
  onMessage?: (fromId: string, message: string) => void
  onLink?: (
    fromId: string,
    linkUrl: string,
    message?: string,
    sender?: { name?: string; uniqueId?: string; allowReshare?: boolean }
  ) => void
  onConnect?: (peerId: string) => void
  onClose?: (peerId: string) => void
  // Sender-side progress
  onSendStart?: (targetId: string, fileName: string, totalBytes: number) => void
  onSendProgress?: (targetId: string, fileName: string, sentBytes: number, totalBytes: number) => void
  onSendComplete?: (targetId: string, fileName: string) => void
  onSendFailed?: (targetId: string, fileName: string, reason?: string) => void
}

export const useWebRTC = (socket: any, roomNumber: string, callbacks: ReceiveCallbacks = {}) => {
  const [peers, setPeers] = useState<Map<string, SimplePeer.Instance>>(new Map())
  const peersRef = useRef<Map<string, SimplePeer.Instance>>(new Map())
  // Receiver assembly buffers
  const recvState = useRef<Map<string, { meta?: any; buffers: ArrayBuffer[]; received: number }>>(new Map())
  // Sender in-flight state per peer
  const sendState = useRef<Map<string, { fileName: string; total: number; sent: number }>>(new Map())
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
    })

    peer.on('data', async (data: any) => {
      // Try to parse control frames as JSON
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
                const blob = new Blob(state.buffers, { type: state.meta.fileType })
                const reader = new FileReader()
                reader.onload = () => {
                  const base64 = reader.result as string
                  callbacks.onFileComplete?.(targetId, base64, state.meta)
                }
                reader.readAsDataURL(blob)
                recvState.current.delete(targetId)
              }
              return
            }
            case 'message':
              callbacks.onMessage?.(targetId, obj.message)
              return
            case 'link':
              callbacks.onLink?.(targetId, obj.linkUrl, obj.message, { name: obj.senderName, uniqueId: obj.senderUniqueId, allowReshare: obj.allowReshare })
              return
          }
        } catch {
          // not JSON; continue
        }
      } else if (ArrayBuffer.isView(data)) {
        // Sometimes control arrives as typed array of text; attempt parse
        try {
          const text = new TextDecoder().decode(data as Uint8Array)
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
                const blob = new Blob(state.buffers, { type: state.meta.fileType })
                const reader = new FileReader()
                reader.onload = () => {
                  const base64 = reader.result as string
                  callbacks.onFileComplete?.(targetId, base64, state.meta)
                }
                reader.readAsDataURL(blob)
                recvState.current.delete(targetId)
              }
              return
            }
            if (obj.type === 'message') { callbacks.onMessage?.(targetId, obj.message); return }
            if (obj.type === 'link') { callbacks.onLink?.(targetId, obj.linkUrl, obj.message, { name: obj.senderName, uniqueId: obj.senderUniqueId, allowReshare: obj.allowReshare }); return }
          }
        } catch {
          // fallthrough to binary handling
        }
      }

      // Binary chunk path
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
        const state = recvState.current.get(targetId)
        if (state) {
          let raw = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength)
          if (!(raw instanceof ArrayBuffer)) {
            const copy = new Uint8Array(u8.byteLength)
            copy.set(u8)
            raw = copy.buffer
          }
          state.buffers.push(raw as ArrayBuffer)
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

  const sendFile = async (targetId: string, file: File, metadata?: { message?: string; senderName?: string; senderUniqueId?: string; allowReshare?: boolean }): Promise<'PW-RTC' | 'SW-RTC' | 'TW-RTC' | 'PW-RTC-F' | void> => {
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
      }).catch(() => {})
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
      method,
    }
    try {
      peer.send(JSON.stringify(meta))
    } catch {}

  const chunkSize = 16 * 1024 // 16KB for better compatibility
    let offset = 0
    callbacks.onSendStart?.(targetId, file.name, file.size)
  sendState.current.set(targetId, { fileName: file.name, total: file.size, sent: 0 })

    const readSlice = (start: number, end: number) => new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader()
      reader.onerror = reject
      reader.onload = () => resolve(reader.result as ArrayBuffer)
      reader.readAsArrayBuffer(file.slice(start, end))
    })

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
      if (ok === false && (peer as any).once) {
        await new Promise<void>(res => (peer as any).once('drain', () => res()))
      }
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
      } catch {}
    }
    callbacks.onSendComplete?.(targetId, file.name)
    sendState.current.delete(targetId)
    return method
  }

  const sendMessage = async (targetId: string, message: string) => {
    const peer = peersRef.current.get(targetId)
    if (!peer || peer.destroyed) return
    if (!(peer as any).connected) {
      await new Promise<void>((resolve) => {
        const onConnect = () => resolve()
        ;(peer as any).once?.('connect', onConnect)
      })
    }
    if (!peer.destroyed && (peer as any).connected) {
      try {
        peer.send(JSON.stringify({ type: 'message', message, timestamp: Date.now() }))
      } catch {}
    }
  }

  const sendLink = async (
    targetId: string,
    linkUrl: string,
    message?: string,
    sender?: { name?: string; uniqueId?: string },
    allowReshare?: boolean
  ): Promise<'PW-RTC' | 'SW-RTC' | 'TW-RTC' | 'PW-RTC-F' | void> => {
    const peer = peersRef.current.get(targetId)
    if (!peer || peer.destroyed) return
    if (!(peer as any).connected) {
      await new Promise<void>((resolve) => {
        const onConnect = () => resolve()
        ;(peer as any).once?.('connect', onConnect)
      })
    }
    if (!peer.destroyed && (peer as any).connected) {
      try {
  const method = await getPeerMethod(targetId)
        peer.send(JSON.stringify({ type: 'link', linkUrl, message, senderName: sender?.name, senderUniqueId: sender?.uniqueId, allowReshare, method }))
        return method
      } catch {}
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