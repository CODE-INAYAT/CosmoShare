import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'edge';

export async function POST(request: NextRequest) {
  // If this route is hit, it means the Service Worker failed to intercept the POST request.
  // This can happen on Android Chrome during cold starts of the PWA share target,
  // or if the Service Worker was unregistered/cleared but the OS still has the widget.
  // Since we cannot write the files to the client's IndexedDB from the server,
  // we gracefully redirect back to the share-target page with an error flag,
  // preventing the ugly 405 Method Not Allowed error.
  
  const url = request.nextUrl.clone()
  url.pathname = '/share-target'
  url.searchParams.set('error', 'sw_bypassed')
  
  return NextResponse.redirect(url, 303)
}
