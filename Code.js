// --- CONFIGURATION CENTRAL ---
var CONFIG = {
 MASTER_SHEET_ID: SpreadsheetApp.getActiveSpreadsheet().getId(),
 MASTER_TAB_NAME: "masterdata",
 SATKER_DB_ID: "1h8MXc3KX9rF0NmjU2I_K8ZQHjCHVPPxRR7etOTBvcfY",
  // 1. PSP DATABASE (Column N for Ticket)
 EXTERNAL_DB_PSP_ID: "1yO2nsD0nUe25CY7JQ3LnGZz6nj3Hdk13xJsL7SfqFnM",
 EXTERNAL_SHEET_PSP_NAME: "Database",
  // 2. SEWA DATABASE (Column O for Ticket)
 EXTERNAL_DB_SEWA_ID: "1unEDOSvyy3X1gFhtZPEuPZPTOJjziSlrmDLY4kRNjHw",
 EXTERNAL_SHEET_SEWA_NAME: "Database_sewa",
  // 3. PINDAHHAPUS DATABASE (Column N for Ticket)
 EXTERNAL_DB_PINDAHHAPUS_ID: "1vM8JuILifD79HaZeQ3OtXuzhPRjQtH12mRc-o_gcBMs",
 EXTERNAL_SHEET_PINDAHHAPUS_NAME: "Database_pindahhapus",
  ALLOWED_EMAILS: [
   "gde.ari.erawan@gmail.com",
   "gsprnthidayat@gmail.com",
   "gshendra@gmail.com",
   "dwikurniawan30@gmail.com",
   "sigamz.05@gmail.com",
   "awawsam@gmail.com",
   "uki.kpknldenpasar@gmail.com"
 ]
};


var MASTER_SHEET_NAME = "masterdata";


// 1. ROUTING
function doGet(e) {
 var userEmail = Session.getActiveUser().getEmail();
  if (!userEmail || CONFIG.ALLOWED_EMAILS.indexOf(userEmail.toLowerCase()) === -1) {
   return HtmlService.createHtmlOutput("<h2 style='color:red; text-align:center; margin-top:50px;'>Access Denied / Akses Ditolak</h2>").setTitle("Access Denied");
 }


var route = e.parameter.page;
  if (route == 'form') {
   return HtmlService.createTemplateFromFile('Form').evaluate().setTitle('Input Data BMN').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  
 } else if (route == 'manage') {
   return HtmlService.createTemplateFromFile('manage').evaluate().setTitle('Kelola Master Data').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  
 } else if (route == 'dashboard') { // <--- NEW COCKPIT ROUTE
   return HtmlService.createTemplateFromFile('Dashboard').evaluate().setTitle('Cockpit BMN').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  
 } else {
   return HtmlService.createTemplateFromFile('List').evaluate().setTitle('Dashboard BMN').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
 }
}


function getScriptUrl() { return ScriptApp.getService().getUrl(); }


