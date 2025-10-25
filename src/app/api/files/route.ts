export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
// Note: This route runs on the Edge in Cloudflare Pages. DB operations should be handled on Render.
// This endpoint is stubbed on Edge to avoid Node/Prisma usage.
import { z } from 'zod'

const CreateFileSchema = z.object({
  fileName: z.string().min(1),
  fileSize: z.number().min(0),
  fileType: z.string().min(1),
  fileData: z.string().optional(),
  isLink: z.boolean().default(false),
  linkUrl: z.string().optional(),
  message: z.string().optional(),
  senderId: z.string().min(1),
  receiverId: z.string().min(1),
  roomNumber: z.string().min(1),
  isPrintRequest: z.boolean().default(false)
})

export async function POST(request: NextRequest) {
  return NextResponse.json({ error: 'Not implemented on Edge. Use Render service.' }, { status: 501 })
}

export async function GET(request: NextRequest) {
  return NextResponse.json({ error: 'Not implemented on Edge. Use Render service.' }, { status: 501 })
}