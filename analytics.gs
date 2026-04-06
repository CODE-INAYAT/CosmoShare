/**
 * CosmoShare Analytics — Google Apps Script Backend (v4 — Accurate)
 *
 * PRINCIPLES:
 *   • ACCURACY over speed: every event counted exactly once
 *   • Direct sheet writes under lock — no intermediate cache
 *   • Lock timeout 30s to handle concurrent users
 *   • Per-event try-catch so one bad event doesn't kill the batch
 *   • Key columns forced to plain text (no date auto-parsing)
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

// ── Per-Sheet Enable/Disable ─────────────────────────────────────
var SHEET_ENABLED = {
  'Day Stats':                true,
  'Grand Total Stats':        true,
  'Month Stats':              true,
  'Users Info':               true,
  'Day Stats (Student Room)': true,
  'Day Stats (Admin Room)':   true,
  'Month Stats (Student Room)': true,
  'Month Stats (Admin Room)':   true
};

// ── Column Layouts ───────────────────────────────────────────────

var HEADERS_DAY = [
  'Date', 'Files Shared', 'Links Shared', 'Codes Shared', 'Auto Shares',
  'Canceled Transfers', 'Visitors', 'Room Joins', 'OneShare Users',
  'Admin Joins', 'Student Joins', 'Support Dialog', 'OneShare-MultiShare',
  'File Size (MB)'
];

var HEADERS_GRAND = [
  'Files Shared', 'Links Shared', 'Codes Shared', 'Auto Shares',
  'Canceled Transfers', 'Visitors', 'Room Joins', 'OneShare Users',
  'Admin Joins', 'Student Joins', 'Support Dialog', 'OneShare-MultiShare',
  'File Size (MB)'
];

var HEADERS_MONTH = [
  'Month', 'Files Shared', 'Links Shared', 'Codes Shared', 'Auto Shares',
  'Canceled Transfers', 'Visitors', 'Room Joins', 'OneShare Users',
  'Admin Joins', 'Student Joins', 'Support Dialog', 'OneShare-MultiShare',
  'File Size (MB)'
];

var HEADERS_USERS = [
  'Date', 'Time', 'Name', 'Room Joined', 'Files Shared', 'Links Shared',
  'Codes Shared', 'Files Received', 'Links Received', 'Codes Received',
  'Auto Shares', 'Canceled Transfers', 'File Size (MB)'
];

var HEADERS_DAY_STUDENT = [
  'Date', 'Room No.', 'Files Shared', 'Links Shared', 'Codes Shared',
  'Canceled Transfers', 'File Size (MB)'
];

var HEADERS_DAY_ADMIN = [
  'Date', 'Room No.', 'Files Received', 'Links Received',
  'Canceled Transfers', 'File Size (MB)'
];

var HEADERS_MONTH_STUDENT = [
  'Month', 'Room No.', 'Files Shared', 'Links Shared', 'Codes Shared',
  'Canceled Transfers', 'File Size (MB)'
];

var HEADERS_MONTH_ADMIN = [
  'Month', 'Room No.', 'Files Received', 'Links Received',
  'Canceled Transfers', 'File Size (MB)'
];

// ── Event → Column Index Mappings (1-based) ──────────────────────

var COL_DAY = {
  'FILE_SHARED': 2, 'LINK_SHARED': 3, 'CODE_SHARED': 4, 'AUTO_SHARE': 5,
  'CANCELED_TRANSFER': 6, 'VISITOR': 7, 'ROOM_JOIN': 8, 'ONESHARE_USER': 9,
  'ADMIN_JOIN': 10, 'STUDENT_JOIN': 11, 'SUPPORT_DIALOG': 12,
  'ONESHARE_MULTISHARE': 13, 'FILE_SIZE': 14
};

var COL_GRAND = {
  'FILE_SHARED': 1, 'LINK_SHARED': 2, 'CODE_SHARED': 3, 'AUTO_SHARE': 4,
  'CANCELED_TRANSFER': 5, 'VISITOR': 6, 'ROOM_JOIN': 7, 'ONESHARE_USER': 8,
  'ADMIN_JOIN': 9, 'STUDENT_JOIN': 10, 'SUPPORT_DIALOG': 11,
  'ONESHARE_MULTISHARE': 12, 'FILE_SIZE': 13
};

// Users Info: student-side events (Files Shared, Links Shared, etc.)
var COL_USERS_STUDENT = {
  'FILE_SHARED': 5, 'LINK_SHARED': 6, 'CODE_SHARED': 7,
  'AUTO_SHARE': 11, 'CANCELED_TRANSFER': 12, 'FILE_SIZE': 13
};

// Users Info: admin-side events (Files Received, Links Received, etc.)
var COL_USERS_ADMIN = {
  'FILE_SHARED': 8, 'LINK_SHARED': 9, 'CODE_SHARED': 10,
  'AUTO_SHARE': 11, 'CANCELED_TRANSFER': 12, 'FILE_SIZE': 13
};

var COL_STUDENT_ROOM = {
  'FILE_SHARED': 3, 'LINK_SHARED': 4, 'CODE_SHARED': 5,
  'CANCELED_TRANSFER': 6, 'FILE_SIZE': 7
};

var COL_ADMIN_ROOM = {
  'FILE_SHARED': 3, 'LINK_SHARED': 4,
  'CANCELED_TRANSFER': 5, 'FILE_SIZE': 6
};

// ── Sheet Helpers ────────────────────────────────────────────────

function getOrCreateSheet(ss, sheetName, headers) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.appendRow(headers);
    var totalCols = headers.length;
    sheet.getRange(1, 1, 1, totalCols).setFontWeight('bold');
    sheet.setFrozenRows(1);
    for (var c = 1; c <= totalCols; c++) {
      sheet.autoResizeColumn(c);
    }
    // Force text format on key columns to prevent Google Sheets
    // from auto-parsing date/month strings as Date objects.
    forceTextColumns(sheet, sheetName);
  }
  return sheet;
}

function forceTextColumns(sheet, sheetName) {
  var maxRows = Math.max(sheet.getMaxRows(), 1000);
  if (sheetName !== 'Grand Total Stats') {
    sheet.getRange(2, 1, maxRows, 1).setNumberFormat('@');
  }
  // Column B is a secondary key for dual-key sheets (Room No.)
  if (sheetName === 'Day Stats (Student Room)' ||
      sheetName === 'Day Stats (Admin Room)' ||
      sheetName === 'Month Stats (Student Room)' ||
      sheetName === 'Month Stats (Admin Room)') {
    sheet.getRange(2, 2, maxRows, 1).setNumberFormat('@');
  }
  // Users Info: Time (col 2) and Name (col 3) as text
  if (sheetName === 'Users Info') {
    sheet.getRange(2, 2, maxRows, 1).setNumberFormat('@');
    sheet.getRange(2, 3, maxRows, 1).setNumberFormat('@');
  }
}

function ensureAllSheets(ss) {
  if (SHEET_ENABLED['Day Stats'])                  getOrCreateSheet(ss, 'Day Stats', HEADERS_DAY);
  if (SHEET_ENABLED['Grand Total Stats'])          getOrCreateSheet(ss, 'Grand Total Stats', HEADERS_GRAND);
  if (SHEET_ENABLED['Month Stats'])                getOrCreateSheet(ss, 'Month Stats', HEADERS_MONTH);
  if (SHEET_ENABLED['Users Info'])                 getOrCreateSheet(ss, 'Users Info', HEADERS_USERS);
  if (SHEET_ENABLED['Day Stats (Student Room)'])   getOrCreateSheet(ss, 'Day Stats (Student Room)', HEADERS_DAY_STUDENT);
  if (SHEET_ENABLED['Day Stats (Admin Room)'])     getOrCreateSheet(ss, 'Day Stats (Admin Room)', HEADERS_DAY_ADMIN);
  if (SHEET_ENABLED['Month Stats (Student Room)']) getOrCreateSheet(ss, 'Month Stats (Student Room)', HEADERS_MONTH_STUDENT);
  if (SHEET_ENABLED['Month Stats (Admin Room)'])   getOrCreateSheet(ss, 'Month Stats (Admin Room)', HEADERS_MONTH_ADMIN);
}

// ── Row Lookup ───────────────────────────────────────────────────

function cellToString(cell) {
  if (cell instanceof Date) {
    // Try both formats — this handles any auto-converted dates
    var tz = Session.getScriptTimeZone();
    return Utilities.formatDate(cell, tz, 'dd-MM-yyyy');
  }
  return String(cell).trim();
}

function cellToMonthString(cell) {
  if (cell instanceof Date) {
    return Utilities.formatDate(cell, Session.getScriptTimeZone(), 'MMMM yyyy');
  }
  return String(cell).trim();
}

function findRowByCol(sheet, colIndex, keyStr, isMonth) {
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return -1;
  var values = sheet.getRange(2, colIndex, lastRow - 1, 1).getValues();
  for (var i = values.length - 1; i >= 0; i--) {
    var cellStr = isMonth ? cellToMonthString(values[i][0]) : cellToString(values[i][0]);
    if (cellStr === keyStr) return i + 2;
  }
  return -1;
}

function findRowByTwoCols(sheet, colA, keyA, colB, keyB, isMonth) {
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return -1;
  var maxCol = Math.max(colA, colB);
  var data = sheet.getRange(2, 1, lastRow - 1, maxCol).getValues();
  for (var i = data.length - 1; i >= 0; i--) {
    var strA = isMonth ? cellToMonthString(data[i][colA - 1]) : cellToString(data[i][colA - 1]);
    var strB = String(data[i][colB - 1]).trim();
    if (strA === keyA && strB === keyB) return i + 2;
  }
  return -1;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// ── Row Increment ────────────────────────────────────────────────

function incrementSingleKey(sheet, keyStr, colIndex, dataCol, amount, totalCols, isMonth) {
  var row = findRowByCol(sheet, colIndex, keyStr, isMonth);
  if (row === -1) {
    var newRow = new Array(totalCols);
    for (var i = 0; i < totalCols; i++) newRow[i] = 0;
    newRow[colIndex - 1] = keyStr;
    sheet.appendRow(newRow);
    row = sheet.getLastRow();
    sheet.getRange(row, colIndex).setNumberFormat('@').setValue(keyStr);
  }
  var cell = sheet.getRange(row, dataCol);
  cell.setValue(round2((Number(cell.getValue()) || 0) + amount));
}

function incrementDualKey(sheet, keyColA, keyA, keyColB, keyB, dataCol, amount, totalCols, isMonth) {
  var row = findRowByTwoCols(sheet, keyColA, keyA, keyColB, keyB, isMonth);
  if (row === -1) {
    var newRow = new Array(totalCols);
    for (var i = 0; i < totalCols; i++) newRow[i] = 0;
    newRow[keyColA - 1] = keyA;
    newRow[keyColB - 1] = keyB;
    sheet.appendRow(newRow);
    row = sheet.getLastRow();
    sheet.getRange(row, keyColA).setNumberFormat('@').setValue(keyA);
    sheet.getRange(row, keyColB).setNumberFormat('@').setValue(keyB);
  }
  var cell = sheet.getRange(row, dataCol);
  cell.setValue(round2((Number(cell.getValue()) || 0) + amount));
}

function incrementGrandTotal(sheet, dataCol, amount) {
  if (sheet.getLastRow() < 2) {
    var totalCols = HEADERS_GRAND.length;
    var newRow = new Array(totalCols);
    for (var i = 0; i < totalCols; i++) newRow[i] = 0;
    sheet.appendRow(newRow);
  }
  var cell = sheet.getRange(2, dataCol);
  cell.setValue(round2((Number(cell.getValue()) || 0) + amount));
}

// ── Event Processing ─────────────────────────────────────────────

function processEvent(ss, dayKey, monthKey, item) {
  var eventName = item.event;
  var value = (typeof item.value === 'number' && item.value > 0) ? item.value : 1;
  var roomNumber = item.roomNumber || '';
  var userName = item.userName || '';
  var isAdmin = !!item.isAdmin;

  if (!COL_DAY.hasOwnProperty(eventName) && !COL_GRAND.hasOwnProperty(eventName)) {
    return 'Unknown event: ' + eventName;
  }

  try {
    // 1. Day Stats
    if (SHEET_ENABLED['Day Stats'] && COL_DAY.hasOwnProperty(eventName)) {
      incrementSingleKey(
        getOrCreateSheet(ss, 'Day Stats', HEADERS_DAY),
        dayKey, 1, COL_DAY[eventName], value, HEADERS_DAY.length, false
      );
    }

    // 2. Month Stats
    if (SHEET_ENABLED['Month Stats'] && COL_DAY.hasOwnProperty(eventName)) {
      incrementSingleKey(
        getOrCreateSheet(ss, 'Month Stats', HEADERS_MONTH),
        monthKey, 1, COL_DAY[eventName], value, HEADERS_MONTH.length, true
      );
    }

    // 3. Grand Total
    if (SHEET_ENABLED['Grand Total Stats'] && COL_GRAND.hasOwnProperty(eventName)) {
      incrementGrandTotal(
        getOrCreateSheet(ss, 'Grand Total Stats', HEADERS_GRAND),
        COL_GRAND[eventName], value
      );
    }

    // 4. Users Info
    // Relevant events: join events (create row) + data events (increment columns)
    var colUsersMap = isAdmin ? COL_USERS_ADMIN : COL_USERS_STUDENT;
    var isJoinEvent = (eventName === 'STUDENT_JOIN' || eventName === 'ADMIN_JOIN');
    var isDataEvent = colUsersMap.hasOwnProperty(eventName);

    if (SHEET_ENABLED['Users Info'] && (isJoinEvent || isDataEvent) && userName && roomNumber) {
      var usersSheet = getOrCreateSheet(ss, 'Users Info', HEADERS_USERS);
      // Key: Date (col 1) + Name (col 3)
      var uRow = findRowByTwoCols(usersSheet, 1, dayKey, 3, userName, false);
      if (uRow === -1) {
        // Create new row with Date, Time, Name, Room
        var timeStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'HH:mm:ss');
        var uNewRow = new Array(HEADERS_USERS.length);
        for (var ui = 0; ui < HEADERS_USERS.length; ui++) uNewRow[ui] = 0;
        uNewRow[0] = dayKey;       // Date (col 1)
        uNewRow[1] = timeStr;      // Time (col 2)
        uNewRow[2] = userName;     // Name (col 3)
        uNewRow[3] = roomNumber;   // Room Joined (col 4)
        usersSheet.appendRow(uNewRow);
        uRow = usersSheet.getLastRow();
        // Force text format on key cells
        usersSheet.getRange(uRow, 1).setNumberFormat('@').setValue(dayKey);
        usersSheet.getRange(uRow, 2).setNumberFormat('@').setValue(timeStr);
        usersSheet.getRange(uRow, 3).setNumberFormat('@').setValue(userName);
      } else {
        // Update room number in case it changed
        usersSheet.getRange(uRow, 4).setValue(roomNumber);
      }
      // Increment the data column (only for data events, not join events)
      if (isDataEvent) {
        var uCell = usersSheet.getRange(uRow, colUsersMap[eventName]);
        uCell.setValue(round2((Number(uCell.getValue()) || 0) + value));
      }
    }

    // 5. Day Stats (Student Room)
    if (SHEET_ENABLED['Day Stats (Student Room)'] &&
        COL_STUDENT_ROOM.hasOwnProperty(eventName) && roomNumber && !isAdmin) {
      incrementDualKey(
        getOrCreateSheet(ss, 'Day Stats (Student Room)', HEADERS_DAY_STUDENT),
        1, dayKey, 2, roomNumber, COL_STUDENT_ROOM[eventName], value, HEADERS_DAY_STUDENT.length, false
      );
    }

    // 6. Day Stats (Admin Room)
    if (SHEET_ENABLED['Day Stats (Admin Room)'] &&
        COL_ADMIN_ROOM.hasOwnProperty(eventName) && roomNumber && isAdmin) {
      incrementDualKey(
        getOrCreateSheet(ss, 'Day Stats (Admin Room)', HEADERS_DAY_ADMIN),
        1, dayKey, 2, roomNumber, COL_ADMIN_ROOM[eventName], value, HEADERS_DAY_ADMIN.length, false
      );
    }

    // 7. Month Stats (Student Room)
    if (SHEET_ENABLED['Month Stats (Student Room)'] &&
        COL_STUDENT_ROOM.hasOwnProperty(eventName) && roomNumber && !isAdmin) {
      incrementDualKey(
        getOrCreateSheet(ss, 'Month Stats (Student Room)', HEADERS_MONTH_STUDENT),
        1, monthKey, 2, roomNumber, COL_STUDENT_ROOM[eventName], value, HEADERS_MONTH_STUDENT.length, true
      );
    }

    // 8. Month Stats (Admin Room)
    if (SHEET_ENABLED['Month Stats (Admin Room)'] &&
        COL_ADMIN_ROOM.hasOwnProperty(eventName) && roomNumber && isAdmin) {
      incrementDualKey(
        getOrCreateSheet(ss, 'Month Stats (Admin Room)', HEADERS_MONTH_ADMIN),
        1, monthKey, 2, roomNumber, COL_ADMIN_ROOM[eventName], value, HEADERS_MONTH_ADMIN.length, true
      );
    }
  } catch (sheetErr) {
    return 'Sheet write error for ' + eventName + ': ' + sheetErr.toString();
  }

  return null;
}

// ── POST Handler ─────────────────────────────────────────────────
// Simple and direct: lock → parse → write → unlock → respond.
// No intermediate caching. No deferred processing. Just accurate writes.

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (lockErr) {
    return ContentService.createTextOutput(
      JSON.stringify({ result: 'error', error: 'Server busy, please retry' })
    ).setMimeType(ContentService.MimeType.JSON);
  }

  try {
    var body = e.postData.contents;
    var data = JSON.parse(body);

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var tz = Session.getScriptTimeZone();
    var now = new Date();
    var dayKey = Utilities.formatDate(now, tz, 'dd-MM-yyyy');
    var monthKey = Utilities.formatDate(now, tz, 'MMMM yyyy');

    ensureAllSheets(ss);

    var events = [];
    if (data.batch && Array.isArray(data.batch)) {
      events = data.batch;
    } else {
      events = [data];
    }

    var processed = 0;
    var errors = [];

    for (var i = 0; i < events.length; i++) {
      try {
        var err = processEvent(ss, dayKey, monthKey, events[i]);
        if (err) {
          errors.push(err);
        } else {
          processed++;
        }
      } catch (eventErr) {
        errors.push('Event error: ' + eventErr.toString());
      }
    }

    SpreadsheetApp.flush();
    lock.releaseLock();

    return ContentService.createTextOutput(
      JSON.stringify({
        result: errors.length === 0 ? 'success' : 'partial',
        processed: processed,
        errors: errors
      })
    ).setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    try { lock.releaseLock(); } catch(x) {}
    return ContentService.createTextOutput(
      JSON.stringify({ result: 'error', error: err.toString() })
    ).setMimeType(ContentService.MimeType.JSON);
  }
}

// ── GET Handler ──────────────────────────────────────────────────

function doGet(e) {
  return ContentService.createTextOutput(
    JSON.stringify({
      status: 'CosmoShare Analytics v4 is active',
      sheets: Object.keys(SHEET_ENABLED),
      enabledSheets: Object.keys(SHEET_ENABLED).filter(function(k) { return SHEET_ENABLED[k]; })
    })
  ).setMimeType(ContentService.MimeType.JSON);
}

// ── One-Time Fix for Existing Sheets ─────────────────────────────
// Run ONCE from the editor (Run > fixExistingSheets) to apply text
// formatting to sheets created before the text-format fix.

function fixExistingSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetNames = [
    'Day Stats', 'Month Stats', 'Users Info',
    'Day Stats (Student Room)', 'Day Stats (Admin Room)',
    'Month Stats (Student Room)', 'Month Stats (Admin Room)'
  ];
  for (var i = 0; i < sheetNames.length; i++) {
    var sheet = ss.getSheetByName(sheetNames[i]);
    if (sheet) {
      forceTextColumns(sheet, sheetNames[i]);
      Logger.log('Fixed: ' + sheetNames[i]);
    }
  }
  Logger.log('Done.');
}