// 2. SAVE DATA (INTERNAL)
function saveData(formObject) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(MASTER_SHEET_NAME);
  if (!sheet) return "Error: Sheet '" + MASTER_SHEET_NAME + "' tidak ditemukan!";

  function cleanCurrency(value) {
    if (!value) return 0;
    return Number(value.toString().replace(/[^0-9]/g, ""));
  }

  // Define data structure (Indices 0 to 16)
  // Indices 0-14 = Data Columns (B through P)
  // Index 15     = Column Q (Formula - SKIP)
  // Index 16     = Column R (Checklist)
  var rowData = [
    formObject.pic,              // 0
    formObject.kodeSatker,       // 1
    formObject.satker,           // 2
    formObject.jenisPengelolaan, // 3
    formObject.jenisBmn,         // 4
    formObject.noSurat,          // 5
    formObject.tglSurat,         // 6
    formObject.tglTerima,        // 7
    formObject.noTiket,          // 8
    formObject.noKmk,            // 9
    formObject.tglSetuju,        // 10
    formObject.halPersetujuan,   // 11
    cleanCurrency(formObject.nilaiBmn),   // 12
    cleanCurrency(formObject.nilaiLimit), // 13
    formObject.linkDokumen,      // 14
    "",                          // 15: Skip this
    formObject.jsonChecklist     // 16: Write this to Col R
  ];

  // --- FIND TARGET ROW ---
  var lastRow = sheet.getLastRow();
  var searchLimit = Math.max(lastRow, 100);
  var colBData = sheet.getRange(1, 2, searchLimit, 1).getValues();
  var targetRow = 0;

  for (var i = 0; i < colBData.length; i++) {
    if (colBData[i][0] === "") {
      targetRow = i + 1;
      break;
    }
  }

  if (targetRow === 0) targetRow = lastRow + 1;
  if (targetRow <= 1) targetRow = 2;

  // --- SAFE WRITE: SPLIT INTO TWO BATCHES ---
  
  // Batch 1: Write Col B (2) through Col P (16)
  // We take elements 0 to 15 (exclusive of 15) -> Indices 0-14
  var dataPart1 = rowData.slice(0, 15); 
  sheet.getRange(targetRow, 2, 1, dataPart1.length).setValues([dataPart1]);

  // Batch 2: Write Col R (18)
  // We take element 16
  var checklistData = rowData[16];
  sheet.getRange(targetRow, 18).setValue(checklistData);

  return "Sukses! Data tersimpan di 'masterdata'.";
}


// 3. GET DATA & MASTER DATA
function getData(sheetName) {
 var ss = SpreadsheetApp.getActiveSpreadsheet();
 var targetSheet = sheetName || "monitoring_pengelolaan";
 var sheet = ss.getSheetByName(targetSheet);
 if (!sheet) return "Error: Sheet '" + targetSheet + "' tidak ditemukan.";
  var range = sheet.getDataRange();
 if (range.getLastRow() === 0) return [];
 var values = range.getValues();
 return values.map(row => row.map(cell => (cell instanceof Date) ? Utilities.formatDate(cell, Session.getScriptTimeZone(), "yyyy-MM-dd") : cell));
}


function getMasterData() {
 var ss = SpreadsheetApp.getActiveSpreadsheet();
 var sheet = ss.getSheetByName(MASTER_SHEET_NAME);
 if (!sheet) return [];
 var values = sheet.getDataRange().getValues();
 return values.map(row => row.map(cell => (cell instanceof Date) ? Utilities.formatDate(cell, Session.getScriptTimeZone(), "yyyy-MM-dd") : cell));
}


// 4. CRUD HELPERS
// 4. CRUD HELPERS
function updateRow(rowIndex, rowData) {
 try {
   var ss = SpreadsheetApp.getActiveSpreadsheet();
   var sheet = ss.getSheetByName(MASTER_SHEET_NAME);
   if (rowIndex <= 1) return "Error: Cannot edit header.";

   // --- BUG FIX START ---
   // The User wants to protect Column A (ID) and Columns Q & R (Formulas)
   // rowData contains indexes: 0=A, 1=B ... 15=P, 16=Q, 17=R
   
   // We slice the array to get ONLY Column B through Column P
   // slice(1, 16) extracts indices 1 (Col B) up to, but not including, 16 (Col Q)
   var dataToWrite = rowData.slice(1, 16); 

   // We write to the sheet starting at Column 2 (B)
   // This ensures Col A, Col Q, and Col R are NEVER touched.
   sheet.getRange(rowIndex, 2, 1, dataToWrite.length).setValues([dataToWrite]);
   // --- BUG FIX END ---

   return "Success: Row " + rowIndex + " updated.";
 } catch (e) { return "Error: " + e.toString(); }
}


function deleteRow(rowIndex) {
 try {
   var ss = SpreadsheetApp.getActiveSpreadsheet();
   var sheet = ss.getSheetByName(MASTER_SHEET_NAME);
   if (rowIndex <= 1) return "Error: Cannot delete header.";
   sheet.deleteRow(rowIndex);
   return "Success: Row " + rowIndex + " deleted.";
 } catch (e) { return "Error: " + e.toString(); }
}


