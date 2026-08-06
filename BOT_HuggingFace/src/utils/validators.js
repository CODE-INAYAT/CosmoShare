'use strict';

const config = require('../config');

// ─── Emoji Number Normalization ─────────────────────────────────────
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

function normalizeInput(text) {
  if (typeof text !== 'string') return '';
  let normalized = text.trim();
  for (const [emoji, digit] of Object.entries(EMOJI_MAP)) {
    normalized = normalized.replace(new RegExp(emoji.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), digit);
  }
  return normalized.trim();
}

// ─── Command Matchers ───────────────────────────────────────────────

function isGreeting(text) {
  if (typeof text !== 'string') return false;
  const n = normalizeInput(text).toLowerCase();
  return /^(hi|hello|hey|start)$/i.test(n);
}

function isMenu(text) {
  if (typeof text !== 'string') return false;
  const n = normalizeInput(text).toLowerCase();
  return n === 'menu' || n === '9';
}

function isDone(text) {
  if (typeof text !== 'string') return false;
  const n = normalizeInput(text).toLowerCase();
  return n === 'done' || n === '#';
}

function isCancel(text) {
  if (typeof text !== 'string') return false;
  const n = normalizeInput(text).toLowerCase();
  return n === 'cancel' || n === '0';
}

// ─── Option Validators ──────────────────────────────────────────────

function isValidMenuOption(text) {
  if (typeof text !== 'string') return null;
  const n = normalizeInput(text);
  if (['1', '2', '3', '4', '5'].includes(n)) return n;
  return null;
}

function isValidShareMethod(text) {
  if (typeof text !== 'string') return null;
  const n = normalizeInput(text);
  if (['1', '2', '3'].includes(n)) return n;
  return null;
}

function isValidRoomNumber(text) {
  if (typeof text !== 'string') return null;
  const n = normalizeInput(text);
  if (config.validRooms.includes(n)) return n;
  return null;
}

function isValidRecipientType(text) {
  if (typeof text !== 'string') return null;
  const n = normalizeInput(text);
  if (n === '1' || n === '2') return n;
  return null;
}

function isValidStudentOption(text) {
  if (typeof text !== 'string') return null;
  const n = normalizeInput(text);
  if (n === '1' || n === '2') return n;
  return null;
}

function isValidMemberId(text) {
  if (typeof text !== 'string') return null;
  const n = normalizeInput(text).trim();
  if (/^[a-zA-Z]\d{1,10}$/.test(n)) return n.toUpperCase();
  return null;
}

// ─── Name & ID Utilities ────────────────────────────────────────────

function sanitizeName(name) {
  if (typeof name !== 'string') return '';
  return name.replace(/[^a-zA-Z\s]/g, '').replace(/\s+/g, ' ').trim();
}

function generateUserId(sanitizedName, phoneNumber) {
  const firstChar = sanitizedName.length > 0 ? sanitizedName[0].toUpperCase() : 'X';
  const digits = (phoneNumber || '').replace(/\D/g, '');
  const last4 = digits.length >= 4 ? digits.slice(-4) : digits.padStart(4, '0');
  return `${firstChar}${last4}`;
}

function validateFileSize(sizeBytes) {
  const maxBytes = config.bot.maxFileSizeMB * 1024 * 1024;
  return sizeBytes <= maxBytes;
}

function generateFileId(isLink, linkUrl) {
  const isGoogleDocs = (url) => !!url && (url.includes('docs.google.com') || url.includes('drive.google.com'));
  const prefix = isLink ? (isGoogleDocs(linkUrl) ? 'D' : 'L') : 'F';
  const rand = Math.floor(10000 + Math.random() * 90000);
  return `${prefix}${rand}`;
}

// ─── Link Detection ─────────────────────────────────────────────────

function verifyIsLink(text) {
  if (!text || typeof text !== 'string') return false;
  const t = text.trim();

  if (/^(https?:\/\/|www\.)/i.test(t)) {
    return /^(https?:\/\/|www\.)[^\s]+$/i.test(t);
  }

  const commonTlds = [
    'com', 'org', 'net', 'edu', 'gov', 'mil', 'biz', 'info', 'mobi', 'name',
    'aero', 'jobs', 'museum', 'io', 'co', 'me', 'tv', 'cc', 'ly', 'live',
    'dev', 'app', 'xyz', 'us', 'uk', 'ca', 'de', 'jp', 'fr', 'au', 'in', 'ru',
    'ch', 'it', 'nl', 'se', 'no', 'es', 'br', 'za'
  ];
  const tldPattern = commonTlds.join('|');
  const domainRegex = new RegExp(`^[a-zA-Z0-9]([a-zA-Z0-9-]*\\.)+(${tldPattern})(\\/[^\\s]*)?$`, 'i');

  if (domainRegex.test(t)) return true;

  const cleanDomainRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]*\.)+[a-zA-Z]{2,10}(\/[a-zA-Z0-9\-._~%!$&'()*+,;=:@/]*\??[a-zA-Z0-9\-._~%!$&'()*+,;=:@/?#]*)?$/i;
  if (cleanDomainRegex.test(t)) {
    const codeChars = /[(){}[\];]/;
    if (!codeChars.test(t)) return true;
  }

  return false;
}

function detectAndNormalizeLink(text, messageLinks = []) {
  if (!text || typeof text !== 'string') return null;
  const trimmed = text.trim();

  if (Array.isArray(messageLinks) && messageLinks.length > 0) {
    for (const linkStr of messageLinks) {
      if (linkStr) {
        let rawLink = linkStr.trim();
        if (verifyIsLink(rawLink)) {
          if (!/^https?:\/\//i.test(rawLink)) rawLink = 'https://' + rawLink;
          return rawLink;
        }
      }
    }
  }

  const explicitUrlMatch = trimmed.match(/https?:\/\/[^\s]+/i);
  if (explicitUrlMatch) {
    const matchedUrl = explicitUrlMatch[0];
    if (verifyIsLink(matchedUrl)) return matchedUrl;
  }

  const words = trimmed.split(/\s+/);
  for (const word of words) {
    if (verifyIsLink(word)) {
      let normalized = word;
      if (!/^https?:\/\//i.test(normalized)) normalized = 'https://' + normalized;
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
  isValidStudentOption,
  isValidMemberId,
  sanitizeName,
  generateUserId,
  validateFileSize,
  generateFileId,
  verifyIsLink,
  detectAndNormalizeLink,
};
