'use strict';

const qrcodeLib = require('qrcode');
const waClient = require('../whatsapp/client');
const { sessionManager } = require('../conversation/session');
const signalingManager = require('../signaling/manager');
const fileStage = require('../relay/fileStage');

const startTime = Date.now();

function renderLoginPage(errorMsg = '') {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Login - CosmoShare Bot</title>
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet">
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Outfit', sans-serif; background: #0f172a; display: flex; align-items: center; justify-content: center; min-height: 100vh; color: #e2e8f0; }
        .card { width: 100%; max-width: 400px; background: rgba(15,23,42,0.8); backdrop-filter: blur(12px); border: 1px solid #1e293b; border-radius: 24px; padding: 2rem; box-shadow: 0 25px 50px rgba(0,0,0,0.5); }
        .logo { display: inline-flex; align-items: center; justify-content: center; width: 48px; height: 48px; border-radius: 16px; background: linear-gradient(135deg, #10b981, #06b6d4); margin-bottom: 1rem; font-size: 1.25rem; font-weight: 700; color: white; box-shadow: 0 8px 16px rgba(16,185,129,0.2); }
        h1 { font-size: 1.5rem; font-weight: 700; margin-bottom: 0.25rem; }
        .subtitle { font-size: 0.75rem; color: #94a3b8; margin-bottom: 2rem; }
        .error { padding: 0.75rem; border-radius: 12px; background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.2); color: #f87171; font-size: 0.875rem; text-align: center; margin-bottom: 1rem; }
        label { display: block; font-size: 0.75rem; font-weight: 600; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.5rem; }
        input { width: 100%; padding: 0.75rem 1rem; border-radius: 12px; background: #1e293b; border: 1px solid #334155; color: #e2e8f0; font-size: 0.875rem; outline: none; transition: border-color 0.2s; }
        input:focus { border-color: #10b981; }
        button { width: 100%; padding: 0.75rem; margin-top: 1rem; background: linear-gradient(135deg, #10b981, #14b8a6); border: none; border-radius: 12px; color: white; font-weight: 600; font-size: 0.875rem; cursor: pointer; box-shadow: 0 8px 16px rgba(16,185,129,0.2); transition: transform 0.15s; }
        button:hover { transform: scale(1.02); }
        button:active { transform: scale(0.98); }
        .center { text-align: center; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="center">
          <div class="logo">C</div>
          <h1>CosmoShare Bot</h1>
          <p class="subtitle">Admin Dashboard</p>
        </div>
        ${errorMsg ? `<div class="error">⚠️ ${errorMsg}</div>` : ''}
        <form action="/login" method="POST">
          <label for="password">Admin Password</label>
          <input type="password" name="password" id="password" required autofocus placeholder="••••••••">
          <button type="submit">Sign In</button>
        </form>
      </div>
    </body>
    </html>
  `;
}

async function renderDashboard() {
  const uptimeSec = Math.floor((Date.now() - startTime) / 1000);
  const uptimeHours = Math.floor(uptimeSec / 3600);
  const uptimeMins = Math.floor((uptimeSec % 3600) / 60);

  const status = waClient.status;
  let statusColor = '#64748b';
  let statusDot = '#64748b';
  if (status === 'CONNECTED') { statusColor = '#10b981'; statusDot = '#10b981'; }
  else if (status === 'AWAITING_SCAN') { statusColor = '#f59e0b'; statusDot = '#f59e0b'; }
  else if (status === 'DISCONNECTED' || status === 'LOGGED_OUT') { statusColor = '#ef4444'; statusDot = '#ef4444'; }

  // Refresh faster when waiting for QR or reconnecting
  const refreshInterval = (status === 'AWAITING_SCAN' || status === 'CONNECTING' || status === 'RECONNECTING') ? 5 : 10;

  let qrHtml = '';
  if (waClient.qrCode) {
    try {
      const qrDataUrl = await qrcodeLib.toDataURL(waClient.qrCode, { width: 300, margin: 2 });
      const pairingHtml = waClient.pairingCode
        ? `<div style="margin-top:1rem;padding:0.75rem;background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.2);border-radius:12px;">
             <p style="color:#10b981;font-weight:600;font-size:0.8rem;margin-bottom:0.25rem;">🔗 Or use Pairing Code:</p>
             <p style="color:#e2e8f0;font-size:1.75rem;font-weight:700;letter-spacing:0.2em;">${waClient.pairingCode}</p>
             <p style="color:#94a3b8;font-size:0.7rem;margin-top:0.25rem;">WhatsApp → Linked Devices → Link a Device → Link with phone number instead</p>
           </div>`
        : '';
      qrHtml = `
        <div style="text-align:center;margin:1.5rem 0;padding:1.5rem;background:rgba(245,158,11,0.05);border:1px solid rgba(245,158,11,0.2);border-radius:16px;">
          <p style="color:#f59e0b;font-weight:700;font-size:1rem;margin-bottom:1rem;">📱 Scan this QR code with WhatsApp</p>
          <img src="${qrDataUrl}" alt="QR Code" style="border-radius:12px;background:white;padding:12px;display:block;margin:0 auto;">
          <p style="color:#94a3b8;font-size:0.75rem;margin-top:0.75rem;">WhatsApp → Settings → Linked Devices → Link a Device</p>
          <p style="color:#64748b;font-size:0.7rem;margin-top:0.5rem;">⚠️ QR expires in ~60 seconds — page auto-refreshes every 5s</p>
          ${pairingHtml}
        </div>
      `;
    } catch {}
  } else if (status === 'CONNECTING' || status === 'RECONNECTING') {
    qrHtml = `
      <div style="text-align:center;margin:1.5rem 0;padding:1.5rem;background:rgba(99,102,241,0.05);border:1px solid rgba(99,102,241,0.2);border-radius:16px;">
        <div style="font-size:2rem;margin-bottom:0.75rem;">⏳</div>
        <p style="color:#818cf8;font-weight:600;">Connecting to WhatsApp...</p>
        <p style="color:#64748b;font-size:0.75rem;margin-top:0.5rem;">QR code will appear here automatically — page refreshes every 5s</p>
      </div>
    `;
  }

  const sigStats = signalingManager.getStats();
  const stageStats = fileStage.getStats();
  const memUsage = process.memoryUsage();

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>CosmoShare Bot Dashboard</title>
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet">
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Outfit', sans-serif; background: #0f172a; color: #e2e8f0; padding: 2rem; }
        .header { display: flex; align-items: center; gap: 1rem; margin-bottom: 2rem; }
        .logo { display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 40px; border-radius: 12px; background: linear-gradient(135deg, #10b981, #06b6d4); font-size: 1rem; font-weight: 700; color: white; }
        h1 { font-size: 1.5rem; }
        .subtitle { color: #94a3b8; font-size: 0.75rem; }
        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
        .stat { background: rgba(30,41,59,0.5); border: 1px solid #334155; border-radius: 16px; padding: 1.25rem; }
        .stat-label { font-size: 0.75rem; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.5rem; }
        .stat-value { font-size: 1.5rem; font-weight: 700; }
        .status-badge { display: inline-flex; align-items: center; gap: 0.5rem; padding: 0.25rem 0.75rem; border-radius: 20px; font-size: 0.75rem; font-weight: 600; border: 1px solid ${statusColor}33; background: ${statusColor}15; color: ${statusColor}; }
        .status-dot { width: 8px; height: 8px; border-radius: 50%; background: ${statusDot}; animation: ${status === 'AWAITING_SCAN' ? 'pulse 1.5s infinite' : 'none'}; }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
        .section { background: rgba(30,41,59,0.5); border: 1px solid #334155; border-radius: 16px; padding: 1.25rem; margin-bottom: 1rem; }
        .section h2 { font-size: 1rem; margin-bottom: 1rem; }
        .logout { display: inline-block; margin-top: 1rem; padding: 0.5rem 1rem; border-radius: 8px; background: #1e293b; border: 1px solid #334155; color: #94a3b8; text-decoration: none; font-size: 0.875rem; }
        .logout:hover { border-color: #ef4444; color: #f87171; }
      </style>
      <meta http-equiv="refresh" content="${refreshInterval}">
    </head>
    <body>
      <div class="header">
        <div class="logo">C</div>
        <div>
          <h1>CosmoShare Bot</h1>
          <p class="subtitle">Zero-Latency Architecture v2.0</p>
        </div>
        <div style="margin-left:auto;">
          <span class="status-badge"><span class="status-dot"></span>${status}</span>
        </div>
      </div>

      ${qrHtml}

      <div class="grid">
        <div class="stat">
          <div class="stat-label">Uptime</div>
          <div class="stat-value">${uptimeHours}h ${uptimeMins}m</div>
        </div>
        <div class="stat">
          <div class="stat-label">Active Sessions</div>
          <div class="stat-value">${sessionManager.activeSessionCount}</div>
        </div>
        <div class="stat">
          <div class="stat-label">Socket.IO Clients</div>
          <div class="stat-value">${sigStats.connectedClients}</div>
        </div>
        <div class="stat">
          <div class="stat-label">Active Rooms</div>
          <div class="stat-value">${sigStats.activeRooms}</div>
        </div>
        <div class="stat">
          <div class="stat-label">OneShare Sessions</div>
          <div class="stat-value">${sigStats.activeOneShareSessions}</div>
        </div>
        <div class="stat">
          <div class="stat-label">Staged Files</div>
          <div class="stat-value">${stageStats.totalFiles}</div>
        </div>
        <div class="stat">
          <div class="stat-label">Memory (RSS)</div>
          <div class="stat-value">${(memUsage.rss / (1024 * 1024)).toFixed(0)} MB</div>
        </div>
        <div class="stat">
          <div class="stat-label">Heap Used</div>
          <div class="stat-value">${(memUsage.heapUsed / (1024 * 1024)).toFixed(0)} MB</div>
        </div>
      </div>

      <a href="/logout" class="logout">🔒 Logout</a>
    </body>
    </html>
  `;
}

module.exports = { renderLoginPage, renderDashboard };
