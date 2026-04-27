# CosmoShare Project Documentation

## 1. Overview

CosmoShare is a modern, real-time, full-stack web application designed for seamless file sharing and communication, particularly focused on computer labs or distinct rooms. It uses Next.js for the UI, Prisma for data models, and a robust real-time communication tier built with WebRTC, Socket.IO, and Cloudflare Workers (Durable Objects).

---

## 2. File and Directory Structure

The files in this project are grouped logically by their architectural responsibilities.

### Core Application & UI (`src/`)

This directory holds the primary Next.js web application frontend and backend configurations.

- **`src/app/`**: Contains the Next.js App Router definitions.
  - `admin/`, `student/`: Distinct layouts and access-controlled dashboard pages.
  - `oneshare/`: The standalone cross-room file sharing setup.
  - `api/`: Next.js REST API routes dealing with files, standard HTTP data transfers, system health, and user administration.
- **`src/components/`**: React components.
  - `ui/`: Shadcn UI primitives (Alert, Button, Form, Cards, etc.) driving the foundational design system.
  - General components (`AppHeader.tsx`, `QRCodeDisplay.tsx`, `FilePreview.tsx`): Feature-level functional modules mapping directly to core UI capabilities.
- **`src/hooks/`**: Custom React hooks handling business logic.
  - `useWebRTC.ts` & `useOneShareWebRTC.ts`: Manage peer connection states, ICE candidates, and signaling payloads.
  - `useNetworkStatus.ts`: Offline detection logic.
- **`src/config/`**: Centralized configuration files manipulating feature flags (see Section 4 for detailed toggles).

### Backend, Signaling & State (`lib/`, `server.ts`, `workers/`)

These directories manage the data flow, database queries, and connections.

- **`server.ts`**: The main Node.js bootstrapping script that serves both Next.js pages and native Socket.IO WebSockets on the same port.
- **`src/lib/`**:
  - `db.ts`: Instantiates the Prisma database client.
  - `socket.ts` & `wsClient.ts`: Defines event structures for the Socket.IO setup.
  - `signalingRouter.ts`: Routes interactions for peer-to-peer connection brokering.
- **`workers/signaling/`**: Cloudflare Workers source code (`src/` and `wrangler.toml`). Houses Durable Object class definitions that scale real-time chat grouping & signaling externally without congesting the main Next.js backend.

### Database (`prisma/`)

- **`prisma/schema.prisma`**: The single source of truth for the PostgreSQL data model. It outlines models like `LabRoom`, `Student`, `SharedFile`, and `FileFolder`.

### Configuration & Tooling (Root Level)

- **`package.json`, `tsconfig.json`, `tailwind.config.ts`, `eslint.config.mjs`**: Standard Node.js package, TypeScript compiler, styling utility, and linter specifications.
- **`wrangler.toml` (Root & Workers)**: Specifies environments, bindings, Cron Triggers, and deployments to the Cloudflare environment.

---

## 3. Backend & Realtime Communication

CosmoShare employs a hybrid backend approach combining standard HTTP APIs with dual-channel real-time connections.

### How the Backend is Connected

1. **Next.js API Layer**: Standard `/api` routes query the PostgreSQL database synchronously using Prisma (`lib/db.ts`) for non-realtime operations (like fetching past files or room status).
2. **Local Socket.IO (`server.ts`)**:
   - A custom Node `http.createServer` instance wraps the Next.js handler.
   - It intercepts any request headed to `/api/socketio` and pipes it into an attached `Socket.IO` server. This connects clients dynamically for lightweight local real-time events.
3. **Cloudflare Durable Objects (`workers/signaling/`)**:
   - Deployed physically closer to users, `workers/signaling/src/index.ts` exposes a `/ws` WebSocket endpoint.
   - Connections are mapped into partitioned `RoomDurableObject` instances by referencing the `room` query parameter. If a room is omitted, it leverages a global `__oneshare__` tier.

### How Files & Data Work

- **Database Tracking:** When a file is initialized, metadata is inserted through Next.js APIs into PostgreSQL via Prisma (`SharedFile` or `FileFolder` models).
- **Peer-to-Peer Transfer:** Large file data doesn't congest the central server. The backend (Socket.IO / Cloudflare Signaling) is only used to exchange **WebRTC SDP offers, answers, and ICE candidates**.
- **Hooks:** the `useWebRTC` hook on the frontend automatically connects to the server, listens for new peers, brokers the connection, and then channels the raw file blobs directly device-to-device.

### How to Handle / Operate the Backend

- **Local Development**: Run `npm run dev` (or `node server.ts` if compiled). It will automatically spin up Next.js alongside the Socket.IO instance on port 3000.
- **Worker Deployment**: Ensure Wrangler is logged in (`npx wrangler login`). Run `npm run deploy` inside the `workers/signaling` directory to push Durable Object patches.

---

## 4. Application Configuration & Feature Controls

The codebase utilizes hard-coded toggles in the `src/config/` directory to enable or disable features globally without needing to restructure logic.

To toggle any of the features below, edit the respective TypeScript file in `src/config/`, modify the boolean, and restart/re-deploy the server.

### 4.1 Auto Login (`autoLogin.ts`)

Controls whether the system can use quick-access bypass techniques.

- **Variable**: `AUTO_LOGIN_ENABLED`
- **Values**: `true` / `false`
- **Behavior**: If `true`, specific routines check hashed environment passwords to log users/admins in rapidly. Uses `AUTO_LOGIN_PASSWORD` from `.env`.

### 4.2 Inspect Element Restriction (`inspectRestriction.ts`)

Controls the client-side limitation to open Developer Tools.

- **Variable**: `INSPECT_RESTRICTION_ENABLED`
- **Values**: `true` / `false`
- **Behavior**: If `true`, the application attempts to trap F12, right-click context menus, and developer shortcuts to prevent students from tampering with the client scope.

### 4.3 URL & Console Obfuscation (`urlObfuscation.ts`)

Protects against manual query-parameter manipulation and hides real-time WebSocket connection URLs being sniffed in the browser console.

- **Variable**: `URL_OBFUSCATION_ENABLED`
- **Values**: `true` / `false`
- **Behavior**: When enabled, encrypts/masks JSON payload URLs using a local XOR Cipher (keyed via `CIPHER_KEY`). Also patches `console.log` globally so any `wss://` strings spit out by network errors or custom logs are masked as hashed signatures (e.g., `[sig-a7f3]`).

### 4.4 Analytics Integration (`analytics.ts`)

Enables custom reporting to a Google Apps Script macro to circumvent traditional ad-blocker analytic blocking.

- **Variable**: Configured via existence/modification of `ANALYTICS_SCRIPT_URL`.
- **Behavior**: Handles a queued buffer of system events (`FILE_SHARED`, `ADMIN_JOIN`, `ROOM_JOIN`), batching them into secure POST requests asynchronously.

### 4.5 Room Definitions (`rooms.ts`)

Lists the strictly verified room assignments.

- **Configuration**: Exposes specific exported arrays of acceptable computer lab numbers (e.g., `'203'`, `'304'`). If a lab is not in this array, the UI will reject routing related actions for it.
