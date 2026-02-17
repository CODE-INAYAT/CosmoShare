'use client'

import { useState, useEffect, useMemo } from 'react'
import { generateGradient } from '@/lib/avatarUtils'
import React from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
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
  FileText,
  Link,
  Download,
  Eye,
  ExternalLink,
  File,
  Image,
  Video,
  Music,
  Archive,
  FileCode,
  FileSpreadsheet,
  Share2,
  Trash2,
  Clock3,
  Check,
  X,
  MessageSquare,
  Copy,
  Clipboard,
  MoreHorizontal
} from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

interface RecipientInfo { id: string; name: string; uniqueId: string }

interface FilePreviewProps {
  file: {
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
    method?: 'PW-RTC' | 'SW-RTC' | 'TW-RTC' | 'PW-RTC-F'
    fileId?: string
  }
  senderName?: string
  senderUniqueId?: string
  recipients?: RecipientInfo[]
  timestamp?: Date
  onReshare?: (file: { fileName: string; fileType: string; fileSize: number; fileData?: string; fileUrl?: string; linkUrl?: string; message?: string }) => void
  isOwnItem?: boolean
  onDelete?: () => void
  highlightQuery?: string
  onMarkPrinted?: () => void
  isPrinted?: boolean
}

const getFileIcon = (fileType: string, fileName: string) => {
  if (fileType === 'code') return FileCode
  if (fileType.startsWith('image/')) return Image
  if (fileType.startsWith('video/')) return Video
  if (fileType.startsWith('audio/')) return Music
  if (fileType.includes('pdf')) return FileText
  if (fileType.includes('spreadsheet') || fileName.endsWith('.xlsx') || fileName.endsWith('.csv')) return FileSpreadsheet
  if (fileType.includes('word') || fileName.endsWith('.docx')) return FileText
  if (fileType.includes('zip') || fileType.includes('rar') || fileType.includes('7z')) return Archive
  if (fileType.includes('javascript') || fileType.includes('json') || fileType.includes('html') || fileType.includes('css')) return FileCode
  return File
}

const formatFileSize = (bytes: number) => {
  if (bytes === 0) return '0 Bytes'
  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

const isGoogleDocsLink = (url: string) => {
  return url.includes('docs.google.com') || url.includes('drive.google.com')
}

const getGoogleDocsEmbedUrl = (url: string) => {
  if (url.includes('docs.google.com/document/d/')) {
    const docId = url.match(/\/d\/([a-zA-Z0-9-_]+)/)?.[1]
    return docId ? `https://docs.google.com/document/d/${docId}/preview` : null
  }
  if (url.includes('docs.google.com/spreadsheets/d/')) {
    const sheetId = url.match(/\/d\/([a-zA-Z0-9-_]+)/)?.[1]
    return sheetId ? `https://docs.google.com/spreadsheets/d/${sheetId}/preview` : null
  }
  if (url.includes('docs.google.com/presentation/d/')) {
    const slideId = url.match(/\/d\/([a-zA-Z0-9-_]+)/)?.[1]
    return slideId ? `https://docs.google.com/presentation/d/${slideId}/embed` : null
  }
  if (url.includes('drive.google.com/file/d/')) {
    const fileId = url.match(/\/d\/([a-zA-Z0-9-_]+)/)?.[1]
    return fileId ? `https://drive.google.com/file/d/${fileId}/preview` : null
  }
  return null
}

// Ensure links without scheme open as absolute URLs in a new tab
const ensureAbsoluteUrl = (url: string | undefined | null): string => {
  if (!url) return ''
  const trimmed = url.trim()
  // If already has a scheme like http(s), mailto, etc., leave as-is
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) return trimmed
  // Otherwise default to https://
  return `https://${trimmed}`
}

// Derive an accurate, human-friendly extension label
const getExtensionFromName = (name: string): string | null => {
  if (!name) return null
  const lower = name.toLowerCase()
  const multiExt: Record<string, string> = {
    'tar.gz': 'TAR.GZ',
    'tar.bz2': 'TAR.BZ2',
    'tar.xz': 'TAR.XZ',
  }
  for (const k of Object.keys(multiExt)) {
    if (lower.endsWith(`.${k}`)) return multiExt[k]
  }
  const idx = lower.lastIndexOf('.')
  if (idx === -1 || idx === lower.length - 1) return null
  return lower.slice(idx + 1).toUpperCase()
}

