'use strict';

/**
 * File Server — Express routes for serving staged files.
 * 
 * GET /relay/files/:uuid → Stream the file from memory or disk.
 * UUID acts as a capability token (unguessable, single-use-ish, TTL-limited).
 */

const fs = require('fs');
const logger = require('../utils/logger');
const fileStage = require('./fileStage');

/**
 * Register relay file routes on an Express app.
 * @param {import('express').Application} app
 */
function registerRoutes(app) {
  app.get('/relay/files/:uuid', (req, res) => {
    const { uuid } = req.params;

    const staged = fileStage.getStaged(uuid);
    if (!staged) {
      return res.status(404).json({ error: 'File not found or expired' });
    }

    // Set response headers
    res.set({
      'Content-Type': staged.mimeType,
      'Content-Disposition': `attachment; filename="${encodeURIComponent(staged.fileName)}"`,
      'Content-Length': staged.size,
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Expose-Headers': 'Content-Disposition',
    });

    // Stream from memory or disk
    if (staged.buffer) {
      res.end(staged.buffer);
    } else if (staged.tempPath && fs.existsSync(staged.tempPath)) {
      const stream = fs.createReadStream(staged.tempPath);
      stream.on('error', (err) => {
        logger.error('File stream error', { uuid, error: err.message });
        if (!res.headersSent) {
          res.status(500).json({ error: 'File stream error' });
        }
      });
      stream.pipe(res);
    } else {
      // File expired or was cleaned up between check and read
      fileStage.removeStaged(uuid);
      return res.status(404).json({ error: 'File no longer available' });
    }

    logger.info('File served', { uuid, fileName: staged.fileName, size: staged.size });
  });
}

module.exports = { registerRoutes };
