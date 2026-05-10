const SHEET_NAME = 'Responses';
const SCRIPT_PROPERTIES = PropertiesService.getScriptProperties();

/**
 * Set these Script Properties in Apps Script project settings:
 * - SPREADSHEET_ID: target Google Sheet ID
 * - ALLOWED_ORIGINS: comma-separated allowed origins (e.g. https://username.github.io,https://username.github.io/repo)
 */

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse_(false, 'Invalid request body', 400);
    }

    const payload = parseJson_(e.postData.contents);
    if (!payload) {
      return jsonResponse_(false, 'Malformed JSON payload', 400);
    }

    const spamCheck = validateAntiSpam_(payload);
    if (!spamCheck.ok) {
      return jsonResponse_(false, spamCheck.message, 429);
    }

    const validation = validatePayload_(payload);
    if (!validation.ok) {
      return jsonResponse_(false, validation.message, 400);
    }

    const originCheck = validateOrigin_(payload);
    if (!originCheck.ok) {
      return jsonResponse_(false, originCheck.message, 403);
    }

    const sanitized = sanitizePayload_(payload);

    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      if (isDuplicate_(sanitized)) {
        return jsonResponse_(false, 'Duplicate or rapid repeat submission detected', 409);
      }

      const writeResult = writeResponse_(sanitized);
      setSubmissionFingerprint_(sanitized);

      return jsonResponse_(true, 'Survey submitted successfully', 200, {
        responseId: writeResult.responseId
      });
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    console.error('doPost error:', err && err.stack ? err.stack : err);
    return jsonResponse_(false, 'Server error while processing submission', 500);
  }
}

function doGet() {
  return jsonResponse_(true, 'Survey API is running', 200, { method: 'POST' });
}

function writeResponse_(payload) {
  const spreadsheetId = SCRIPT_PROPERTIES.getProperty('SPREADSHEET_ID');
  if (!spreadsheetId) {
    throw new Error('Missing SPREADSHEET_ID script property');
  }

  const ss = SpreadsheetApp.openById(spreadsheetId);
  const sheet = getOrCreateSheet_(ss, SHEET_NAME);

  const headers = ensureHeaders_(sheet);
  const rowObject = flattenPayload_(payload);
  rowObject.timestamp = new Date().toISOString();
  rowObject.responseId = createResponseId_();
  rowObject.userAgent = safeGet_(payload, ['metadata', 'userAgent']) || '';

  const row = headers.map((h) => rowObject[h] !== undefined ? rowObject[h] : '');
  sheet.appendRow(row);

  return { responseId: rowObject.responseId };
}

function ensureHeaders_(sheet) {
  const requiredBase = ['timestamp', 'responseId', 'userAgent'];
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const existing = sheet.getRange(1, 1, 1, lastCol).getValues()[0].filter(Boolean);

  const dynamicKeys = getDynamicSurveyKeys_();
  const targetHeaders = requiredBase.concat(dynamicKeys);

  const merged = existing.slice();
  targetHeaders.forEach((key) => {
    if (merged.indexOf(key) === -1) merged.push(key);
  });

  if (merged.length === 0) {
    sheet.getRange(1, 1, 1, targetHeaders.length).setValues([targetHeaders]);
    return targetHeaders;
  }

  if (existing.join('||') !== merged.join('||')) {
    sheet.getRange(1, 1, 1, merged.length).setValues([merged]);
  }

  return merged;
}

function getDynamicSurveyKeys_() {
  return [
    'respondent.name',
    'respondent.phone',
    'respondent.association',
    'respondent.associationOther',
    'respondent.area',
    'respondent.plotNumber',
    'respondent.tenure',
    'respondent.category',
    'currentSituation.awareOfValuation',
    'currentSituation.receivedCommunication',
    'currentSituation.participatedInHearings',
    'currentSituation.paidUnderPreviousFramework',
    'currentSituation.amountDemandedKES',
    'affordability.comparedToOld',
    'affordability.affordabilityScore',
    'affordability.householdCategory',
    'affordability.maxAffordableKES',
    'affordability.defaultRisk',
    'ratingFramework.preferredSystem',
    'ratingFramework.preferredFlatRange',
    'ratingFramework.differentiationPreferences',
    'ratingFramework.exemptionGroups',
    'serviceDelivery.serviceRatings',
    'serviceDelivery.ratesProportional',
    'serviceDelivery.wouldPayIfTransparent',
    'serviceDelivery.willingToPayIfFair',
    'legalConcerns.hasConcerns',
    'legalConcerns.specificIssues',
    'legalConcerns.supportLegalAction',
    'legalConcerns.preferredStrategy',
    'priorities.topPriorities',
    'priorities.maraSatisfactionRating',
    'priorities.additionalComments',
    'priorities.contactableForFollowUp',
    'metadata.pageUrl',
    'metadata.origin',
    'metadata.language',
    'metadata.platform',
    'metadata.submittedAtClient'
  ];
}

