import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const files = formData.getAll('files') as File[]

    if (!files || files.length === 0) {
      return NextResponse.redirect(new URL('/share-target?error=no_files', request.url), 303)
    }

    // Filter valid files
    const validFiles = files.filter(f => f.size > 0)
    if (validFiles.length === 0) {
      return NextResponse.redirect(new URL('/share-target?error=no_valid_files', request.url), 303)
    }

    // We need a temporary directory to store these files.
    // We'll use a specific fallback directory in the OS temp dir.
    const fallbackId = Date.now().toString() + Math.random().toString().substring(2, 8)
    const fallbackDir = path.join(os.tmpdir(), 'cosmoshare_fallback', fallbackId)
    
    await fs.mkdir(fallbackDir, { recursive: true })
    
    const metaData: { name: string; type: string; size: number }[] = []
    
    // Save each file to the temp directory
    for (let i = 0; i < validFiles.length; i++) {
      const file = validFiles[i]
      const arrayBuffer = await file.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)
      
      const fileName = file.name || `shared_file_${i}`
      const filePath = path.join(fallbackDir, fileName)
      
      await fs.writeFile(filePath, buffer)
      
      metaData.push({
        name: fileName,
        type: file.type,
        size: file.size
      })
    }
    
    // Save metadata json
    await fs.writeFile(
      path.join(fallbackDir, 'metadata.json'), 
      JSON.stringify(metaData)
    )

    // Redirect back to the PWA UI with the fallback ID so the client can fetch the files
    const redirectUrl = new URL(`/share-target?fallbackId=${fallbackId}`, request.url)
    return NextResponse.redirect(redirectUrl, 303)
    
  } catch (err) {
    console.error('[API Fallback] Web Share Target POST error:', err)
    return NextResponse.redirect(new URL('/share-target?error=server_fallback_failed', request.url), 303)
  }
}
