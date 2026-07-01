/**
 * =====================================================================
 *  DAILY JOURNAL — Google Apps Script Backend
 * =====================================================================
 *
 *  A single-file REST-like API that uses a Google Sheet as the
 *  database for a personal journal app. Pairs with index.html.
 *
 *  HOW IT WORKS
 *  ------------
 *  Apps Script web apps cannot respond to CORS "preflight" (OPTIONS)
 *  requests, so a browser fetch() with a JSON content-type would be
 *  blocked before it even reaches this script. To avoid that, ALL
 *  operations (including reads) go through doPost(e), and the
 *  frontend sends its payload with a "text/plain" content type. That
 *  keeps the request classified as a CORS "simple request", which
 *  skips preflight entirely. We still parse the body as JSON
 *  ourselves — see doPost() below.
 *
 *  See README.md for full setup instructions.
 * =====================================================================
 */

// ---------------------------------------------------------------------
// CONFIGURATION — edit these two values before deploying
// ---------------------------------------------------------------------

// A shared secret the frontend must send with every request. This is
// NOT strong security (it lives in plain sight in index.html's source)
// — it's a low-cost trip-wire against automated scanners that stumble
// on your URL. Real protection is keeping the deployed URL private.
// Change this to your own random string, and use the SAME string in
// the CONFIG.API_KEY constant near the top of index.html.
const API_KEY = 'my-journal-secret-2026';

// The name of the sheet (tab) this script will read from and write to.
// It will be created automatically the first time the script runs if
// it doesn't already exist — you don't need to create it by hand.
const SHEET_NAME = 'Entries';

// ---------------------------------------------------------------------
// Column layout. Order matters — it defines both the sheet's header
// row and how spreadsheet rows are converted to/from JSON objects.
// ---------------------------------------------------------------------
const HEADERS = [
  'id',           // unique identifier, generated server-side
  'timestamp',    // ISO datetime the entry was first created
  'date',         // the journal date itself (YYYY-MM-DD), user-editable
  'title',        // short title for the entry
  'content',      // the main journal text
  'mood',         // a single emoji representing mood
  'tags',         // comma-separated tags
  'location',     // optional free-text location/weather note
  'lastModified'  // ISO datetime of the most recent edit
];

// Simple size guards, enforced server-side (the frontend also enforces
// these via maxlength so users get instant feedback, but the backend
// never trusts the client).
const LIMITS = {
  title: 200,
  content: 20000,
  tags: 300,
  location: 150
};

// =====================================================================
// ENTRY POINTS
// =====================================================================

/**
 * Handles GET requests. Only used as a human-friendly health check —
 * e.g. visiting the deployed URL directly in a browser to confirm the
 * deployment worked. All real data operations go through doPost.
 */
function doGet(e) {
  return jsonResponse({
    status: 'ok',
    message: 'Daily Journal API is running. Send POST requests for all data operations.'
  });
}

/**
 * Single entry point for every data operation: listing, creating,
 * updating, and deleting entries. Routing is done via an "action"
 * field in the JSON request body.
 *
 * Expected body (sent as text/plain, see header comment above):
 *   { "action": "list" | "create" | "update" | "delete",
 *     "apiKey": "...",
 *     "data": { ... } }
 */
function doPost(e) {
  let result;
  try {
    if (!e || !e.postData || !e.postData.contents) {
      throw new Error('Missing request body.');
    }

    const request = JSON.parse(e.postData.contents);

    if (request.apiKey !== API_KEY) {
      return jsonResponse({ status: 'error', message: 'Unauthorized: invalid API key.' });
    }

    const data = request.data || {};

    switch (request.action) {
      case 'list':
        result = listEntries();
        break;
      case 'create':
        result = createEntry(data);
        break;
      case 'update':
        result = updateEntry(data);
        break;
      case 'delete':
        result = deleteEntry(data);
        break;
      default:
        result = { status: 'error', message: 'Unknown action: "' + request.action + '".' };
    }
  } catch (err) {
    result = { status: 'error', message: 'Server error: ' + err.message };
  }

  return jsonResponse(result);
}

// =====================================================================
// CRUD OPERATIONS
// =====================================================================

function listEntries() {
  const sheet = getSheet();
  const lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    return { status: 'success', entries: [] };
  }

  const values = sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();
  const entries = values
    .filter(function (row) { return row[0]; }) // skip any blank rows
    .map(rowToEntry);

  // Most recent first: by journal date, then by creation time for ties.
  entries.sort(function (a, b) {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return new Date(b.timestamp) - new Date(a.timestamp);
  });

  return { status: 'success', entries: entries };
}

function createEntry(data) {
  const validation = validateEntry(data);
  if (!validation.valid) {
    return { status: 'error', message: validation.message };
  }

  const sheet = getSheet();
  const now = new Date().toISOString();
  const id = Utilities.getUuid();

  const row = [
    id,
    now,
    data.date,
    sanitize(data.title),
    sanitize(data.content),
    sanitize(data.mood),
    sanitize(data.tags),
    sanitize(data.location),
    now
  ];

  sheet.appendRow(row);

  return { status: 'success', message: 'Entry created.', entry: rowToEntry(row) };
}

