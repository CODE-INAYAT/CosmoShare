function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.tryLock(10000);
  try {
    const data = JSON.parse(e.postData.contents);
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    // Determine Sheet based on Type
    let sheetName = "Droptio Support Responses";
    if (data.type === "Lab Add Request") {
      sheetName = "Lab Add Request";
    }

    let sheet = ss.getSheetByName(sheetName);
    // Auto-create new sheet if it doesn't exist
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
      // Add Headers based on type
      if (data.type === "Lab Add Request") {
        sheet.appendRow([
          "Timestamp",
          "Request ID",
          "Name",
          "Contact",
          "Room Number",
          "File URL",
        ]);
      } else {
        sheet.appendRow([
          "Timestamp",
          "Request ID",
          "Type",
          "Name",
          "Contact",
          "Message",
          "File URL",
        ]);
      }
    }

    // Handle File Upload
    let fileUrl = "No File";
    if (data.fileData && data.fileName) {
      try {
        const decoded = Utilities.base64Decode(
          data.fileData.split(",")[1] || data.fileData
        );
        const blob = Utilities.newBlob(decoded, data.mimeType, data.fileName);

        // --- OPTION 1: Save to Specific Folder (Recommended) ---
        const folder = DriveApp.getFolderById(
          "1IXUq4zPA_c_dMJqdYCjGTD5q-WbOEcvf"
        );
        const file = folder.createFile(blob);

        // --- OPTION 2: Save to Root Drive (Default) ---
        //  const file = DriveApp.createFile(blob);
        // Make file accessible to you via link
        file.setSharing(
          DriveApp.Access.ANYONE_WITH_LINK,
          DriveApp.Permission.VIEW
        );
        fileUrl = file.getUrl();
      } catch (fileError) {
        fileUrl = "Error saving file: " + fileError.toString();
      }
    }
    // Append to Sheet
    const timestamp = new Date();

    if (data.type === "Lab Add Request") {
      sheet.appendRow([
        timestamp,
        data.requestId,
        data.name,
        data.contact,
        data.roomNumber,
        fileUrl,
      ]);
    } else {
      sheet.appendRow([
        timestamp,
        data.requestId,
        data.type,
        data.name,
        data.contact,
        data.message,
        fileUrl,
      ]);
    }
    // --- EMAIL NOTIFICATION ---
    const emailRecipient = "it.inayat2005@gmail.com";
    const subject = `[Request ID: ${data.requestId}] ${data.type}`;
    const body = `
    Name : ${data.name}
    Type : ${data.type}
    Contact : ${data.contact}
    Message / Room Number: ${
      data.type === "Lab Add Request" ? data.roomNumber : data.message
    }
    File : ${fileUrl}
    `;

    MailApp.sendEmail(emailRecipient, subject, body);
    return ContentService.createTextOutput(
      JSON.stringify({ result: "success", id: data.requestId })
    ).setMimeType(ContentService.MimeType.JSON);
  } catch (e) {
    return ContentService.createTextOutput(
      JSON.stringify({ result: "error", error: e.toString() })
    ).setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}
function setup() {
  const doc = SpreadsheetApp.getActiveSpreadsheet();
  ScriptApp.newTrigger("doPost").forSpreadsheet(doc).onFormSubmit().create();
}
