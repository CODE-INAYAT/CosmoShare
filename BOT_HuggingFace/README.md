# CosmoShare Bot — Zero-Latency WhatsApp Bot for Hugging Face Spaces

A completely redesigned WhatsApp bot architecture optimized for Hugging Face Spaces free tier. Combines the WhatsApp bot and Socket.IO signaling server in a single process for zero internal latency.

## Architecture

```
Single HF Space (port 7860)
├── Baileys WhatsApp Client (~80MB RAM, no Chromium)
├── Socket.IO Signaling Server (embedded, in-process)
├── Express API Server (REST endpoints + admin dashboard)
├── Relay Engine (server-mediated file transfer via HTTP)
└── File Stage (in-memory + temp disk with TTL cleanup)
```

## Key Features

- **Zero-latency code generation** — OneShare codes generated in < 1ms (in-process function call)
- **No Chromium/Puppeteer** — Baileys uses pure JS WhatsApp Multi-Device protocol (~80MB vs 1.2GB)
- **HTTP file relay** — Files served via standard HTTPS, no WebRTC ICE negotiation
- **Eager parallel downloads** — WhatsApp media downloaded during file collection, not after
- **Combined deployment** — Signaling + Bot in one process, one Space, one URL

## Deployment to Hugging Face Spaces

1. Create a new **Docker** Space (private) on Hugging Face
2. Upload the contents of this folder
3. Set these **Secrets** in Space settings:
   - `ADMIN_PASSWORD` — Dashboard login password
   - `HF_TOKEN` — Your Hugging Face access token (for auth + session backup)
   - `HF_DATASET` — (Optional) Private dataset name for auth state persistence (e.g., `username/cosmoshare-sessions`)
   - `BRIDGE_API_SECRET` — Same secret as in your CosmoShare `.env`
4. The Space will build and start automatically

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ADMIN_PASSWORD` | Yes | `admin123` | Dashboard login password |
| `HF_TOKEN` | Yes | — | HF access token |
| `HF_DATASET` | No | — | HF dataset for auth persistence |
| `BRIDGE_API_SECRET` | Yes | — | API secret for web portal auth |
| `BOT_MAX_FILE_SIZE_MB` | No | `50` | Max file size in MB |
| `BOT_SESSION_TIMEOUT_MINUTES` | No | `30` | Session inactivity timeout |
| `LOG_LEVEL` | No | `info` | Logging level |
| `ENABLE_TEST_NUMBERS_ONLY` | No | `false` | Restrict to test numbers |
| `ALLOWED_TEST_NUMBERS` | No | — | Comma-separated test numbers |

## CosmoShare `.env` Configuration

After deploying, update your CosmoShare web app `.env`:

```env
# Point both to the same Space URL
NEXT_PUBLIC_SIGNALING_HF = https://<username>-<space-name>.hf.space
WHATSAPP_BOT_URL = https://<username>-<space-name>.hf.space
NEXT_PUBLIC_HF_TOKEN = hf_your_token_here
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Admin dashboard |
| `GET` | `/ping` | Health check |
| `GET` | `/api/whatsapp/status` | Bot status + stats |
| `POST` | `/api/whatsapp/share` | Share link/code to WhatsApp |
| `POST` | `/api/whatsapp/share-file` | Share binary file to WhatsApp |
| `GET` | `/relay/files/:uuid` | Download staged file |
| `WS` | `/api/socket/io` | Socket.IO signaling |

## Resource Usage

| Metric | Value |
|--------|-------|
| RAM at idle | ~140MB |
| Docker image size | ~150MB |
| Startup time | 2-5s |
| Max concurrent transfers | 500+ |
