# CosmoShare WhatsApp Bot

A WhatsApp bot that enables file sharing via the CosmoShare platform. Users send files to the bot through WhatsApp and receive share codes (OneShare / MultiShare) or deliver files directly to a lab computer (LabShare).

---

## Overview

The WA-Bot integrates directly with CosmoShare's signaling infrastructure:

1. **User sends files** to the bot via WhatsApp
2. **Bot connects to CosmoShare signaling workers** via WebSocket (same shards as the web app)
3. **Bot registers a 4-digit code** on the signaling Durable Object
4. **Recipient enters the code** on the CosmoShare web app → WebRTC data channel → files transfer directly

```
Phone (WhatsApp) ←→ Oracle Cloud VM (WA-Bot) ←→ Cloudflare Signaling DOs (WebSocket + WebRTC) ←→ CosmoShare Web App
```

### Share Modes

| Mode | Description | Code Validity |
|------|-------------|---------------|
| **OneShare** | Single-use code, files deleted after first download | 10 minutes |
| **MultiShare** | Reusable code, multiple downloads allowed | 5 minutes |
| **LabShare** | Send files directly to a lab computer room | Instant |

---

## Prerequisites

- **Node.js 18+** (20 LTS recommended)
- **A WhatsApp account** — a personal number dedicated for the bot
- **Oracle Cloud account** — for Always Free VM deployment
- **Cloudflare account** — for the bridge Worker

---

## Quick Start (Local Development — Windows 11)

> All commands in this section run in **Windows Command Prompt** or **PowerShell** on your local PC.

### Step 1: Install Dependencies

```bash
# Run in: Windows Command Prompt / PowerShell
cd WA-Bot
npm install
```

### Step 2: Configure Environment

```bash
# Run in: Windows Command Prompt / PowerShell
copy .env.example .env
```

Open `.env` in your editor and set:
- `BRIDGE_API_URL` — the Cloudflare Worker URL (deploy the bridge first, or leave as-is for offline testing)
- `BRIDGE_API_SECRET` — must match the secret in `wrangler.toml`
- `SIGNALING_URLS` — copy the value of `NEXT_PUBLIC_SIGNALING_URLS` from your CosmoShare web app's `.env`
- `SIGNALING_URLS_ONESHARE` — copy the value of `NEXT_PUBLIC_SIGNALING_URLS_ONESHARE` from your CosmoShare web app's `.env`

> **Important:** The signaling URLs must be identical to what the CosmoShare web app uses. The bot uses the same `djb2Hash` shard routing to connect to the correct signaling worker.

### Step 3: Start the Bot

```bash
# Run in: Windows Command Prompt / PowerShell
npm start
```

A **QR code** appears in the terminal. Open WhatsApp on your phone → **Settings → Linked Devices → Link a Device** → scan the QR code.

### Step 4: Test

From **another phone** (or WhatsApp Web on a different account), send **"Hi"** to the bot's WhatsApp number. You should get a welcome response.

---

### Local — WhatsApp Session Management

#### Restart the Bot (Without Re-scanning QR)

The session is saved in the `sessions/` folder. A normal restart preserves it:

```bash
# Run in: Windows Command Prompt / PowerShell
# Press Ctrl+C to stop the running bot, then:
npm start
```

The bot reconnects using the saved session — **no QR scan needed**.

> **When is QR re-scanning required?**
> - You manually deleted the `sessions/` folder
> - You unlinked the device from WhatsApp → Settings → Linked Devices
> - The session was inactive for ~14 days (WhatsApp auto-expires linked devices)
> - WhatsApp updated its web protocol and the session became invalid

#### Disconnect the Current WhatsApp Number

To unlink the currently paired WhatsApp number from the bot:

**Option A — From your phone (easiest):**
Open WhatsApp → **Settings → Linked Devices** → tap the linked device → **Log Out**

**Option B — From the bot terminal:**

```bash
# Run in: Windows Command Prompt / PowerShell
# 1. Stop the bot (Ctrl+C if running), then delete the session:
rmdir /s /q sessions\.wwebjs_auth

# 2. The next time you start the bot, the old number is fully disconnected.
```

#### Scan QR Code with a New Mobile Number

```bash
# Run in: Windows Command Prompt / PowerShell

# 1. Stop the bot (Ctrl+C if running)

# 2. Delete the old session
rmdir /s /q sessions\.wwebjs_auth

# 3. Start the bot — a fresh QR code appears
npm start

# 4. Scan the QR code with the NEW phone's WhatsApp
#    (WhatsApp → Settings → Linked Devices → Link a Device)
```

