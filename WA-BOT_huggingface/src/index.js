'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const express = require('express');
const qrcodeLib = require('qrcode');
const config = require('./config');
const logger = require('./utils/logger');
const client = require('./client');
const { createMessageHandler } = require('./handlers/messageHandler');
const { sessionManager } = require('./conversation/session');
const { cleanupAllTemp } = require('./handlers/fileHandler');
const storageService = require('./services/storageService');
const emailService = require('./services/emailService');
const pauseService = require('./services/pauseService');

const startTime = Date.now();

// ─── Ensure directories exist ────────────────────────────────────────
function ensureDirectories() {
  const dirs = [
    path.resolve(config.bot.sessionDir),
    path.resolve(config.bot.tempDir),
    path.resolve(__dirname, '..', 'logs'),
  ];

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      logger.debug('Created directory', { dir });
    }
  }
}

// Helper to parse cookies from request headers without external dependencies
function parseCookies(req) {
  if (!req.headers.cookie) return {};
  return Object.fromEntries(
    req.headers.cookie.split('; ').map((c) => {
      const parts = c.split('=');
      return [parts[0], decodeURIComponent(parts.slice(1).join('='))];
    })
  );
}

// Helper to read the last 50 lines of logs safely
function getRecentLogs() {
  const logFile = path.resolve(__dirname, '..', 'logs', 'bot.log');
  if (!fs.existsSync(logFile)) return 'No logs recorded yet. Start interacting with the bot to see logs here.';
  try {
    const data = fs.readFileSync(logFile, 'utf8');
    const lines = data.trim().split('\n');
    return lines.slice(-50).map(line => {
      try {
        const parsed = JSON.parse(line);
        const date = new Date(parsed.timestamp).toLocaleTimeString();
        return `[${date}] [${parsed.level.toUpperCase()}] ${parsed.message} ${parsed.service ? '' : JSON.stringify(parsed)}`;
      } catch {
        return line;
      }
    }).join('\n');
  } catch (err) {
    return `Error reading logs: ${err.message}`;
  }
}

// ─── HTML UI Templates ──────────────────────────────────────────────