// 5. SATKER & DUPLICATES
function getSatkerName(kode) {
 if (!kode) return "";
 var ss = SpreadsheetApp.openById(CONFIG.SATKER_DB_ID);
 var sheet = ss.getSheetByName("detail_satker");
 if (!sheet) return "Error DB Satker";
 var data = sheet.getRange(2, 2, sheet.getLastRow() - 1, 2).getValues();
 var searchCode = kode.toString().trim();
 for (var i = 0; i < data.length; i++) {
   if (data[i][0].toString().trim() === searchCode) return data[i][1];
 }
 return "Satker Tidak Ditemukan";
}


function checkDuplicateData(noSurat, noTiket) {
 var ss = SpreadsheetApp.getActiveSpreadsheet();
 var sheet = ss.getSheetByName(MASTER_SHEET_NAME);
 if (!sheet) return { found: false };
 var data = sheet.getDataRange().getValues();
 var duplicateInfo = [];
 for (var i = 1; i < data.length; i++) {
   var row = data[i]; if (!row) continue;
   var currentSurat = row.length > 5 ? String(row[5]).trim().toUpperCase() : "";
   var currentTiket = row.length > 8 ? String(row[8]).trim().toUpperCase() : "";
   if (noSurat && currentSurat === String(noSurat).trim().toUpperCase()) duplicateInfo.push("No Surat: " + noSurat);
   if (noTiket && currentTiket === String(noTiket).trim().toUpperCase()) duplicateInfo.push("No Tiket: " + noTiket);
 }
 if (duplicateInfo.length > 0) return { found: true, message: duplicateInfo.join(" & ") };
 return { found: false };
}


function updateDashboardRow(sheetName, rowIndex, pnbpValue, tinjutValue, nupValue) {
 var ss = SpreadsheetApp.getActiveSpreadsheet();
 var sheet = ss.getSheetByName(sheetName);
 if (!sheet) return "Error: Sheet not found";

 var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
 
 // Find Column Indices
 var pnbpIndex = headers.findIndex(h => h.toString().toLowerCase().includes("setoran pnbp"));
 var tinjutIndex = headers.findIndex(h => h.toString().toLowerCase().includes("status tinjut"));
 // New: Find "Jmlh NUP" column
 var nupIndex = headers.findIndex(h => h.toString().toLowerCase().includes("jmlh nup"));

 // Update PNBP
 if (pnbpIndex !== -1) {
    sheet.getRange(rowIndex, pnbpIndex + 1).setValue(pnbpValue);
 }
 
 // Update Tinjut
 if (tinjutIndex !== -1) {
    sheet.getRange(rowIndex, tinjutIndex + 1).setValue(tinjutValue);
 }

 // Update NUP (Only if column exists and value was sent from frontend)
 if (nupIndex !== -1 && nupValue !== null && nupValue !== undefined) {
    sheet.getRange(rowIndex, nupIndex + 1).setValue(nupValue);
 }

 return "Success";
}


// ==========================================
// 6. EXTERNAL DB HANDLING (CRITICAL UPDATE)
// ==========================================


function getExternalTarget(type) {
 if (type === "SEWA") {
   // DB_SEWA: Ticket in Column O.
   // Index: O is the 15th letter. 0-based index = 14.
   return { id: CONFIG.EXTERNAL_DB_SEWA_ID, sheetName: CONFIG.EXTERNAL_SHEET_SEWA_NAME, tiketIndex: 14 };
 }
 else if (type === "PINDAHHAPUS") {
   // DB_PINDAHHAPUS: Ticket in Column N.
   // Index: N is the 14th letter. 0-based index = 13.
   return { id: CONFIG.EXTERNAL_DB_PINDAHHAPUS_ID, sheetName: CONFIG.EXTERNAL_SHEET_PINDAHHAPUS_NAME, tiketIndex: 13 };
 }
 else {
   // DB_PSP: Ticket in Column N.
   // Index: N is the 14th letter. 0-based index = 13.
   return { id: CONFIG.EXTERNAL_DB_PSP_ID, sheetName: CONFIG.EXTERNAL_SHEET_PSP_NAME, tiketIndex: 13 };
 }
}


