'use strict';

const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * whatsapp-web.js auth persistence.
 * Uses LocalAuth strategy with session stored in /data (HF persistent volume).
 * Backs up to HF Dataset via git for cold-start recovery.
 */

const AUTH_DIR = path.resolve(config.bot.sessionDir, 'wwebjs_auth');

/**
 * Get the auth directory path for whatsapp-web.js LocalAuth.
 */
function getAuthDir() {
  if (!fs.existsSync(AUTH_DIR)) {
    fs.mkdirSync(AUTH_DIR, { recursive: true });
    logger.info({ path: AUTH_DIR }, 'Created auth directory');
  }
  return AUTH_DIR;
}

/**
 * Check if a valid session exists locally.
 */
function hasLocalSession() {
  if (!fs.existsSync(AUTH_DIR)) return false;
  // whatsapp-web.js LocalAuth stores session in session-<clientId>/Default/
  const sessionDir = path.join(AUTH_DIR, 'session-cosmoshare');
  return fs.existsSync(sessionDir) && fs.readdirSync(sessionDir).length > 0;
}

/**
 * Backup auth state to HF Dataset via git.
 */
async function backupAuthToDataset() {
  const { dataset, token } = config.hf;
  if (!dataset || !token) {
    logger.debug('HF Dataset backup skipped (no HF_DATASET or HF_TOKEN)');
    return;
  }

  const { execSync } = require('child_process');
  const GIT_TEMP = path.resolve(__dirname, '..', '..', 'temp', 'git-auth-backup');

  try {
    try {
      execSync('git config --global user.name "CosmoShare Bot"');
      execSync('git config --global user.email "bot@cosmoshare.live"');
      execSync('git config --global --add safe.directory "*"');
    } catch {}

    const remoteUrl = `https://user:${token}@huggingface.co/datasets/${dataset}`;

    if (fs.existsSync(GIT_TEMP)) {
      fs.rmSync(GIT_TEMP, { recursive: true, force: true });
    }

    execSync(`git clone -4 --depth 1 ${remoteUrl} "${GIT_TEMP}"`, { stdio: 'ignore' });

    // Copy auth files
    const destAuth = path.join(GIT_TEMP, 'wwebjs_auth');
    if (fs.existsSync(destAuth)) {
      fs.rmSync(destAuth, { recursive: true, force: true });
    }
    if (fs.existsSync(AUTH_DIR)) {
      fs.cpSync(AUTH_DIR, destAuth, { recursive: true });
    }

    execSync('git add -A', { cwd: GIT_TEMP, stdio: 'ignore' });
    try {
      execSync('git commit -m "Backup wwebjs auth state"', { cwd: GIT_TEMP, stdio: 'ignore' });
      execSync('git push', { cwd: GIT_TEMP, stdio: 'ignore' });
      logger.info('Auth state backed up to HF Dataset');
    } catch {
      logger.debug('No auth changes to backup');
    }

    fs.rmSync(GIT_TEMP, { recursive: true, force: true });
  } catch (err) {
    logger.error({ error: err.message }, 'Auth backup to dataset failed');
    try { fs.rmSync(GIT_TEMP, { recursive: true, force: true }); } catch {}
  }
}

/**
 * Restore auth state from HF Dataset on cold start.
 */
async function restoreAuthFromDataset() {
  const { dataset, token } = config.hf;
  if (!dataset || !token) return false;

  // Skip if local session already exists
  if (hasLocalSession()) {
    logger.info('Local auth state exists, skipping dataset restore');
    return true;
  }

  const { execSync } = require('child_process');
  const GIT_TEMP = path.resolve(__dirname, '..', '..', 'temp', 'git-auth-restore');

  try {
    try {
      execSync('git config --global user.name "CosmoShare Bot"');
      execSync('git config --global user.email "bot@cosmoshare.live"');
      execSync('git config --global --add safe.directory "*"');
    } catch {}

    const remoteUrl = `https://user:${token}@huggingface.co/datasets/${dataset}`;

    if (fs.existsSync(GIT_TEMP)) {
      fs.rmSync(GIT_TEMP, { recursive: true, force: true });
    }

    execSync(`git clone -4 --depth 1 ${remoteUrl} "${GIT_TEMP}"`, { stdio: 'ignore' });

    const sourceAuth = path.join(GIT_TEMP, 'wwebjs_auth');
    if (fs.existsSync(sourceAuth)) {
      if (!fs.existsSync(AUTH_DIR)) {
        fs.mkdirSync(AUTH_DIR, { recursive: true });
      }
      fs.cpSync(sourceAuth, AUTH_DIR, { recursive: true });
      logger.info('Auth state restored from HF Dataset');

      fs.rmSync(GIT_TEMP, { recursive: true, force: true });
      return true;
    }

    fs.rmSync(GIT_TEMP, { recursive: true, force: true });
    return false;
  } catch (err) {
    logger.error({ error: err.message }, 'Auth restore from dataset failed');
    try { fs.rmSync(GIT_TEMP, { recursive: true, force: true }); } catch {}
    return false;
  }
}

module.exports = { getAuthDir, hasLocalSession, backupAuthToDataset, restoreAuthFromDataset };