function updateEntry(data) {
  if (!data.id) {
    return { status: 'error', message: 'Missing entry id.' };
  }

  const validation = validateEntry(data);
  if (!validation.valid) {
    return { status: 'error', message: validation.message };
  }

  const sheet = getSheet();
  const rowIndex = findRowById(sheet, data.id);
  if (rowIndex === -1) {
    return { status: 'error', message: 'Entry not found. It may have already been deleted.' };
  }

  const originalTimestamp = sheet.getRange(rowIndex, 2).getValue();
  const now = new Date().toISOString();

  const row = [
    data.id,
    originalTimestamp,
    data.date,
    sanitize(data.title),
    sanitize(data.content),
    sanitize(data.mood),
    sanitize(data.tags),
    sanitize(data.location),
    now
  ];

  sheet.getRange(rowIndex, 1, 1, HEADERS.length).setValues([row]);

  return { status: 'success', message: 'Entry updated.', entry: rowToEntry(row) };
}

function deleteEntry(data) {
  if (!data.id) {
    return { status: 'error', message: 'Missing entry id.' };
  }

  const sheet = getSheet();
  const rowIndex = findRowById(sheet, data.id);
  if (rowIndex === -1) {
    return { status: 'error', message: 'Entry not found. It may have already been deleted.' };
  }

  sheet.deleteRow(rowIndex);
  return { status: 'success', message: 'Entry deleted.' };
}

// =====================================================================
// VALIDATION & SANITIZATION
// =====================================================================

/**
 * Server-side validation. The frontend validates too, but the backend
 * never trusts client-side checks — they're only there for a snappier
 * user experience.
 */
function validateEntry(data) {
  if (!data.date || !/^\d{4}-\d{2}-\d{2}$/.test(data.date)) {
    return { valid: false, message: 'A valid date (YYYY-MM-DD) is required.' };
  }
  if (isNaN(new Date(data.date).getTime())) {
    return { valid: false, message: 'That date does not look valid.' };
  }
  if (!data.title || !data.title.toString().trim()) {
    return { valid: false, message: 'Title is required.' };
  }
  if (data.title.toString().length > LIMITS.title) {
    return { valid: false, message: 'Title must be under ' + LIMITS.title + ' characters.' };
  }
  if (!data.content || !data.content.toString().trim()) {
    return { valid: false, message: 'Content is required.' };
  }
  if (data.content.toString().length > LIMITS.content) {
    return { valid: false, message: 'Content must be under ' + LIMITS.content + ' characters.' };
  }
  if (data.tags && data.tags.toString().length > LIMITS.tags) {
    return { valid: false, message: 'Tags must be under ' + LIMITS.tags + ' characters.' };
  }
  if (data.location && data.location.toString().length > LIMITS.location) {
    return { valid: false, message: 'Location/weather note must be under ' + LIMITS.location + ' characters.' };
  }
  return { valid: true };
}

/**
 * Trims and coerces to a plain string. Formula-injection protection
 * (a value like "=A1" being interpreted as a spreadsheet formula) is
 * handled separately by formatting the data columns as plain text —
 * see getSheet() — rather than by mangling the text here, so what a
 * user types is always exactly what they get back.
 */
function sanitize(value) {
  if (value === null || value === undefined) return '';
  return value.toString().trim();
}

// =====================================================================
// SHEET HELPERS
// =====================================================================

/**
 * Returns the Entries sheet, creating it (with headers, a frozen
 * header row, and plain-text formatted data columns) if it doesn't
 * exist yet. Safe to call on every request.
 */
function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
    sheet.getRange('1:1').setFontWeight('bold');

    // Force every data cell to be treated as plain text. This means a
    // journal entry that happens to start with "=" or "+" is stored
    // and read back exactly as typed, instead of Sheets trying to
    // evaluate it as a formula (a real risk for spreadsheet-backed
    // apps, sometimes called formula/CSV injection).
    sheet.getRange(2, 1, Math.max(sheet.getMaxRows() - 1, 1000), HEADERS.length).setNumberFormat('@');

    sheet.setColumnWidths(1, HEADERS.length, 160);
  }

  return sheet;
}

function rowToEntry(row) {
  const entry = {};
  HEADERS.forEach(function (key, i) { entry[key] = row[i]; });
  return entry;
}

/** Returns the 1-indexed sheet row number for a given entry id, or -1. */
function findRowById(sheet, id) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;

  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (ids[i][0] === id) return i + 2; // +2: 1-indexed, plus the header row
  }
  return -1;
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// =====================================================================
// ONE-TIME SETUP — run manually from the Apps Script editor
// =====================================================================

/**
 * Run this once, manually, from the Apps Script editor before your
 * first deployment (select "setupSheet" in the function dropdown at
 * the top, then click ▶ Run). It creates the Entries sheet ahead of
 * time and — importantly — triggers Google's permission prompt in a
 * clear, visible context rather than surprising you during your first
 * real API call. Check View > Logs afterwards to confirm it worked.
 */
function setupSheet() {
  const sheet = getSheet();
  Logger.log(
    'Setup complete. "%s" sheet is ready with %s existing entr%s.',
    SHEET_NAME,
    sheet.getLastRow() - 1,
    (sheet.getLastRow() - 1) === 1 ? 'y' : 'ies'
  );
}
