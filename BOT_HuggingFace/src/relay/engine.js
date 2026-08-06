'use strict';

/**
 * Relay Engine — Core orchestrator for file/link/code transfer.
 * 
 * Handles two directions:
 * 1. OUTBOUND (WhatsApp → Web): Download from WA, stage locally, create OneShare/LabShare
 * 2. INBOUND  (Web → WhatsApp): Receive via REST API, send to WA via whatsapp-web.js
 * 
 * Replaces the old WebRTC-based transfer with server-mediated HTTP relay.
 * Zero ICE negotiation, zero DataChannel chunking.
 */

const path = require('path');
const mime = require('mime-types');
const logger = require('../utils/logger');
const config = require('../config');
const fileStage = require('./fileStage');
const signalingManager = require('../signaling/manager');
const validators = require('../utils/validators');

/**
 * Get the base URL for relay file downloads.
 * On HF Spaces, this is the Space's public URL.
 */
function getBaseUrl() {
  if (process.env.SPACE_ID) {
    const parts = process.env.SPACE_ID.split('/');
    if (parts.length === 2) {
      return `https://${parts[0]}-${parts[1].replace(/_/g, '-')}.hf.space`;
    }
  }
  return `http://localhost:${config.health.port}`;
}

/**
 * Create a OneShare session from collected session data.
 * Stages all files and registers the session in signaling instantly.
 * 
 * @param {object} sessionData - { files, links, codeSnippets }
 * @returns {{ code: string }}
 */
function createOneShare(sessionData) {
  const baseUrl = getBaseUrl();
  const relayFiles = [];
  const relayLinks = [];
  const relayCodeSnippets = [];

  // Stage files and generate download URLs
  for (const file of (sessionData.files || [])) {
    if (file.buffer) {
      const uuid = fileStage.stageFile(
        file.buffer,
        file.fileName,
        file.fileType || file.mimetype || 'application/octet-stream'
      );
      relayFiles.push({
        uuid,
        downloadUrl: `${baseUrl}/relay/files/${uuid}`,
        fileName: file.fileName,
        fileSize: file.buffer.length,
        fileType: file.fileType || file.mimetype || 'application/octet-stream',
        fileId: file.fileId,
      });
    }
  }

  // Collect links
  for (const link of (sessionData.links || [])) {
    relayLinks.push({
      url: link.url,
      fileId: link.fileId,
    });
  }

  // Collect code snippets
  for (const snippet of (sessionData.codeSnippets || [])) {
    relayCodeSnippets.push(snippet);
  }

  // Build file metadata for signaling (what the receiver sees)
  const filesMeta = relayFiles.map(f => ({
    fileName: f.fileName,
    fileSize: f.fileSize,
    fileType: f.fileType,
    fileId: f.fileId,
  }));

  // Create session in signaling (instant — in-process function call)
  const result = signalingManager.createOneShareSession({
    files: filesMeta,
    multiShare: true, // Always MultiShare for bot-created sessions
    relayFiles,
    relayLinks,
    relayCodeSnippets,
  });

  logger.info('OneShare relay created', {
    code: result.code,
    files: relayFiles.length,
    links: relayLinks.length,
    codeSnippets: relayCodeSnippets.length,
  });

  return { code: result.code };
}

/**
 * Create a LabShare session — join room and relay content to targets.
 * 
 * @param {object} sessionData - { files, links, codeSnippets }
 * @param {string} roomNumber
 * @param {string} recipientType - 'print' | 'students' | 'single' | 'all'
 * @param {string} senderName
 * @param {string} senderId
 * @param {string} [targetMemberId]
 * @returns {object}
 */
function createLabShare(sessionData, roomNumber, recipientType, senderName, senderId, targetMemberId) {
  const baseUrl = getBaseUrl();

  // Join room as virtual bot user (instant — in-process)
  const { virtualId, roomUsers } = signalingManager.joinRoom(roomNumber, {
    name: senderName.toUpperCase(),
    id: senderId,
    uniqueId: senderId,
  });

  logger.info('Bot joined lab room for LabShare', { roomNumber, usersCount: roomUsers.length, recipientType });

  // Determine targets
  let targets;
  if (recipientType === 'single' && targetMemberId) {
    targets = roomUsers.filter(u =>
      (u.uniqueId && u.uniqueId.toUpperCase() === targetMemberId.toUpperCase()) ||
      (u.logicalId && u.logicalId.toUpperCase() === targetMemberId.toUpperCase())
    );
  } else if (recipientType === 'print') {
    targets = roomUsers.filter(u => u.name === 'Lab Admin' || u.uniqueId === 'ADMIN');
  } else if (recipientType === 'students') {
    targets = roomUsers.filter(u => u.name !== 'Lab Admin' && u.uniqueId !== 'ADMIN');
  } else {
    targets = roomUsers;
  }

  // Check if single-member target exists
  if (recipientType === 'single' && targetMemberId && targets.length === 0) {
    signalingManager.leaveRoom(roomNumber, virtualId);
    return {
      memberNotFound: true,
      name: senderName,
      id: senderId,
      room: roomNumber,
      to: recipientType,
    };
  }

  // Stage files
  const relayFiles = [];
  for (const file of (sessionData.files || [])) {
    if (file.buffer) {
      const uuid = fileStage.stageFile(
        file.buffer,
        file.fileName,
        file.fileType || file.mimetype || 'application/octet-stream'
      );
      relayFiles.push({
        uuid,
        downloadUrl: `${baseUrl}/relay/files/${uuid}`,
        fileName: file.fileName,
        fileSize: file.buffer.length,
        fileType: file.fileType || file.mimetype || 'application/octet-stream',
        fileId: file.fileId,
        senderName: senderName.toUpperCase(),
        senderUniqueId: senderId,
      });
    }
  }

  // Relay content to each target (instant — in-process)
  for (const target of targets) {
    // Relay files
    for (const rf of relayFiles) {
      signalingManager.relayFileToTarget(target.id, rf);
    }

    // Relay links
    for (const link of (sessionData.links || [])) {
      signalingManager.relayLinkToTarget(target.id, {
        linkUrl: link.url,
        fileId: link.fileId,
        senderName: senderName.toUpperCase(),
        senderUniqueId: senderId,
      });
    }

    // Relay code snippets
    for (const snippet of (sessionData.codeSnippets || [])) {
      signalingManager.relayCodeToTarget(target.id, {
        codeSnippet: snippet,
        senderName: senderName.toUpperCase(),
        senderUniqueId: senderId,
      });
    }
  }

  // Get target member name for single-member share
  let targetMemberName = null;
  if (recipientType === 'single' && targets.length > 0) {
    targetMemberName = targets[0].name || targetMemberId;
  }

  // Leave room after a delay
  setTimeout(() => {
    signalingManager.leaveRoom(roomNumber, virtualId);
  }, 5000);

  logger.info('LabShare relay complete', {
    roomNumber,
    recipientType,
    targetsCount: targets.length,
    filesRelayed: relayFiles.length,
  });

  return {
    name: senderName,
    id: senderId,
    room: roomNumber,
    to: recipientType,
    targetMemberName,
  };
}

module.exports = {
  createOneShare,
  createLabShare,
  getBaseUrl,
};
