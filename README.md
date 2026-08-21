# CosmoShare 🚀

**CosmoShare** is a modern, real-time, full-stack web application designed for seamless file sharing and communication. It is uniquely focused on computer labs or distinct rooms, providing a robust peer-to-peer experience.

## ✨ Features

- **Real-Time File Sharing**: Lightning-fast peer-to-peer file transfers using WebRTC.
- **Room-Based Architecture**: Isolated environments for distinct computer labs or groups.
- **OneShare Tier**: Standalone cross-room file sharing capability.
- **Hybrid Real-Time Backend**:
  - Primary signaling backend via **Hugging Face Spaces** (`SignalingHuggingFace`).
  - Backup edge-scaled signaling via **Cloudflare Workers (Durable Objects)**.
  - Local WebSocket connectivity via **Socket.IO**.
- **Role-Based Access**: Dedicated admin and student dashboards.
- **Feature Flags**: Built-in toggles for Auto Login, Analytics, Inspect Element Restriction, and URL Obfuscation.

## 🛠️ Tech Stack

- **Frontend**: Next.js (App Router), React, Tailwind CSS, Shadcn UI
- **Backend**: Node.js, Next.js API Routes, Prisma (PostgreSQL)
- **Real-Time**: WebRTC, Hugging Face Spaces, Cloudflare Workers, Socket.IO
- **Deployment & Config**: TypeScript, ESLint, Wrangler

## 🚀 Getting Started

### Prerequisites

- Node.js (v18+ recommended)
- PostgreSQL database
- Hugging Face account (for deploying the primary signaling server)
- Cloudflare account (for deploying the backup Workers)

### Local Development

1. **Clone the repository:**
   ```bash
   git clone <your-repo-url>
   cd CosmoShare
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure Environment Variables:**
   - Create or update the `.env` file with your database connection strings and secrets (e.g., `DATABASE_URL`).

4. **Initialize Database:**
   ```bash
   npx prisma generate
   npx prisma db push
   ```

5. **Run the local development server:**
   ```bash
   npm run dev
   # The server will spin up Next.js alongside the Socket.IO instance.
   # By default, it runs on http://localhost:3000
   ```

### 🚀 Hugging Face Deployment (Primary)

CosmoShare uses a dedicated Node.js signaling server deployed on Hugging Face Spaces as its primary signaling backend. The source code and environment details are located in the `SignalingHuggingFace/` directory.

### ☁️ Cloudflare Workers Deployment (Backup)

As a robust backup mechanism, CosmoShare uses Cloudflare Workers and Durable Objects for edge-scaled signaling.

1. **Authenticate with Cloudflare:**
   ```bash
   npx wrangler login
   ```

2. **Deploy the Worker:**
   Navigate to the workers directory and deploy:
   ```bash
   cd workers/signaling
   npm run deploy
   ```

## ⚙️ Configuration

CosmoShare includes several built-in toggles to adjust application behavior globally without restructuring logic. These can be found in the `src/config/` directory:

- **Auto Login** (`autoLogin.ts`): Bypass login for rapid access.
- **Inspect Restriction** (`inspectRestriction.ts`): Prevent client-side dev tools access.
- **URL Obfuscation** (`urlObfuscation.ts`): Obfuscate URLs and mask WebSocket connections.
- **Analytics** (`analytics.ts`): Custom analytics integration.
- **Rooms** (`rooms.ts`): Define acceptable computer lab room numbers.

## 📖 Documentation

For an in-depth look at the architecture, directory structure, and data flows, please refer to the [PROJECT_DOCUMENTATION.md](./PROJECT_DOCUMENTATION.md) file.

---
*Made with ❤️ By Inayat*
