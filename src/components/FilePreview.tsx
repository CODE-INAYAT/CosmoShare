'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
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
  FilePlus,
  FileImage
} from 'lucide-react'

interface RecipientInfo { id: string; name: string; uniqueId: string }

interface FilePreviewProps {
  file: {
    id: string
    fileName: string
    fileSize: number
    fileType: string
    fileData?: string
    isLink: boolean
    linkUrl?: string
    message?: string
    allowReshare?: boolean
  }
  senderName?: string
  senderUniqueId?: string
  recipients?: RecipientInfo[]
  timestamp?: Date
  onReshare?: (file: { fileName: string; fileType: string; fileSize: number; fileData?: string; linkUrl?: string }) => void
  isOwnItem?: boolean
}

const getFileIcon = (fileType: string, fileName: string) => {
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

export default function FilePreview({ file, senderName, senderUniqueId, recipients, timestamp, onReshare, isOwnItem }: FilePreviewProps) {
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [isRecipientsOpen, setIsRecipientsOpen] = useState(false)
  const FileIcon = getFileIcon(file.fileType, file.fileName)

  useEffect(() => {
    if (file.isLink && file.linkUrl) {
      if (isGoogleDocsLink(file.linkUrl)) {
        setPreviewUrl(getGoogleDocsEmbedUrl(file.linkUrl))
      } else {
        setPreviewUrl(file.linkUrl)
      }
    } else if (file.fileData) {
      // For base64 encoded files, create a blob URL
      try {
        const byteCharacters = atob(file.fileData.split(',')[1])
        const byteNumbers = new Array(byteCharacters.length)
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i)
        }
        const byteArray = new Uint8Array(byteNumbers)
        const blob = new Blob([byteArray], { type: file.fileType })
        const url = URL.createObjectURL(blob)
        setPreviewUrl(url)
        
        return () => {
          URL.revokeObjectURL(url)
        }
      } catch (error) {
        console.error('Error creating preview URL:', error)
      }
    }
  }, [file])

  const handleDownload = () => {
    if (file.isLink && file.linkUrl) {
      window.open(file.linkUrl, '_blank')
    } else if (file.fileData) {
      const link = document.createElement('a')
      link.href = file.fileData
      link.download = file.fileName
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    }
  }

  const renderPreview = () => {
    if (!previewUrl) return null

    if (file.fileType.startsWith('image/')) {
      return (
        <div className="flex justify-center">
          <img 
            src={previewUrl} 
            alt={file.fileName}
            className="max-w-full max-h-96 rounded-lg shadow-lg"
          />
        </div>
      )
    }

    if (file.fileType.startsWith('video/')) {
      return (
        <video 
          src={previewUrl} 
          controls 
          className="w-full max-w-2xl rounded-lg shadow-lg"
        >
          Your browser does not support the video tag.
        </video>
      )
    }

    if (file.fileType.startsWith('audio/')) {
      return (
        <audio 
          src={previewUrl} 
          controls 
          className="w-full"
        >
          Your browser does not support the audio tag.
        </audio>
      )
    }

    if (file.fileType.includes('pdf')) {
      return (
        <iframe
          src={previewUrl}
          className="w-full h-96 rounded-lg shadow-lg"
          title={file.fileName}
        />
      )
    }

    if (file.isLink && file.linkUrl && isGoogleDocsLink(file.linkUrl)) {
      return (
        <iframe
          src={previewUrl!}
          className="w-full h-96 rounded-lg shadow-lg"
          title={file.fileName}
        />
      )
    }

    if (file.isLink) {
      return (
        <div className="text-center py-8">
          <Link className="w-16 h-16 mx-auto mb-4 text-blue-500" />
          <h3 className="text-lg font-semibold mb-2">External Link</h3>
          <p className="text-gray-600 mb-4">{file.linkUrl}</p>
          <Button asChild>
            <a href={file.linkUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="w-4 h-4 mr-2" />
              Open Link
            </a>
          </Button>
        </div>
      )
    }

    return (
      <div className="text-center py-8">
        <FileIcon className="w-16 h-16 mx-auto mb-4 text-gray-400" />
        <h3 className="text-lg font-semibold mb-2">Preview Not Available</h3>
        <p className="text-gray-600 mb-4">This file type cannot be previewed.</p>
        <Button onClick={handleDownload}>
          <Download className="w-4 h-4 mr-2" />
          Download File
        </Button>
      </div>
    )
  }

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="p-2 bg-gray-100 rounded-lg">
            <FileIcon className="w-5 h-5 text-gray-600" />
          </div>
          
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h4 className="font-medium truncate">{file.fileName}</h4>
              {file.isLink && (
                <Badge variant="secondary" className="text-xs">
                  <Link className="w-3 h-3 mr-1" />
                  Link
                </Badge>
              )}
            </div>
            
            <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500 mb-2">
              <span>{formatFileSize(file.fileSize)}</span>
              {senderName && (
                <span>From: {senderName}{senderUniqueId ? ` (${senderUniqueId})` : ''}</span>
              )}
              {recipients && recipients.length > 0 && (
                <span className="truncate">
                  To: {
                    (() => {
                      const maxShow = 2
                      const parts = recipients.slice(0, maxShow).map(r => `${r.name} (${r.uniqueId})`)
                      const remaining = recipients.length - maxShow
                      return (
                        <>
                          <span className="truncate inline-block max-w-[220px] align-middle">
                            {parts.join(', ')}
                            {remaining > 0 && ', '}
                          </span>
                          {remaining > 0 && (
                            <button className="text-blue-600 hover:underline" onClick={() => setIsRecipientsOpen(true)}>
                              {`and ${remaining} more`}
                            </button>
                          )}
                        </>
                      )
                    })()
                  }
                </span>
              )}
              {timestamp && <span>{new Date(timestamp).toLocaleTimeString()}</span>}
            </div>
            
            {file.message && (
              <p className="text-sm text-gray-600 mb-3 italic">
                "{file.message}"
              </p>
            )}
            
            <div className="flex items-center gap-2">
              <Dialog open={isPreviewOpen} onOpenChange={setIsPreviewOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm">
                    <Eye className="w-4 h-4 mr-1" />
                    Preview
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                      <FileIcon className="w-5 h-5" />
                      {file.fileName}
                    </DialogTitle>
                  </DialogHeader>
                  {renderPreview()}
                </DialogContent>
              </Dialog>
              
              <Button variant="outline" size="sm" onClick={handleDownload}>
                {file.isLink ? (
                  <>
                    <ExternalLink className="w-4 h-4 mr-1" />
                    Open
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4 mr-1" />
                    Download
                  </>
                )}
              </Button>

              {onReshare && (isOwnItem || (file.allowReshare ?? true)) && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onReshare({ fileName: file.fileName, fileType: file.fileType, fileSize: file.fileSize, fileData: file.fileData, linkUrl: file.linkUrl })}
                >
                  Reshare
                </Button>
              )}
            </div>
          </div>
        </div>
      </CardContent>

      {/* Recipients Modal */}
      <Dialog open={isRecipientsOpen} onOpenChange={setIsRecipientsOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Recipients</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {recipients && recipients.length > 0 ? (
              recipients.map((r) => (
                <div key={r.id} className="flex items-center justify-between p-2 rounded border border-gray-200">
                  <span className="text-sm font-medium">{r.name}</span>
                  <span className="text-xs text-gray-500">{r.uniqueId}</span>
                </div>
              ))
            ) : (
              <p className="text-sm text-gray-500">No recipients</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  )
}