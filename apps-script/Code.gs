/**
 * Google Sheets "database" REST endpoint (Apps Script Web App).
 *
 * Endpoints (one Web App URL, routed by the "action" query parameter):
 *   POST ?action=participants  → append to "participants" sheet
 *   POST ?action=wishes        → append to "wishes" sheet
 *   GET  ?action=wishes        → 10 random wishes
 *   GET  (no action)           → health check
 *
 * Deploy: Extensions → Apps Script (from the target spreadsheet) → paste this file →
 * Deploy → New deployment → Web app → Execute as: Me, Who has access: Anyone.
 * After editing: Deploy → Manage deployments → Edit → Version: New version (keeps the same URL).
 */

// ===================== CONFIGURATION — customize here =====================

const CONFIG = {
  // https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>/edit
  // Set to '' to use the spreadsheet the script is bound to instead.
  SPREADSHEET_ID: 'placeholder',
  LOCK_TIMEOUT_MS: 1000,
  TIMESTAMP_HEADER: 'timestamp',
  // Optional shared secret for POSTs. Set Script Properties → API_KEY to enable; clients send it as "apiKey".
  API_KEY_PROPERTY: 'API_KEY',
  MAX_PAYLOAD_BYTES: 10 * 1024,
  RANDOM_WISHES_COUNT: 10,
};

/**
 * One entry per POST action. Fields are listed in column order (after the timestamp column).
 *   key       – JSON property name sent by the client, also used as the column header
 *   required  – reject the request if missing/blank
 *   type      – 'string' (default) | 'number' | 'boolean'
 *   maxLength – strings only
 *   min / max – numbers only
 *   allowed   – optional whitelist of values
 */
const RESOURCES = {
  participants: {
    sheetName: 'participants',
    fields: [
      { key: 'participation_options', required: true, type: 'string',
        allowed: ['Да, приду', 'Приду с семьёй', 'К сожалению, не смогу'] },
      { key: 'name', required: true, type: 'string', maxLength: 100 },
    ],
  },
  wishes: {
    sheetName: 'wishes',
    fields: [
      { key: 'name', required: true, type: 'string', maxLength: 100 },
      { key: 'wish', required: true, type: 'string', maxLength: 5000 },
    ],
  },
};

// ==========================================================================

function doPost(e) {
  try {
    const resource = getResource_(e);
    // Parse + validate BEFORE taking the lock, so the lock is held only for the write.
    const payload = parseJsonBody_(e);
    checkApiKey_(payload);
    const values = validate_(resource.fields, payload);

    // A Date object is stored as a real datetime cell, not text.
    const row = [new Date()].concat(values);
    const rowNumber = appendRowLocked_(resource, row);

    return respond_(200, 'Record saved.', { row: rowNumber });
  } catch (err) {
    return handleError_('doPost', err);
  }
}

function doGet(e) {
  try {
    const action = e && e.parameter && e.parameter.action;
    if (!action) return respond_(200, 'OK'); // health check
    if (action === 'wishes') {
      return respond_(200, 'OK', { wishes: getRandomWishes_(CONFIG.RANDOM_WISHES_COUNT) });
    }
    throw new ApiError(404, 'Unknown action: ' + action);
  } catch (err) {
    return handleError_('doGet', err);
  }
}

function handleError_(where, err) {
  if (err instanceof ApiError) {
    return respond_(err.code, err.message, err.details ? { errors: err.details } : undefined);
  }
  // Unexpected failure: log the details, don't leak internals to the client.
  console.error('%s failed: %s\n%s', where, err && err.message, err && err.stack);
  return respond_(500, 'Internal server error.');
}

// --------------------------------- Routing ---------------------------------

function getResource_(e) {
  const action = e && e.parameter && e.parameter.action;
  if (!action) {
    throw new ApiError(400, 'Missing "action" query parameter. Use one of: ' + Object.keys(RESOURCES).join(', ') + '.');
  }
  if (!Object.prototype.hasOwnProperty.call(RESOURCES, action)) {
    throw new ApiError(404, 'Unknown action: ' + action);
  }
  return RESOURCES[action];
}

// --------------------------------- Parsing ---------------------------------

function parseJsonBody_(e) {
  const body = e && e.postData && e.postData.contents;
  if (!body || !body.trim()) {
    throw new ApiError(400, 'Request body is empty. Send a JSON object.');
  }
  if (body.length > CONFIG.MAX_PAYLOAD_BYTES) {
    throw new ApiError(413, 'Payload too large.');
  }

  let data;
  try {
    data = JSON.parse(body);
  } catch (_) {
    throw new ApiError(400, 'Malformed JSON.');
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new ApiError(400, 'JSON body must be an object.');
  }
  if (Object.keys(data).length === 0) {
    throw new ApiError(400, 'JSON object is empty.');
  }
  return data;
}

