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
      );
    }

    // Parse the JSON body from the client
    const body = await request.json().catch(() => ({}))
    const { phoneNumber, type, linkUrl, codeSnippet, message, files } = body

    if (!phoneNumber) {
      return NextResponse.json({ error: 'Phone number is required' }, { status: 400 })
    }

    if (!type || !['file', 'link', 'code'].includes(type)) {
      return NextResponse.json({ error: 'Valid share type is required (file, link, or code)' }, { status: 400 })
    }

    // Call the WhatsApp Bot share endpoint
    const botShareEndpoint = `${botUrl.replace(/\/+$/, '')}/api/whatsapp/share`
    
    console.log(`Forwarding share request to WhatsApp bot: ${botShareEndpoint}`, {
      type,
      hasFiles: !!(files && files.length),
      phoneNumber: phoneNumber.slice(0, 4) + '...'
    })

    const reqHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Bot-Secret': expectedSecret,
    }

    if (hfToken) {
      reqHeaders['Authorization'] = `Bearer ${hfToken}`
    } else {
      reqHeaders['Authorization'] = `Bearer ${expectedSecret}`
    }

    const botResponse = await fetch(botShareEndpoint, {
      method: 'POST',
      headers: reqHeaders,
      body: JSON.stringify({
        phoneNumber,
        type,
        linkUrl,
        codeSnippet,
        message,
        files
      })
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
    console.error('Error forwarding share request to WhatsApp bot:', err)
    return NextResponse.json(
      { error: err.message || 'Failed to connect to the WhatsApp Bot service. Please verify the bot is online.' },
      { status: 502 }
    )
  }
}
