# Root Cause Investigation: Transfer Failures on Deployed HF Space

> **Investigation status:** Verified directly against the live Space
> `isk2005/cosmoshare-wa-bot` and the dataset `isk2005/cosmoshare-bot-session`
> using the Hugging Face MCP. All file/line references below were confirmed by
> comparing the **deployed** files (cloned from the Space repo) against the
> **local** working copy.

## Investigation Method

1. ✅ Verified HF Space is running (currently `/health` → `connectedToWhatsApp: true`,
   `uptime: 52852s` — healthy *right now*, confirming the issues are **intermittent**
   and that live logs alone cannot rule them out).
2. ✅ Cloned the deployed Space repo and ran **normalized (CRLF-stripped) diffs**
   against local — found a real deployment drift.
3. ✅ Confirmed which files are identical deployed↔local and which differ.
4. ✅ Traced every error in the recorded logs to specific lines of source code.
5. ✅ Verified the web portal's fallback logic in `src/lib/signalingRouter.ts`.
6. ✅ Verified the signaling worker's Durable Object overload handling.
7. ✅ Confirmed the precise HF Hub HTTP commit endpoint from the official OpenAPI spec.

---

## Deployment Drift (verified)

| File | Deployed vs Local | Notes |
|---|---|---|
| `src/index.js` | **Identical** (normalized diff = 0) | — |
| `src/client.js` | **Identical** | — |
| `src/services/signalingClient.js` | **Identical** | — |
| `src/services/storageService.js` | **DIFFERS** | Deployed (247 lines) has a `filter` fn excluding Chromium lock/cache files + `stderr` logging that local (221 lines) lacks. **⚠️ The deployed "improvement" is itself broken — see Gap A under Root Cause #3.** |

> The original plan claimed deployment drift across multiple files. That is
> **inaccurate** — only `storageService.js` differs. This matters because it
> changes the fix scope: the other files need no "sync".

---

## Timeline Analysis (from the recorded logs)

```
10:55:53  Bot startup complete
10:56:33  WhatsApp authentication successful (×4 — multiple event listeners)
10:56:35  Bot is ready, status → CONNECTED
10:56:37  Session backup fails: "git push --force" error        ← Root Cause #3
10:57:00  Message filtering working (test numbers correctly handled)
10:57:53  SMTP email timeout (non-critical)                     ← Root Cause #4 (NEW)
11:02:03  ⚡ "auth timeout" UNHANDLED REJECTION ← EVERYTHING BREAKS HERE  ← Root Cause #1
11:18:14  getChat error on sendMessage ← Puppeteer page is DEAD
11:19:32  getChat error on API share ← All Portal→WhatsApp transfers broken
12:27:08  getChat error (from my diagnostic probe)
21:42:45  Signaling WS timeout ← WhatsApp→Portal LabShare broken           ← Root Cause #2
```

---

## Root Cause #1: Puppeteer Page Death After Auth Timeout (Portal → WhatsApp BROKEN)

> [!CAUTION]
> The `auth timeout` rejection kills the Puppeteer page's execution context,
> but the bot has no way to know it's dead, so it sits in a **zombie state**.

### What happens

1. At startup, `whatsapp-web.js` launches Chromium and loads WhatsApp Web.
2. `client.on('authenticated')` fires → `client.info` is populated (cached).
3. `client.on('ready')` fires → `global.botStatus = 'CONNECTED'` (`client.js:67`).
4. ~6 minutes later an **unhandled `auth timeout` rejection** occurs internally.
5. This corrupts the Puppeteer page's execution context — the WhatsApp Web JS
   environment inside the browser tab becomes invalid.

### Why the health check lies

