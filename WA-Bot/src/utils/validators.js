'use strict';

const config = require('../config');

// ─── Emoji Number Normalization ─────────────────────────────────────
// WhatsApp keycap emoji numbers → plain digits
const EMOJI_MAP = {
  '0️⃣': '0', '0⃣': '0',
  '1️⃣': '1', '1⃣': '1',
  '2️⃣': '2', '2⃣': '2',
  '3️⃣': '3', '3⃣': '3',
  '4️⃣': '4', '4⃣': '4',
  '5️⃣': '5', '5⃣': '5',
  '6️⃣': '6', '6⃣': '6',
  '7️⃣': '7', '7⃣': '7',
  '8️⃣': '8', '8⃣': '8',
  '9️⃣': '9', '9⃣': '9',
};

/**
 * Normalize user input: trim whitespace and convert emoji numbers to digits.
 * @param {string} text - Raw input
 * @returns {string} Normalized text
 */
function normalizeInput(text) {
  if (typeof text !== 'string') return '';
  let normalized = text.trim();
  // Replace emoji keycap numbers with plain digits
  for (const [emoji, digit] of Object.entries(EMOJI_MAP)) {
    normalized = normalized.replace(new RegExp(emoji.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), digit);
  }
  return normalized.trim();
}

// ─── Command Matchers ───────────────────────────────────────────────

/**
 * Returns true if text is a greeting (hi, hello, hey, start).
 */
function isGreeting(text) {
  if (typeof text !== 'string') return false;
  const n = normalizeInput(text).toLowerCase();
  return /^(hi|hello|hey|start)$/i.test(n);
}

/**
 * Returns true if text means "menu" (menu, 9).
 */
function isMenu(text) {
  if (typeof text !== 'string') return false;
  const n = normalizeInput(text).toLowerCase();
  return n === 'menu' || n === '9';
}

/**
 * Returns true if text means "done" (done, #).
 */
function isDone(text) {
  if (typeof text !== 'string') return false;
  const n = normalizeInput(text).toLowerCase();
  return n === 'done' || n === '#';
}

/**
 * Returns true if text means "cancel" (cancel, 0).
 */
function isCancel(text) {
  if (typeof text !== 'string') return false;
  const n = normalizeInput(text).toLowerCase();
  return n === 'cancel' || n === '0';
}

// ─── Option Validators ──────────────────────────────────────────────

/**
 * Returns "1"-"5" if valid main menu option, null otherwise.
 */
function isValidMenuOption(text) {
  if (typeof text !== 'string') return null;
  const n = normalizeInput(text);
  if (['1', '2', '3', '4', '5'].includes(n)) return n;
  return null;
}

/**
 * Returns "1", "2", or "3" if valid share method, null otherwise.
 */
function isValidShareMethod(text) {
  if (typeof text !== 'string') return null;
  const n = normalizeInput(text);
  if (['1', '2', '3'].includes(n)) return n;
  return null;
}

/**
 * Returns the room number string if valid, null otherwise.
 */
function isValidRoomNumber(text) {
  if (typeof text !== 'string') return null;
  const n = normalizeInput(text);
  if (config.validRooms.includes(n)) return n;
  return null;
}

/**
 * Returns "1" or "2" if valid recipient type, null otherwise.
 */
function isValidRecipientType(text) {
  if (typeof text !== 'string') return null;
  const n = normalizeInput(text);
  if (n === '1' || n === '2') return n;
  return null;
}

// ─── Name & ID Utilities ────────────────────────────────────────────

/**
 * Remove all non-alphabetic characters and extra spaces from name.
 */
