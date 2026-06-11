'use strict';

class SessionExpiredError extends Error {
  constructor(message = 'Session has expired') {
    super(message);
    this.name = 'SessionExpiredError';
    this.userMessage = '⏰ Your session has expired due to inactivity. Please send *Hi* to start a new session.';
  }
}

class InvalidInputError extends Error {
  constructor(message = 'Invalid input', userMessage) {
    super(message);
    this.name = 'InvalidInputError';
    this.userMessage = userMessage || '❌ Sorry, I didn\'t understand that. Please try again.';
  }
}

class FileTooLargeError extends Error {
  constructor(fileName, sizeMB, maxMB) {
    super(`File "${fileName}" is too large (${sizeMB} MB, max ${maxMB} MB)`);
    this.name = 'FileTooLargeError';
    this.fileName = fileName;
    this.sizeMB = sizeMB;
    this.maxMB = maxMB;
    this.userMessage = `⚠️ File *${fileName}* (${sizeMB} MB) exceeds the maximum allowed size of ${maxMB} MB and was skipped.`;
  }
}

class BridgeConnectionError extends Error {
  constructor(message = 'Failed to connect to bridge service') {
    super(message);
    this.name = 'BridgeConnectionError';
    this.userMessage = '🚫 Service is temporarily unavailable. Please try again later.';
  }
}

class RoomNotFoundError extends Error {
  constructor(roomNumber) {
    super(`Room "${roomNumber}" is not a valid lab room`);
    this.name = 'RoomNotFoundError';
    this.roomNumber = roomNumber;
    this.userMessage = `❌ Room *${roomNumber}* is not a valid lab room. Please enter a valid room number.`;
  }
}

class ShareCreationError extends Error {
  constructor(shareType, cause) {
    super(`Failed to create ${shareType}: ${cause}`);
    this.name = 'ShareCreationError';
    this.shareType = shareType;
    this.userMessage = `❌ Failed to create your ${shareType}. Please try again.`;
  }
}

module.exports = {
  SessionExpiredError,
  InvalidInputError,
  FileTooLargeError,
  BridgeConnectionError,
  RoomNotFoundError,
  ShareCreationError,
};
