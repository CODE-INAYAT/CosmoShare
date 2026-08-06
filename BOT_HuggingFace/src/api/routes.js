'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');
const logger = require('../utils/logger');
const waClient = require('../whatsapp/client');
const { renderLoginPage, renderDashboard } = require('./dashboard');
const signalingManager = require('../signaling/manager');
const fileStage = require('../relay/fileStage');

// Simple session token tracking (cookie-based)
const validTokens = new Set();

function parseCookies(req) {
  if (!req.headers.cookie) return {};
  return Object.fromEntries(
    req.headers.cookie.split('; ').map(c => {
      const parts = c.split('=');
      return [parts[0], decodeURIComponent(parts.slice(1).join('='))];
    })
  );
}

function isAuthenticated(req) {
  const cookies = parseCookies(req);
  return validTokens.has(cookies['auth_token']);
}

/**
 * Register API routes on an Express app.
 * @param {import('express').Application} app
 */
function registerRoutes(app) {
  // ── Health check ──
  app.get('/ping', (_req, res) => res.send('OK'));

  // ── Root: Dashboard or Login ──
  app.get('/', async (req, res) => {
    if (!isAuthenticated(req)) {
      return res.send(renderLoginPage());
    }
    const html = await renderDashboard();
    res.send(html);
  });

  // ── Login ──
  app.post('/login', (req, res) => {
    const { password } = req.body || {};
    if (password === config.admin.password) {
      const token = crypto.randomBytes(32).toString('hex');
      validTokens.add(token);
      res.setHeader('Set-Cookie', `auth_token=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400`);
      return res.redirect('/');
    }
    res.send(renderLoginPage('Incorrect password'));
  });

  // ── Logout ──
  app.get('/logout', (req, res) => {
    const cookies = parseCookies(req);
    if (cookies['auth_token']) validTokens.delete(cookies['auth_token']);
    res.setHeader('Set-Cookie', `auth_token=; Path=/; HttpOnly; Max-Age=0`);
    res.redirect('/');
  });

  // ── Status API ──
  app.get('/api/whatsapp/status', (req, res) => {
    const sigStats = signalingManager.getStats();
    const stageStats = fileStage.getStats();
    res.json({
      status: waClient.status,
      uptime: process.uptime(),
      sessions: waClient.status === 'CONNECTED' ? 'active' : 'inactive',
      signaling: sigStats,
      fileStage: stageStats,
      memory: {
        rss: `${(process.memoryUsage().rss / (1024 * 1024)).toFixed(1)} MB`,
        heapUsed: `${(process.memoryUsage().heapUsed / (1024 * 1024)).toFixed(1)} MB`,
      },
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // INBOUND: Web Portal → WhatsApp (share to a WhatsApp number)
  // ══════════════════════════════════════════════════════════════════

  // Auth middleware for bot API
  function authenticateBotAPI(req, res, next) {
    const botSecret = req.headers['x-bot-secret'];
    const authHeader = req.headers['authorization'];
    const expectedSecret = process.env.BRIDGE_API_SECRET || '';
    const hfToken = config.hf.token;

    // Accept X-Bot-Secret match OR Bearer token match
    if (botSecret === expectedSecret) return next();
    if (authHeader) {
      const token = authHeader.replace(/^Bearer\s+/i, '');
      if (token === expectedSecret || token === hfToken) return next();
    }

    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Share link/code to WhatsApp
  app.post('/api/whatsapp/share', authenticateBotAPI, async (req, res) => {
    try {
      const { phoneNumber, type, linkUrl, codeSnippet, message, files } = req.body;

      if (!phoneNumber) return res.status(400).json({ error: 'Phone number is required' });
      if (!type || !['file', 'link', 'code'].includes(type)) {
        return res.status(400).json({ error: 'Valid share type is required' });
      }

      // Ensure bot is connected
      if (waClient.status !== 'CONNECTED') {
        return res.status(503).json({ error: 'WhatsApp bot is not connected' });
      }

      // Normalize phone to JID
      const cleanPhone = phoneNumber.replace(/\D/g, '');
      const jid = `${cleanPhone}@c.us`;

      // Send based on type
      if (type === 'link' && linkUrl) {
        const msg = message ? `${message}\n\n${linkUrl}` : `🔗 ${linkUrl}`;
        await waClient.sendMessage(jid, msg);
      } else if (type === 'code' && codeSnippet) {
        const msg = message ? `${message}\n\n\`\`\`\n${codeSnippet}\n\`\`\`` : `📋 Code Snippet:\n\n${codeSnippet}`;
        await waClient.sendMessage(jid, msg);
      } else if (type === 'file' && files && files.length > 0) {
        // Handle base64 file data
        for (const file of files) {
          if (file.data) {
            const buffer = Buffer.from(file.data, 'base64');
            await waClient.sendFile(jid, buffer, file.mimetype || 'application/octet-stream', file.fileName, message);
          }
        }
      }

      res.json({ success: true });
    } catch (err) {
      logger.error('Share to WhatsApp failed', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  // Share binary file to WhatsApp
  app.post('/api/whatsapp/share-file', authenticateBotAPI, async (req, res) => {
    try {
      const phoneNumber = req.headers['x-phone-number'];
      const fileName = req.headers['x-file-name'] || 'file';
      const message = req.headers['x-message'];
      const contentType = req.headers['content-type'] || 'application/octet-stream';

      if (!phoneNumber) return res.status(400).json({ error: 'x-phone-number header is required' });

      if (waClient.status !== 'CONNECTED') {
        return res.status(503).json({ error: 'WhatsApp bot is not connected' });
      }

      // Read request body as buffer
      const chunks = [];
      for await (const chunk of req) {
        chunks.push(chunk);
      }
      const buffer = Buffer.concat(chunks);

      const cleanPhone = phoneNumber.replace(/\D/g, '');
      const jid = `${cleanPhone}@c.us`;

      await waClient.sendFile(jid, buffer, contentType, fileName, message);

      res.json({ success: true });
    } catch (err) {
      logger.error('File share to WhatsApp failed', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });
}

module.exports = { registerRoutes };
