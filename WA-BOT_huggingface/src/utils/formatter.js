'use strict';

const config = require('../config');

// ─── Main Menu & Navigation ─────────────────────────────────────────

function mainMenu(name) {
  return (
    `👋 Hi, *${name}*!\n\n` +
    `Welcome to *CosmoShare WA-BOT*\n\n` +
    `What would you like to do?\n\n` +
    `1️⃣  OneShare – _One code, one device_\n` +
    `2️⃣  MultiShare – _One code, many devices_\n` +
    `3️⃣  LabShare – _Share within a lab room_\n` +
    `4️⃣  ✏️ Edit Name\n` +
    `5️⃣  ❓ Help\n\n` +
    `_Reply with a number to continue (e.g., 1, 2, or 3)._`
  );
}

function helpMessage() {
  return (
    `📖 *CosmoShare Help*\n\n` +
    `• *OneShare* — Generate a 4-digit code. Enter it on any device at cosmoshare.live to receive your files instantly.\n\n` +
    `• *MultiShare* — Same code works on multiple devices at the same time.\n\n` +
    `• *LabShare* — Send files, links, or code snippets directly to a lab room's dashboard.\n\n` +
    `*Quick Commands*\n` +
    `• *Done/#* — Finish adding files and proceed\n` +
    `• *Cancel/0* — Cancel current session\n` +
    `• *Menu/9* — Return to main menu\n\n` +
    `_Type *menu/9* to go back._`
  );
}

function invalidMenuOption() {
  return `Please reply with a number from *1* to *5*.`;
}

// ─── Name Editing ───────────────────────────────────────────────────

function editNamePrompt(currentName) {
  return (
    `Your current name: *${currentName}*\n\n` +
    `What would you like to change it to?\n\n` +
    `_Type your new name, or type *cancel/0* to go back._`
  );
}

function nameUpdated(newName) {
  return `✅ Name updated to *${newName}*.`;
}

// ─── Collecting Mode Entry ──────────────────────────────────────────

function collectingEntry(method) {
  let icon = '📤';
  let label = 'Share';

  switch (method) {
    case 'oneshare':
      label = 'OneShare'; break;
    case 'multishare':
      label = 'MultiShare'; break;
    case 'labshare':
      icon = '🏫';
      label = 'LabShare'; break;
  }

  return (
    `${icon} *${label}*\n\n` +
    `Send your files, links, or code snippets now.\n` +
    `Type *Done/#* when you're finished.`
  );
}

// ─── File/Link/Code Receipts ────────────────────────────────────────

function fileReceivedMessage(fileName, fileSizeMB) {
  return `✅ File received: *${fileName}*`;
}

function linkReceivedMessage(url) {
  return `✅ Link saved.`;
}

function codeSnippetReceivedMessage() {
  return `✅ Code snippet saved. Send more, or type *Done/#* to finish.`;
}

function fileSkippedTooLargeMessage(fileName, fileSizeMB, maxMB) {
  return (
    `⚠️ *${fileName}* (${fileSizeMB} MB) exceeds the ${maxMB} MB file size limit and was skipped.\n\n` +
    `For unlimited sharing, please use the CosmoShare Web Application.`
  );
}

// ─── LabShare Prompts ───────────────────────────────────────────────

function askRoomNumber(hasCodeSnippets) {
  let msg = `Which room?\n\n_Reply with the room number (e.g., 309)._`;
  if (hasCodeSnippets) {
    msg += `\n\n*Note:* _Code snippets are shared only with students (not with Lab Admin)._`;
  }
  return msg;
}

function showRecipientOptions(roomNumber) {
  return (
    `Who should receive this in Room *${roomNumber}*?\n\n` +
    `1️⃣  Lab Admin (Print)\n` +
    `2️⃣  Everyone (Admin + Students)\n\n` +
    `_Type *cancel/0* to go back._`
  );
}

// ─── Sharing Status (Personalized) ──────────────────────────────────

function sendingMessage(stats) {
  const hasFiles = (stats.totalFiles || 0) > 0;
  const hasLinks = (stats.totalLinks || 0) > 0;
  const hasCode = (stats.totalCodeSnippets || 0) > 0;

  let contentLabel;
  if (hasCode) {
    contentLabel = 'code snippets';
  } else if (hasFiles && hasLinks) {
    contentLabel = 'files & links';
  } else if (hasFiles) {
    contentLabel = 'files';
  } else if (hasLinks) {
    contentLabel = 'links';
  } else {
    contentLabel = 'files';
  }

  return `⏳ Sharing your ${contentLabel}, please wait!...`;
}

// ─── Success Messages ───────────────────────────────────────────────

