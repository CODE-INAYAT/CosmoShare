'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const config = require('../config');
const logger = require('../utils/logger');

// Local working path for Git operations
const GIT_TEMP_DIR = path.resolve(__dirname, '..', '..', 'temp', 'git-storage-repo');

/**
 * Configure global git name and email if not set.
 */
function configureGitUser() {
  try {
    execSync('git config --global user.name "CosmoShare WA-BOT"');
    execSync('git config --global user.email "bot@cosmoshare.live"');
    // Set safe directory for git to avoid permission check warnings in containers
    execSync('git config --global --add safe.directory "*"');
  } catch (err) {
    logger.debug('Failed to configure global Git user settings (non-critical)', { error: err.message });
  }
}

/**
 * Get remote HTTPS Git URL containing credentials.
 */
function getRemoteGitUrl() {
  const { dataset, token } = config.hf;
  if (!dataset || !token) return null;
  // Format: https://user:HF_TOKEN@huggingface.co/datasets/username/datasetname
  return `https://user:${token}@huggingface.co/datasets/${dataset}`;
}

/**
 * Restore session files from the Hugging Face Dataset.
 * Runs once on startup.
 */
async function restoreSession() {
  const remoteUrl = getRemoteGitUrl();
  if (!remoteUrl) {
    logger.info('Hugging Face Dataset persistence is NOT enabled (missing HF_TOKEN or HF_DATASET)');
    return false;
  }

  logger.info('Attempting to restore session from Hugging Face Dataset...', { dataset: config.hf.dataset });

  // If native persistent storage (/data) is writable, we prefer that over git sync
  if (config.bot.sessionDir.startsWith('/data')) {
    logger.info('Using native Hugging Face Spaces Persistent Storage mount (/data). Skipping Git clone.');
    return true;
  }

  const destSessionDir = path.resolve(config.bot.sessionDir);

  try {
    configureGitUser();

    // Clean up old temp git dir if exists
    if (fs.existsSync(GIT_TEMP_DIR)) {
      fs.rmSync(GIT_TEMP_DIR, { recursive: true, force: true });
    }

    // Shallow clone of the remote dataset
    logger.debug('Cloning session dataset...');
    execSync(`git clone --depth 1 ${remoteUrl} "${GIT_TEMP_DIR}"`, { stdio: 'ignore' });

    // Restore files
    const sourceAuthDir = path.join(GIT_TEMP_DIR, '.wwebjs_auth');
    const sourceNamesFile = path.join(GIT_TEMP_DIR, 'names.json');
    const sourceStateFile = path.join(GIT_TEMP_DIR, 'state.json');
    const sourcePauseFile = path.join(GIT_TEMP_DIR, 'pause.json');

    let restored = false;

    // Create session directory if missing
    if (!fs.existsSync(destSessionDir)) {
      fs.mkdirSync(destSessionDir, { recursive: true });
    }

    // Copy auth sessions folder
    if (fs.existsSync(sourceAuthDir)) {
      logger.info('Found .wwebjs_auth folder in dataset. Restoring WhatsApp credentials...');
      const destAuthDir = path.join(destSessionDir, '.wwebjs_auth');
      if (fs.existsSync(destAuthDir)) {
        fs.rmSync(destAuthDir, { recursive: true, force: true });
      }
      fs.cpSync(sourceAuthDir, destAuthDir, { recursive: true });
      restored = true;
    }

    // Copy names database
    if (fs.existsSync(sourceNamesFile)) {
      logger.info('Found names.json database in dataset. Restoring user names...');
      fs.copyFileSync(sourceNamesFile, path.join(destSessionDir, 'names.json'));
      restored = true;
    }

    // Copy state database
    if (fs.existsSync(sourceStateFile)) {
      logger.info('Found state.json database in dataset. Restoring conversation states...');
      fs.copyFileSync(sourceStateFile, path.join(destSessionDir, 'state.json'));
      restored = true;
    }

    // Copy pause state
    if (fs.existsSync(sourcePauseFile)) {
      logger.info('Found pause.json in dataset. Restoring pause state...');
      fs.copyFileSync(sourcePauseFile, path.join(destSessionDir, 'pause.json'));
      restored = true;
    }

    if (restored) {
      logger.info('✅ WhatsApp session restored successfully from Hugging Face Dataset');
    } else {
      logger.info('No session files found in dataset. Starting fresh.');
    }
    return true;
  } catch (err) {
    logger.error('Failed to restore session from Hugging Face Dataset', { error: err.message });
    return false;
  }
}