const getExtensionFromMime = (mime?: string): string | null => {
  if (!mime) return null
  const map: Record<string, string> = {
    // Documents
    'application/pdf': 'PDF',
    'application/msword': 'DOC',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
    'application/vnd.ms-excel': 'XLS',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLSX',
    'application/vnd.ms-powerpoint': 'PPT',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PPTX',
    'text/csv': 'CSV',
    'text/plain': 'TXT',
    'application/json': 'JSON',
    'text/html': 'HTML',
    'application/xml': 'XML',
    'text/xml': 'XML',
    'application/x-ipynb+json': 'IPYNB',
    // Archives
    'application/zip': 'ZIP',
    'application/x-zip-compressed': 'ZIP',
    'application/x-7z-compressed': '7Z',
    'application/x-rar-compressed': 'RAR',
    'application/vnd.rar': 'RAR',
    // Code / text
    'application/javascript': 'JS',
    'text/javascript': 'JS',
    'text/css': 'CSS',
    // Images
    'image/png': 'PNG',
    'image/jpeg': 'JPG',
    'image/jpg': 'JPG',
    'image/webp': 'WEBP',
    'image/gif': 'GIF',
    'image/svg+xml': 'SVG',
    // Video
    'video/mp4': 'MP4',
    'video/webm': 'WEBM',
    'video/quicktime': 'MOV',
    'video/mpeg': 'MPEG',
    // Audio
    'audio/mpeg': 'MP3',
    'audio/mp3': 'MP3',
    'audio/wav': 'WAV',
    'audio/ogg': 'OGG',
    'audio/aac': 'AAC',
  }
  if (map[mime]) return map[mime]
  // Try to compress the subtype into a readable token (last token after special chars)
  const subtype = mime.split('/')[1] || ''
  if (!subtype) return null
  // Prefer last token after dot/plus
  const tokens = subtype.split(/[.+-]/).filter(Boolean)
  if (tokens.length) return tokens[tokens.length - 1].toUpperCase()
  return subtype.toUpperCase()
}

const getDisplayExtension = (fileType: string, fileName: string, isLink: boolean): string => {
  if (fileType === 'code') return 'CODE'
  if (isLink) return 'URL'
  const fromName = getExtensionFromName(fileName)
  if (fromName) return fromName
  const fromMime = getExtensionFromMime(fileType)
  return fromMime || 'FILE'
}

// Smart middle truncation preserving start and end tokens
const truncateMiddle = (value: string, max: number): string => {
  if (value.length <= max) return value
  const keep = max - 1 // room for ellipsis
  const front = Math.ceil(keep / 2)
  const back = Math.floor(keep / 2)
  return value.slice(0, front) + '…' + value.slice(-back)
}