function fetchExternalData(tiketSiman, type) {
 if (!tiketSiman) return null;
 var target = getExternalTarget(type);
  try {
   var ss = SpreadsheetApp.openById(target.id);
   var sheet = ss.getSheetByName(target.sheetName);
   if (!sheet) return null;


   var data = sheet.getDataRange().getValues();
   var searchKey = String(tiketSiman).trim().toLowerCase();


   for (var i = 1; i < data.length; i++) {
     if (data[i].length <= target.tiketIndex) continue;


     var dbKey = String(data[i][target.tiketIndex]).trim().toLowerCase();
    
     if (dbKey === searchKey) {
       return data[i].map(function(cell) {
         if (Object.prototype.toString.call(cell) === '[object Date]') {
            return Utilities.formatDate(cell, Session.getScriptTimeZone(), "yyyy-MM-dd");
         }
         return cell;
       });
     }
   }
 } catch (e) {
   Logger.log("Error Fetching: " + e.toString());
   return null;
 }
 return null;
}


function saveToExternalDatabase(rowData, maxCols, type) {
 var target = getExternalTarget(type);
  // DYNAMICALLY CALCULATE WHICH FORM FIELD IS THE TICKET KEY
 // We write starting at Col 2 (B).
 // Column B is index 1.
 // Column N (13) is 12 steps away from B. So it's 'col13'.
 // Column O (14) is 13 steps away from B. So it's 'col14'.
 // Formula: FormKey = 'col' + (tiketIndex);
 var formKey = 'col' + target.tiketIndex;
  var keyVal = rowData[formKey];


 try {
   var ss = SpreadsheetApp.openById(target.id);
   var sheet = ss.getSheetByName(target.sheetName);
   if (!sheet) return "Error: Sheet '" + target.sheetName + "' not found.";


   var rowArray = [];
   for (var i = 1; i <= maxCols; i++) {
     var val = rowData['col' + i];
     rowArray.push(val === undefined || val === null ? "" : val);
   }


   var targetRow = 0;
   var lastRow = sheet.getLastRow();
   keyVal = keyVal ? String(keyVal).trim() : "";


   // UPDATE Check
   if (keyVal !== "" && lastRow > 1) {
     // Search Column is Index + 1 (because getRange is 1-based)
     var searchRange = sheet.getRange(2, target.tiketIndex + 1, lastRow - 1, 1).getValues();
     for (var r = 0; r < searchRange.length; r++) {
       if (String(searchRange[r][0]).trim().toUpperCase() === keyVal.toUpperCase()) {
         targetRow = r + 2; break;
       }
     }
   }


   // INSERT Check
   if (targetRow === 0) {
     if (lastRow > 0) {
       var searchLimit = Math.max(lastRow, 100);
       var colBData = sheet.getRange(1, 2, searchLimit, 1).getValues();
       for (var r = 0; r < colBData.length; r++) {
         if (colBData[r][0] === "") { targetRow = r + 1; break; }
       }
     }
     if (targetRow === 0) targetRow = lastRow + 1;
     if (targetRow <= 1) targetRow = 2;
   }


   sheet.getRange(targetRow, 2, 1, rowArray.length).setValues([rowArray]);
   return "Success";
 
 } catch (e) { return "Error System: " + e.toString(); }
}


function getSatkerDetails(kodeSatker) {
 if (!kodeSatker) return null;
 var ss = SpreadsheetApp.openById(CONFIG.SATKER_DB_ID);
 var sheet = ss.getSheetByName("detail_satker");
 if (!sheet) return null;
 var data = sheet.getDataRange().getValues();
 var searchCode = String(kodeSatker).trim();
 for (var i = 1; i < data.length; i++) {
   if (String(data[i][1]).trim() === searchCode) {
     return {
       kl: data[i][4], pimpinanKl: data[i][5], alamat: data[i][11], pimpinanSatker: data[i][22]
     };
   }
 }
 return null;
}


/* --- SATKER MANAGEMENT FEATURES --- */
var SATKER_SPREADSHEET_ID = "1h8MXc3KX9rF0NmjU2I_K8ZQHjCHVPPxRR7etOTBvcfY";