function oneShareSuccess({ code, validFor, totalFiles, links, codeSnippets, size }) {
  const isCode = (codeSnippets || 0) > 0;

  let stats;
  if (isCode) {
    stats = `📋 Code Snippets: ${codeSnippets}`;
  } else {
    stats = `📎 Files: ${totalFiles} | Links: ${links || 0}\n💾 Size: ${size} MB`;
  }

  return (
    `✅ *Share Ready!*\n\n` +
    `📌 Code: *${code}*\n` +
    `⏰ Valid for: *${validFor}*\n` +
    `${stats}\n\n` +
    `Open *cosmoshare.live* and enter the code to receive your files.`
  );
}

function multiShareSuccess({ code, validFor, totalFiles, links, codeSnippets, size }) {
  const isCode = (codeSnippets || 0) > 0;

  let stats;
  if (isCode) {
    stats = `📋 Code Snippets: ${codeSnippets}`;
  } else {
    stats = `📎 Files: ${totalFiles} | Links: ${links || 0}\n💾 Size: ${size} MB`;
  }

  return (
    `✅ *Share Ready!*\n\n` +
    `📌 Code: *${code}*\n` +
    `⏰ Valid for: *${validFor}*\n` +
    `${stats}\n\n` +
    `Open *cosmoshare.live* and enter the code.\n` +
    `Multiple devices can receive at the same time.`
  );
}

function labShareSuccess({ name, id, room, to, totalFiles, links, codeSnippets, size }) {
  const isCode = (codeSnippets || 0) > 0;

  let stats;
  if (isCode) {
    stats = `📋 Code Snippets: ${codeSnippets}`;
  } else {
    stats = `📎 Files: ${totalFiles} | Links: ${links || 0}\n💾 Size: ${size} MB`;
  }

  return (
    `✅ *Shared Successfully!*\n\n` +
    `👤 Name: *${name} (${id})*\n` +
    `🏫 Room: *${room}*\n` +
    `📩 To: *${to}*\n` +
    `${stats}`
  );
}

// ─── Error & Validation Messages ────────────────────────────────────

function noFilesError() {
  return (
    `You haven't sent any files yet.\n` +
    `Send files, links, or code first, then type *Done/#*.`
  );
}

function invalidShareMethodError() {
  return `Please reply with *1*, *2*, or *3*.`;
}

function invalidRoomError(validRooms) {
  const roomList = validRooms.join(', ');
  return (
    `That's not a valid room number.\n\n` +
    `*Available rooms:*\n${roomList}\n\n` +
    `_Enter a valid room number, or type *cancel/0* to go back._`
  );
}

function invalidRecipientError() {
  return `Please reply with *1* or *2*.`;
}

function codeSnippetBlockedByFiles() {
  return `⚠️ You're currently sharing files. Type *Done/#* first, then you can share code snippets.`;
}

function filesBlockedByCodeSnippet() {
  return `⚠️ You're currently sharing code snippets. Type *Done/#* first, then you can share files.`;
}

// ─── Session & Status Messages ──────────────────────────────────────

function alreadyInSessionMessage() {
  return (
    `You have an active session.\n` +
    `Continue sending files, or type *Done/#* to finish.\n\n` +
    `_Type *cancel/0* to start over._`
  );
}

function sessionExpiredMessage() {
  return `⏰ Your session has expired due to inactivity.`;
}

function cancelledMessage() {
  return `Session cancelled.\n\n_Type *menu/9* to start over._`;
}

function serviceUnavailableMessage() {
  return `⚠️ Service is temporarily unavailable. Please try again.\n\n_Type *menu/9* to go back to the main menu._`;
}

function genericErrorMessage() {
  return `❌ Something went wrong. Please try again or type *menu/9* to start over.`;
}

function promptGreeting() {
  return `👋 Hi there! Type *menu* to start sharing files with CosmoShare.`;
}

// ─── Exports ────────────────────────────────────────────────────────

module.exports = {
  // Menu & Navigation
  mainMenu,
  helpMessage,
  invalidMenuOption,

  // Name
  editNamePrompt,
  nameUpdated,

  // Collecting
  collectingEntry,
  fileReceivedMessage,
  linkReceivedMessage,
  codeSnippetReceivedMessage,
  fileSkippedTooLargeMessage,

  // LabShare
  askRoomNumber,
  showRecipientOptions,

  // Sharing
  sendingMessage,
  oneShareSuccess,
  multiShareSuccess,
  labShareSuccess,

  // Errors & Validation
  noFilesError,
  invalidShareMethodError,
  invalidRoomError,
  invalidRecipientError,
  codeSnippetBlockedByFiles,
  filesBlockedByCodeSnippet,

  // Session & Status
  alreadyInSessionMessage,
  sessionExpiredMessage,
  cancelledMessage,
  serviceUnavailableMessage,
  genericErrorMessage,
  promptGreeting,
};
