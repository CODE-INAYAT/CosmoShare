export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
// Note: This route runs on the Edge in Cloudflare Pages. DB operations should be handled on Render.
// To keep deployment simple, this endpoint is a stub and returns 501 to indicate it isn't available on the Edge.
// If needed, proxy to your Render service from the client using the base URL.
import { z } from 'zod'

const CreateUserSchema = z.object({
  name: z.string().min(1),
  roomNumber: z.string().min(1),
  uniqueId: z.string().min(1)
})

export async function POST(request: NextRequest) {
  return NextResponse.json({ error: 'Not implemented on Edge. Use Render service.' }, { status: 501 })
}

export async function GET(request: NextRequest) {
  return NextResponse.json({ error: 'Not implemented on Edge. Use Render service.' }, { status: 501 })
}