function sanitizeName(name) {
  if (typeof name !== 'string') return '';
  return name.replace(/[^a-zA-Z\s]/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Generate user ID: first char of sanitized name (uppercase) + last 4 digits of phone.
 */
function generateUserId(sanitizedName, phoneNumber) {
  const firstChar = sanitizedName.length > 0 ? sanitizedName[0].toUpperCase() : 'X';
  const digits = (phoneNumber || '').replace(/\D/g, '');
  const last4 = digits.length >= 4 ? digits.slice(-4) : digits.padStart(4, '0');
  return `${firstChar}${last4}`;
}

/**
 * Returns true if file size is within allowed limit.
 */
function validateFileSize(sizeBytes) {
  const maxBytes = config.bot.maxFileSizeMB * 1024 * 1024;
  return sizeBytes <= maxBytes;
}

/**
 * Generate a unique file ID.
 */
function generateFileId(isLink, linkUrl) {
  const isGoogleDocs = (url) => !!url && (url.includes('docs.google.com') || url.includes('drive.google.com'));
  const prefix = isLink ? (isGoogleDocs(linkUrl) ? 'D' : 'L') : 'F';
  const rand = Math.floor(10000 + Math.random() * 90000);
  return `${prefix}${rand}`;
}

/**
 * Verify if a given string is a valid URL/link.
 * Performs verification to avoid code snippets (e.g. console.log) being treated as links.
 */
function verifyIsLink(text) {
  if (!text || typeof text !== 'string') return false;
  const t = text.trim();

  // 1. If it starts with http:// or https:// or www., it is highly likely a link
  if (/^(https?:\/\/|www\.)/i.test(t)) {
    return /^(https?:\/\/|www\.)[^\s]+$/i.test(t);
  }

  // 2. Otherwise, check if it matches a domain pattern with a known/common TLD
  const commonTlds = [
    'com', 'org', 'net', 'edu', 'gov', 'mil', 'biz', 'info', 'mobi', 'name',
    'aero', 'jobs', 'museum', 'io', 'co', 'me', 'tv', 'cc', 'ly', 'live',
    'dev', 'app', 'xyz', 'us', 'uk', 'ca', 'de', 'jp', 'fr', 'au', 'in', 'ru',
    'ch', 'it', 'nl', 'se', 'no', 'es', 'br', 'za'
  ];
  
  const tldPattern = commonTlds.join('|');
  const domainRegex = new RegExp(`^[a-zA-Z0-9]([a-zA-Z0-9-]*\\.)+(${tldPattern})(\\/[^\\s]*)?$`, 'i');

  if (domainRegex.test(t)) {
    return true;
  }

  // Fallback: If it's a general domain pattern but not in common TLDs, check if it looks like code
  const cleanDomainRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]*\.)+[a-zA-Z]{2,10}(\/[a-zA-Z0-9\-._~%!$&'()*+,;=:@/]*\??[a-zA-Z0-9\-._~%!$&'()*+,;=:@/?#]*)?$/i;
  if (cleanDomainRegex.test(t)) {
    // Ensure it does not contain common code-like characters
    const codeChars = /[\(\)\{\}\[\]\;]/;
    if (!codeChars.test(t)) {
      return true;
    }
  }

  return false;
}

/**
 * Detect and normalize a link in the given text.
 * Returns the normalized link (with protocol) or null.
 */
function detectAndNormalizeLink(text, messageLinks = []) {
  if (!text || typeof text !== 'string') return null;
  const trimmed = text.trim();

  // 1. Check if WhatsApp detected any links in this message
  if (Array.isArray(messageLinks) && messageLinks.length > 0) {
    for (const linkStr of messageLinks) {
      if (linkStr) {
        let rawLink = linkStr.trim();
        if (verifyIsLink(rawLink)) {
          if (!/^https?:\/\//i.test(rawLink)) {
            rawLink = 'https://' + rawLink;
          }
          return rawLink;
        }
      }
    }
  }

  // 2. Fallback: Parse the body ourselves to find an explicit URL
  const explicitUrlMatch = trimmed.match(/https?:\/\/[^\s]+/i);
  if (explicitUrlMatch) {
    const matchedUrl = explicitUrlMatch[0];
    if (verifyIsLink(matchedUrl)) {
      return matchedUrl;
    }
  }

  // 3. Check if the entire text (or a single word) matches a domain pattern
  const words = trimmed.split(/\s+/);
  for (const word of words) {
    if (verifyIsLink(word)) {
      let normalized = word;
      if (!/^https?:\/\//i.test(normalized)) {
        normalized = 'https://' + normalized;
      }
      return normalized;
    }
  }

  return null;
}

module.exports = {
  normalizeInput,
  isGreeting,
  isMenu,
  isDone,
  isCancel,
  isValidMenuOption,
  isValidShareMethod,
  isValidRoomNumber,
  isValidRecipientType,
  sanitizeName,
  generateUserId,
  validateFileSize,
  generateFileId,
  verifyIsLink,
  detectAndNormalizeLink,
};
