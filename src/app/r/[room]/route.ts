import { NextResponse } from 'next/server';
import { validRoomsSet } from '@/config/rooms';

export const runtime = 'edge';

export async function GET(
    request: Request,
    { params }: { params: Promise<{ room: string }> }
) {
    const url = new URL(request.url);
    const origin = url.origin;
    
    // In Next.js 15, params is a Promise and must be unwrapped
    const { room } = await params;

    // Validate that the requested room actually exists in O(1) time complexity
    if (!validRoomsSet.has(room)) {
        // Redirect to homepage silently if the room doesn't exist
        return NextResponse.redirect(`${origin}/`);
    }

    // Redirect to the homepage with the 'r' (room) query parameter
    return NextResponse.redirect(`${origin}/?r=${room}`);
}
