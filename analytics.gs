/**
 * ShareMe Analytics — Google Apps Script Backend
 *
 * Deploy as a Web App (Execute as "Me", Access "Anyone").
 * Receives analytics events via POST and updates "Day Stats"
 * and "Month Stats" sheets with accurate column placement.
 *
 * Supports both single events and batch arrays:
 *   Single: { event: "FILE_SHARED", value: 1 }
 *   Batch:  { batch: [{ event: "FILE_SHARED", value: 3 }, { event: "VISITOR", value: 1 }] }
 *
 * DEPLOYMENT:
 *   1. Paste this into Apps Script (Extensions > Apps Script)
 *   2. Deploy > New Deployment > Web App
 *   3. Execute as: Me, Access: Anyone
 *   4. Copy the URL into src/config/analytics.ts
 *
 * REDEPLOYING AFTER CHANGES:
 *   Deploy > Manage deployments > Edit > Version: New version > Deploy
 */

// ── Sheet Layout ──────────────────────────────────────────────────
//   A (1)  = Date
//   B (2)  = Files Shared
//   C (3)  = Links Shared
//   D (4)  = Codes Shared
//   E (5)  = Auto Shares
//   F (6)  = Canceled Transfers
//   G (7)  = Visitors
//   H (8)  = Room Joins
//   I (9)  = OneShare Users
//   J (10) = Admin Joins
//   K (11) = Student Joins
//   L (12) = Support Dialog
//   M (13) = OneShare-MultiShare
//   N (14) = File Size (MB)

var COL_INDEX = {
  'FILE_SHARED':        2,
  'LINK_SHARED':        3,
  'CODE_SHARED':        4,
  'AUTO_SHARE':         5,
  'CANCELED_TRANSFER':  6,
  'VISITOR':            7,
  'ROOM_JOIN':          8,
  'ONESHARE_USER':      9,
  'ADMIN_JOIN':         10,
  'STUDENT_JOIN':       11,
  'SUPPORT_DIALOG':     12,
  'ONESHARE_MULTISHARE':13,
  'FILE_SIZE':          14
};

var HEADERS = [
  'Date',
  'Files Shared',
  'Links Shared',
  'Codes Shared',
  'Auto Shares',
  'Canceled Transfers',
  'Visitors',
  'Room Joins',
  'OneShare Users',
  'Admin Joins',
  'Student Joins',
  'Support Dialog',
  'OneShare-MultiShare',
  'File Size (MB)'
];

var TOTAL_COLS = HEADERS.length; // 14

// ── Sheet Helpers ─────────────────────────────────────────────────

function getOrCreateSheet(ss, sheetName) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.appendRow(HEADERS);
    sheet.getRange(1, 1, 1, TOTAL_COLS).setFontWeight('bold');
    sheet.setFrozenRows(1);
    // Auto-resize all columns for readability
    for (var c = 1; c <= TOTAL_COLS; c++) {
      sheet.autoResizeColumn(c);
    }
  }
  return sheet;
}

/**
 * Find the 1-based row number for a given date string in column A.
 * Returns -1 if no matching row exists.
 */
function findRow(sheet, dateStr) {
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return -1;

  var values = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  // Search from bottom (newest dates at the end)
  for (var i = values.length - 1; i >= 0; i--) {
    var cell = values[i][0];
    var cellText = (cell instanceof Date)
      ? Utilities.formatDate(cell, Session.getScriptTimeZone(), 'yyyy-MM-dd')
      : String(cell).trim();
    if (cellText === dateStr) {
      return i + 2; // +2: 0-indexed array + skip header row
    }
  }
  return -1;
}

/**
 * Increment the value in a specific column of a date row.
 * Creates the row if it doesn't exist yet.
 */
function incrementCell(sheet, dateStr, colNumber, amount) {
  var row = findRow(sheet, dateStr);

  if (row === -1) {
    var newRow = new Array(TOTAL_COLS);
    newRow[0] = dateStr;
    for (var i = 1; i < TOTAL_COLS; i++) {
      newRow[i] = 0;
    }
    sheet.appendRow(newRow);
    row = sheet.getLastRow();
  }

  var cell = sheet.getRange(row, colNumber);
  var current = Number(cell.getValue()) || 0;
  cell.setValue(Math.round((current + amount) * 100) / 100); // round to 2dp for FILE_SIZE
}

/**
 * Process a single event object: validate and increment both sheets.
 * Returns null on success or an error string on failure.
 */
function processEvent(ss, daySheet, monthSheet, dayKey, monthKey, item) {
  var eventName = item.event;
  var value = (typeof item.value === 'number' && item.value > 0) ? item.value : 1;

  if (!COL_INDEX.hasOwnProperty(eventName)) {
    return 'Unknown event: ' + eventName;
  }

  var colNumber = COL_INDEX[eventName];
  incrementCell(daySheet, dayKey, colNumber, value);
  incrementCell(monthSheet, monthKey, colNumber, value);
  return null;
}

// ── POST Handler ──────────────────────────────────────────────────

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
  } catch (lockErr) {
    return ContentService.createTextOutput(
      JSON.stringify({ result: 'error', error: 'Could not acquire lock' })
    ).setMimeType(ContentService.MimeType.JSON);
  }

  try {
    var body = e.postData.contents;
    var data = JSON.parse(body);

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var tz = Session.getScriptTimeZone();
    var now = new Date();
    var dayKey = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
    var monthKey = Utilities.formatDate(now, tz, 'yyyy-MM');

    var daySheet = getOrCreateSheet(ss, 'Day Stats');
    var monthSheet = getOrCreateSheet(ss, 'Month Stats');

    var processed = 0;
    var errors = [];

    // Support batch: { batch: [ {event, value}, ... ] }
    if (data.batch && Array.isArray(data.batch)) {
      for (var i = 0; i < data.batch.length; i++) {
        var err = processEvent(ss, daySheet, monthSheet, dayKey, monthKey, data.batch[i]);
        if (err) {
          errors.push(err);
        } else {
          processed++;
        }
      }
    } else {
      // Single event: { event, value }
      var err = processEvent(ss, daySheet, monthSheet, dayKey, monthKey, data);
      if (err) {
        errors.push(err);
      } else {
        processed++;
      }
    }

    lock.releaseLock();

    return ContentService.createTextOutput(
      JSON.stringify({
        result: errors.length === 0 ? 'success' : 'partial',
        processed: processed,
        errors: errors,
        day: dayKey,
        month: monthKey
      })
    ).setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    try { lock.releaseLock(); } catch(x) {}
    return ContentService.createTextOutput(
      JSON.stringify({ result: 'error', error: err.toString() })
    ).setMimeType(ContentService.MimeType.JSON);
  }
}

// ── GET Handler (health check) ────────────────────────────────────

function doGet(e) {
  return ContentService.createTextOutput(
    JSON.stringify({
      status: 'ShareMe Analytics endpoint is active',
      columns: HEADERS,
      supportsBatch: true
    })
  ).setMimeType(ContentService.MimeType.JSON);
}