---

## Deploy Bridge Worker (Cloudflare)

The bridge Worker handles file storage and share-code generation. It runs on Cloudflare's free tier.

> All commands in this section run in **Windows Command Prompt** or **PowerShell** on your local PC.

### Step 1: Install Wrangler CLI

```bash
# Run in: Windows Command Prompt / PowerShell
npm install -g wrangler
```

### Step 2: Login to Cloudflare

```bash
# Run in: Windows Command Prompt / PowerShell
cd WA-Bot/worker-bridge
npx wrangler login
```

A browser window opens — authorize Wrangler.

### Step 3: Create KV Namespace

```bash
# Run in: Windows Command Prompt / PowerShell
npx wrangler kv namespace create FILE_STORE
```

This prints something like:

```
{ binding = "FILE_STORE", id = "abcd1234..." }
```

Copy the `id` value and update `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "FILE_STORE"
id = "abcd1234..."   # ← paste your ID here
```

### Step 4: Set the API Secret

```bash
# Run in: Windows Command Prompt / PowerShell
npx wrangler secret put BOT_API_SECRET
```

Enter a strong random string when prompted. This same value must be set as `BRIDGE_API_SECRET` in the bot's `.env`.

### Step 5: Deploy

```bash
# Run in: Windows Command Prompt / PowerShell
npx wrangler deploy
```

Note the output URL (e.g., `https://wa-bot-bridge.your-sub.workers.dev`). Add this to your bot's `.env` as `BRIDGE_API_URL`.

---

## Deploy to Oracle Cloud (Complete Beginner Guide)

### Phase 1: Create Oracle Cloud Account

*(These steps are done in your web browser — no terminal needed)*