// 1. Fetch List for Autocomplete (Code & Name only)
function getSatkerLookupList() {
 var ss = SpreadsheetApp.openById(SATKER_SPREADSHEET_ID);
 var sheet = ss.getSheetByName("detail_satker") || ss.getSheets()[0];
 // Assuming Row 1 is header, Data starts Row 2
 // Col B is index 1, Col C is index 2. We fetch all data to be safe.
 var data = sheet.getDataRange().getValues();
 var output = [];
  // Skip header (row 0)
 for (var i = 1; i < data.length; i++) {
   // Return object: { code: Col B, name: Col C }
   // Array indices: B=1, C=2
   if(data[i][1]) {
     output.push({
       code: data[i][1].toString(),
       name: data[i][2].toString()
     });
   }
 }
 return output;
}


// 2. Fetch Details for a specific Satker Code
function getSatkerDetails(kodeSatker) {
 var ss = SpreadsheetApp.openById(SATKER_SPREADSHEET_ID);
 var sheet = ss.getSheetByName("detail_satker") || ss.getSheets()[0];
 var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
   // Column B (Index 1) is Kode Satker
   if (data[i][1].toString() === kodeSatker.toString()) {
     return {
       found: true,
       rowIndex: i + 1,
       kl: data[i][4],              // Col E (Index 4)
       pimpinanKl: data[i][5],      // Col F (Index 5) -> Corrected
       pimpinanSatker: data[i][22], // Col W (Index 22) -> Corrected
       alamat: data[i][11],         // Col L (Index 11)
       pic: data[i][23],            // Col X (Index 23)
       telp: data[i][24]            // Col Y (Index 24)
     };
   }
 }
 return null;
}


// 3. Save/Update Satker Details
/* --- UPDATE SATKER DETAILS (With New Field) --- */
function updateSatkerDetails(formObj) {
  try {
    var ss = SpreadsheetApp.openById(SATKER_SPREADSHEET_ID); // Ensure this ID is defined
    var sheet = ss.getSheetByName("detail_satker") || ss.getSheets()[0];
    var kode = formObj.editKodeSatker;

    // 1. FAST SEARCH: Find the row instantly without looping
    // We assume Kode Satker is in Column B (Index 2 in A1 notation)
    var finder = sheet.getRange("B:B").createTextFinder(kode).matchEntireCell(true).findNext();

    if (finder) {
      var row = finder.getRow();

      // 2. FAST WRITE: Group neighboring columns to reduce server lag
      
      // Batch 1: Columns E (5) and F (6) - K/L & Pimpinan K/L
      sheet.getRange(row, 5, 1, 2).setValues([[
        formObj.editKL, 
        formObj.editPimpinan
      ]]);

      // Batch 2: Column L (12) - Alamat
      sheet.getRange(row, 12).setValue(formObj.editAlamat);

      // Batch 3: Columns W (23), X (24), Y (25) - Pimpinan Satker, PIC, Telp
      sheet.getRange(row, 23, 1, 3).setValues([[
        formObj.editPimpinanSatker, 
        formObj.editPic, 
        formObj.editTelp
      ]]);

      return "Berhasil memperbarui data Satker " + formObj.editNamaSatker;
    } 
    
    return "Error: Satker dengan Kode " + kode + " tidak ditemukan.";
    
  } catch (e) {
    return "Error System: " + e.message;
  }
}


