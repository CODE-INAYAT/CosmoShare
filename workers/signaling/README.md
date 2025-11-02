# ShareKaro Signaling Worker (Cloudflare Workers + Durable Objects)

This Worker hosts the WebSocket signaling server backed by a Durable Object. The Next.js app on Cloudflare Pages connects to this Worker via `NEXT_PUBLIC_SIGNALING_BASE_URL`.

## What it provides

- WebSocket endpoint: `/ws?room=<roomNumber>`
- Events: `join-room`, `admin-auth`, `get-room-users`, `webrtc-offer`, `webrtc-answer`, `webrtc-ice-candidate`
- Presence, single-session enforcement, admin presence, and relaying of WebRTC messages

## Deploy

Prereqs:

- Install Wrangler and login

```powershell
npm i -g wrangler; wrangler login
```

Deploy the Worker:

```powershell
cd workers/signaling
wrangler deploy
```

After deploy, note your Worker URL:

- Example: `https://sharekaro-signal.YOUR_ACCOUNT.workers.dev`
- The signaling endpoint is `wss://sharekaro-signal.YOUR_ACCOUNT.workers.dev/ws`

## Configure Pages env var

Set this on your Cloudflare Pages project (Production and Preview):

- `NEXT_PUBLIC_SIGNALING_BASE_URL = wss://sharekaro-signal.YOUR_ACCOUNT.workers.dev`

The app will automatically connect to `${NEXT_PUBLIC_SIGNALING_BASE_URL}/ws?room=...`.

## Local test (optional)

You can use the Worker locally:

```powershell
cd workers/signaling
wrangler dev
```

Then connect to `ws://127.0.0.1:8787/ws?room=123`.