1. Go to [https://cloud.oracle.com](https://cloud.oracle.com) and click **"Sign Up"**
2. Fill in your details — a credit card is required for verification but you will **NOT** be charged for Always Free resources
3. Choose your **Home Region** (select the closest to you, e.g., "India South (Hyderabad)" or "India West (Mumbai)")
4. Complete verification and wait for account provisioning (5–15 minutes)

### Phase 2: Generate SSH Key

```powershell
# Run in: Windows PowerShell (on your local PC)
ssh-keygen -t ed25519 -f $env:USERPROFILE\.ssh\oracle-vm-key
```

This creates two files:
- `oracle-vm-key` — private key (**keep this safe!**)
- `oracle-vm-key.pub` — public key (you'll upload this to Oracle Cloud)

### Phase 3: Create the VM Instance

*(These steps are done in the Oracle Cloud Console in your web browser)*

1. Go to **Oracle Cloud Console** → Hamburger menu → **Compute → Instances**
2. Click **"Create Instance"**
3. **Name**: `wa-bot`
4. **Placement**: Leave default
5. **Image**: Click "Change Image" → Select **Oracle Linux 8** (or Ubuntu 22.04)
6. **Shape**: Click "Change Shape"
   - Select **"Ampere"** (ARM-based)
   - Shape: `VM.Standard.A1.Flex`
   - OCPUs: **1**
   - Memory: **6 GB**
7. **Networking**:
   - Click "Create new virtual cloud network" (if first VM)
   - ✅ Check **"Assign a public IPv4 address"**
8. **SSH Key**: Select "Paste SSH keys" and paste the contents of `oracle-vm-key.pub`

   To copy the public key to your clipboard:
   ```powershell
   # Run in: Windows PowerShell (on your local PC)
   Get-Content $env:USERPROFILE\.ssh\oracle-vm-key.pub | Set-Clipboard
   ```

9. **Boot Volume**: Leave default (47 GB)
10. Click **"Create"**
11. Wait for status to show **"RUNNING"** — note the **Public IP Address**

### Phase 4: Open Firewall Port (Optional — for health check)

*(Steps 1–3 are done in the Oracle Cloud Console in your browser)*

1. Go to your instance → **Attached VNICs** → **Subnet**
2. Click the **Security List**
3. **Add Ingress Rule**:
   - Source CIDR: `0.0.0.0/0`
   - Destination Port: `3001`
   - Protocol: TCP

4. Then SSH into the VM and open the port in the OS firewall:

```bash
# Run in: Oracle Cloud VM terminal (after SSHing in — see Phase 5)
sudo firewall-cmd --permanent --add-port=3001/tcp
sudo firewall-cmd --reload
```

### Phase 5: Connect to VM & Deploy

**Step 1 — SSH into the VM from your local PC:**

```powershell
# Run in: Windows PowerShell (on your local PC)
ssh -i $env:USERPROFILE\.ssh\oracle-vm-key opc@<PUBLIC_IP>
```

> Use `ubuntu@<PUBLIC_IP>` instead of `opc@` if you chose Ubuntu as the image.

**Step 2 — Upload the setup script from your local PC to the VM:**

```powershell
# Run in: Windows PowerShell (on your local PC — in a SEPARATE window)
scp -i $env:USERPROFILE\.ssh\oracle-vm-key .\WA-Bot\scripts\setup-oracle-vm.sh opc@<PUBLIC_IP>:~/
```

**Step 3 — Run the setup script on the VM:**

```bash
# Run in: Oracle Cloud VM terminal
bash ~/setup-oracle-vm.sh
```

This installs Node.js 20, Chromium dependencies, and PM2.

**Step 4 — Copy project files to the VM:**

Option A — SCP from your local PC:

```powershell
# Run in: Windows PowerShell (on your local PC)
scp -i $env:USERPROFILE\.ssh\oracle-vm-key -r .\WA-Bot\ opc@<PUBLIC_IP>:~/wa-bot/
```

Option B — Git clone on the VM:

```bash
# Run in: Oracle Cloud VM terminal
git clone <your-repo-url>
cp -r CosmoShare/WA-Bot ~/wa-bot
```

**Step 5 — Install dependencies on the VM:**

```bash
# Run in: Oracle Cloud VM terminal
cd ~/wa-bot
npm install
```

**Step 6 — Configure environment on the VM:**

```bash
# Run in: Oracle Cloud VM terminal
cp .env.example .env
nano .env
# Set BRIDGE_API_URL and BRIDGE_API_SECRET, then save (Ctrl+O, Enter, Ctrl+X)
```

**Step 7 — Start the bot with PM2:**

```bash
# Run in: Oracle Cloud VM terminal
pm2 start ecosystem.config.js --env production
```

**Step 8 — View the QR code and scan it:**

```bash
# Run in: Oracle Cloud VM terminal
pm2 logs wa-bot
```

A QR code appears in the logs. Scan it with your phone (WhatsApp → Settings → Linked Devices → Link a Device).

**Step 9 — Save PM2 config (auto-start on VM reboot):**

```bash
# Run in: Oracle Cloud VM terminal
pm2 save
```

### Phase 6: Verify

```bash
# Run in: Oracle Cloud VM terminal

# Check if bot process is running
pm2 status

# View recent logs
pm2 logs wa-bot --lines 50

# Health check
curl http://localhost:3001/health
```

Send **"Hi"** to the bot's WhatsApp number — you should get a response!

---

## Production Operations

> All commands in this section run on the **Oracle Cloud VM terminal** (SSH in first).

### Common Commands

```bash
# Run in: Oracle Cloud VM terminal
pm2 status           # Check if bot is running
pm2 logs wa-bot      # View live logs
pm2 restart wa-bot   # Restart bot (session preserved — no QR scan needed)
pm2 stop wa-bot      # Stop bot
pm2 delete wa-bot    # Remove from PM2
```

### Restart the Bot (Without Re-scanning QR)

The WhatsApp session is saved in the `sessions/` folder on the VM. A restart preserves it:

```bash
# Run in: Oracle Cloud VM terminal
pm2 restart wa-bot
```

The bot reconnects using the saved session — **no QR scan needed**.

> **When is QR re-scanning required?**
> - You manually deleted the `sessions/` folder on the VM
> - You unlinked the device from WhatsApp → Settings → Linked Devices on your phone
> - The session was inactive for ~14 days (WhatsApp auto-expires linked devices)
> - WhatsApp updated its web protocol and the session became invalid
> - A persistent auth error that auto-reconnection cannot resolve (rare)

### Disconnect the Current WhatsApp Number

To unlink the currently paired WhatsApp number from the bot:

**Option A — From your phone (easiest):**
Open WhatsApp → **Settings → Linked Devices** → tap the linked device → **Log Out**

**Option B — From the VM terminal:**

```bash
# Run in: Oracle Cloud VM terminal
pm2 stop wa-bot
rm -rf sessions/.wwebjs_auth
# The old number is now fully disconnected.
# The next start will show a fresh QR code.
```

### Scan QR Code with a New Mobile Number

```bash
# Run in: Oracle Cloud VM terminal

# 1. Stop the bot
pm2 stop wa-bot

# 2. Delete the old session
rm -rf sessions/.wwebjs_auth

# 3. Start the bot — a fresh QR code appears in logs
pm2 start ecosystem.config.js --env production

# 4. View the QR code
pm2 logs wa-bot

# 5. Scan with the NEW phone's WhatsApp
#    (WhatsApp → Settings → Linked Devices → Link a Device)

# 6. Save the new config
pm2 save
```

### Re-authenticate WhatsApp (After Auth Failure)

If the bot keeps showing auth errors and auto-reconnection fails:

```bash
# Run in: Oracle Cloud VM terminal
pm2 stop wa-bot
rm -rf sessions/.wwebjs_auth    # Clear corrupted session
pm2 start ecosystem.config.js --env production
pm2 logs wa-bot                 # Scan the new QR code
pm2 save
```

### Update the Bot

```bash
# Run in: Oracle Cloud VM terminal
cd ~/wa-bot
git pull              # or re-upload files via SCP from Windows
npm install
pm2 restart wa-bot    # Session preserved — no QR scan needed
```

### Monitor Resources

```bash
# Run in: Oracle Cloud VM terminal
pm2 monit             # Real-time CPU/memory monitoring
free -h               # Check memory usage
df -h                 # Check disk usage
```

---

## Architecture

```
┌──────────────┐       ┌─────────────────────┐       ┌──────────────────────┐
│              │       │  Oracle Cloud VM     │       │  Cloudflare Worker   │
│  WhatsApp    │◄─────►│  (WA-Bot)            │◄─────►│  (Bridge)            │
│  Phone       │  WA   │                     │ HTTPS │                      │
│              │  API  │  • whatsapp-web.js   │       │  • File upload → KV  │
└──────────────┘       │  • Node.js 20        │       │  • Share code gen    │
                       │  • PM2 managed       │       │  • OneShare / Multi  │
                       │  • Health server     │       │  • LabShare routing  │
                       └─────────────────────┘       └──────────┬───────────┘
                                                                │
                                                     ┌──────────▼───────────┐
                                                     │  CosmoShare Web App  │
                                                     │  (Enter code to      │
                                                     │   download files)    │
                                                     └──────────────────────┘
```

### Key Components

| Component | Technology | Hosting |
|-----------|-----------|---------|
| WA-Bot | Node.js + whatsapp-web.js | Oracle Cloud Always Free VM |
| Bridge Worker | Cloudflare Worker + KV | Cloudflare Free Tier |
| Web App | CosmoShare frontend | Cloudflare Pages |

---

## Troubleshooting

### QR Code Not Showing

- Check logs: `pm2 logs wa-bot`
- Ensure Chromium is installed: `chromium --version` or `chromium-browser --version`
- Clear old session: `rm -rf sessions/.wwebjs_auth`

### Bot Not Responding

- Check status: `pm2 status`
- Check errors: `pm2 logs wa-bot --err --lines 100`
- Restart: `pm2 restart wa-bot`

### Memory Issues

- Check usage: `free -h`
- PM2 auto-restarts if memory exceeds 500 MB (configured in `ecosystem.config.js`)
- Chromium args `--disable-gpu --single-process` are already configured to reduce memory

### Oracle Cloud VM Issues

- **Cannot SSH**: Check Security List ingress rules for port 22
- **VM not starting**: Ensure you're within Always Free limits (1 OCPU, 6 GB RAM)
- **Slow boot**: ARM VMs may take a minute to fully boot after creation

### Bridge Worker Issues

- **401 Unauthorized**: `BRIDGE_API_SECRET` in `.env` must match `BOT_API_SECRET` in the Worker
- **KV errors**: Make sure you created the KV namespace and updated the ID in `wrangler.toml`
- **Deploy fails**: Run `npx wrangler whoami` to verify authentication

---

## Project Structure

```
WA-Bot/
├── package.json              # Dependencies & scripts
├── ecosystem.config.js       # PM2 process manager config
├── .env.example              # Environment template
├── .gitignore
├── README.md
├── src/                      # Bot application code
│   └── index.js              # Entry point
├── worker-bridge/            # Cloudflare Worker bridge
│   ├── package.json
│   ├── wrangler.toml
│   └── src/
│       └── index.ts          # Worker source
├── scripts/
│   └── setup-oracle-vm.sh    # VM provisioning script
├── sessions/                 # WhatsApp session data (gitignored)
├── temp/                     # Temporary file storage (gitignored)
└── logs/                     # PM2 & app logs (gitignored)
```

---

## License

Part of the CosmoShare project. See the root repository for license details.
