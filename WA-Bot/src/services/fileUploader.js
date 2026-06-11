'use strict';

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

/**
 * Upload all files from a user session to the bridge service.
 *
 * @param {string} userId - WhatsApp user ID
 * @param {object} sessionManager - SessionManager instance
 * @param {object} bridgeClient - BridgeClient instance
 * @returns {Array} Array of uploaded file references from the bridge
 */
async function uploadSessionFiles(userId, sessionManager, bridgeClient) {
  const session = sessionManager.getSessionData(userId);
  if (!session) {
    throw new Error(`No session found for user ${userId}`);
  }

  const filePaths = session.files
    .map((f) => f.tempPath)
    .filter((p) => p && fs.existsSync(p));

  if (filePaths.length === 0 && session.links.length === 0 && session.codeSnippets.length === 0) {
    logger.warn('No files, links, or code snippets to upload', { userId });
    return { uploadId: null, files: [] };
  }

  // Upload all files in a single batch — bridge returns { uploadId, files: [...] }
  if (filePaths.length > 0) {
    try {
      const result = await bridgeClient.uploadFiles(filePaths, userId);
      logger.info('Files uploaded successfully', { userId, count: filePaths.length, uploadId: result.uploadId });
      return result; // { uploadId, files: [{ key, fileName, fileSize, fileType }] }
    } catch (err) {
      logger.error('Batch upload failed, attempting individual uploads', { userId, error: err.message });

      // Fallback: upload files one by one, use the last successful uploadId
      let lastResult = { uploadId: null, files: [] };
      for (const filePath of filePaths) {
        try {
          const result = await bridgeClient.uploadFiles([filePath], userId);
          lastResult = result;
          logger.info('Individual file uploaded', { userId, file: path.basename(filePath) });
        } catch (individualErr) {
          logger.error('Individual file upload failed', {
            userId,
            file: path.basename(filePath),
            error: individualErr.message,
          });
        }
      }
      return lastResult;
    }
  }

  return { uploadId: null, files: [] };
}

/**
 * Build FormData from an array of file paths.
 * @param {string[]} files - Array of absolute file paths
 * @returns {FormData}
 */
function buildFormData(files) {
  const mime = require('mime-types');
  const form = new FormData();

  for (const filePath of files) {
    if (fs.existsSync(filePath)) {
      const fileBuffer = fs.readFileSync(filePath);
      const fileName = path.basename(filePath);
      const mimeType = mime.lookup(filePath) || 'application/octet-stream';
      const blob = new Blob([fileBuffer], { type: mimeType });
      form.append('files', blob, fileName);
    }
  }

  return form;
}

module.exports = {
  uploadSessionFiles,
  buildFormData,
};