/* --- EVAKIN DATA HANDLER (APPEND + INDONESIA DATE FORMAT) --- */
function saveEvakinData(form) {
 var EVAKIN_SPREADSHEET_ID = "1_oOuw2nnfHVkW3CKJcCqsAEGgDw7Ml1MXoN--4WltqM";
 var SHEET_NAME = "monitoring_evakin";


 try {
   var ss = SpreadsheetApp.openById(EVAKIN_SPREADSHEET_ID);
   var sheet = ss.getSheetByName(SHEET_NAME);
  
   if (!sheet) return "Error: Sheet '" + SHEET_NAME + "' tidak ditemukan.";


   // 1. Calculate Next Number (Auto Increment)
   var nextNum = 1;
   var lastRow = sheet.getLastRow();
   if (lastRow > 1) {
     var colAValues = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
     var maxVal = 0;
     for (var i = 0; i < colAValues.length; i++) {
       var val = colAValues[i][0];
       if (typeof val === 'number' && val > maxVal) { maxVal = val; }
     }
     nextNum = maxVal + 1;
   }


   // --- HELPER: FORMAT DATE TO INDONESIA (DD/MM/YYYY) ---
   function formatDateIndo(dateStr) {
     if (!dateStr) return "";
     // Input is usually YYYY-MM-DD
     var parts = dateStr.split("-");
     if (parts.length === 3) {
       return parts[2] + "/" + parts[1] + "/" + parts[0]; // Returns DD/MM/YYYY
     }
     return dateStr;
   }


   // 2. Prepare Data Array with Formatted Dates
   var rowData = [
     nextNum,              
     "'" + form.ev_noTiket,
     form.ev_kodeSatker,   
     form.ev_namaSatker,   
     form.ev_noLaporan,    
     formatDateIndo(form.ev_tglLaporan),       // Formatted
     form.ev_jmlNup,       
     form.ev_noSuratPengantar,
     formatDateIndo(form.ev_tglSuratPengantar), // Formatted
     form.ev_noSuratTinjut,    
     formatDateIndo(form.ev_tglSuratTinjut)     // Formatted
   ];


   // 3. Append to Bottom
   sheet.appendRow(rowData);


   return "Success";


 } catch (e) {
   return "Error: " + e.toString();
 }
}


/* --- UPDATE EVAKIN ROW (Edit specific columns) --- */
function updateEvakinRow(rowIndex, noTinjut, tglTinjut) {
 var EVAKIN_ID = "1_oOuw2nnfHVkW3CKJcCqsAEGgDw7Ml1MXoN--4WltqM";
 var SHEET_NAME = "monitoring_evakin";
  try {
   var ss = SpreadsheetApp.openById(EVAKIN_ID);
   var sheet = ss.getSheetByName(SHEET_NAME);
  
   // Convert Date format from YYYY-MM-DD to DD/MM/YYYY if needed
   // or just save as string. Let's ensure consistency.
   var formattedDate = tglTinjut;
   if (tglTinjut && tglTinjut.includes("-")) {
      var parts = tglTinjut.split("-");
      formattedDate = parts[2] + "/" + parts[1] + "/" + parts[0];
   }


   // Update Column J (10) and K (11)
   // rowIndex is the actual sheet row number passed from frontend
   sheet.getRange(rowIndex, 10).setValue(noTinjut);
   sheet.getRange(rowIndex, 11).setValue(formattedDate);
  
   return "Success";
 } catch (e) {
   return "Error: " + e.toString();
 }
}
/* --- DELETE EVAKIN ROW --- */
function deleteEvakinRow(rowIndex) {
 var EVAKIN_ID = "1_oOuw2nnfHVkW3CKJcCqsAEGgDw7Ml1MXoN--4WltqM";
 var SHEET_NAME = "monitoring_evakin";
  try {
   var ss = SpreadsheetApp.openById(EVAKIN_ID);
   var sheet = ss.getSheetByName(SHEET_NAME);
  
   // Check if row exists to prevent errors
   if (rowIndex > 0 && rowIndex <= sheet.getLastRow()) {
     sheet.deleteRow(rowIndex);
     return "Success";
   } else {
     return "Error: Row index out of bounds.";
   }
 } catch (e) {
   return "Error: " + e.toString();
 }
}
// Code.gs


function updateChecklistData(rowIndex, jsonString) {
 try {
   var ss = SpreadsheetApp.getActiveSpreadsheet();
   var sheet = ss.getSheetByName(MASTER_SHEET_NAME);
  
   // Safety check
   if (rowIndex <= 1) return "Error: Cannot edit header.";
  
   // Update Column 18 (Column R)
   sheet.getRange(rowIndex, 18).setValue(jsonString);
  
   return "Success";
 } catch (e) {
   return "Error: " + e.toString();
 }
}


// ==========================================
// 7. DASHBOARD ANALYTICS (BACKEND)
// ==========================================