function FilePreviewInner({ file, senderName, senderUniqueId, recipients, timestamp, onReshare, isOwnItem, onDelete, highlightQuery, onMarkPrinted, isPrinted }: FilePreviewProps) {
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [isRecipientsOpen, setIsRecipientsOpen] = useState(false)
  const [copiedCode, setCopiedCode] = useState(false)
  const [meatballsOpen, setMeatballsOpen] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const FileIcon = getFileIcon(file.fileType, file.fileName)
  const isPreviewableType = (
    file.fileType.startsWith('image/') ||
    file.fileType.startsWith('video/') ||
    file.fileType.startsWith('audio/') ||
    file.fileType.includes('pdf')
  )
  const canPreview = file.isLink
    ? !!(file.linkUrl && isGoogleDocsLink(file.linkUrl))
    : isPreviewableType && (!!file.fileUrl || !!file.fileData)

  const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\\]\]/g, '\\$&')
  const highlight = (text: string) => {
    if (!highlightQuery || !text) return text
    try {
      const re = new RegExp(`(${escapeRegExp(highlightQuery)})`, 'ig')
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

  useEffect(() => {
    if (!isPreviewOpen) return
    let revokeUrl: string | null = null
    try {
      if (file.isLink && file.linkUrl) {
        if (isGoogleDocsLink(file.linkUrl)) {
          setPreviewUrl(getGoogleDocsEmbedUrl(file.linkUrl))
        } else {
          setPreviewUrl(file.linkUrl)
        }
      } else if (file.fileUrl) {
        setPreviewUrl(file.fileUrl)
      } else if (file.fileData) {
        const byteCharacters = atob(file.fileData.split(',')[1])
        const byteNumbers = new Array(byteCharacters.length)
        for (let i = 0; i < byteCharacters.length; i++) byteNumbers[i] = byteCharacters.charCodeAt(i)
        const byteArray = new Uint8Array(byteNumbers)
        const blob = new Blob([byteArray], { type: file.fileType })
        const url = URL.createObjectURL(blob)
        setPreviewUrl(url)
        revokeUrl = url
      }
    } catch (error) {
      console.error('Error creating preview URL:', error)
    }
    return () => { if (revokeUrl) { try { URL.revokeObjectURL(revokeUrl) } catch { } } }
  }, [isPreviewOpen, file])

  const handleDownload = () => {
    if (file.isLink && file.linkUrl) {
      const href = ensureAbsoluteUrl(file.linkUrl)
      if (href) window.open(href, '_blank')
    } else if (file.fileUrl || file.fileData) {
      const link = document.createElement('a')
      link.href = file.fileUrl || file.fileData!
      link.download = file.fileName
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    }
  }

  const renderPreview = (mode: 'dialog' | 'inline' = 'inline') => {
    if (!previewUrl) return null
    if (file.fileType.startsWith('image/')) {
      if (mode === 'dialog') {
        return (
          <div className="w-full h-full bg-muted/50 dark:bg-muted flex items-center justify-center">
            <img src={previewUrl} alt={file.fileName} className="max-h-full max-w-full object-contain" />
          </div>
        )
      }
      return <img src={previewUrl} alt={file.fileName} className="max-w-full max-h-[80vh] rounded-lg shadow-lg" />
    }
    if (file.fileType.startsWith('video/')) {
      if (mode === 'dialog') {
        return (
          <div className="w-full h-full bg-black flex items-center justify-center">
            <video src={previewUrl} controls className="max-h-full max-w-full" />
          </div>
        )
      }
      return <video src={previewUrl} controls className="w-full max-h-[80vh] rounded-lg shadow-lg" />
    }
    if (file.fileType.startsWith('audio/')) {
      if (mode === 'dialog') {
        return (
          <div className="w-full h-full bg-muted/50 dark:bg-muted flex items-center justify-center p-6">
            <audio src={previewUrl} controls className="w-full max-w-2xl" />
          </div>
        )
      }
      return <audio src={previewUrl} controls className="w-full" />
    }
    if (file.fileType.includes('pdf') || (file.isLink && file.linkUrl && isGoogleDocsLink(file.linkUrl))) {
      if (mode === 'dialog') {
        return <iframe src={previewUrl} className="w-full h-full" title={file.fileName} />
      }
      return <iframe src={previewUrl} className="w-full h-[80vh] rounded-lg shadow-lg" title={file.fileName} />
    }
    if (file.isLink) {
      return mode === 'dialog' ? (
        <div className="w-full h-full flex items-center justify-center p-6 text-center">
          <div>
            <Link className="w-16 h-16 mx-auto mb-4 text-primary" />
            <h3 className="text-lg font-semibold mb-2">External Link</h3>
            <p className="text-muted-foreground mb-4">Open the link in a new tab to view.</p>
            <Button asChild>
              <a href={ensureAbsoluteUrl(file.linkUrl)} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="w-4 h-4 mr-2" />
                Open Link
              </a>
            </Button>
          </div>
        </div>
      ) : (
        <div className="text-center py-8">
          <Link className="w-16 h-16 mx-auto mb-4 text-primary" />
          <h3 className="text-lg font-semibold mb-2">External Link</h3>
          <p className="text-muted-foreground mb-4">{file.linkUrl}</p>
          <Button asChild>
            <a href={ensureAbsoluteUrl(file.linkUrl)} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="w-4 h-4 mr-2" />
              Open Link
            </a>
          </Button>
        </div>
      )
    }
    return mode === 'dialog' ? (
      <div className="w-full h-full flex items-center justify-center p-6 text-center">
        <div>
          <FileIcon className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
          <h3 className="text-lg font-semibold mb-2">Preview Not Available</h3>
          <p className="text-muted-foreground mb-4">This file type cannot be previewed.</p>
          <Button onClick={handleDownload}><Download className="w-4 h-4 mr-2" />Download File</Button>
        </div>
      </div>
    ) : (
      <div className="text-center py-8">
        <FileIcon className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
        <h3 className="text-lg font-semibold mb-2">Preview Not Available</h3>
        <p className="text-muted-foreground mb-4">This file type cannot be previewed.</p>
        <Button onClick={handleDownload}><Download className="w-4 h-4 mr-2" />Download File</Button>
      </div>
    )
  }

  const displayName = file.fileName.replace(/\.[^/.]+$/, '')

  const userGradient = useMemo(() => generateGradient(senderName || 'Unknown'), [senderName])

  return (
    <Card className="group relative chat-bubble border-none shadow-none bg-transparent">
      <CardContent className="p-0">
        <div className="mb-3 flex items-center gap-2 sm:gap-3">
          <div className="relative">
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center text-white font-semibold text-base sm:text-lg" style={{ backgroundImage: userGradient }}>
              {(senderName || 'U').charAt(0).toUpperCase()}
            </div>
            <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 sm:w-3 sm:h-3 border border-white dark:border-gray-700 rounded-full" style={{ backgroundImage: userGradient }} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] sm:text-xs text-muted-foreground dark:text-muted-foreground">{isOwnItem ? 'Uploaded By' : 'Received From'}</p>
            <h4 className="text-xs sm:text-sm font-semibold text-foreground dark:text-white truncate">{senderName || 'Unknown'}{senderUniqueId ? ` (${senderUniqueId})` : ''}{isOwnItem ? ' (You)' : ''}</h4>
          </div>
        </div>
        <div className="p-3 sm:p-4 ms-4 sm:ms-8 mr-1 sm:mr-4 bg-card border border-border rounded-lg shadow-lg dark:bg-card dark:border-border relative group cursor-default min-h-fit" style={{ borderRadius: 25, paddingBottom: 10, paddingTop: 10 }}>
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-normal text-muted-foreground dark:text-gray-300 min-w-0">
              {file.fileId && <span className="italic text-muted-foreground dark:text-white ml-[5px]">{file.fileType === 'code' ? 'Code ID' : 'File ID'} : {highlight(file.fileId)}</span>}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {onMarkPrinted && !isPrinted && (
                <Button
                  size="sm"
                  onClick={onMarkPrinted}
                  className="hidden sm:inline-flex rounded-full bg-neutral-900/95 text-white hover:bg-neutral-800 h-7 px-3 active:scale-[0.97] transition-all shadow-sm ring-1 ring-neutral-900/20"
                >
                  <Check className="w-4 h-4 mr-1" />
                  Mark Printed
                </Button>
              )}
              {isPrinted && (
                <Badge className="rounded-full bg-green-600 text-white h-7 px-3 flex items-center gap-1 animate-in fade-in-0 zoom-in-95 duration-200 shadow-sm ring-1 ring-green-700/30">
                  <Check className="w-3 h-3" />
                  Printed
                </Badge>
              )}
              {/* Meatballs menu - mobile only */}
              <Popover open={meatballsOpen} onOpenChange={setMeatballsOpen}>
                <PopoverTrigger asChild>
                  <button
                    className="sm:hidden inline-flex items-center justify-center h-7 w-7 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors active:scale-95"
                    aria-label="More actions"
                  >
                    <MoreHorizontal className="w-4.5 h-4.5" />
                  </button>
                </PopoverTrigger>
                <PopoverContent align="end" side="bottom" className="w-44 p-1 sm:hidden">
                  {onMarkPrinted && !isPrinted && (
                    <button
                      className="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-foreground hover:bg-muted rounded-md transition-colors"
                      onClick={() => { setMeatballsOpen(false); onMarkPrinted() }}
                    >
                      <Check className="w-4 h-4 text-muted-foreground" />
                      Mark Printed
                    </button>
                  )}
                  {canPreview && (
                    <button
                      className="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-foreground hover:bg-muted rounded-md transition-colors"
                      onClick={() => { setMeatballsOpen(false); setIsPreviewOpen(true) }}
                    >
                      <Eye className="w-4 h-4 text-muted-foreground" />
                      Preview
                    </button>
                  )}
                  {file.fileType === 'code' && file.message && (
                    <button
                      className="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-foreground hover:bg-muted rounded-md transition-colors"
                      onClick={() => { setMeatballsOpen(false); setIsPreviewOpen(true) }}
                    >
                      <Eye className="w-4 h-4 text-muted-foreground" />
                      Preview Code
                    </button>
                  )}
                  {file.fileType !== 'code' && (
                    <button
                      className="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-foreground hover:bg-muted rounded-md transition-colors"
                      onClick={() => { setMeatballsOpen(false); handleDownload() }}
                    >
                      {file.isLink ? <ExternalLink className="w-4 h-4 text-muted-foreground" /> : <Download className="w-4 h-4 text-muted-foreground" />}
                      {file.isLink ? 'Open Link' : 'Download'}
                    </button>
                  )}
                  {onReshare && (isOwnItem || (file.allowReshare ?? true)) && (
                    <button
                      className="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-foreground hover:bg-muted rounded-md transition-colors"
                      onClick={() => { setMeatballsOpen(false); onReshare({ fileName: file.fileName, fileType: file.fileType, fileSize: file.fileSize, fileData: file.fileData, fileUrl: file.fileUrl, linkUrl: file.linkUrl, message: file.fileType === 'code' ? file.message : undefined }) }}
                    >
                      <Share2 className="w-4 h-4 text-muted-foreground" />
                      Reshare
                    </button>
                  )}
                  {typeof onDelete === 'function' && (
                    <button
                      className="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-md transition-colors"
                      onClick={() => { setMeatballsOpen(false); setDeleteConfirmOpen(true) }}
                    >
                      <Trash2 className="w-4 h-4" />
                      Delete
                    </button>
                  )}
                </PopoverContent>
              </Popover>
            </div>
          </div>
          {/* Hide file info bar for code type - show only the code block */}
          {file.fileType !== 'code' && (
            <div className="p-2 sm:p-3 mb-2 text-xs italic font-normal text-muted-foreground border border-border rounded-lg bg-muted/50 dark:bg-muted dark:border-border dark:text-gray-300 min-h-fit" style={{ borderRadius: 20 }}>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-2.5">
                {/* File info section - clickable: preview if possible, else download */}
                <div
                  className="flex flex-col gap-2 sm:gap-2.5 min-w-0 flex-1 cursor-pointer"
                  onClick={() => { canPreview ? setIsPreviewOpen(true) : handleDownload() }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); canPreview ? setIsPreviewOpen(true) : handleDownload() } }}
                >
                  <div className="leading-1.5 flex w-full max-w-md flex-col">
                    <div className="flex items-start rounded-xl p-1.5 sm:p-2 h-auto w-full md:w-auto cursor-pointer" style={{ borderRadius: 15 }}>
                      <div className="me-2 flex-1 min-w-0">
                        <span className="flex items-center gap-1.5 sm:gap-2 text-sm font-medium text-foreground dark:text-white pb-2 cursor-pointer">
                          <span className="file-icon shrink-0">{file.isLink ? <Link className="h-7 w-7 sm:h-10 sm:w-10 text-foreground dark:text-gray-200" /> : <FileIcon className="h-7 w-7 sm:h-10 sm:w-10 text-foreground dark:text-gray-200" />}</span>
                          <TooltipProvider delayDuration={150}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span
                                  className="file-exam-semester truncate whitespace-nowrap overflow-hidden text-ellipsis max-w-[40vw] sm:max-w-[16rem] md:max-w-[22rem] cursor-pointer"
                                >
                                  {highlight(file.isLink ? (file.linkUrl || '') : displayName)}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="max-w-[90vw] sm:max-w-md break-words">
                                {file.isLink ? (file.linkUrl || '') : file.fileName}
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </span>
                        <span className="flex text-xs font-normal text-muted-foreground dark:text-muted-foreground gap-2">
                          <span className="file-size">{formatFileSize(file.fileSize)}</span>
                          <svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className="self-center" width="3" height="4" viewBox="0 0 3 4" fill="none"><circle cx="1.5" cy="2" r="1.5" fill="#6B7280" /></svg>
                          <span className="file-type">{getDisplayExtension(file.fileType, file.fileName, file.isLink)}</span>
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
                {/* Action buttons - hidden on mobile, shown on sm+ */}
                <TooltipProvider delayDuration={150}>
                  <div className="hidden sm:flex items-center gap-3 pr-2 md:pr-3 mr-1 md:mr-2">
                    {canPreview && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            onClick={() => setIsPreviewOpen(true)}
                            className="cursor-pointer inline-flex items-center justify-center h-9 w-9 rounded-full text-primary hover:text-primary/90 hover:bg-primary/10 dark:hover:bg-primary/20 transition-colors transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-95"
                            aria-label="Preview"
                          >
                            <Eye className="w-6 h-6" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="top">Preview</TooltipContent>
                      </Tooltip>
                    )}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          onClick={handleDownload}
                          aria-label={file.isLink ? 'Open link' : 'Download'}
                          className="cursor-pointer inline-flex items-center justify-center h-7 w-7 sm:h-9 sm:w-9 rounded-full text-primary hover:text-primary/90 hover:bg-primary/10 dark:hover:bg-primary/20 transition-colors transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-95"
                        >
                          {file.isLink ? <ExternalLink className="w-4 h-4 sm:w-6 sm:h-6" /> : <svg className="w-4 h-4 sm:w-6 sm:h-6" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 15v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M12 4v12m0 0-4-4m4 4 4-4" /></svg>}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top">{file.isLink ? 'Open link' : 'Download'}</TooltipContent>
                    </Tooltip>
                    {onReshare && (isOwnItem || (file.allowReshare ?? true)) && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            onClick={() => onReshare({ fileName: file.fileName, fileType: file.fileType, fileSize: file.fileSize, fileData: file.fileData, fileUrl: file.fileUrl, linkUrl: file.linkUrl })}
                            aria-label="Reshare"
                            className="cursor-pointer inline-flex items-center justify-center h-7 w-7 sm:h-9 sm:w-9 rounded-full text-primary hover:text-primary/90 hover:bg-primary/10 dark:hover:bg-primary/20 transition-colors transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-95"
                          >
                            <Share2 className="w-4 h-4 sm:w-6 sm:h-6" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="top">Reshare</TooltipContent>
                      </Tooltip>
                    )}
                    {typeof onDelete === 'function' && (
                      <AlertDialog>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <AlertDialogTrigger asChild>
                              <button
                                className="cursor-pointer inline-flex items-center justify-center h-7 w-7 sm:h-9 sm:w-9 rounded-full text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-95"
                                aria-label="Delete"
                              >
                                <Trash2 className="w-4 h-4 sm:w-6 sm:h-6" />
                              </button>
                            </AlertDialogTrigger>
                          </TooltipTrigger>
                          <TooltipContent side="top">Delete</TooltipContent>
                        </Tooltip>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete this item?</AlertDialogTitle>
                            <AlertDialogDescription>This will remove it from your history. You can undo for 30 seconds.</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={onDelete} className="bg-destructive text-white hover:bg-destructive/90">Delete</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                  </div>
                </TooltipProvider>
              </div>
            </div>
          )}
          {/* Code Block Display - Specialized UI for code sharing */}
          {file.fileType === 'code' && file.message && (
            <div className="rounded-lg overflow-hidden border border-slate-600 bg-slate-900">
              {/* Code Header */}
              <div className="flex items-center justify-between px-2.5 sm:px-4 py-2 bg-slate-800 border-b border-slate-600 gap-2">
                <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
                  <FileCode className="w-4 h-4 text-sky-400 shrink-0" />
                  <span className="text-xs font-medium text-slate-200 shrink-0">Code Snippet</span>
                  <span className="text-xs text-slate-500 truncate">({file.message.length} chars)</span>
                </div>
                {/* Actions row: Copy, Reshare, Delete — hidden on mobile (use meatballs) */}
                <div className="hidden sm:flex items-center gap-2">
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(file.message || '')
                      setCopiedCode(true)
                      setTimeout(() => setCopiedCode(false), 2000)
                    }}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${copiedCode
                      ? 'bg-sky-500/20 text-sky-400 ring-1 ring-sky-500/30'
                      : 'bg-slate-700 text-slate-200 hover:bg-slate-600 hover:text-white'
                      }`}
                  >
                    {copiedCode ? (
                      <><Check className="w-3.5 h-3.5" /> Copied!</>
                    ) : (
                      <><Copy className="w-3.5 h-3.5" /> Copy Code</>
                    )}
                  </button>
                  {onReshare && (isOwnItem || file.allowReshare === true) && (
                    <TooltipProvider delayDuration={150}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            onClick={() => onReshare({ fileName: file.fileName, fileType: file.fileType, fileSize: file.fileSize, fileData: file.fileData, fileUrl: file.fileUrl, linkUrl: file.linkUrl, message: file.message })}
                            className="flex items-center justify-center h-8 w-8 rounded-md bg-slate-700 text-slate-200 hover:bg-slate-600 hover:text-white transition-all"
                          >
                            <Share2 className="w-4 h-4" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">Reshare</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                  {typeof onDelete === 'function' && (
                    <AlertDialog>
                      <TooltipProvider delayDuration={150}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <AlertDialogTrigger asChild>
                              <button
                                className="flex items-center justify-center h-8 w-8 rounded-md bg-slate-700 text-red-400 hover:bg-red-900/30 hover:text-red-300 transition-all"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </AlertDialogTrigger>
                          </TooltipTrigger>
                          <TooltipContent side="bottom">Delete</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete this item?</AlertDialogTitle>
                          <AlertDialogDescription>This will remove it from your history. You can undo for 30 seconds.</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={onDelete} className="bg-destructive text-white hover:bg-destructive/90">Delete</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </div>
                {/* Mobile: Copy Code button only */}
                <button
                  className="sm:hidden flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-all shrink-0"
                  style={copiedCode ? {} : {}}
                  onClick={() => {
                    navigator.clipboard.writeText(file.message || '')
                    setCopiedCode(true)
                    setTimeout(() => setCopiedCode(false), 2000)
                  }}
                >
                  {copiedCode ? (
                    <span className="flex items-center gap-1 bg-sky-500/20 text-sky-400 ring-1 ring-sky-500/30 px-2.5 py-1.5 rounded-md"><Check className="w-3.5 h-3.5" /><span className="hidden sm:inline"> Copied!</span></span>
                  ) : (
                    <span className="flex items-center gap-1 bg-slate-700 text-slate-200 hover:bg-slate-600 px-2.5 py-1.5 rounded-md"><Copy className="w-3.5 h-3.5" /></span>
                  )}
                </button>
              </div>
              {/* Code Content with scroll */}
              <pre
                className="p-3 sm:p-4 overflow-auto text-xs sm:text-sm leading-relaxed"
                style={{
                  fontFamily: 'Consolas, Monaco, "Courier New", monospace',
                  color: '#e2e8f0',
                  backgroundColor: '#1e293b',
                  margin: 0,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  maxHeight: '200px'
                }}
              >
                <code>{file.message}</code>
              </pre>
            </div>
          )}
          {/* Message Chat Bubble - For non-code messages */}
          {file.fileType !== 'code' && file.message && (
            <div className="mt-3 flex items-center gap-2 px-4 py-3 bg-primary/10 dark:bg-primary/15 rounded-lg border border-primary/20">
              <svg className="w-6 h-6 text-primary flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              <span className="text-sm font-medium text-primary">{file.message}</span>
            </div>
          )}
          {timestamp && (
            <time className="mb-1 text-xs font-normal text-muted-foreground sm:order-last sm:mb-0 flex justify-end" style={{ marginTop: 4 }}>
              <span className="text-primary text-xs font-medium inline-flex items-center px-2.5 py-0.5 dark:bg-card dark:text-primary" style={{ borderRadius: 30 }}>
                <svg className="w-2.5 h-2.5 me-1.5" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 20 20"><path d="M10 0a10 10 0 1 0 10 10A10.011 10.011 0 0 0 10 0Zm3.982 13.982a1 1 0 0 1-1.414 0l-3.274-3.274A1.012 1.012 0 0 1 9 10V6a1 1 0 0 1 2 0v3.586l2.982 2.982a1 1 0 0 1 0 1.414Z" /></svg>
                {new Date(timestamp).toLocaleTimeString()}
              </span>
            </time>
          )}
        </div>
        <div className="ms-4 sm:ms-8 mt-2 flex flex-wrap items-center gap-2 sm:gap-3 text-xs text-muted-foreground">
          {recipients && recipients.length > 0 && (
            <span className="truncate">To: {(() => {
              const maxShow = 2
              const parts = recipients.slice(0, maxShow).map(r => `${r.name} (${r.uniqueId})`)
              const remaining = recipients.length - maxShow
              return (
                <>
                  <span className="truncate inline-block max-w-[220px] align-middle">{parts.join(', ')}{remaining > 0 && ', '}</span>
                  {remaining > 0 && <button className="text-primary hover:underline" onClick={() => setIsRecipientsOpen(true)}>{`and ${remaining} more`}</button>}
                </>
              )
            })()}</span>
          )}
          {file.method && <span className="hidden sm:inline text-primary dark:text-primary font-medium">Method : {file.method}</span>}
        </div>
      </CardContent>
      {/* Delete confirmation dialog triggered from meatballs menu */}
      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this item?</AlertDialogTitle>
            <AlertDialogDescription>This will remove it from your history. You can undo for 30 seconds.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setDeleteConfirmOpen(false); onDelete?.() }} className="bg-destructive text-white hover:bg-destructive/90">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {/* Preview dialog (shared between meatballs tap and inline button on desktop) */}
      <Dialog open={isPreviewOpen} onOpenChange={setIsPreviewOpen}>
        {file.fileType === 'code' && file.message ? (
          /* Code Preview Dialog - full-screen code viewer */
          <DialogContent
            showCloseButton={false}
            onOpenAutoFocus={(event) => event.preventDefault()}
            className="max-w-[95vw] sm:max-w-2xl h-[80vh] sm:h-[85vh] p-0 rounded-2xl overflow-hidden flex flex-col"
          >
            <div className="flex items-center justify-between px-2.5 py-2 sm:px-4 sm:py-3 border-b border-slate-700 bg-slate-800 gap-1.5 sm:gap-2 min-w-0">
              <DialogHeader className="p-0 m-0 min-w-0 flex-1 overflow-hidden">
                <DialogTitle className="flex items-center gap-1.5 sm:gap-2 text-sm sm:text-base font-semibold min-w-0 text-slate-100">
                  <FileCode className="w-4 h-4 sm:w-5 sm:h-5 shrink-0 text-sky-400" />
                  <span className="truncate">Code Snippet</span>
                  <span className="text-xs text-slate-500 shrink-0">({file.message.length} chars)</span>
                </DialogTitle>
              </DialogHeader>
              <div className="flex items-center gap-1 sm:gap-2 shrink-0">
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(file.message || '')
                    setCopiedCode(true)
                    setTimeout(() => setCopiedCode(false), 2000)
                  }}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-all ${copiedCode
                    ? 'bg-sky-500/20 text-sky-400 ring-1 ring-sky-500/30'
                    : 'bg-slate-700 text-slate-200 hover:bg-slate-600 hover:text-white'
                    }`}
                >
                  {copiedCode ? <><Check className="w-3.5 h-3.5" /><span className="hidden sm:inline"> Copied!</span></> : <><Copy className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Copy</span></>}
                </button>
                <DialogClose asChild>
                  <button
                    aria-label="Close"
                    className="cursor-pointer inline-flex items-center justify-center h-8 w-8 sm:h-9 sm:w-9 rounded-full text-slate-400 hover:text-slate-200 hover:bg-slate-700 focus-visible:outline-none active:scale-95"
                  >
                    <X className="w-[18px] h-[18px] sm:w-5 sm:h-5" />
                  </button>
                </DialogClose>
              </div>
            </div>
            <div className="flex-1 overflow-auto bg-slate-900">
              <pre
                className="p-3 sm:p-4 text-xs sm:text-sm leading-relaxed"
                style={{
                  fontFamily: 'Consolas, Monaco, "Courier New", monospace',
                  color: '#e2e8f0',
                  backgroundColor: '#1e293b',
                  margin: 0,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                <code>{file.message}</code>
              </pre>
            </div>
          </DialogContent>
        ) : (
          /* Standard file/link preview dialog */
          <DialogContent
            showCloseButton={false}
            onOpenAutoFocus={(event) => event.preventDefault()}
            className="max-w-[95vw] sm:max-w-[92vw] w-[95vw] sm:w-[92vw] h-[80vh] sm:h-[85vh] p-0 rounded-2xl overflow-hidden flex flex-col"
          >
          <div className="flex items-center justify-between px-2.5 py-2 sm:px-4 sm:py-3 border-b bg-card dark:bg-gray-900 dark:border-gray-800 gap-1.5 sm:gap-2 min-w-0">
            <DialogHeader className="p-0 m-0 min-w-0 flex-1 overflow-hidden">
              <DialogTitle className="flex items-center gap-1.5 sm:gap-2 text-sm sm:text-base font-semibold min-w-0">
                {file.isLink ? <Link className="w-4 h-4 sm:w-5 sm:h-5 shrink-0" /> : <FileIcon className="w-4 h-4 sm:w-5 sm:h-5 shrink-0" />}
                <span className="overflow-x-auto whitespace-nowrap scrollbar-thin" title={file.fileName}>{file.fileName}</span>
              </DialogTitle>
            </DialogHeader>
            <div className="flex items-center gap-1 sm:gap-2 shrink-0">
              <TooltipProvider delayDuration={150}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={handleDownload}
                      aria-label={file.isLink ? 'Open link' : 'Download'}
                      className="cursor-pointer inline-flex items-center justify-center h-8 w-8 sm:h-9 sm:w-9 rounded-full text-primary hover:text-primary/90 hover:bg-primary/10 dark:hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 active:scale-95"
                    >
                      {file.isLink ? <ExternalLink className="w-[18px] h-[18px] sm:w-5 sm:h-5" /> : <Download className="w-[18px] h-[18px] sm:w-5 sm:h-5" />}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">{file.isLink ? 'Open link' : 'Download'}</TooltipContent>
                </Tooltip>
                {onReshare && (isOwnItem || (file.allowReshare ?? true)) && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => onReshare({ fileName: file.fileName, fileType: file.fileType, fileSize: file.fileSize, fileData: file.fileData, fileUrl: file.fileUrl, linkUrl: file.linkUrl })}
                        aria-label="Reshare"
                        className="cursor-pointer inline-flex items-center justify-center h-8 w-8 sm:h-9 sm:w-9 rounded-full text-primary hover:text-primary/90 hover:bg-primary/10 dark:hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 active:scale-95"
                      >
                        <Share2 className="w-[18px] h-[18px] sm:w-5 sm:h-5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">Reshare</TooltipContent>
                  </Tooltip>
                )}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <DialogClose asChild>
                      <button
                        aria-label="Close"
                        className="cursor-pointer inline-flex items-center justify-center h-8 w-8 sm:h-9 sm:w-9 rounded-full text-muted-foreground hover:text-foreground hover:bg-gray-100 dark:hover:bg-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400/50 active:scale-95"
                      >
                        <X className="w-[18px] h-[18px] sm:w-5 sm:h-5" />
                      </button>
                    </DialogClose>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Close</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>
          <div className="flex-1 overflow-hidden bg-card dark:bg-gray-900">
            {renderPreview('dialog')}
          </div>
        </DialogContent>
        )}
      </Dialog>
      <Dialog open={isRecipientsOpen} onOpenChange={setIsRecipientsOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Recipients</DialogTitle></DialogHeader>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {recipients && recipients.length > 0 ? recipients.map(r => (
              <div key={r.id} className="flex items-center justify-between p-2 rounded-xl border border-border">
                <span className="text-sm font-medium">{r.name}</span>
                <span className="text-xs text-muted-foreground">{r.uniqueId}</span>
              </div>
            )) : <p className="text-sm text-muted-foreground">No recipients</p>}
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

// Avoid re-rendering every item on unrelated state changes
const FilePreview = React.memo(FilePreviewInner, (prev, next) => {
  const f1 = prev.file, f2 = next.file
  return (
    f1.id === f2.id &&
    f1.fileUrl === f2.fileUrl &&
    f1.fileData === f2.fileData &&
    f1.message === f2.message &&
    f1.method === f2.method &&
    f1.fileId === f2.fileId &&
    prev.senderName === next.senderName &&
    prev.senderUniqueId === next.senderUniqueId &&
    prev.isOwnItem === next.isOwnItem &&
    prev.timestamp?.getTime?.() === next.timestamp?.getTime?.() &&
    prev.highlightQuery === next.highlightQuery &&
    prev.isPrinted === next.isPrinted
  )
})

export default FilePreview
