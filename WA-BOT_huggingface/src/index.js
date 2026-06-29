'use strict';

require('dotenv').config();

const dns = require('dns');
if (typeof dns.setDefaultResultOrder === 'function') {
  dns.setDefaultResultOrder('ipv4first');
}

const fs = require('fs');
const path = require('path');
const express = require('express');
const qrcodeLib = require('qrcode');
const config = require('./config');
const featuresConfig = require('../config/featuresConfig.json');
const logger = require('./utils/logger');
const client = require('./client');
const { createMessageHandler } = require('./handlers/messageHandler');
const { sessionManager, getSavedName } = require('./conversation/session');
const { cleanupAllTemp } = require('./handlers/fileHandler');
const storageService = require('./services/storageService');
const emailService = require('./services/emailService');
const pauseService = require('./services/pauseService');

const startTime = Date.now();

// ─── 24-Hour Greeting Persistence ───────────────────────────────────
const GREETINGS_FILE = path.resolve(config.bot.sessionDir, 'greetings.json');
let greetingStore = new Map();

function _loadGreetings() {
  try {
    if (fs.existsSync(GREETINGS_FILE)) {
      const raw = fs.readFileSync(GREETINGS_FILE, 'utf-8');
      const data = JSON.parse(raw);
      greetingStore = new Map(Object.entries(data));
      
      // Cleanup entries older than 48 hours to prevent unbounded growth
      const cutoff = Date.now() - (48 * 60 * 60 * 1000);
      let cleaned = 0;
      for (const [phone, timestamp] of greetingStore) {
        if (timestamp < cutoff) {
          greetingStore.delete(phone);
          cleaned++;
        }
      }
      if (cleaned > 0) {
        logger.debug(`Cleaned ${cleaned} expired greeting entries`);
        _saveGreetings();
      }
    }
  } catch (err) {
    logger.error('Failed to load greeting store', { error: err.message });
  }
}