function getDashboardData() {
 var ss = SpreadsheetApp.getActiveSpreadsheet();

 var rawApprovalData = [];
 var rawTinjutData = [];
 // --- NEW: Container for Tanah & Bangunan Data ---
 var rawTanahData = []; 

 var evakinMetrics = {
   totalNUP: 0,
   totalTinjut: 0,
   totalLaporan: 0
 };

 // --- NEW: FETCH TARGETS ---
 // ID provided: 1_oOuw2nnfHVkW3CKJcCqsAEGgDw7Ml1MXoN--4WltqM
 var targetMetrics = { q1: 0, q2: 0, q3: 0, q4: 0 };
 try {
   var ssTarget = SpreadsheetApp.openById("1_oOuw2nnfHVkW3CKJcCqsAEGgDw7Ml1MXoN--4WltqM");
   // We look for a specific sheet/tab named "target_psp" to avoid conflict with evakin data
   var sheetTarget = ssTarget.getSheetByName("target_psp"); 
   if (sheetTarget) {
      // Fetch A2:D2
      var values = sheetTarget.getRange("A2:D2").getValues()[0];
      targetMetrics.q1 = values[0] || 0;
      targetMetrics.q2 = values[1] || 0;
      targetMetrics.q3 = values[2] || 0;
      targetMetrics.q4 = values[3] || 0;
   }
 } catch (e) {
   Logger.log("Error fetching targets: " + e.toString());
 }

 // --- 1. PROCESS SHEET: MONITORING_EVAKIN ---
 var sheetEvakin = ss.getSheetByName("monitoring_evakin");
 if (sheetEvakin) {
   var dataE = sheetEvakin.getDataRange().getValues();
   if (dataE.length > 1) {
     var headE = dataE[0].map(String);
    
     var colNUP = 6;
     var colTinjutEvakin = findColIndex(headE, ["no surat tinjut", "no surat tinjut satker"], 10);
     var colLaporanEvakin = findColIndex(headE, ["no laporan evakin", "no laporan"], 1);

     for (var k = 1; k < dataE.length; k++) {
       var row = dataE[k];
       if (!row[0] && !row[1]) continue;

       var valNUP = parseInt(row[colNUP]);
       if (!isNaN(valNUP)) {
         evakinMetrics.totalNUP += valNUP;
       }

       if (String(row[colTinjutEvakin]).trim() !== "") {
         evakinMetrics.totalTinjut++;
       }

       if (String(row[colLaporanEvakin]).trim() !== "") {
         evakinMetrics.totalLaporan++;
       }
     }
   }
 }

 // --- 2. PROCESS SHEET: MONITORING_PSP ---
 var sheetPSP = ss.getSheetByName("monitoring_psp");
 if (sheetPSP) {
   var dataPSP = sheetPSP.getDataRange().getValues();
   if (dataPSP.length > 1) {
     var headPSP = dataPSP[0].map(String);
     
     // Existing Column Finders
     var colDatePSP = findColIndex(headPSP, ["tgl persetujuan", "tgl setuju", "tgl sk"], 2);
     var colTinjutPSP = findColIndex(headPSP, ["status tinjut", "tinjut"], 10);
     var colPNBPPSP = findColIndex(headPSP, ["setoran pnbp", "pnbp"], 16);
     
     // --- NEW: Specific Columns for Tanah Logic ---
     // Column H is Index 7
     // Column O is Index 14
     var colJenisIndex = 7; 
     var colNupIndex = 14; 
    
     for (var i = 1; i < dataPSP.length; i++) {
       var row = dataPSP[i];
       if (isRowEmpty(row)) continue;

       var dateStr = parseDateToISO(row[colDatePSP]);
       var isTicked = checkTicked(row[colTinjutPSP]);
       var pnbpVal = parseMoney(row[colPNBPPSP]);

       // Existing Logic: Approval Trend
       if (dateStr) {
         rawApprovalData.push({ date: dateStr, isPSP: true, subType: "PSP BMN" });
       }
       // Existing Logic: Tinjut
       if (dateStr || isTicked) {
         rawTinjutData.push({ date: dateStr, ticked: isTicked, pnbp: pnbpVal, type: "PSP" });
       }

       // --- NEW LOGIC: TANAH & BANGUNAN FILTER ---
       // Check if Column H (Index 7) is exactly "tanah dan/atau bangunan"
       var jenisVal = String(row[colJenisIndex] || "").trim().toLowerCase();
       
       if (jenisVal === "tanah dan/atau bangunan") {
           var nupVal = parseInt(row[colNupIndex]);
           if (isNaN(nupVal)) nupVal = 0; // Default to 0 if empty/text

           // Only push if we have a valid date (required for the Year Filter in Dashboard)
           if (dateStr) {
               rawTanahData.push({ 
                   date: dateStr, 
                   nup: nupVal 
               });
           }
       }
       // ------------------------------------------
     }
   }
 }

 // --- 3. PROCESS SHEET: MONITORING_PENGELOLAAN ---
 var sheetKelola = ss.getSheetByName("monitoring_pengelolaan");
 if (sheetKelola) {
   var dataKelola = sheetKelola.getDataRange().getValues();
   if (dataKelola.length > 1) {
     var headKelola = dataKelola[0].map(String);
     var colDateKelola = findColIndex(headKelola, ["tgl persetujuan", "tgl setuju", "tgl sk"], 2);
     var colJenisKelola = findColIndex(headKelola, ["jenis pengelolaan", "jenis"], 3);
     var colTinjutKelola = findColIndex(headKelola, ["status tinjut", "tinjut"], 10);
     var colPNBPKelola = findColIndex(headKelola, ["setoran pnbp", "pnbp"], 16);

     for (var j = 1; j < dataKelola.length; j++) {
       var row = dataKelola[j];
       if (isRowEmpty(row)) continue;

       var dateStr = parseDateToISO(row[colDateKelola]);
       var jenisFull = String(row[colJenisKelola] || "").trim();
       var subType = jenisFull || "Lainnya";

       if (dateStr) {
         rawApprovalData.push({ date: dateStr, isPSP: false, subType: subType });
       }

       var isTicked = checkTicked(row[colTinjutKelola]);
       var pnbpVal = parseMoney(row[colPNBPKelola]);

       if (dateStr || isTicked) {
         rawTinjutData.push({ date: dateStr, ticked: isTicked, pnbp: pnbpVal, type: subType });
       }
     }
   }
 }

 return {
   kpi: {
     evakin: evakinMetrics, 
     rawApproval: rawApprovalData,
     rawTinjut: rawTinjutData,
     rawTanah: rawTanahData,
     targets: targetMetrics // --- NEW: Return the Tanah data
   }
 };
}