function checkApiKey_(payload) {
  const expected = PropertiesService.getScriptProperties().getProperty(CONFIG.API_KEY_PROPERTY);
  if (expected && payload.apiKey !== expected) {
    throw new ApiError(401, 'Unauthorized.');
  }
}

// ------------------------------- Validation --------------------------------

/** Returns the row values (in fields order) or throws a 400 listing every problem at once. */
function validate_(fields, payload) {
  const errors = [];
  const values = fields.map(function (field) {
    const raw = payload[field.key];
    const isBlank = raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '');

    if (isBlank) {
      if (field.required) errors.push(field.key + ' is required.');
      return '';
    }

    const value = coerce_(field, raw, errors);
    if (value === undefined) return '';

    if (field.allowed && field.allowed.indexOf(value) === -1) {
      errors.push(field.key + ' must be one of: ' + field.allowed.join(', ') + '.');
    }
    return value;
  });

  if (errors.length) {
    throw new ApiError(400, 'Validation failed.', errors);
  }
  return values;
}

function coerce_(field, raw, errors) {
  switch (field.type || 'string') {
    case 'number': {
      const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
      if (!isFinite(n)) { errors.push(field.key + ' must be a number.'); return undefined; }
      if (field.min !== undefined && n < field.min) errors.push(field.key + ' must be >= ' + field.min + '.');
      if (field.max !== undefined && n > field.max) errors.push(field.key + ' must be <= ' + field.max + '.');
      return n;
    }
    case 'boolean': {
      if (typeof raw === 'boolean') return raw;
      const s = String(raw).toLowerCase();
      if (s === 'true' || s === 'false') return s === 'true';
      errors.push(field.key + ' must be true or false.');
      return undefined;
    }
    default: {
      if (typeof raw === 'object') { errors.push(field.key + ' must be a string.'); return undefined; }
      const s = String(raw).trim();
      if (field.maxLength && s.length > field.maxLength) {
        errors.push(field.key + ' must be at most ' + field.maxLength + ' characters.');
      }
      // Whitelisted values are compared as-is; everything else is made formula-safe.
      return field.allowed ? s : sanitizeForSheet_(s);
    }
  }
}

/** Prevents formula/CSV injection: a value like "=IMPORTXML(...)" is stored as plain text. */
function sanitizeForSheet_(s) {
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}

// ------------------------------- Data access -------------------------------

function appendRowLocked_(resource, row) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(CONFIG.LOCK_TIMEOUT_MS)) {
    throw new ApiError(503, 'Server busy, please retry.');
  }
  try {
    const sheet = getSheet_(resource);
    const rowNumber = sheet.getLastRow() + 1;
    // One batched write instead of per-cell calls.
    sheet.getRange(rowNumber, 1, 1, row.length).setValues([row]);
    // Commit before releasing the lock so the next request sees the new last row.
    SpreadsheetApp.flush();
    return rowNumber;
  } finally {
    lock.releaseLock();
  }
}

/** Reads all wishes in one call and returns `count` random ones (Fisher–Yates partial shuffle). */
function getRandomWishes_(count) {
  const resource = RESOURCES.wishes;
  const sheet = getSpreadsheet_().getSheetByName(resource.sheetName);
  if (!sheet || sheet.getLastRow() < 2) return [];

  const keys = [CONFIG.TIMESTAMP_HEADER].concat(resource.fields.map(function (f) { return f.key; }));
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, keys.length).getValues();

  const n = Math.min(count, rows.length);
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(Math.random() * (rows.length - i));
    const tmp = rows[i]; rows[i] = rows[j]; rows[j] = tmp;
  }

  return rows.slice(0, n).map(function (row) {
    const obj = {};
    keys.forEach(function (key, idx) {
      const v = row[idx];
      obj[key] = v instanceof Date ? v.toISOString() : v;
    });
    return obj;
  });
}

function getSpreadsheet_() {
  return CONFIG.SPREADSHEET_ID
    ? SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();
}

/** Gets (or creates) the resource's sheet and writes the header row if it's missing. Call under lock. */
function getSheet_(resource) {
  const ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(resource.sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(resource.sheetName);
  }
  if (sheet.getLastRow() === 0) {
    const headers = [CONFIG.TIMESTAMP_HEADER].concat(resource.fields.map(function (f) { return f.key; }));
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// -------------------------------- Responses --------------------------------

function ApiError(code, message, details) {
  this.code = code;
  this.message = message;
  this.details = details;
}
ApiError.prototype = Object.create(Error.prototype);

/**
 * Apps Script cannot set real HTTP status codes (the transport is always 200),
 * so the status is carried in the body as "code".
 */
function respond_(code, message, extra) {
  const body = { success: code >= 200 && code < 300, code: code, message: message };
  if (extra) Object.keys(extra).forEach(function (k) { body[k] = extra[k]; });
  return ContentService
    .createTextOutput(JSON.stringify(body))
    .setMimeType(ContentService.MimeType.JSON);
}