/**
 * Backup session files to the Hugging Face Dataset.
 * Runs asynchronously on connection ready / auth successful and name updates.
 */
async function backupSession() {
  const remoteUrl = getRemoteGitUrl();
  if (!remoteUrl) return false;

  // Skip Git sync if using native persistent storage (/data)
  if (config.bot.sessionDir.startsWith('/data')) {
    logger.debug('Skipping Git push: Native persistent storage (/data) is in use.');
    return true;
  }

  logger.info('Syncing/backing up session files to Hugging Face Dataset...', { dataset: config.hf.dataset });

  const srcSessionDir = path.resolve(config.bot.sessionDir);
  if (!fs.existsSync(srcSessionDir)) {
    logger.warn('Session directory does not exist. Skipping backup.');
    return false;
  }

  try {
    configureGitUser();

    // Clean or create temp git workspace
    if (fs.existsSync(GIT_TEMP_DIR)) {
      fs.rmSync(GIT_TEMP_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(GIT_TEMP_DIR, { recursive: true });

    // Copy current session files to temp git directory
    const destAuthDir = path.join(GIT_TEMP_DIR, '.wwebjs_auth');
    const srcAuthDir = path.join(srcSessionDir, '.wwebjs_auth');
    if (fs.existsSync(srcAuthDir)) {
      fs.cpSync(srcAuthDir, destAuthDir, { recursive: true });
    }

    const srcNamesFile = path.join(srcSessionDir, 'names.json');
    if (fs.existsSync(srcNamesFile)) {
      fs.copyFileSync(srcNamesFile, path.join(GIT_TEMP_DIR, 'names.json'));
    }

    const srcStateFile = path.join(srcSessionDir, 'state.json');
    if (fs.existsSync(srcStateFile)) {
      fs.copyFileSync(srcStateFile, path.join(GIT_TEMP_DIR, 'state.json'));
    }

    const srcPauseFile = path.join(srcSessionDir, 'pause.json');
    if (fs.existsSync(srcPauseFile)) {
      fs.copyFileSync(srcPauseFile, path.join(GIT_TEMP_DIR, 'pause.json'));
    }

    // Write a standard Hugging Face dataset README.md card
    const readmeContent = 
      `---\n` +
      `pretty_name: CosmoShare WA-BOT Sessions Backup\n` +
      `description: Automatically managed credentials and user name records for CosmoShare WA-BOT.\n` +
      `---\n\n` +
      `# CosmoShare WA-BOT Sessions Backup\n\n` +
      `⚠️ **Do not edit these files manually.**\n\n` +
      `This repository stores authenticated WhatsApp session credentials and name databases.\n` +
      `It is updated automatically by your bot container.`;
    fs.writeFileSync(path.join(GIT_TEMP_DIR, 'README.md'), readmeContent);

    // Git initialization and orphan push to reset commit history (zero history bloat)
    logger.debug('Staging and pushing changes to Hugging Face...');
    
    // Commands executed inside the git temp dir
    const opts = { cwd: GIT_TEMP_DIR, stdio: 'ignore' };
    
    execSync('git init', opts);
    execSync('git checkout -b main', opts);
    execSync('git add .', opts);
    execSync('git commit -m "Backup WhatsApp session state"', opts);
    execSync(`git remote add origin ${remoteUrl}`, opts);
    
    // Force push to overwrite history (maintains a clean, single-commit repository)
    execSync('git push --force origin main', opts);

    logger.info('✅ WhatsApp session backed up successfully to Hugging Face Dataset');
    
    // Clean up temporary workspace directory
    fs.rmSync(GIT_TEMP_DIR, { recursive: true, force: true });
    return true;
  } catch (err) {
    logger.error('Failed to backup session to Hugging Face Dataset', { error: err.message });
    return false;
  }
}

module.exports = {
  restoreSession,
  backupSession,
};