function flattenPayload_(payload) {
  const out = {};

  function visit(prefix, value) {
    if (value === null || value === undefined) {
      out[prefix] = '';
      return;
    }

    if (Array.isArray(value)) {
      out[prefix] = value.map(sanitizeValue_).join(' | ');
      return;
    }

    if (typeof value === 'object') {
      Object.keys(value).forEach((key) => {
        const next = prefix ? prefix + '.' + key : key;
        visit(next, value[key]);
      });
      return;
    }

    out[prefix] = sanitizeValue_(value);
  }

  visit('', payload);
  if (out['']) delete out[''];
  return out;
}

function validatePayload_(payload) {
  const name = safeGet_(payload, ['respondent', 'name']);
  const phone = safeGet_(payload, ['respondent', 'phone']);
  const assoc = safeGet_(payload, ['respondent', 'association']);
  const tenure = safeGet_(payload, ['respondent', 'tenure']);
  const ratingSystem = safeGet_(payload, ['ratingFramework', 'preferredSystem']);

  if (!name || String(name).trim().length < 2) return { ok: false, message: 'Missing respondent name' };
  if (!phone || String(phone).trim().length < 7) return { ok: false, message: 'Missing respondent phone' };
  if (!assoc) return { ok: false, message: 'Missing association' };
  if (!tenure) return { ok: false, message: 'Missing tenure' };
  if (!ratingSystem) return { ok: false, message: 'Missing preferred rating system' };

  return { ok: true };
}

function validateAntiSpam_(payload) {
  const honeypot = safeGet_(payload, ['antiSpam', 'honeypot']);
  if (honeypot && String(honeypot).trim() !== '') {
    return { ok: false, message: 'Spam detected' };
  }

  return { ok: true };
}

function validateOrigin_(payload) {
  const configured = SCRIPT_PROPERTIES.getProperty('ALLOWED_ORIGINS') || '';
  const allowed = configured.split(',').map(function (s) { return s.trim(); }).filter(Boolean);

  if (allowed.length === 0) return { ok: true };

  const origin = String(safeGet_(payload, ['metadata', 'origin']) || '').trim();
  if (!origin || allowed.indexOf(origin) === -1) {
    return { ok: false, message: 'Origin not allowed' };
  }

  return { ok: true };
}

function sanitizePayload_(payload) {
  return deepSanitize_(payload);
}

function deepSanitize_(value) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map(deepSanitize_);
  if (typeof value === 'object') {
    const out = {};
    Object.keys(value).forEach(function (k) {
      out[sanitizeKey_(k)] = deepSanitize_(value[k]);
    });
    return out;
  }
  return sanitizeValue_(value);
}

function sanitizeKey_(key) {
  return String(key).replace(/[^a-zA-Z0-9_.-]/g, '').substring(0, 80);
}

function sanitizeValue_(value) {
  return String(value)
    .replace(/[<>]/g, '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .trim()
    .substring(0, 2000);
}

function isDuplicate_(payload) {
  const fp = getSubmissionFingerprint_(payload);
  const cache = CacheService.getScriptCache();
  return cache.get(fp) !== null;
}

function setSubmissionFingerprint_(payload) {
  const fp = getSubmissionFingerprint_(payload);
  const cache = CacheService.getScriptCache();
  cache.put(fp, '1', 30);
}

function getSubmissionFingerprint_(payload) {
  const name = (safeGet_(payload, ['respondent', 'name']) || '').toLowerCase();
  const phone = (safeGet_(payload, ['respondent', 'phone']) || '').toLowerCase();
  const ua = (safeGet_(payload, ['metadata', 'userAgent']) || '').toLowerCase();
  const raw = [name, phone, ua].join('|');
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, raw, Utilities.Charset.UTF_8);
  return digest.map(function (b) {
    const v = (b < 0 ? b + 256 : b).toString(16);
    return v.length === 1 ? '0' + v : v;
  }).join('');
}

function createResponseId_() {
  const now = new Date();
  const ts = Utilities.formatDate(now, 'UTC', 'yyyyMMddHHmmss');
  const rand = Math.floor(Math.random() * 900000 + 100000);
  return 'MARA-' + ts + '-' + rand;
}

function parseJson_(text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    console.error('JSON parse error:', e);
    return null;
  }
}

function safeGet_(obj, path) {
  return path.reduce(function (acc, key) {
    return acc && acc[key] !== undefined ? acc[key] : undefined;
  }, obj);
}

function getOrCreateSheet_(ss, sheetName) {
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }
  return sheet;
}

function jsonResponse_(success, message, statusCode, extra) {
  const body = {
    success: !!success,
    message: message || '',
    statusCode: statusCode || 200
  };

  if (extra && typeof extra === 'object') {
    Object.keys(extra).forEach(function (k) {
      body[k] = extra[k];
    });
  }

  return ContentService
    .createTextOutput(JSON.stringify(body))
    .setMimeType(ContentService.MimeType.JSON);
}