function renderLoginPage(errorMsg = '') {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Login - CosmoShare Admin</title>
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet">
      <script src="https://cdn.tailwindcss.com"></script>
      <style>
        body { font-family: 'Outfit', sans-serif; background-color: #0f172a; }
      </style>
    </head>
    <body class="flex items-center justify-center min-h-screen text-slate-100 p-4">
      <div class="w-full max-w-md bg-slate-900/80 backdrop-blur-md border border-slate-800 rounded-3xl p-8 shadow-2xl">
        <div class="text-center mb-8">
          <div class="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-gradient-to-tr from-emerald-500 to-cyan-500 mb-4 shadow-lg shadow-emerald-500/20">
            <span class="text-xl font-bold text-white">C</span>
          </div>
          <h1 class="text-2xl font-bold tracking-tight">CosmoShare Admin</h1>
          <p class="text-xs text-slate-400 mt-1">WA-BOT Management Portal</p>
        </div>
        
        ${errorMsg ? `
          <div class="mb-5 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm text-center">
            ⚠️ ${errorMsg}
          </div>
        ` : ''}

        <form action="/login" method="POST" class="space-y-4">
          <div>
            <label for="password" class="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Admin Password</label>
            <input type="password" name="password" id="password" required autofocus
              class="w-full px-4 py-3 rounded-xl bg-slate-800 border border-slate-700 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none transition text-slate-100 placeholder-slate-500 text-sm"
              placeholder="••••••••">
          </div>
          <button type="submit" 
            class="w-full py-3 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 active:scale-95 transition rounded-xl font-semibold text-white shadow-lg shadow-emerald-500/20 text-sm">
            Sign In
          </button>
        </form>
      </div>
    </body>
    </html>
  `;
}

function renderDashboard(qrImageBase64 = '') {
  const uptimeSec = Math.floor((Date.now() - startTime) / 1000);
  const uptimeHours = Math.floor(uptimeSec / 3600);
  const uptimeMins = Math.floor((uptimeSec % 3600) / 60);
  
  const isBotPaused = pauseService.isPaused();
  const pauseState = pauseService.getState();
  const currentIST = pauseService.formatToIST(new Date());
  
  let statusBadgeColor = 'bg-slate-800 text-slate-400 border-slate-700';
  let statusDotColor = 'bg-slate-500';
  let statusText = global.botStatus || 'UNKNOWN';

  if (statusText === 'CONNECTED') {
    statusBadgeColor = 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
    statusDotColor = 'bg-emerald-500';
  } else if (statusText === 'AWAITING_SCAN') {
    statusBadgeColor = 'bg-sky-500/10 text-sky-400 border-sky-500/20';
    statusDotColor = 'bg-sky-500';
  } else if (statusText === 'DISCONNECTED' || statusText === 'AUTH_FAILURE') {
    statusBadgeColor = 'bg-red-500/10 text-red-400 border-red-500/20';
    statusDotColor = 'bg-red-500';
  }

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Dashboard - CosmoShare Admin</title>
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet">
      <script src="https://cdn.tailwindcss.com"></script>
      <style>
        body { font-family: 'Outfit', sans-serif; background-color: #0f172a; }
      </style>
    </head>
    <body class="text-slate-100 p-4 md:p-8 min-h-screen">
      <div class="max-w-6xl mx-auto space-y-6">
        
        <!-- Header -->
        <header class="flex flex-col sm:flex-row items-center justify-between gap-4 bg-slate-900/60 backdrop-blur-md border border-slate-800 rounded-3xl p-6 shadow-xl">
          <div class="flex items-center gap-4">
            <div class="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-500 to-cyan-500 shadow-md">
              <span class="text-lg font-bold text-white">C</span>
            </div>
            <div>
              <h1 class="text-lg font-semibold leading-tight">CosmoShare WA-BOT</h1>
              <p class="text-xs text-slate-400">Admin Dashboard & Operations Panel</p>
            </div>
          </div>
          
          <div class="flex items-center gap-3">
            <span class="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold border ${statusBadgeColor}">
              <span class="w-2 h-2 rounded-full ${statusDotColor} animate-pulse"></span>
              ${statusText}
            </span>
            <form action="/logout" method="POST">
              <button type="submit" class="px-3.5 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 active:scale-95 transition rounded-full font-medium border border-slate-700">
                Log Out
              </button>
            </form>
          </div>
        </header>

        <!-- Stats Grid -->
        <section class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div class="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-5">
            <p class="text-xs text-slate-400 uppercase tracking-wider font-semibold">System Uptime</p>
            <p class="text-xl font-bold mt-1 text-slate-100">${uptimeHours}h ${uptimeMins}m</p>
          </div>
          <div class="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-5">
            <p class="text-xs text-slate-400 uppercase tracking-wider font-semibold">Active Sessions</p>
            <p class="text-xl font-bold mt-1 text-slate-100">${sessionManager.activeSessionCount}</p>
          </div>
          <div class="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-5">
            <p class="text-xs text-slate-400 uppercase tracking-wider font-semibold">Storage Mode</p>
            <p class="text-xl font-bold mt-1 text-slate-100">
              ${config.bot.sessionDir.startsWith('/data') ? '💎 Persistent Mount' : config.hf.dataset ? '🪣 HF Dataset Sync' : '📁 Local Ephemeral'}
            </p>
          </div>
          <div class="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-5">
            <p class="text-xs text-slate-400 uppercase tracking-wider font-semibold">Operational Status</p>
            <p class="text-xl font-bold mt-1 ${isBotPaused ? 'text-amber-400' : 'text-emerald-400'}">
              ${isBotPaused ? '⏸️ PAUSED' : '▶️ RUNNING'}
            </p>
          </div>
        </section>

        <!-- Main Workspace -->
        <main class="grid grid-cols-1 md:grid-cols-5 gap-6">
          
          <!-- Left Panel: QR Code / Connection State -->
          <div class="md:col-span-2 bg-slate-900/60 backdrop-blur-md border border-slate-800 rounded-3xl p-6 shadow-xl flex flex-col justify-between min-h-[350px]">
            <div>
              <h2 class="text-md font-semibold mb-1">WhatsApp Connection Status</h2>
              <p class="text-xs text-slate-400">Scan or verify linkage to link bot with WhatsApp client.</p>
            </div>
            
            <div class="flex flex-col items-center justify-center my-6 flex-1">
              ${statusText === 'AWAITING_SCAN' && qrImageBase64 ? `
                <div class="bg-white p-4 rounded-2xl shadow-lg border border-slate-200">
                  <img src="${qrImageBase64}" alt="Scan QR Code" class="w-48 h-48">
                </div>
                <p class="text-xs text-sky-400 font-semibold mt-4 animate-pulse">Waiting for WhatsApp Scan...</p>
              ` : statusText === 'CONNECTED' || statusText === 'AUTHENTICATED' ? `
                <div class="w-20 h-20 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 mb-4 shadow-lg shadow-emerald-500/5">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor" class="w-10 h-10">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                </div>
                <p class="text-sm font-semibold text-emerald-400">Authenticated & Ready</p>
                <p class="text-xs text-slate-400 text-center mt-1 max-w-[200px]">Bot is listening for commands on WhatsApp.</p>
              ` : `
                <div class="w-20 h-20 rounded-full bg-slate-800 flex items-center justify-center text-slate-500 mb-4">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-8 h-8">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 12c0-1.232-.046-2.453-.138-3.662a4.006 4.006 0 00-3.7-3.7 48.656 48.656 0 00-7.324 0 4.006 4.006 0 00-3.7 3.7c-.017.22-.032.441-.046.662M19.5 12l3-3m-3 3l-3-3M3 12h16.5m0 0a48.11 48.11 0 013.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m-7.5 0v-.916c0-1.18.91-2.164 2.09-2.201a51.964 51.964 0 003.32 0c1.18.037 2.09 1.022 2.09 2.201v.916m-7.5 0a48.667 48.667 0 007.5 0" />
                  </svg>
                </div>
                <p class="text-sm font-semibold text-slate-400">Initializing Client...</p>
                <p class="text-xs text-slate-500 text-center mt-1">Please wait or refresh dashboard.</p>
              `}
            </div>

            <div class="text-center">
              <button onclick="window.location.reload()" class="w-full py-2 bg-slate-800 hover:bg-slate-700 active:scale-95 transition rounded-xl text-xs font-semibold border border-slate-700">
                🔄 Refresh Page
              </button>
            </div>
          </div>

          <!-- Right Panel: Operations & Logs -->
          <div class="md:col-span-3 space-y-6">
            
            <!-- Temporary Pause Card -->
            <div class="bg-slate-900/60 backdrop-blur-md border border-slate-800 rounded-3xl p-6 shadow-xl">
              <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
                <h2 class="text-md font-semibold">Temporary Pause</h2>
                <span class="text-[10px] text-slate-400 font-mono bg-slate-950 px-2.5 py-1 rounded-full">Current IST: ${currentIST}</span>
              </div>
              
              ${isBotPaused ? `
                <!-- Paused State View -->
                <div class="mb-5 p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-slate-200">
                  <div class="flex items-start gap-3">
                    <span class="text-lg">⏸️</span>
                    <div>
                      <h3 class="font-semibold text-amber-400 text-sm">Bot is Temporarily Paused</h3>
                      <p class="text-xs text-slate-300 mt-1">
                        ${pauseState.pauseType === 'scheduled' 
                          ? `Paused until scheduled resume: <strong class="text-amber-300">${pauseService.formatToIST(pauseState.resumeAt)}</strong>`
                          : 'Paused indefinitely until manually resumed.'
                        }
                      </p>
                      <p class="text-[10px] text-slate-500 mt-2">Paused at: ${pauseService.formatToIST(pauseState.pausedAt)} (IST)</p>
                    </div>
                  </div>
                </div>
                
                <form action="/resume" method="POST">
                  <button type="submit" 
                    class="w-full py-3 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 active:scale-95 transition rounded-2xl font-semibold text-white shadow-lg shadow-emerald-500/20 text-xs flex items-center justify-center gap-2">
                    <span>▶️</span> Resume Bot Operations
                  </button>
                </form>
              ` : `
                <!-- Running State View / Pause Forms -->
                <div class="space-y-4">
                  <div class="p-3 rounded-xl bg-slate-950/40 border border-slate-800/60 text-slate-400 text-xs">
                    🟢 Bot is active. Use options below to pause operations.
                  </div>
                  
                  <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <!-- Scheduled Pause Form -->
                    <form action="/pause/scheduled" method="POST" class="space-y-3 p-4 rounded-2xl bg-slate-950/30 border border-slate-800/80">
                      <div>
                        <label class="block text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Pause Until (IST)</label>
                        <input type="datetime-local" name="resumeTime" 
                          min="${pauseService.getISTISOString()}"
                          value="${pauseService.getISTISOString(new Date(Date.now() + 60 * 60 * 1000))}"
                          required
                          class="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 focus:border-amber-500 outline-none text-xs text-slate-200">
                      </div>
                      <button type="submit" 
                        class="w-full py-2.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 active:scale-95 transition rounded-xl font-semibold border border-amber-500/20 text-xs">
                        ⏳ Schedule Pause
                      </button>
                    </form>

                    <!-- Manual Pause Form -->
                    <form action="/pause/manual" method="POST" class="flex flex-col justify-between p-4 rounded-2xl bg-slate-950/30 border border-slate-800/80">
                      <div class="mb-3">
                        <h4 class="text-xs font-semibold text-slate-300">Manual Pause</h4>
                        <p class="text-[10px] text-slate-400 mt-1">Halt bot indefinitely until you click Resume here.</p>
                      </div>
                      <button type="submit" 
                        class="w-full py-2.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 active:scale-95 transition rounded-xl font-semibold border border-red-500/20 text-xs mt-auto">
                        ⏸️ Pause Manually
                      </button>
                    </form>
                  </div>
                </div>
              `}
            </div>
            
            <!-- Operations Card -->
            <div class="bg-slate-900/60 backdrop-blur-md border border-slate-800 rounded-3xl p-6 shadow-xl">
              <h2 class="text-md font-semibold mb-3">Bot Control Actions</h2>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <form action="/restart" method="POST">
                  <button type="submit" 
                    class="w-full py-3 px-4 bg-slate-800 hover:bg-slate-700 active:scale-95 transition rounded-2xl font-semibold border border-slate-700 text-xs text-left flex items-center justify-between">
                    <div>
                      <p class="text-slate-100">Restart Client</p>
                      <p class="text-[10px] text-slate-400 font-normal mt-0.5">Reinitialize client instance</p>
                    </div>
                    <span>⚡</span>
                  </button>
                </form>
                <form action="/reset" method="POST" onsubmit="return confirm('WARNING: This will delete the session credentials and log out the bot completely. You will need to scan the QR code again. Proceed?');">
                  <button type="submit" 
                    class="w-full py-3 px-4 bg-red-500/10 hover:bg-red-500/20 active:scale-95 transition rounded-2xl font-semibold border border-red-500/20 text-xs text-left flex items-center justify-between text-red-400">
                    <div>
                      <p class="text-red-400 font-semibold">Force Log Out</p>
                      <p class="text-[10px] text-red-400/75 font-normal mt-0.5">Delete session keys & rescan</p>
                    </div>
                    <span>⚠️</span>
                  </button>
                </form>
              </div>
            </div>

            <!-- Logs Card -->
            <div class="bg-slate-900/60 backdrop-blur-md border border-slate-800 rounded-3xl p-6 shadow-xl">
              <div class="flex items-center justify-between mb-3">
                <h2 class="text-md font-semibold">Recent Event Logs</h2>
                <button onclick="window.location.reload()" class="text-xs text-emerald-400 hover:underline">Refresh Logs</button>
              </div>
              <div class="bg-slate-950 rounded-2xl p-4 border border-slate-800 overflow-auto h-64 text-left">
                <pre class="font-mono text-xs text-slate-300 leading-relaxed whitespace-pre-wrap" style="font-family: Consolas, Monaco, monospace;">${getRecentLogs()}</pre>
              </div>
            </div>
            
          </div>
        </main>
      </div>
    </body>
    </html>
  `;
}

function renderTransitionPage(msg) {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta http-equiv="refresh" content="8;url=/">
      <title>Processing Command...</title>
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet">
      <script src="https://cdn.tailwindcss.com"></script>
      <style>
        body { font-family: 'Outfit', sans-serif; background-color: #0f172a; }
      </style>
    </head>
    <body class="flex flex-col items-center justify-center min-h-screen text-slate-100 p-4">
      <div class="w-full max-w-md bg-slate-900/80 backdrop-blur-md border border-slate-800 rounded-3xl p-8 shadow-2xl text-center space-y-6">
        <div class="inline-flex items-center justify-center w-12 h-12 rounded-full border-4 border-emerald-500/20 border-t-emerald-500 animate-spin"></div>
        <div>
          <h1 class="text-lg font-semibold">${msg}</h1>
          <p class="text-xs text-slate-400 mt-2">Redirecting to dashboard automatically in <span id="countdown">8</span> seconds...</p>
        </div>
      </div>
      <script>
        let count = 8;
        const interval = setInterval(() => {
          count--;
          document.getElementById('countdown').innerText = count;
          if (count <= 0) clearInterval(interval);
        }, 1000);
      </script>
    </body>
    </html>
  `;
}

// ─── Health & Dashboard Server ───────────────────────────────────────
function startHealthServer() {
  const app = express();
  app.use(express.urlencoded({ extended: true }));

  // Middleware to authenticate admin requests
  function checkAuth(req, res, next) {
    const cookies = parseCookies(req);
    if (cookies.auth_token === config.admin.password) {
      return next();
    }
    res.send(renderLoginPage());
  }

  // Handle Login
  app.post('/login', (req, res) => {
    const { password } = req.body;
    if (password === config.admin.password) {
      res.setHeader('Set-Cookie', `auth_token=${encodeURIComponent(password)}; Max-Age=${24 * 60 * 60}; Path=/; HttpOnly; SameSite=None; Secure`);
      res.redirect('/');
    } else {
      res.send(renderLoginPage('Invalid Password'));
    }
  });

  // Handle Logout
  app.post('/logout', (req, res) => {
    res.setHeader('Set-Cookie', 'auth_token=; Max-Age=0; Path=/; HttpOnly; SameSite=None; Secure');
    res.redirect('/');
  });

  // Health endpoint (public)
  app.get('/health', (req, res) => {
    const info = client.info;
    const pauseState = pauseService.getState();
    res.json({
      status: 'ok',
      uptime: Math.floor((Date.now() - startTime) / 1000),
      connectedToWhatsApp: !!(info && info.wid),
      botStatus: global.botStatus,
      isPaused: pauseService.isPaused(),
      pauseType: pauseState.pauseType,
      resumeAtIST: pauseState.resumeAt ? pauseService.formatToIST(pauseState.resumeAt) : null,
      activeSessions: sessionManager.activeSessionCount,
      timestamp: new Date().toISOString(),
    });
  });

  // Dashboard Page (authenticated)
  app.get('/', checkAuth, async (req, res) => {
    let qrImage = '';
    if (global.botStatus === 'AWAITING_SCAN' && global.latestQrCode) {
      try {
        qrImage = await qrcodeLib.toDataURL(global.latestQrCode);
      } catch (err) {
        logger.error('Failed to generate QR DataURL', { error: err.message });
      }
    }
    res.send(renderDashboard(qrImage));
  });

  // Restart client action (authenticated)
  app.post('/restart', checkAuth, async (req, res) => {
    logger.info('Manual restart requested via admin dashboard...');
    res.send(renderTransitionPage('Restarting WhatsApp client, please wait...'));
    try {
      await client.destroy();
    } catch (err) {
      // Ignored
    }
    // Reinitialize
    client.initialize().catch((err) => {
      logger.error('Failed to initialize client after restart', { error: err.message });
    });
  });

  // Scheduled Pause action (authenticated)
  app.post('/pause/scheduled', checkAuth, async (req, res) => {
    const { resumeTime } = req.body;
    if (!resumeTime) {
      return res.send(renderTransitionPage('Error: Resume time is required'));
    }
    
    // Parse input (user submits IST: e.g. "2026-06-07T19:30").
    // We append '+05:30' offset to parse as IST time in UTC milliseconds correctly.
    const parseStr = resumeTime.includes('+') || resumeTime.includes('Z') ? resumeTime : `${resumeTime}:00+05:30`;
    const epoch = new Date(parseStr).getTime();
    
    if (isNaN(epoch) || epoch <= Date.now()) {
      return res.send(renderTransitionPage('Error: Scheduled resume time must be a valid future date & time.'));
    }
    
    logger.info(`Manual request to pause bot until ${resumeTime} (IST) received`);
    pauseService.pauseBot('scheduled', epoch);
    res.send(renderTransitionPage('WhatsApp bot paused successfully until scheduled time.'));
  });

  // Manual Pause action (authenticated)
  app.post('/pause/manual', checkAuth, async (req, res) => {
    logger.info('Manual request to pause bot indefinitely received');
    pauseService.pauseBot('manual');
    res.send(renderTransitionPage('WhatsApp bot paused manually (indefinite).'));
  });

  // Resume action (authenticated)
  app.post('/resume', checkAuth, async (req, res) => {
    logger.info('Manual request to resume bot received');
    pauseService.resumeBot('manual');
    res.send(renderTransitionPage('WhatsApp bot resumed successfully.'));
  });

  // Reset session credentials action (authenticated)
  app.post('/reset', checkAuth, async (req, res) => {
    logger.info('Manual session reset requested via admin dashboard...');
    res.send(renderTransitionPage('Resetting WhatsApp session and generating new QR, please wait...'));
    try {
      await client.destroy();
    } catch (err) {
      // Ignored
    }
    
    // Delete local session credentials folder
    const sessionPath = path.resolve(config.bot.sessionDir);
    if (fs.existsSync(sessionPath)) {
      try {
        // Clear .wwebjs_auth subfolder specifically to preserve names.json / state.json if desired,
        // or clear everything for a complete factory reset.
        const authPath = path.join(sessionPath, '.wwebjs_auth');
        if (fs.existsSync(authPath)) {
          fs.rmSync(authPath, { recursive: true, force: true });
        }
        logger.info('WhatsApp session credentials cleared successfully');
      } catch (err) {
        logger.error('Failed to clear session credentials directory', { error: err.message });
      }
    }

    // Force backup empty session to Git dataset to clear remote state
    storageService.backupSession().catch(err => {
      logger.error('Failed to clear remote storage backup on reset', { error: err.message });
    });

    // Reinitialize to obtain fresh QR code
    client.initialize().catch((err) => {
      logger.error('Failed to initialize client after reset', { error: err.message });
    });
  });

  // Start Express server
  app.listen(config.health.port, () => {
    logger.info(`Admin Dashboard is running at http://localhost:${config.health.port}`);
  });
}

