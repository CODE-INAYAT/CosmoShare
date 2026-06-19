import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'edge'

export async function POST(request: NextRequest) {
  try {
    const expectedSecret = process.env.BRIDGE_API_SECRET || ''
    const botUrl = process.env.WHATSAPP_BOT_URL || ''
    const hfToken = process.env.HF_TOKEN || ''

    if (!expectedSecret || !botUrl) {
      return NextResponse.json(
        { error: 'WhatsApp bot integration is not configured on the server. Please check environment variables.' },
        { status: 500 }
      )
    }

    const phoneNumber = request.headers.get('x-phone-number')
    const fileName = request.headers.get('x-file-name')
    const message = request.headers.get('x-message')
    const contentType = request.headers.get('content-type')

    if (!phoneNumber) {
      return NextResponse.json({ error: 'x-phone-number header is required' }, { status: 400 })
    }

    const botShareEndpoint = `${botUrl.replace(/\/+$/, '')}/api/whatsapp/share-file`

    const reqHeaders: Record<string, string> = {
      'x-phone-number': phoneNumber,
      'content-type': contentType || 'application/octet-stream',
      'x-bot-secret': expectedSecret,
    }

    if (fileName) reqHeaders['x-file-name'] = fileName
    if (message) reqHeaders['x-message'] = message

    if (hfToken) {
      reqHeaders['Authorization'] = `Bearer ${hfToken}`
    } else {
      reqHeaders['Authorization'] = `Bearer ${expectedSecret}`
    }

    // Forward the binary stream directly to the bot
    const bodyStream = request.body

    const botResponse = await fetch(botShareEndpoint, {
      method: 'POST',
      headers: reqHeaders,
      body: bodyStream,
      // @ts-ignore
      duplex: 'half',
    })

    if (!botResponse.ok) {
      const errorText = await botResponse.text().catch(() => 'Unknown error')
      let errorMessage = errorText
      try {
        const errorJson = JSON.parse(errorText)
        errorMessage = errorJson.error || errorText
      } catch {}
      return NextResponse.json({ error: errorMessage }, { status: botResponse.status })
    }

    const data = await botResponse.json().catch(() => ({ success: true }))
    return NextResponse.json(data)
  } catch (err: any) {
    console.error('Error forwarding binary share request to WhatsApp bot:', err)
    return NextResponse.json(
      { error: err.message || 'Failed to connect to the WhatsApp Bot service. Please verify the bot is online.' },
      { status: 502 }
    )
  }
}
