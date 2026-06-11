# 🚀 CosmoShare WA-BOT — Hugging Face Spaces Deployment Guide

This folder contains a fully containerized version of the **CosmoShare WhatsApp Bot (WA-BOT)**, optimized specifically for deploying on **Hugging Face Spaces**. It features a password-protected admin dashboard, simple browser-based QR code scanning, native/git-based persistence, auto-reconnection, and email alert notifications.

---

## 📋 Table of Contents
1. [Core Features](#-core-features)
2. [Environment Variables Reference](#-environment-variables-reference)
3. [Local Setup & Testing Guide](#-local-setup--testing-guide)
4. [Hugging Face Spaces Deployment Guide](#-hugging-face-spaces-deployment-guide)
5. [Uptime & Keep-Alive setup (24/7 Bot Uptime)](#-uptime--keep-alive-setup-247-bot-uptime)
6. [Managing the Bot (Admin Dashboard)](#-managing-the-bot-admin-dashboard)

---

## ✨ Core Features

* **Browser QR Scanning**: View and scan the WhatsApp Web link QR code directly from your web browser (no terminal access needed).
* **Persistent Sessions**: Supports two methods of session persistence:
  * **Paid volume mount**: If using Hugging Face paid storage, data is automatically written to `/data`.
  * **Free Git Dataset Backup (100% Free)**: Automatically downloads and backup session keys to a private Hugging Face Dataset in the background.
* **Email Alerts**: Automatic alerts sent via SMTP if the bot requires a scan, goes offline, or crashes.
* **Health Check**: Native HTTP endpoint on `/health` for easy uptime monitoring.

---

## 🔑 Environment Variables Reference

Configure these parameters under **Repository Secrets** in Hugging Face (or in a local `.env` file).

### 1. General Settings
| Variable | Description | Default | Where to Obtain |
|---|---|---|---|
| `ADMIN_PASSWORD` | Password to access the Admin Web Dashboard and scan QR code. | `admin123` | **Create your own secure password.** |
| `LOG_LEVEL` | Level of console logging (`debug`, `info`, `warn`, `error`). | `info` | Leave as `info` unless debugging. |
| `VALID_ROOMS` | Comma-separated list of valid lab room numbers. | List of 18 rooms | Custom list matching your database. |

### 2. CosmoShare Integration Secrets
| Variable | Description | Where to Obtain |
|---|---|---|
| `BRIDGE_API_URL` | The API Endpoint of your CosmoShare server. | URL of your CosmoShare Bridge Server (e.g. `https://api.cosmoshare.live`). |
| `BRIDGE_API_SECRET` | Secret key for authorizing bot-to-bridge communications. | Set in your CosmoShare database or server config. |
| `SIGNALING_URLS` | Comma-separated list of WebRTC signaling server URLs. | The signaling WebSocket URLs for your CosmoShare workers. |

### 3. Persistent Storage Secrets (Optional: for Free Session Persistence)
| Variable | Description | Where to Obtain |
|---|---|---|
| `HF_DATASET` | Hugging Face Dataset identifier where session data is saved. | Create a **Private Dataset** on Hugging Face (e.g. `username/cosmoshare-sessions-backup`). |
| `HF_TOKEN` | Hugging Face write-access API token. | Hugging Face settings -> **Access Tokens** -> **Create New Token (Role: Write)**. |

### 4. SMTP Email Alerts Secrets (Optional)
| Variable | Description | Where to Obtain |
|---|---|---|
| `SMTP_HOST` | Host address of your SMTP mail server. | E.g. `smtp.gmail.com` (Gmail), `smtp.sendgrid.net` (SendGrid), etc. |
| `SMTP_PORT` | Port number of your SMTP mail server. | E.g. `587` (TLS), `465` (SSL). |
| `SMTP_USER` | Username/email address for SMTP authentication. | Your email account address (e.g. `your-email@gmail.com`). |
| `SMTP_PASS` | Password or App Password for SMTP authentication. | **Gmail**: Google Account -> Security -> App Passwords (do not use regular password). |
| `ALERT_EMAIL` | Recipient email address where alerts will be sent. | **Your personal email address.** |

---

## 💻 Local Setup & Testing Guide

Before deploying, you can test the bot and admin dashboard on your local machine:

1. **Install Prerequisites**: Ensure you have [Node.js (18 or newer)](https://nodejs.org/) installed.
2. **Open Terminal**: Navigate to this directory:
   ```bash
   cd WA-BOT_huggingface
   ```
3. **Install Dependencies**:
   ```bash
   npm install
   ```
4. **Configure Environment**: Copy `.env.example` to `.env` and fill in the values:
   ```bash
   cp .env.example .env
   ```
   *For local test, set `ADMIN_PASSWORD=admin123` and leave SMTP / Hugging Face details empty.*
5. **Run the Bot**:
   ```bash
   npm start
   ```
6. **Open Dashboard**:
   * Open your browser and navigate to: `http://localhost:7860`
   * Enter the password (`admin123`).
   * Scan the QR code shown on the screen using your phone's WhatsApp -> **Linked Devices** -> **Link a Device**.
   * Once scanned, status will change to `CONNECTED` and you can start chatting with your bot!

---

## 🤗 Hugging Face Spaces Deployment Guide

Deploying the bot to Hugging Face takes only a few clicks:

### Step 1: Create a Private Dataset (Highly Recommended)
*If you are paying for Hugging Face Persistent Storage, skip this step.*
1. Go to [Hugging Face](https://huggingface.co/) and log in.
2. Click your profile picture -> **New Dataset**.
3. Name it (e.g. `cosmoshare-bot-session`).
4. **Set Visibility to Private** (Crucial: to protect your WhatsApp credentials!).
5. Click **Create Dataset**.

### Step 2: Create a Hugging Face Access Token
1. Go to your Hugging Face **Settings** -> **Access Tokens**.
2. Click **Create New Token**.
3. Name: `wa-bot-sync`.
4. Role: **Write**.
5. Copy the generated token (`hf_...`).

### Step 3: Create the Space
1. Go to [Hugging Face Spaces](https://huggingface.co/spaces) -> **New Space**.
2. Name your Space (e.g. `cosmoshare-wa-bot`).
3. Select **Docker** as the SDK.
4. Select **Blank** template.
5. Set Space License to **MIT**.
6. Set Space Visibility:
   * **Public**: The dashboard URL can be accessed by anyone, but it is protected by the `ADMIN_PASSWORD` you set in secrets.
   * **Private (Recommended)**: The Space is only visible to you. The Admin Dashboard is fully accessible to you when you are logged into your Hugging Face account and viewing the Space directly on Hugging Face.
7. Under hardware, choose the Free CPU basic instance (16GB RAM / 2 vCPUs).
8. Click **Create Space**.

### Step 4: Configure Repository Secrets
1. In your newly created Space, go to the **Settings** tab.
2. Scroll down to **Variables and secrets** -> **New Secret**.
3. Add the following Secrets (refer to the [Environment Variables Reference](#-environment-variables-reference)):
   * `ADMIN_PASSWORD` (Your dashboard access password)
   * `BRIDGE_API_URL`
   * `BRIDGE_API_SECRET`
   * `SIGNALING_URLS`
   * `HF_DATASET` (e.g., `username/cosmoshare-bot-session` if using Dataset persistence)
   * `HF_TOKEN` (The Write token copied in Step 2)
   * `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `ALERT_EMAIL` (If you want email alerts)

### Step 5: Upload Files & Deploy
You can deploy the bot using either of the following two methods:

#### Method A: Using Git Command Line (Recommended)
1. **Clone your Space repository**: Open your terminal/command prompt, navigate to a folder where you want to clone the repo, and run:
   ```bash
   git clone https://huggingface.co/spaces/YOUR_USERNAME/YOUR_SPACE_NAME
   ```
   *(This creates a folder named after your Space on your computer)*
2. **Copy the bot files**: 
   You can copy the files manually using your file explorer, or run one of the following commands from your terminal inside the `WA-BOT_huggingface` directory to copy them directly:
   
   * **Windows PowerShell**:
     ```powershell
     Copy-Item -Path "src", "Dockerfile", "package.json", "package-lock.json", ".gitignore" -Destination "../YOUR_SPACE_NAME" -Recurse -Force
     ```
   * **Linux / macOS / Git Bash**:
     ```bash
     cp -r src Dockerfile package.json package-lock.json .gitignore ../YOUR_SPACE_NAME/
     ```
   *(Note: This copies only the clean, essential source code and configurations. It automatically excludes `node_modules/`, `sessions/`, or `temp/` folders if they exist, which keeps the deployment repository clean and fast to upload.)*
3. **Commit and push the files**: In your terminal, navigate inside your cloned Space folder and run:
   ```bash
   git add .
   git commit -m "Deploy WhatsApp Bot"
   git push origin main
   ```
   *(If prompted, enter your Hugging Face username and your Hugging Face Access Token as the password)*

#### Method B: Direct Drag-and-Drop Web Upload (Easiest)
1. Open your Space page on the Hugging Face website.
2. Click on the **Files** tab at the top.
3. Click the **Add file** button -> **Upload files**.
4. Drag and drop the following files and folders from the `WA-BOT_huggingface` folder on your computer:
   - The `src` folder
   - `Dockerfile`
   - `package.json`
   - `package-lock.json`
   - `.gitignore`
5. Scroll down to the bottom, type a commit message (e.g., "Deploy bot files"), and click **Commit changes to main**.

Hugging Face will automatically detect the uploaded `Dockerfile`, build the container, install the Node.js/Chromium environment, and start the bot dashboard!

---

## ⏰ Uptime & Keep-Alive Setup (24/7 Bot Uptime)

Hugging Face Free Spaces automatically spin down (go to sleep) if they do not receive incoming web requests for 48 hours. To keep your bot running 24/7, you must set up an external ping service depending on whether your Space is Public or Private:

### Option A: For Public Spaces (UptimeRobot or cron-job.org)
If your Space visibility is **Public**, you can use **UptimeRobot** (or cron-job.org) to ping your space:
1. Go to [UptimeRobot](https://uptimerobot.com/) and create a free account.
2. Click **Add New Monitor**.
3. Monitor Type: **HTTPS**.
4. Friendly Name: `CosmoShare WA-BOT`.
5. URL: `https://YOUR_HF_USERNAME-YOUR_SPACE_NAME.hf.space/health`
   *(Note: replace YOUR_HF_USERNAME and YOUR_SPACE_NAME. Hugging Face converts "/" in your Space path to "-")*
6. Monitoring Interval: **Every 5 minutes**.
7. Click **Create Monitor**.

---

### Option B: For Private Spaces (cron-job.org - Required)
If your Space is **Private**, anonymous pings will be blocked with an unauthorized redirect, and UptimeRobot will fail to keep the Space awake. You **must** use **cron-job.org** which allows sending custom authentication headers:

1. Obtain a Hugging Face **Read** (or Write) Token (from Settings -> Access Tokens).
2. Go to [cron-job.org](https://cron-job.org/) and create a free account.
3. In the sidebar, click **Cronjobs** -> **Create Cronjob**.
4. Title: `CosmoShare WA-BOT Keep-Alive`.
5. Address (URL): `https://YOUR_HF_USERNAME-YOUR_SPACE_NAME.hf.space/health`
   *(Replace YOUR_HF_USERNAME and YOUR_SPACE_NAME. Hugging Face converts "/" to "-")*
6. Schedule: **Every 5 minutes** (or click "Custom" and set `*/5 * * * *`).
7. Scroll down to **Request Headers** and click **Add Header**:
   * **Key**: `Authorization`
   * **Value**: `Bearer YOUR_HF_ACCESS_TOKEN` *(Replace with your actual token starting with hf_)*
8. Click **Create**.

Cron-job.org will now authenticate using your token to bypass the private Space shield and ping `/health` successfully, keeping your private Space active 24/7!

---

## 🛠️ Managing the Bot (Admin Dashboard)

Once deployed, open your Space page (directly or embedded in Hugging Face).

1. **Dashboard Login**: Enter your configured `ADMIN_PASSWORD`.
2. **Initial Scan**: If the status is `AWAITING_SCAN`, scan the QR code displayed on the screen using WhatsApp on your phone (Linked Devices -> Link a Device).
3. **Bot Status**:
   * **Operational Status**: Shows **Running** (active) or **Paused** (halted). When paused, the bot ignores all incoming messages and blocks sending replies.
   - **Connection State**: Shows `CONNECTED` (active), `AWAITING_SCAN` (needs scan), `AUTHENTICATED`, or `DISCONNECTED` (reconnecting).
4. **Temporary Pause & Resume Controls**:
   * **Pause Until a Specific Date & Time**: Enter a date & time in Indian Standard Time (IST). The system will automatically resume processing when the time is reached, and email you an alert.
   * **Manual Indefinite Pause**: Pause the bot indefinitely until you manually click "Resume".
   * **Manual Resume**: Click "Resume Bot Operations" to immediately reactivate the bot.
5. **Bot Control Actions**:
   * **Restart Client**: Reinitializes the WhatsApp Web engine without restarting the container (useful if connections lag).
   * **Force Log Out (Reset)**: Deletes all session keys locally and remotely on the HF dataset, logging out the bot and generating a new QR code.
   * **Event Logs**: Displays the last 50 lines of logs dynamically. Use the refresh button to update.
