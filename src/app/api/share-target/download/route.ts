import { NextRequest, NextResponse } from 'next/server'
import { promises as fs, createReadStream } from 'fs'
import path from 'path'
import os from 'os'

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const fallbackId = searchParams.get('id')
  const fileName = searchParams.get('file')
  const deleteFlag = searchParams.get('delete')

  if (!fallbackId) {
    return NextResponse.json({ error: 'Missing fallbackId' }, { status: 400 })
  }

  const fallbackDir = path.join(os.tmpdir(), 'cosmoshare_fallback', fallbackId)

  try {
    // If delete flag is passed, just delete the entire directory and return success
    if (deleteFlag === 'true') {
      await fs.rm(fallbackDir, { recursive: true, force: true })
      return NextResponse.json({ success: true })
    }

    // If no fileName, we are asking for the metadata json
    if (!fileName) {
      const metaPath = path.join(fallbackDir, 'metadata.json')
      const metaData = await fs.readFile(metaPath, 'utf8')
      return new NextResponse(metaData, {
        headers: {
          'Content-Type': 'application/json'
        }
      })
    }

    // Serve the specific file
    const filePath = path.join(fallbackDir, fileName)
    
    // Validate that the requested file is actually inside the fallback dir (security check)
    const resolvedPath = path.resolve(filePath)
    if (!resolvedPath.startsWith(path.resolve(fallbackDir))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const stat = await fs.stat(filePath)
    
    // Load file into memory and return (Next.js App Router standard way for small/medium files)
    // Note: Since this is local dev server, memory limits are generous, but we stream it just in case
    const fileBuffer = await fs.readFile(filePath)
    
    return new NextResponse(new Uint8Array(fileBuffer), {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': stat.size.toString(),
        'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`
      }
    })

  } catch (err) {
    console.error('[API Fallback Download] Error:', err)
    return NextResponse.json({ error: 'File not found or error occurred' }, { status: 404 })
  }
}