// --- KEEP HELPERS (Same as before) ---
function findColIndex(headers, keywords, fallbackIndex) {
 var found = headers.findIndex(h => keywords.some(k => h.toLowerCase().includes(k)));
 return found !== -1 ? found : fallbackIndex;
}
function isRowEmpty(row) { return !row[0] && !row[1] && !row[2]; }
function checkTicked(val) { return val === true || String(val).toLowerCase() === "true" || String(val).toLowerCase() === "v"; }
function parseMoney(val) { var str = String(val || ""); var clean = str.replace(/[Rp\s.]/g, "").replace(",", "."); var num = parseFloat(clean); return isNaN(num) ? 0 : num; }
function parseDateToISO(value) {
 if (!value) return null;
 if (value instanceof Date) return isNaN(value.getTime()) ? null : value.toISOString();
 var s = String(value).trim();
 if (s.length < 6) return null;
 var parts = s.split(/[\/\-\.]/);
 if (parts.length === 3) {
   var p1 = parseInt(parts[0], 10), p2 = parseInt(parts[1], 10), p3 = parseInt(parts[2], 10);
   if (p1 > 31) { var dt = new Date(p1, p2 - 1, p3); return !isNaN(dt.getTime()) ? dt.toISOString() : null; }
   else { var dt = new Date(p3, p2 - 1, p1); return !isNaN(dt.getTime()) ? dt.toISOString() : null; }
 }
 return null;
}

