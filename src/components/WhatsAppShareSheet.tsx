'use client'

import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X,
  Upload,
  FileText,
  Link as LinkIcon,
  Code as CodeIcon,
  CheckCircle2,
  Loader2,
  Phone,
  AlertCircle,
  MessageSquare
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/hooks/use-toast'

export interface WhatsAppShareDetail {
  type: 'file' | 'files' | 'link' | 'links' | 'code'
  files?: File[]
  linkUrl?: string
  codeSnippet?: string
  message?: string
}

export default function WhatsAppShareSheet() {
  const [isOpen, setIsOpen] = useState(false)
  const [phoneNumber, setPhoneNumber] = useState('')
  const [shareMode, setShareMode] = useState<'files' | 'links' | 'code'>('files')
  
  // Content states
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [linkUrl, setLinkUrl] = useState('')
  const [codeSnippet, setCodeSnippet] = useState('')
  const [message, setMessage] = useState('')

  // Action states
  const [isSharing, setIsSharing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [errorMsg, setErrorMsg] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isDragActive, setIsDragActive] = useState(false)

  // Load phone number on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedNumber = localStorage.getItem('cosmoshare_wa_number') || ''
      setPhoneNumber(savedNumber)
    }
  }, [])

  // Listen to the global trigger event
  useEffect(() => {
    const handleShareEvent = (e: Event) => {
      const customEvent = e as CustomEvent<WhatsAppShareDetail>
      const { type, files, linkUrl: url, codeSnippet: code, message: msg } = customEvent.detail

      setIsOpen(true)
      setErrorMsg('')
      setSuccessMsg('')
      setProgress(0)

      if (type) {
        if (type === 'file' || type === 'files') setShareMode('files')
        else if (type === 'link' || type === 'links') setShareMode('links')
        else if (type === 'code') setShareMode('code')
      }
      if (files) setSelectedFiles(files)
      if (url) setLinkUrl(url)
      if (code) setCodeSnippet(code)
      if (msg) setMessage(msg)
    }

    window.addEventListener('cosmoshare:whatsapp-share', handleShareEvent)
    return () => window.removeEventListener('cosmoshare:whatsapp-share', handleShareEvent)
  }, [])

  // Lock scroll when drawer is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = 'unset'
    }
    return () => {
      document.body.style.overflow = 'unset'
    }
  }, [isOpen])

  // Drag and Drop Handlers
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setIsDragActive(true)
    } else if (e.type === 'dragleave') {
      setIsDragActive(false)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragActive(false)
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      setSelectedFiles(Array.from(e.dataTransfer.files))
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setSelectedFiles(Array.from(e.target.files))
    }
  }

  const removeFile = (index: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index))
  }

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  // Convert File to Base64 helper
  const fileToBase64 = (file: File): Promise<{ fileName: string; fileType: string; base64Data: string }> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.readAsDataURL(file)
      reader.onload = () => {
        const result = reader.result as string
        const base64Data = result.split(',')[1] // Strip data:*/*;base64, prefix
        resolve({
          fileName: file.name,
          fileType: file.type || 'application/octet-stream',
          base64Data
        })
      };
      reader.onerror = error => reject(error)
    })
  }

  // Handle Submit
  const handleShare = async () => {
    if (!phoneNumber) {
      setErrorMsg('WhatsApp phone number is required')
      return
    }

    const cleanNum = phoneNumber.replace(/\D/g, '')
    if (cleanNum.length < 8) {
      setErrorMsg('Please enter a valid phone number with country code (e.g. +91...)')
      return
    }

    setErrorMsg('')
    setSuccessMsg('')
    setIsSharing(true)
    setProgress(10)

    try {
      // Save number for next time
      localStorage.setItem('cosmoshare_wa_number', phoneNumber)

      let payload: any = {
        phoneNumber: cleanNum,
        type: shareMode === 'files' ? 'file' : shareMode === 'links' ? 'link' : 'code',
        message: message.trim() || undefined
      }

      if (shareMode === 'links') {
        if (!linkUrl) throw new Error('Please enter a link URL')
        payload.linkUrl = linkUrl
        setProgress(50)
      } else if (shareMode === 'code') {
        if (!codeSnippet) throw new Error('Please enter a code snippet')
        payload.codeSnippet = codeSnippet
        setProgress(50)
      } else if (shareMode === 'files') {
        if (selectedFiles.length === 0) throw new Error('Please select at least one file')
        setProgress(30)
        
        // Convert files to base64 in parallel
        const base64Files = await Promise.all(
          selectedFiles.map(async (file, idx) => {
            const res = await fileToBase64(file)
            setProgress(30 + Math.floor((idx + 1) / selectedFiles.length * 30))
            return res
          })
        )
        payload.files = base64Files
      }

      setProgress(80)

      // Send to Next.js proxy route
      const resp = await fetch('/api/whatsapp/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      setProgress(95)

      if (!resp.ok) {
        const errJson = await resp.json().catch(() => ({}))
        throw new Error(errJson.error || `HTTP error ${resp.status}`)
      }

      setProgress(100)
      setSuccessMsg('Delivered to WhatsApp bot!')
      
      toast({
        title: 'Success!',
        description: 'Shared content delivered to WhatsApp bot successfully.'
      })

      // Reset content fields
      setSelectedFiles([])
      setLinkUrl('')
      setCodeSnippet('')
      setMessage('')

      // Auto close after delay
      setTimeout(() => {
        setIsOpen(false)
        setSuccessMsg('')
        setProgress(0)
        setIsSharing(false)
      }, 2000)

    } catch (err: any) {
      console.error(err)
      setErrorMsg(err.message || 'Failed to share content. Verify bot status.')
      setIsSharing(false)
      setProgress(0)
    }
  }

  return (
    <>
      {/* Floating Glassmorphic Pill */}
      <motion.button
        className="fixed bottom-6 right-6 z-40 flex items-center gap-2 px-4 py-3 rounded-full bg-slate-900/80 hover:bg-slate-800/95 border border-emerald-500/20 hover:border-emerald-400/50 shadow-lg backdrop-blur-md text-emerald-400 text-sm font-semibold tracking-wide transition-all group scale-100 hover:scale-105 active:scale-95"
        onClick={() => {
          setIsOpen(true)
          setErrorMsg('')
          setSuccessMsg('')
        }}
        whileTap={{ scale: 0.95 }}
      >
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
        </span>
        <MessageSquare className="w-4 h-4 text-emerald-400 group-hover:rotate-12 transition-transform duration-300" />
        <span className="hidden sm:inline">Share to WhatsApp</span>
      </motion.button>

      {/* Share Sheet Drawer */}
      <AnimatePresence>
        {isOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
              onClick={() => !isSharing && setIsOpen(false)}
            />

            {/* Drawer */}
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 220 }}
              className="fixed top-0 right-0 z-50 h-full w-full max-w-md bg-slate-950/95 border-l border-slate-900 backdrop-blur-xl shadow-2xl flex flex-col text-slate-100"
            >
              {/* Header */}
              <div className="p-6 border-b border-slate-900 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 glow-sm">
                    <MessageSquare className="w-4 h-4" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold tracking-tight">Share to WhatsApp</h2>
                    <p className="text-xs text-slate-400">Directly send files, links or code to phone</p>
                  </div>
                </div>
                <button
                  onClick={() => setIsOpen(false)}
                  disabled={isSharing}
                  className="w-8 h-8 rounded-full border border-slate-800 flex items-center justify-center hover:bg-slate-900 transition disabled:opacity-50"
                >
                  <X className="w-4 h-4 text-slate-400" />
                </button>
              </div>

              {/* Form Content */}
              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                
                {/* Error Banner */}
                {errorMsg && (
                  <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-start gap-2.5">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{errorMsg}</span>
                  </div>
                )}

                {/* Success Banner */}
                {successMsg && (
                  <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm flex items-start gap-2.5">
                    <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{successMsg}</span>
                  </div>
                )}

                {/* Phone Input */}
                <div className="space-y-2">
                  <Label htmlFor="wa-phone" className="text-slate-400 text-xs font-semibold uppercase tracking-wider">
                    WhatsApp Phone Number
                  </Label>
                  <div className="relative">
                    <Input
                      id="wa-phone"
                      type="tel"
                      placeholder="e.g. +91 98765 43210"
                      value={phoneNumber}
                      onChange={(e) => setPhoneNumber(e.target.value)}
                      disabled={isSharing}
                      className="pl-10 bg-slate-900/60 border-slate-800 rounded-xl h-11 focus:border-emerald-500/50 focus:ring-4 focus:ring-emerald-500/10 text-sm placeholder:text-slate-600 transition"
                    />
                    <Phone className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  </div>
                  <p className="text-[10px] text-slate-500 leading-normal">
                    Enter the full number with country code. The WhatsApp bot will deliver the content instantly to this number.
                  </p>
                </div>

                {/* Selection Tabs */}
                <div className="space-y-3">
                  <Label className="text-slate-400 text-xs font-semibold uppercase tracking-wider">
                    Select Content Type
                  </Label>
                  <div className="grid grid-cols-3 p-1 bg-slate-900 rounded-xl border border-slate-800/80">
                    {(['files', 'links', 'code'] as const).map((mode) => {
                      const active = shareMode === mode
                      const label = mode === 'files' ? 'Files' : mode === 'links' ? 'Link' : 'Code'
                      const Icon = mode === 'files' ? FileText : mode === 'links' ? LinkIcon : CodeIcon
                      return (
                        <button
                          key={mode}
                          onClick={() => !isSharing && setShareMode(mode)}
                          className={`flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-lg text-xs font-medium transition ${
                            active
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/10'
                              : 'text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          <Icon className="w-3.5 h-3.5" />
                          <span>{label}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Tab Contents */}
                <div className="space-y-4">
                  {shareMode === 'files' && (
                    <div className="space-y-3">
                      <Label className="text-slate-400 text-xs font-semibold uppercase tracking-wider">
                        Files to share
                      </Label>
                      <div
                        onDragEnter={handleDrag}
                        onDragOver={handleDrag}
                        onDragLeave={handleDrag}
                        onDrop={handleDrop}
                        onClick={() => !isSharing && fileInputRef.current?.click()}
                        className={`border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition ${
                          isDragActive
                            ? 'border-emerald-500 bg-emerald-500/5'
                            : 'border-slate-850 bg-slate-900/40 hover:bg-slate-900/60 hover:border-slate-700'
                        }`}
                      >
                        <input
                          ref={fileInputRef}
                          type="file"
                          multiple
                          onChange={handleFileChange}
                          disabled={isSharing}
                          className="hidden"
                        />
                        <Upload className="w-8 h-8 mx-auto mb-2.5 text-slate-500" />
                        <p className="text-sm font-medium text-slate-300">
                          Drag & drop files here, or click to upload
                        </p>
                        <p className="text-xs text-slate-500 mt-1">
                          Support for PDFs, images, documents, zip
                        </p>
                      </div>

                      {/* File List */}
                      {selectedFiles.length > 0 && (
                        <div className="space-y-2">
                          <Label className="text-xs text-slate-500">Selected Files ({selectedFiles.length})</Label>
                          <div className="max-h-40 overflow-y-auto space-y-1.5 pr-1">
                            {selectedFiles.map((file, idx) => (
                              <div key={idx} className="flex items-center justify-between p-2.5 bg-slate-900 border border-slate-850 rounded-xl">
                                <div className="flex items-center gap-2 min-w-0">
                                  <FileText className="w-4 h-4 text-emerald-400 shrink-0" />
                                  <span className="text-xs font-medium truncate max-w-[200px]">{file.name}</span>
                                  <span className="text-[10px] text-slate-500">({formatFileSize(file.size)})</span>
                                </div>
                                <button
                                  onClick={(e) => { e.stopPropagation(); removeFile(idx); }}
                                  disabled={isSharing}
                                  className="text-xs text-slate-500 hover:text-red-400"
                                >
                                  Remove
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {shareMode === 'links' && (
                    <div className="space-y-2">
                      <Label htmlFor="wa-link-url" className="text-slate-400 text-xs font-semibold uppercase tracking-wider">
                        Share Link URL
                      </Label>
                      <div className="relative">
                        <Input
                          id="wa-link-url"
                          type="url"
                          placeholder="https://docs.google.com/..."
                          value={linkUrl}
                          onChange={(e) => setLinkUrl(e.target.value)}
                          disabled={isSharing}
                          className="pl-10 bg-slate-900/60 border-slate-800 rounded-xl h-11 focus:border-emerald-500/50 focus:ring-4 focus:ring-emerald-500/10 text-sm placeholder:text-slate-600 transition"
                        />
                        <LinkIcon className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                      </div>
                      <p className="text-[10px] text-slate-500">
                        Paste any website, document, or drive URL to send.
                      </p>
                    </div>
                  )}

                  {shareMode === 'code' && (
                    <div className="space-y-2">
                      <Label htmlFor="wa-code-snippet" className="text-slate-400 text-xs font-semibold uppercase tracking-wider">
                        Code Snippet
                      </Label>
                      <Textarea
                        id="wa-code-snippet"
                        placeholder="// Paste code snippet here..."
                        value={codeSnippet}
                        onChange={(e) => setCodeSnippet(e.target.value)}
                        disabled={isSharing}
                        rows={7}
                        className="font-mono text-xs text-emerald-300 bg-slate-950 border-slate-900 focus:border-emerald-500/30 focus:ring-0 focus-visible:ring-emerald-500/10 rounded-xl placeholder:text-slate-700 resize-none"
                        style={{ fontFamily: 'Consolas, Monaco, monospace' }}
                      />
                    </div>
                  )}
                </div>

                {/* Optional Message */}
                <div className="space-y-2">
                  <Label htmlFor="wa-message" className="text-slate-400 text-xs font-semibold uppercase tracking-wider">
                    Message / Caption (Optional)
                  </Label>
                  <Textarea
                    id="wa-message"
                    placeholder="Add an optional message or note..."
                    value={message}
                    onChange={(e) => setMessage(e.target.value.slice(0, 160))}
                    disabled={isSharing}
                    maxLength={160}
                    rows={2}
                    className="bg-slate-900/60 border-slate-850 rounded-xl placeholder:text-slate-600 focus:border-emerald-500/50 focus:ring-4 focus:ring-emerald-500/10 resize-none text-sm"
                  />
                  <div className="text-[10px] text-slate-500 text-right">{message.length}/160</div>
                </div>

              </div>

              {/* Progress and Send Actions Footer */}
              <div className="p-6 border-t border-slate-900 space-y-4">
                {isSharing && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs font-semibold text-slate-400">
                      <span>Sharing to WhatsApp...</span>
                      <span>{progress}%</span>
                    </div>
                    <div className="w-full h-1.5 bg-slate-900 rounded-full overflow-hidden border border-slate-850">
                      <motion.div
                        className="h-full bg-emerald-500"
                        initial={{ width: 0 }}
                        animate={{ width: `${progress}%` }}
                        transition={{ duration: 0.1 }}
                      />
                    </div>
                  </div>
                )}

                <div className="flex gap-3">
                  <Button
                    variant="outline"
                    onClick={() => setIsOpen(false)}
                    disabled={isSharing}
                    className="flex-1 rounded-xl h-11 border-slate-800 text-xs font-semibold text-slate-400 hover:bg-slate-900"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleShare}
                    disabled={
                      isSharing ||
                      !phoneNumber ||
                      (shareMode === 'files' && selectedFiles.length === 0) ||
                      (shareMode === 'links' && !linkUrl) ||
                      (shareMode === 'code' && !codeSnippet)
                    }
                    className="flex-1 rounded-xl h-11 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 font-semibold text-xs text-white shadow-lg shadow-emerald-500/10 hover:shadow-emerald-500/20 active:scale-95 transition disabled:opacity-50"
                  >
                    {isSharing ? (
                      <>
                        <Loader2 className="w-4.5 h-4.5 mr-2 animate-spin" />
                        <span>Sending...</span>
                      </>
                    ) : (
                      <>
                        <MessageSquare className="w-4 h-4 mr-2" />
                        <span>Share Now</span>
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  )
}