function _saveGreetings() {
  try {
    const dir = path.dirname(GREETINGS_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const obj = Object.fromEntries(greetingStore);
    fs.writeFileSync(GREETINGS_FILE, JSON.stringify(obj, null, 2), 'utf-8');
  } catch (err) {
    logger.error('Failed to save greeting store', { error: err.message });
  }
}

function shouldSendGreeting(cleanNumber) {
  const now = Date.now();
  const phone = cleanNumber.replace(/\D/g, '');
  const lastTime = greetingStore.get(phone);
  if (!lastTime || now - lastTime > 24 * 60 * 60 * 1000) {
    greetingStore.set(phone, now);
    _saveGreetings();
    return true;
  }
  return false;
}

// Load greetings on module init
_loadGreetings();

async function sendDailyGreetingIfNeeded(cleanNumber) {
  if (shouldSendGreeting(cleanNumber)) {
    if (featuresConfig.REMOVE_NAME_FROM_GREETING) {
      await client.sendMessage(cleanNumber, `👋 *Hi!* Welcome to CosmoShare. Here is the resource shared from the web portal:`);
    } else {
      let nameVal = getSavedName(cleanNumber.replace(/\D/g, ''));
      if (!nameVal) {
        try {
          const contact = await client.getContactById(cleanNumber);
          nameVal = contact.pushname || contact.name || contact.shortName;
        } catch (err) {
          logger.warn('Failed to fetch contact details for name', { error: err.message });
        }
      }
      let formattedName = 'there';
      if (nameVal) {
        formattedName = nameVal.charAt(0).toUpperCase() + nameVal.slice(1).toLowerCase();
      }
      await client.sendMessage(cleanNumber, `👋 *Hi ${formattedName}!* Welcome to CosmoShare. Here is the resource shared from the web portal:`);
    }
  }
}

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

/**
 * Verify the WhatsApp client is truly usable before attempting to send.
 * The cached `client.info` survives a dead Puppeteer page, so we additionally
 * probe the page itself. This turns a confusing `getChat` stack trace into a
 * clear, actionable error for callers (and triggers recovery via 'disconnected').
 *
 * @param {boolean} [emitRecover=true] - if the page is dead, emit 'disconnected'
 *   so the existing recovery path runs.
 * @returns {Promise<void>} resolves if alive; throws a descriptive Error if not.
 */
async function ensureClientAlive(emitRecover = true) {
  const info = client.info;
  if (!info || !info.wid) {
    throw new Error('WhatsApp bot is offline or not linked. Please scan the QR code to link it first.');
  }
  try {
    // Actually execute JS inside the Puppeteer page to confirm it's alive.
    await client.pupPage.evaluate(() => true);
  } catch (err) {
    if (emitRecover && global.botStatus !== 'DISCONNECTED') {
      logger.error('Puppeteer page is dead during pre-check, triggering recovery...', { error: err.message });
      global.botStatus = 'DISCONNECTED';
      client.emit('disconnected', 'puppeteer_page_dead');
    }
    throw new Error('WhatsApp bot session has expired. A recovery/restart has been triggered — please retry shortly.');
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

  // Middleware to authenticate API requests from the Next.js portal
  function checkApiAuth(req, res, next) {
    const authHeader = req.headers['authorization'] || '';
    const botSecretHeader = req.headers['x-bot-secret'] || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;

    const expectedSecret = config.bridge.apiSecret;
    if (!expectedSecret) {
      logger.warn('API authentication skipped because BRIDGE_API_SECRET is not set in bot config');
      return next();
    }

    if (token === expectedSecret || botSecretHeader === expectedSecret) {
      return next();
    }

    logger.warn('Unauthorized API share request received', {
      hasAuth: !!authHeader,
      hasSecretHeader: !!botSecretHeader
    });
    return res.status(401).json({ error: 'Unauthorized: Invalid API secret key' });
  }

  // 1. Register raw binary endpoint before global body parsers
  app.post('/api/whatsapp/share-file', checkApiAuth, express.raw({ type: '*/*', limit: '100mb' }), async (req, res) => {
    try {
      const phoneNumber = req.headers['x-phone-number'];
      const fileNameEncoded = req.headers['x-file-name'];
      const messageEncoded = req.headers['x-message'];
      const contentType = req.headers['content-type'];

      const fileName = fileNameEncoded ? decodeURIComponent(fileNameEncoded) : 'file';
      const message = messageEncoded ? decodeURIComponent(messageEncoded) : '';

      if (!phoneNumber) {
        return res.status(400).json({ error: 'x-phone-number header is required' });
      }

      // Check if WhatsApp bot is truly connected (probes the Puppeteer page).
      try {
        await ensureClientAlive();
      } catch (err) {
        return res.status(503).json({ error: err.message });
      }

      // Clean phone number
      let cleanNumber = phoneNumber.replace(/\D/g, '');
      if (cleanNumber.length < 8) {
        return res.status(400).json({ error: 'Invalid phone number format.' });
      }
      if (!cleanNumber.endsWith('@c.us')) {
        cleanNumber = `${cleanNumber}@c.us`;
      }

      // 1. Send daily greeting if needed
      await sendDailyGreetingIfNeeded(cleanNumber);

      const buffer = req.body;
      if (!buffer || buffer.length === 0) {
        return res.status(400).json({ error: 'Empty file body received.' });
      }

      const { MessageMedia } = require('whatsapp-web.js');
      const base64Data = buffer.toString('base64');
      const media = new MessageMedia(contentType || 'application/octet-stream', base64Data, fileName);

      // 3. Send the file itself
      await client.sendMessage(cleanNumber, media);

      // 4. Send note description if provided as a separate bubble
      if (message) {
        await client.sendMessage(cleanNumber, `*Note:* ${message}`);
      }

      return res.json({ success: true, message: 'File shared successfully via WhatsApp!' });
    } catch (err) {
      logger.error('Error sharing file via WhatsApp', { error: err.message });
      return res.status(500).json({ error: 'Failed to share file: ' + err.message });
    }
  });

  // 2. Register JSON body parser
  app.use(express.json({ limit: '100mb' }));
  app.use(express.urlencoded({ limit: '100mb', extended: true }));

  // API Sharing Endpoint (authenticated)
  app.post('/api/whatsapp/share', checkApiAuth, async (req, res) => {
    try {
      const { phoneNumber, type, linkUrl, codeSnippet, message, files } = req.body;

      if (!phoneNumber) {
        return res.status(400).json({ error: 'Phone number is required' });
      }

      // Check if WhatsApp bot is truly connected (probes the Puppeteer page).
      try {
        await ensureClientAlive();
      } catch (err) {
        return res.status(503).json({ error: err.message });
      }

      // Clean phone number (keep only digits)
      let cleanNumber = phoneNumber.replace(/\D/g, '');
      if (cleanNumber.length < 8) {
        return res.status(400).json({ error: 'Invalid phone number format. Must contain at least 8 digits.' });
      }

      // Format target number as chatId
      if (!cleanNumber.endsWith('@c.us')) {
        cleanNumber = `${cleanNumber}@c.us`;
      }

      logger.info('Received API share request', { phoneNumber: cleanNumber, type });

      // 1. Send daily greeting if needed
      await sendDailyGreetingIfNeeded(cleanNumber);

      if (type === 'link') {
        if (!linkUrl) {
          return res.status(400).json({ error: 'linkUrl is required for type link' });
        }
        
        // Chat bubble 1: Intro
        await client.sendMessage(cleanNumber, `Below is a shared *Link* from CosmoShare 👇`);
        
        // Chat bubble 2: Link
        const sendOptions = {};
        if (featuresConfig.ENABLE_LINK_PREVIEW === false) {
          sendOptions.linkPreview = false;
        }
        await client.sendMessage(cleanNumber, linkUrl, sendOptions);
        
        // Chat bubble 3: Note
        if (message) {
          await client.sendMessage(cleanNumber, `*Note:* ${message}`);
        }
      } else if (type === 'code') {
        if (!codeSnippet) {
          return res.status(400).json({ error: 'codeSnippet is required for type code' });
        }
        
        // Chat bubble 1: Intro
        await client.sendMessage(cleanNumber, `Below is a shared *Code Snippet* from CosmoShare 👇`);
        
        // Chat bubble 2: Code
        await client.sendMessage(cleanNumber, `\`\`\`\n${codeSnippet}\n\`\`\``);
        
        // Chat bubble 3: Note
        if (message) {
          await client.sendMessage(cleanNumber, `*Note:* ${message}`);
        }
      } else if (type === 'file') {
        if (!files || !Array.isArray(files) || files.length === 0) {
          return res.status(400).json({ error: 'files array is required and must not be empty for type file' });
        }

        const { MessageMedia } = require('whatsapp-web.js');
        for (const file of files) {
          if (!file.fileName || !file.base64Data || !file.fileType) {
            return res.status(400).json({ error: 'Each file must contain fileName, fileType, and base64Data' });
          }
          
          // Chat bubble 2: File
          const media = new MessageMedia(file.fileType, file.base64Data, file.fileName);
          await client.sendMessage(cleanNumber, media);
          
          // Chat bubble 3: Note
          if (message) {
            await client.sendMessage(cleanNumber, `*Note:* ${message}`);
          }
          
          // Introduce a short delay between multiple files to prevent flooding
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      } else {
        return res.status(400).json({ error: 'Invalid share type. Must be link, code, or file' });
      }

      return res.json({ success: true, message: 'Content shared successfully via WhatsApp!' });
    } catch (err) {
      logger.error('Error handling API share request', { error: err.message, stack: err.stack });
      return res.status(500).json({ error: 'Failed to share content: ' + err.message });
    }
  });

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

  // Health endpoint (public) — probes the Puppeteer page, not just cached info.
  app.get('/health', async (req, res) => {
    const info = client.info;
    const pauseState = pauseService.getState();

    // `client.info` is cached at auth time and survives a dead page, so probe
    // the page itself to report the true connection state.
    let isAlive = false;
    if (info && info.wid) {
      try {
        await client.pupPage.evaluate(() => true);
        isAlive = true;
      } catch {
        // Page context is dead → not really connected.
        isAlive = false;
        if (global.botStatus === 'CONNECTED') {
          // Don't claim CONNECTED if the page is dead.
          global.botStatus = 'DISCONNECTED';
        }
      }
    }

    res.json({
      status: 'ok',
      uptime: Math.floor((Date.now() - startTime) / 1000),
      connectedToWhatsApp: isAlive,
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

    // Periodic Puppeteer page liveness probe.
    // `client.info` is cached and survives a dead page; this probe is what
    // actually detects the zombie state (e.g. after an "auth timeout" that does
    // NOT emit 'disconnected') and routes it into recovery.
    setInterval(async () => {
      if (global.botStatus !== 'CONNECTED' && global.botStatus !== 'AUTHENTICATED') return;
      try {
        await client.pupPage.evaluate(() => true);
      } catch (err) {
        logger.error('Puppeteer page is dead, triggering recovery...', { error: err.message });
        global.botStatus = 'DISCONNECTED';
        client.emit('disconnected', 'puppeteer_page_dead');
      }
    }, 60000).unref();
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

// ─── Network Diagnostic Helper ──────────────────────────────────────
async function runNetworkDiagnostics() {
  const dns = require('dns').promises;
  const https = require('https');
  
  logger.info('[Diagnostic] Running network and DNS checks...');
  const targetHost = 'web.whatsapp.com';
  
  // 1. DNS Resolution Check
  try {
    const ipv4 = await dns.resolve4(targetHost).catch(() => []);
    logger.info(`[Diagnostic] DNS IPv4 addresses: ${JSON.stringify(ipv4)}`);
  } catch (err) {
    logger.error('[Diagnostic] Failed to resolve IPv4:', { error: err.message });
  }
  
  try {
    const ipv6 = await dns.resolve6(targetHost).catch(() => []);
    logger.info(`[Diagnostic] DNS IPv6 addresses: ${JSON.stringify(ipv6)}`);
  } catch (err) {
    logger.warn('[Diagnostic] Failed to resolve IPv6:', { error: err.message });
  }

  // 2. Outbound internet check to Google
  const testGoogle = () => {
    return new Promise((resolve) => {
      logger.info('[Diagnostic] Attempting HTTPS request to https://google.com/ to check outbound internet...');
      const start = Date.now();
      const req = https.get('https://google.com/', { timeout: 10000 }, (res) => {
        logger.info(`[Diagnostic] Google connection successful! Status Code: ${res.statusCode}, Time: ${Date.now() - start}ms`);
        res.resume();
        resolve(true);
      });

      req.on('error', (err) => {
        logger.error('[Diagnostic] Google connection failed:', { error: err.message, code: err.code, time: Date.now() - start });
        resolve(false);
      });

      req.on('timeout', () => {
        logger.error('[Diagnostic] Google connection timed out after 10000ms');
        req.destroy();
        resolve(false);
      });
    });
  };

  // 3. Connection check to WhatsApp Web with a modern User-Agent over IPv4
  const testWhatsAppWithUA = () => {
    return new Promise((resolve) => {
      logger.info(`[Diagnostic] Attempting HTTPS request to https://${targetHost}/ with modern User-Agent...`);
      const start = Date.now();
      const options = {
        hostname: targetHost,
        port: 443,
        path: '/',
        method: 'GET',
        family: 4,
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
        }
      };

      const req = https.request(options, (res) => {
        logger.info(`[Diagnostic] WhatsApp HTTPS (with UA) successful! Status Code: ${res.statusCode}, Time: ${Date.now() - start}ms`);
        res.resume();
        resolve(true);
      });

      req.on('error', (err) => {
        logger.error('[Diagnostic] WhatsApp HTTPS (with UA) failed:', { error: err.message, code: err.code, time: Date.now() - start });
        resolve(false);
      });

      req.on('timeout', () => {
        logger.error('[Diagnostic] WhatsApp HTTPS (with UA) timed out after 10000ms');
        req.destroy();
        resolve(false);
      });

      req.end();
    });
  };

  await testGoogle();
  await testWhatsAppWithUA();
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

  // Run network diagnostics before client initialization
  try {
    await runNetworkDiagnostics();
  } catch (diagErr) {
    logger.error('Error running network diagnostics:', { error: diagErr.message });
  }

  // Initialize WhatsApp client with retries
  logger.info('Initializing WhatsApp client...');
  const MAX_INIT_ATTEMPTS = 3;
  const INIT_RETRY_DELAY_MS = 10000;
  let attempt = 0;
  let initialized = false;

  while (attempt < MAX_INIT_ATTEMPTS && !initialized) {
    try {
      attempt++;
      logger.info(`Initialization attempt ${attempt}/${MAX_INIT_ATTEMPTS}...`);
      await client.initialize();
      initialized = true;
      logger.info('WhatsApp client initialized successfully!');
    } catch (err) {
      logger.error(`Initialization attempt ${attempt} failed:`, { error: err.message, stack: err.stack });
      if (attempt < MAX_INIT_ATTEMPTS) {
        logger.info(`Waiting ${INIT_RETRY_DELAY_MS / 1000}s before retrying...`);
        await new Promise((resolve) => setTimeout(resolve, INIT_RETRY_DELAY_MS));
        try {
          await client.destroy();
        } catch (destroyErr) {
          logger.warn('Failed to destroy client on retry:', { error: destroyErr.message });
        }
      } else {
        throw err;
      }
    }
  }

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
  const msg = reason instanceof Error ? reason.message : String(reason);
  logger.error('Unhandled rejection', { reason: msg });

  // Auth-related rejections (e.g. the recurring "auth timeout") do NOT trigger
  // whatsapp-web.js's 'disconnected' event, so the bot would otherwise stay in a
  // zombie "CONNECTED" state. Detect them and route into recovery.
  if (/auth|timeout|UNPAIRED/i.test(msg) &&
      (global.botStatus === 'CONNECTED' || global.botStatus === 'AUTHENTICATED')) {
    logger.warn('Auth-related rejection detected, triggering recovery...', { reason: msg });
    global.botStatus = 'DISCONNECTED';
    client.emit('disconnected', `unhandled:${msg}`);
  }
});

// ─── Run ────────────────────────────────────────────────────────────
main().catch((err) => {
  logger.error('Fatal startup error', { error: err.message, stack: err.stack });
  process.exit(1);
});
