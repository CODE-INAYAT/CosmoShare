'use strict';

const logger = require('../utils/logger');
const config = require('../config');
const { BridgeConnectionError, ShareCreationError } = require('../utils/errors');

const DEFAULT_TIMEOUT_MS = 30000;
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 1000;

class BridgeClient {
  /**
   * @param {string} baseUrl - Bridge API base URL
   * @param {string} apiSecret - API secret for authentication
   */
  constructor(baseUrl, apiSecret) {
    this.baseUrl = (baseUrl || '').replace(/\/+$/, '');
    this.apiSecret = apiSecret || '';
  }

  /**
   * Base HTTP request with auth, timeout, and retry logic.
   */
  async _request(method, urlPath, data, options = {}) {
    const url = `${this.baseUrl}${urlPath}`;
    const timeout = options.timeout || DEFAULT_TIMEOUT_MS;
    const maxRetries = options.retries != null ? options.retries : MAX_RETRIES;

    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      try {
        const fetchOptions = {
          method,
          headers: {
            'X-Bot-Secret': this.apiSecret,
            'Content-Type': 'application/json',
            'User-Agent': 'CosmoShare-WABot/1.0',
            ...(options.headers || {}),
          },
          signal: controller.signal,
        };

        if (data && method !== 'GET') {
          // If data is FormData (multipart), adjust headers
          if (options.isFormData) {
            delete fetchOptions.headers['Content-Type'];
            fetchOptions.body = data;
          } else {
            fetchOptions.body = JSON.stringify(data);
          }
        }

        const response = await fetch(url, fetchOptions);
        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorBody = await response.text().catch(() => 'No response body');
          throw new Error(`HTTP ${response.status}: ${errorBody}`);
        }

        const json = await response.json().catch(() => ({}));
        return json;
      } catch (err) {
        clearTimeout(timeoutId);
        lastError = err;

        if (err.name === 'AbortError') {
          logger.warn('Request timed out', { url, attempt, timeout });
        } else {
          logger.warn('Request failed', { url, attempt, error: err.message });
        }

        // Don't retry on 4xx errors
        if (err.message && /^HTTP 4\d\d/.test(err.message)) {
          break;
        }

        // Exponential backoff
        if (attempt < maxRetries) {
          const backoff = BASE_BACKOFF_MS * Math.pow(2, attempt - 1);
          await new Promise((resolve) => setTimeout(resolve, backoff));
        }
      }
    }

    throw new BridgeConnectionError(`Bridge request failed after ${maxRetries} attempts: ${lastError.message}`);
  }

  /**
   * Create a OneShare.
   */
  async createOneShare(uploadId, metadata) {
    try {
      return await this._request('POST', '/api/share/oneshare', {
        uploadId,
        metadata,
      });
    } catch (err) {
      if (err instanceof BridgeConnectionError) throw err;
      throw new ShareCreationError('OneShare', err.message);
    }
  }

  /**
   * Create a MultiShare.
   */
  async createMultiShare(uploadId, metadata) {
    try {
      return await this._request('POST', '/api/share/multishare', {
        uploadId,
        metadata,
      });
    } catch (err) {
      if (err instanceof BridgeConnectionError) throw err;
      throw new ShareCreationError('MultiShare', err.message);
    }
  }

  /**
   * Create a Lab Share.
   */
  async createLabShare(uploadId, metadata, roomNumber, recipientType, senderName, senderId) {
    try {
      return await this._request('POST', '/api/share/labshare', {
        uploadId,
        roomNumber,
        recipientType,
        senderName,
        senderId,
        metadata,
      });
    } catch (err) {
      if (err instanceof BridgeConnectionError) throw err;
      throw new ShareCreationError('LabShare', err.message);
    }
  }

  /**
   * Upload files via multipart form data.
   */
  async uploadFiles(filePaths, userId) {
    const fs = require('fs');
    const path = require('path');
    const mime = require('mime-types');

    // Use Node.js built-in FormData (available in Node 18+)
    // This works natively with the built-in fetch() — no boundary issues.
    const form = new FormData();
    form.append('userId', userId);

    for (const filePath of filePaths) {
      const fileBuffer = fs.readFileSync(filePath);
      const fileName = path.basename(filePath);
      const mimeType = mime.lookup(filePath) || 'application/octet-stream';
      const blob = new Blob([fileBuffer], { type: mimeType });
      form.append('files', blob, fileName);
    }

    return await this._request('POST', '/api/upload', form, {
      isFormData: true,
      timeout: 60000, // longer timeout for file uploads
    });
  }

  /**
   * Health check.
   */
  async healthCheck() {
    return await this._request('GET', '/api/health', null, {
      retries: 1,
      timeout: 5000,
    });
  }
}

// Singleton instance
const bridgeClient = new BridgeClient(config.bridge.apiUrl, config.bridge.apiSecret);

module.exports = bridgeClient;