// ─── Graceful Shutdown ──────────────────────────────────────────────
async function shutdown(signal) {
  logger.info(`Received ${signal}. Starting graceful shutdown...`);

  try {
    // Persist sessions
    sessionManager.persistToDisk();
    logger.info('Sessions persisted');

    // Sync state one last time to remote Git Dataset
    try {
      await storageService.backupSession();
    } catch (err) {
      // Ignore
    }

    // Cleanup temp files
    cleanupAllTemp();
    logger.info('Temp files cleaned');

    // Destroy client
    try {
      await client.destroy();
    } catch (err) {
      // May already be destroyed
    }

    logger.info('Shutdown complete');
    process.exit(0);
  } catch (err) {
    logger.error('Error during shutdown', { error: err.message });
    process.exit(1);
  }
}

// ─── Main ───────────────────────────────────────────────────────────
async function main() {
  logger.info('╔══════════════════════════════════════╗');
  logger.info('║       CosmoShare WhatsApp Bot        ║');
  logger.info('╚══════════════════════════════════════╝');
  logger.info('Starting up...');

  // Try to restore session files from Hugging Face Dataset before starting
  await storageService.restoreSession();

  // Ensure required directories
  ensureDirectories();

  // Restore sessions from disk
  sessionManager.restoreFromDisk();

  // Restore pause state
  pauseService.loadPauseState();

  // Register message handler on BOTH events for maximum reliability.
  const onMessage = createMessageHandler(client);
  client.on('message', onMessage);
  client.on('message_create', (msg) => {
    if (msg.fromMe) return;
    onMessage(msg);
  });

  // Start health and dashboard check server
  startHealthServer();

  // Initialize WhatsApp client
  logger.info('Initializing WhatsApp client...');
  await client.initialize();

  logger.info('Bot startup sequence complete');
}

// ─── Process-level handlers ─────────────────────────────────────────
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('uncaughtException', async (err) => {
  logger.error('Uncaught exception', { error: err.message, stack: err.stack });
  try {
    await emailService.sendCrashAlert(err.stack || err.message);
  } catch (emailErr) {
    logger.error('Failed to send crash email alert', { error: emailErr.message });
  }
  shutdown('uncaughtException');
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', { reason: reason instanceof Error ? reason.message : reason });
});

// ─── Run ────────────────────────────────────────────────────────────
main().catch((err) => {
  logger.error('Fatal startup error', { error: err.message, stack: err.stack });
  process.exit(1);
});
