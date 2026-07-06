# CosmoShare Signaling Server (Hugging Face Spaces)

Socket.IO signaling server for CosmoShare, designed for deployment on Hugging Face Spaces via Docker.

This server replicates the full signaling logic from the main CosmoShare Next.js server (`src/lib/socket.ts`), providing:

- **Room-based presence** — join-room, user tracking, single-session enforcement
- **WebRTC signaling relay** — offer, answer, ICE candidate forwarding
- **Admin authentication** — password-based admin auth with room-scoped presence
- **OneShare** — 4-digit code sessions, MultiShare support, auto-expiry
- **Daily cleanup** — 3:00 AM IST automatic state reset via cron

## Deploy to Hugging Face Spaces (Private)

### Step 1: Create the Space

1. Go to [Hugging Face Spaces](https://huggingface.co/spaces) → **New Space**
2. Name your Space (e.g. `cosmoshare-signaling`)
3. Select **Docker** as the SDK
4. Select **Blank** template
5. Set Space Visibility to **Private**

### Step 2: Push the code

```bash
cd SignalingHuggingFace
git init
git remote add origin https://huggingface.co/spaces/<username>/cosmoshare-signaling
git add .
git commit -m "Initial deploy"
git push -u origin main
```

The Space will build and start automatically on port `7860`.

### Step 3: Configure CosmoShare `.env`

After deployment, your Space URL will be:
```
https://<username>-cosmoshare-signaling.hf.space
```

Update the `.env` file in your CosmoShare project:

```env
# Comment out existing Cloudflare signaling config
# NEXT_PUBLIC_SIGNALING_BASE_URL = wss://...
# NEXT_PUBLIC_SIGNALING_BASE_URL_ONESHARE = wss://...
# NEXT_PUBLIC_SIGNALING_URLS = wss://...
# NEXT_PUBLIC_SIGNALING_URLS_ONESHARE = wss://...

# Use Hugging Face Spaces signaling server
NEXT_PUBLIC_SIGNALING_HF = https://<username>-cosmoshare-signaling.hf.space

# Required for private Spaces — the client sends this as Authorization header
# Both HF_TOKEN and NEXT_PUBLIC_HF_TOKEN must have the same value
HF_TOKEN = hf_your_token_here
NEXT_PUBLIC_HF_TOKEN = hf_your_token_here
```

> **Why two token variables?**
> - `HF_TOKEN` — used server-side (e.g. by WA-BOT)
> - `NEXT_PUBLIC_HF_TOKEN` — same token, but accessible in browser code (Next.js requires the `NEXT_PUBLIC_` prefix for client-side env vars)

### How Private Space Auth Works

When the Space is private, Hugging Face's reverse proxy requires an `Authorization: Bearer <HF_TOKEN>` header on every request. The CosmoShare client automatically sends this header via Socket.IO's `extraHeaders` when `NEXT_PUBLIC_HF_TOKEN` is set in `.env`.

## Environment Variables (Optional)

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `7860` | Server port (HF Spaces requires 7860) |
| `ADMIN_PASSWORD` | `admin123` | Admin authentication password |

## Local Development

```bash
npm install
npm run dev
```

Server starts at `http://localhost:7860` with Socket.IO path `/api/socket/io`.

## Health Check

```
GET /ping → "OK"
GET /     → JSON status with uptime and connection count
```