The [health endpoint](file:///d:/CosmoShare/CosmoShare/WA-BOT_huggingface/src/index.js#L697-L712)
checks:
```javascript
connectedToWhatsApp: !!(info && info.wid),  // Line 704 — `client.info` is CACHED
botStatus: global.botStatus,                 // Line 705 — set once in 'ready', never cleared
```
Both persist after the page dies, so `/health` keeps reporting
`connectedToWhatsApp: true, botStatus: CONNECTED` even when every operation fails.

### Why sendMessage fails

Every `client.sendMessage()` runs `pupPage.evaluate(...)` inside the Chromium tab.
After the auth timeout corrupts the context, `getChat(chatId)` returns `undefined`:

```
TypeError: Cannot read properties of undefined (reading 'getChat')
    at evaluate (evaluate at Client.sendMessage (Client.js:1533:44))
```

### Why there's no recovery

The [unhandledRejection handler](file:///d:/CosmoShare/CosmoShare/WA-BOT_huggingface/src/index.js#L1028-L1030)
only logs:
```javascript
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', { reason: ... });
  // ← No recovery action taken!
});
```
The [disconnected handler](file:///d:/CosmoShare/CosmoShare/WA-BOT_huggingface/src/client.js#L102-L129)
has reconnect logic, but `auth timeout` **does NOT trigger `disconnected`** — it's
an unhandled promise rejection, not a clean disconnect. So nothing recovers.

---

## Root Cause #2: Signaling WebSocket Connection Failures (WhatsApp → Portal LabShare BROKEN)

> [!WARNING]
> LabShare/OneShare creation fails because the bot connects to exactly ONE
> signaling shard with **no fallback**, while the web portal tries all shards.

From the logs:
```
19:53:12 [error] Signaling WS error {"url":"wss://signal5.it-inayat2005-bce.workers.dev/ws",
                "error":"WebSocket was closed before the connection was established"}
19:53:12 [error] OneShare creation failed {"userId":"...@lid","error":"WebSocket connection timeout (15s)"}
```

### The problem

The bot's [SignalingClient.connect()](file:///d:/CosmoShare/CosmoShare/WA-BOT_huggingface/src/services/signalingClient.js#L74-L124)
has a 15s timeout and `connectForOneShare`/`connectForLabShare` (lines 204-221)
try **only the primary shard**:
```javascript
async function connectForOneShare(code) {
  const url = getOneShareUrl(code);             // single primary URL
  const client = new SignalingClient(url);
  await client.connect();                        // no retry, no fallback
  return client;
}
```

### Confirmed: the web portal DOES have fallback

The web portal's [getLabSignalingUrls()](file:///d:/CosmoShare/CosmoShare/src/lib/signalingRouter.ts#L84-L96)
and [getOneShareSignalingUrls()](file:///d:/CosmoShare/CosmoShare/src/lib/signalingRouter.ts#L144-L155)
return **all shards in ring order**:
```typescript
const primary = djb2Hash(roomNumber) % urls.length;
for (let i = 0; i < urls.length; i++) {
  const idx = (primary + i) % urls.length;      // ring fallback
  ...
}
```

### Confirmed: the failure mode is real

The [signaling worker](file:///d:/CosmoShare/CosmoShare/workers/signaling/src/index.ts#L39-L54)
returns **HTTP 503 `worker-overloaded`** when a Durable Object hits the Cloudflare
free-tier duration limit. That 503 surfaces on the client as
`"WebSocket was closed before the connection was established"`.

| Feature | Web Portal | WA-Bot |
|---|---|---|
| Primary shard selection | `djb2Hash % N` | `djb2Hash % N` ✅ |
| Shard fallback | Ring order (all N shards) | ❌ None |
| Reconnect on failure | Yes | ❌ No |

> Convergence note: when the bot falls back to shard *k*, the web receiver —
> which also iterates the same ring via `getOneShareSignalingUrls` — will reach
> shard *k* too. So fallback is safe **as long as both sides iterate**.

---

## Root Cause #3: Session Backup Failure (Data Loss Risk)

> [!WARNING]
> `git push --force` fails, so WhatsApp auth credentials may not survive
> container restarts. The `.wwebjs_auth` folder is NOT reliably backed up.

```
19:40:24 [error] Failed to backup session to Hugging Face Dataset
  {"error":"Command failed: git push -4 --force origin main","stderr":""}
```

### Investigation Findings

1. **The HF Dataset is reachable** — last modified `2026-06-27T19:32:21`,
   contains `README.md`, `names.json`, `state.json` but **no `.wwebjs_auth`**.

2. **Race condition at startup** — the backup fires in the `ready` handler
   (`client.js:76`), ~2s after Chromium starts. Lock files
   (`SingletonLock`, `SingletonSocket`, `DevToolsActivePort`) are held live,
   making `fs.cpSync` inconsistent and the subsequent `git push` fail.

3. **The orphan-push approach is fragile** — `git init → git add . → git push --force`
   re-uploads the entire `.wwebjs_auth` (50–100 MB of Chromium profile data,
   LevelDB, IndexedDB, Local Storage) on every push. Slow and likely to exceed
   HF dataset limits without LFS.

4. **The `-4` (IPv4-only) flag** — HF's git endpoints can have intermittent
   IPv4 connectivity issues in Docker. The empty `stderr` (see Gap A) hides
   the true reason.

### ⚠️ Gap A (NEW — the plan missed this): the "improved" stderr capture is non-functional

The deployed `storageService.js` added a `stderr` field to the error log, but
it runs every `git` command with:
```javascript
const opts = { cwd: GIT_TEMP_DIR, stdio: 'ignore' };   // line 251 — DISCARDS stderr
```
`stdio: 'ignore'` pipes stderr to `/dev/null`, so `err.stderr` is **always
empty**. That is exactly why the recorded log shows `"stderr":""`. The
"improvement" looks correct on the surface but does not work. **Any fix must
remove `stdio: 'ignore'` (or use `stdio: 'pipe'`) or the real error stays
invisible.**

---

## Root Cause #4 (NEW): Email Alerts Never Sent — HF Spaces blocks SMTP

> [!IMPORTANT]
> The original plan dismissed the email timeout as "non-critical" and
> **provided no fix**. It is a real, separate root cause with a platform-level
> explanation.

From the logs:
```
19:36:38 [error] Failed to send alert email {"subject":"WhatsApp Bot Scan Required","error":"Connection timeout"}
```

### The real root cause (verified)

`emailService.js` uses `nodemailer` over SMTP port **587** (`config.js:47`,
`emailService.js:29`). **Hugging Face Spaces blocks all outbound network traffic
except ports 80, 443, and 8080.** Port 587 (SMTP) is unreachable from inside the
container, so `sendMail()` hangs until nodemailer's socket timeout fires →
`"Connection timeout"`.

This is a **hard platform constraint**. No change to `emailService.js` retry
logic, timeout values, or `family: 4` will fix it — the packets are dropped at
the egress firewall.

> This means **every** alert (`sendQrScanAlert`, `sendOfflineAlert`,
> `sendCrashAlert`, `sendPauseAlert`, `sendResumeAlert`) silently fails. That
> compounds Root Cause #1: when the bot goes into the zombie state, the admin
> gets **no** notification email either.

### Fix

Switch alerting to an **HTTPS-based (port 443)** channel so it is reachable from
the Space. Options, in order of recommendation:
1. **Email-over-HTTPS relay** — keep the Gmail account, but send via a Cloudflare
   Worker (or Resend / Postmark / SendGrid) **HTTP API** on port 443. Resend's
   free tier is the simplest drop-in (one `fetch` call). This restores true
   email delivery.
2. **Push notification webhook** — `ntfy.sh`, a Discord/Slack/Telegram webhook
   (all HTTPS). Lowest-effort, no account needed for ntfy.

In all cases `nodemailer` over 587 should be removed or disabled when running
inside the Space, since it will only ever time out.

---

## Proposed Fixes

### Fix 1: Puppeteer Page Liveness Detection + Auto-Recovery

#### [MODIFY] [client.js](file:///d:/CosmoShare/CosmoShare/WA-BOT_huggingface/src/client.js)

Add a `change_state` listener to catch auth-state transitions that
`whatsapp-web.js` does **not** surface as `disconnected`:

```javascript
client.on('change_state', (state) => {
  logger.info('WhatsApp state changed', { state });
  if (state === 'UNPAIRED' || state === 'TIMEOUT' || state === 'CONFLICT') {
    logger.warn('WhatsApp session lost, triggering reconnect...');
    global.botStatus = 'DISCONNECTED';
    client.emit('disconnected', `state_change:${state}`); // reuses existing reconnect
  }
});
```

> ⚠️ Note: manually emitting `disconnected` reuses the existing reconnect logic
> **and** the existing `sendOfflineAlert` call inside that handler — that is
> desirable. Guard against double-firing if a periodic probe (below) also fires.

#### [MODIFY] [index.js](file:///d:/CosmoShare/CosmoShare/WA-BOT_huggingface/src/index.js)

1. **Health check should do a real liveness probe**, not read cached `client.info`:
```javascript
app.get('/health', async (req, res) => {
  const info = client.info;
  let isAlive = false;
  if (info && info.wid) {
    try {
      await client.pupPage.evaluate(() => true);   // actually probes the page
      isAlive = true;
    } catch {
      isAlive = false;                              // page context is dead
    }
  }
  res.json({
    ...
    connectedToWhatsApp: isAlive,
    botStatus: global.botStatus,
    ...
  });
});
```

2. **Periodic liveness probe** (every 60s) that detects page death and recovers:
```javascript
setInterval(async () => {
  if (global.botStatus !== 'CONNECTED') return;
  try {
    await client.pupPage.evaluate(() => true);
  } catch (err) {
    logger.error('Puppeteer page is dead, triggering recovery...', { error: err.message });
    global.botStatus = 'DISCONNECTED';
    client.emit('disconnected', 'puppeteer_page_dead');
  }
}, 60000);
```

3. **Make `unhandledRejection` actionable** for auth-related reasons:
```javascript
process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  logger.error('Unhandled rejection', { reason: msg });

  if (/auth|timeout|UNPAIRED/i.test(msg) && global.botStatus === 'CONNECTED') {
    logger.warn('Auth-related rejection detected, triggering recovery...');
    global.botStatus = 'DISCONNECTED';
    client.emit('disconnected', `unhandled:${msg}`);
  }
});
```

### Fix 2: Signaling Shard Fallback for the Bot

#### [MODIFY] [signalingClient.js](file:///d:/CosmoShare/CosmoShare/WA-BOT_huggingface/src/services/signalingClient.js)

Add ring-order fallback (matching the web portal). Replace the single-shard
`connectForOneShare` / `connectForLabShare`:

```javascript
async function connectForOneShare(code) {
  const urls = config.signaling.oneShareUrls;
  if (urls.length === 0) throw new Error('No signaling URLs configured');
  const primary = djb2Hash(code) % urls.length;
  let lastErr;
  for (let i = 0; i < urls.length; i++) {
    const idx = (primary + i) % urls.length;          // ring order — matches portal
    const url = normaliseWs(urls[idx]);
    try {
      const client = new SignalingClient(url);
      await client.connect();
      if (i > 0) logger.info('Connected to fallback shard', { shard: idx, url });
      return client;
    } catch (err) {
      lastErr = err;
      logger.warn('Shard connection failed, trying next', { shard: idx, error: err.message });
    }
  }
  throw new Error('All signaling shards unreachable' + (lastErr ? `: ${lastErr.message}` : ''));
}
```
Apply the identical pattern to `connectForLabShare` (hashing `roomNumber`,
appending `?room=`). Export both as before — `shareManager.js` needs no changes.

### Fix 3: Guard `sendMessage` Calls with a Page-Liveness Pre-check

#### [MODIFY] [index.js](file:///d:/CosmoShare/CosmoShare/WA-BOT_huggingface/src/index.js)

Both API handlers (`/api/whatsapp/share` at L577 and `/api/whatsapp/share-file`
at L516) should pre-verify the page is alive so callers get a clear error
instead of a `getChat` stack trace:

```javascript
async function ensureClientAlive() {
  const info = client.info;
  if (!info || !info.wid) {
    throw new Error('WhatsApp bot is offline. Please scan the QR code.');
  }
  try {
    await client.pupPage.evaluate(() => true);
  } catch {
    throw new Error('WhatsApp bot session has expired. Please restart it from the admin dashboard.');
  }
}
// call `await ensureClientAlive();` at the top of each share handler
```

### Fix 4: Replace Git-Based Session Backup with the HF Hub HTTP API

#### [MODIFY] [storageService.js](file:///d:/CosmoShare/CosmoShare/WA-BOT_huggingface/src/services/storageService.js)

**Key changes:**

1. **Drop `git init/add/push` and use the HF Hub HTTP commit API.** The exact
   endpoint (confirmed from HF's OpenAPI spec) is:
   ```
   POST https://huggingface.co/api/datasets/{namespace}/{repo}/commit/{rev}
   Authorization: Bearer {HF_TOKEN}
   ```
   (preceded by `POST .../preupload/{rev}` for files > a few MB). Rather than
   hand-rolling the multipart `create-commit` body, **use the `@huggingface/hub`
   npm package's `uploadFiles()`** — it handles preupload, LFS, chunking and
   retries automatically and is the officially supported path:
   ```javascript
   const { uploadFiles } = require('@huggingface/hub');
   await uploadFiles({
     repo: config.hf.dataset,            // 'isk2005/cosmoshare-bot-session'
     repoType: 'dataset',
     credentials: { accessToken: config.hf.token },
     files: collectedFiles,              // [{ path, content: Buffer }]
   });
   ```
   This uploads only the files that changed, is far more reliable than a forced
   orphan push, and handles the multi-MB Chromium profile correctly.

2. **⚠️ Gap A fix (NEW):** if you keep ANY `execSync('git …')` calls (e.g. the
   `restoreSession` clone), change `stdio: 'ignore'` → `stdio: 'pipe'` so
   `err.stderr` is actually populated and errors stop appearing as `stderr:""`.

3. **Delay the first backup** until Chromium has stabilized. In `client.js`
   `ready` handler, wrap the backup in a 30s timeout (lets lock files release):
   ```javascript
   setTimeout(() => {
     storageService.backupSession().catch(err => {
       logger.error('Failed to backup session on ready', { error: err.message });
     });
   }, 30000);
   ```

4. **Add retry with exponential backoff** (60s → 120s → 180s):
   ```javascript
   async function backupWithRetry(maxRetries = 3) {
     for (let i = 0; i < maxRetries; i++) {
       if (await backupSession()) return true;
       const delay = (i + 1) * 60000;
       logger.warn(`Backup retry ${i+1}/${maxRetries} in ${delay/1000}s`);
       await new Promise(r => setTimeout(r, delay));
     }
     return false;
   }
   ```

5. **Do NOT blindly "sync local to deployed".** The deployed `storageService.js`
   looks newer, but its stderr capture is broken (Gap A). Base the new version on
   the deployed one *plus* the `stdio` fix *plus* the HTTP-API change above.

### Fix 5 (NEW): Move Alerting Off SMTP Port 587

#### [MODIFY] [emailService.js](file:///d:/CosmoShare/CosmoShare/WA-BOT_huggingface/src/services/emailService.js)

Because HF Spaces egress is restricted to ports 80/443/8080, replace
`nodemailer` SMTP with an **HTTPS** delivery path. Minimal change using a
Resend-style HTTP API (free tier, port 443):

```javascript
async function sendAlert(subject, text) {
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.emailRelay.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'CosmoShare WA-BOT <bot@your-verified-domain>',
        to: [config.smtp.alertEmail],
        subject: `🚨 ${subject}`,
        text,
      }),
    });
    if (!res.ok) logger.error('Alert email relay failed', { status: res.status, body: await res.text() });
  } catch (err) {
    logger.error('Failed to send alert email', { subject, error: err.message });
  }
}
```

Add the relay config (e.g. `EMAIL_RELAY_API_KEY`) to `config.js` and the
Space's secrets. Remove the `nodemailer` SMTP transporter, or keep it only for
local (non-Space) runs. Alternatively, swap in `ntfy.sh`/Discord/Telegram
webhooks — all HTTPS, zero account setup for ntfy.

---

## Open Question

> [!IMPORTANT]
> **What triggers the `auth timeout` ~6 min after startup?** Candidates:
> 1. WhatsApp multi-device conflict (same phone linked to another wwebjs instance)
> 2. HF Space container resource pressure (Chromium OOM / CPU starvation)
> 3. Network instability to `web.whatsapp.com`
> 4. Stale/corrupted auth data from a partial dataset restore
>
> The fixes above add **resilience** (auto-recovery) regardless of the trigger,
> but identifying the exact cause would let us *prevent* it. Worth checking the
> HF Space memory tier and confirming only one linked device exists.

---

## Verification Plan

1. Deploy the fixed code to the HF Space.
2. Wait for startup and `CONNECTED` status.
3. **Test Portal → WhatsApp** (Share Sheet → link/file) — confirm delivery.
4. **Test WhatsApp → Portal (OneShare)** — file → `done` → enter code → transfer.
5. **Test WhatsApp → Portal (LabShare)** — file → LabShare → enter room → transfer.
6. **Test resilience** — wait >6 min, re-run all scenarios; if `auth timeout`
   fires, verify auto-recovery restores `CONNECTED` within ~60s.
7. **Probe `/health`** while the page is dead — `connectedToWhatsApp` must now
   read `false` (not the stale cached `true`).
8. **Test session backup** — confirm the dataset gains a current `.wwebjs_auth`,
   `names.json`, `state.json`; force a container restart and confirm the session
   survives without a new QR scan.
9. **Test alerting** — trigger a QR/offline event and confirm the email/webhook
   actually arrives (SMTP path is gone).
