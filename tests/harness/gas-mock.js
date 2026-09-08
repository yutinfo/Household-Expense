'use strict';
/**
 * In-memory emulation of the Google Apps Script services used by the project.
 * Enough fidelity for logic tests: getValues/setValues ranges, script
 * properties, locks, HMAC, base64, formatDate with timezone, UrlFetchApp stub.
 */
const crypto = require('crypto');

function createMockSpreadsheet(id) {
  const sheets = new Map();
  let timeZone = 'Asia/Bangkok';

  class Range {
    constructor(sheet, row, col, numRows, numCols) {
      this.sheet = sheet; this.row = row; this.col = col; this.numRows = numRows; this.numCols = numCols;
    }
    getValues() {
      const out = [];
      for (let r = 0; r < this.numRows; r++) {
        const rowArr = [];
        for (let c = 0; c < this.numCols; c++) {
          const v = (this.sheet.data[this.row - 1 + r] || [])[this.col - 1 + c];
          rowArr.push(v === undefined ? '' : v);
        }
        out.push(rowArr);
      }
      return out;
    }
    getValue() { return this.getValues()[0][0]; }
    setValues(values) {
      if (values.length !== this.numRows) throw new Error('setValues rows mismatch');
      for (let r = 0; r < this.numRows; r++) {
        if (values[r].length !== this.numCols) throw new Error('setValues cols mismatch');
        const target = this.row - 1 + r;
        while (this.sheet.data.length <= target) this.sheet.data.push([]);
        for (let c = 0; c < this.numCols; c++) {
          let v = values[r][c];
          if (typeof v === 'string' && v.startsWith("'")) v = v; // sheet keeps apostrophe-marked literal
          else if (typeof v === 'string' && /^[=+]/.test(v) && this.sheet.ss.formulaGuard) {
            this.sheet.ss.formulaWrites.push({ sheet: this.sheet.name, value: v });
          }
          this.sheet.data[target][this.col - 1 + c] = v;
        }
      }
      this.sheet.ss.writeCount++;
      return this;
    }
    setValue(v) { return this.setValues([[v]]); }
    setNumberFormat() { return this; }
    setFontWeight() { return this; }
    setDataValidation() { return this; }
    setBackground() { return this; }
    setFormula(f) { this.sheet.data[this.row - 1] = this.sheet.data[this.row - 1] || []; this.sheet.data[this.row - 1][this.col - 1] = f; return this; }
    setFormulas(f) { return this.setValues(f); }
    protect() { const p = { setDescription() { return p; }, setWarningOnly() { return p; }, remove() {} }; this.sheet.rangeProtections.push(p); return p; }
    clearContent() { for (let r = 0; r < this.numRows; r++) for (let c = 0; c < this.numCols; c++) if (this.sheet.data[this.row - 1 + r]) this.sheet.data[this.row - 1 + r][this.col - 1 + c] = ''; return this; }
    merge() { return this; }
    setHorizontalAlignment() { return this; }
    setWrap() { return this; }
    setFontSize() { return this; }
  }

  class Sheet {
    constructor(ss, name) { this.ss = ss; this.name = name; this.data = []; this.sheetProtections = []; this.rangeProtections = []; this.charts = []; this.hidden = false; }
    getName() { return this.name; }
    getRange(row, col, numRows, numCols) { return new Range(this, row, col, numRows || 1, numCols || 1); }
    getLastRow() { let last = 0; this.data.forEach((r, i) => { if (r.some(v => v !== '' && v !== undefined && v !== null)) last = i + 1; }); return last; }
    getLastColumn() { let last = 0; this.data.forEach(r => { r.forEach((v, i) => { if (v !== '' && v !== undefined && v !== null) last = Math.max(last, i + 1); }); }); return last; }
    getMaxRows() { return Math.max(1000, this.data.length); }
    getMaxColumns() { return 26; }
    deleteRow(r) { this.data.splice(r - 1, 1); }
    deleteRows(r, n) { this.data.splice(r - 1, n); }
    insertRows() {}
    clear() { this.data = []; return this; }
    clearContents() { this.data = []; return this; }
    setFrozenRows() {}
    setColumnWidth() {}
    setColumnWidths() {}
    autoResizeColumns() {}
    hideSheet() { this.hidden = true; }
    getProtections(type) { return type === 'SHEET' ? this.sheetProtections : this.rangeProtections; }
    protect() { const p = { setDescription() { return p; }, setWarningOnly() { return p; }, remove() {} }; this.sheetProtections.push(p); return p; }
    newChart() {
      const b = { setChartType() { return b; }, addRange() { return b; }, setPosition() { return b; }, setOption() { return b; }, build() { return {}; } };
      return b;
    }
    insertChart(c) { this.charts.push(c); }
    getCharts() { return this.charts; }
    removeChart() {}
    getSheetId() { return 1; }
  }

  const ss = {
    id,
    writeCount: 0,
    formulaGuard: true,
    formulaWrites: [],
    getId() { return id; },
    getName() { return 'MockSpreadsheet-' + id; },
    getSheetByName(name) { return sheets.get(name) || null; },
    insertSheet(name) { const s = new Sheet(ss, name); sheets.set(name, s); return s; },
    getSheets() { return [...sheets.values()]; },
    deleteSheet(sh) { sheets.delete(sh.name); },
    setSpreadsheetTimeZone(tz) { timeZone = tz; },
    getSpreadsheetTimeZone() { return timeZone; },
    getUrl() { return 'https://docs.google.com/spreadsheets/d/' + id; },
    copy(name) { const c = createMockSpreadsheet(id + '-copy-' + Date.now()); sheets.forEach((s, n) => { const ns = c.insertSheet(n); ns.data = s.data.map(r => r.slice()); }); c.copyName = name; return c; },
    _sheets: sheets
  };
  return ss;
}

function pad(n, l) { return String(n).padStart(l || 2, '0'); }

function formatDate(date, tz, pattern) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(date);
  const p = {};
  parts.forEach(x => { p[x.type] = x.value; });
  if (p.hour === '24') p.hour = '00';
  return pattern
    .replace(/yyyy/g, p.year).replace(/MM/g, p.month).replace(/dd/g, p.day)
    .replace(/HH/g, p.hour).replace(/mm/g, p.minute).replace(/ss/g, p.second)
    .replace(/'T'/g, 'T').replace(/XXX/g, tz === 'Asia/Bangkok' ? '+07:00' : 'Z');
}

function createEnvironment(options) {
  options = options || {};
  const spreadsheets = new Map();
  const props = Object.assign({ SPREADSHEET_ID: 'TEST_SS', ALLOWED_GROUP_ID: 'Cgroup1', INTERNAL_SIGNING_SECRET: 'internal-secret-for-tests-0123456789', LINE_CHANNEL_SECRET: 'line-channel-secret-for-tests', LINE_CHANNEL_ACCESS_TOKEN: 'line-token-for-tests-abcdef', GEMINI_API_KEY: 'gemini-key-for-tests-abcdef' }, options.properties || {});
  const cache = new Map();
  const fetchLog = [];
  let fetchHandler = options.fetchHandler || (() => { throw new Error('UrlFetchApp not stubbed'); });
  const lockState = { held: false, acquisitions: 0 };
  const triggers = [];
  const driveFiles = [];

  function getSpreadsheet(id) {
    if (!spreadsheets.has(id)) spreadsheets.set(id, createMockSpreadsheet(id));
    return spreadsheets.get(id);
  }

  const env = {
    SpreadsheetApp: {
      openById(id) { return getSpreadsheet(id); },
      getActiveSpreadsheet() { return getSpreadsheet(props.SPREADSHEET_ID); },
      flush() {},
      newDataValidation() { const b = { requireValueInList() { return b; }, setAllowInvalid() { return b; }, build() { return {}; } }; return b; },
      ProtectionType: { SHEET: 'SHEET', RANGE: 'RANGE' },
      Charts: { ChartType: { PIE: 'PIE', COLUMN: 'COLUMN', LINE: 'LINE' } }
    },
    PropertiesService: {
      getScriptProperties() {
        return {
          getProperties() { return Object.assign({}, props); },
          getProperty(k) { return Object.prototype.hasOwnProperty.call(props, k) ? props[k] : null; },
          setProperty(k, v) { props[k] = String(v); },
          setProperties(map) { Object.keys(map).forEach(k => { props[k] = String(map[k]); }); },
          deleteProperty(k) { delete props[k]; }
        };
      }
    },
    LockService: {
      getScriptLock() {
        return {
          tryLock() { if (lockState.held) return false; lockState.held = true; lockState.acquisitions++; return true; },
          waitLock() { if (lockState.held) throw new Error('lock held'); lockState.held = true; lockState.acquisitions++; },
          releaseLock() { lockState.held = false; },
          hasLock() { return lockState.held; }
        };
      }
    },
    CacheService: {
      getScriptCache() {
        return {
          get(k) { const e = cache.get(k); if (!e) return null; if (e.exp && e.exp < Date.now()) { cache.delete(k); return null; } return e.v; },
          put(k, v, ttl) { cache.set(k, { v: String(v), exp: ttl ? Date.now() + ttl * 1000 : 0 }); },
          remove(k) { cache.delete(k); }
        };
      }
    },
    Utilities: {
      formatDate,
      base64Encode(input) { return Buffer.from(typeof input === 'string' ? input : Buffer.from(input.map(b => b & 0xff))).toString('base64'); },
      base64Decode(s) { return Array.from(Buffer.from(s, 'base64')).map(b => (b > 127 ? b - 256 : b)); },
      newBlob(bytes, mime, name) { const buf = Buffer.from((Array.isArray(bytes) ? bytes : []).map(b => b & 0xff)); return { getDataAsString() { return buf.toString('utf8'); }, getBytes() { return Array.from(buf); }, getContentType() { return mime; }, getName() { return name; } }; },
      computeHmacSha256Signature(value, key) {
        const v = typeof value === 'string' ? Buffer.from(value, 'utf8') : Buffer.from(value.map(b => b & 0xff));
        const k = typeof key === 'string' ? Buffer.from(key, 'utf8') : Buffer.from(key.map(b => b & 0xff));
        return Array.from(crypto.createHmac('sha256', k).update(v).digest()).map(b => (b > 127 ? b - 256 : b));
      },
      computeDigest(alg, value) {
        const v = typeof value === 'string' ? Buffer.from(value, 'utf8') : Buffer.from(value.map(b => b & 0xff));
        return Array.from(crypto.createHash('sha256').update(v).digest()).map(b => (b > 127 ? b - 256 : b));
      },
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      Charset: { UTF_8: 'UTF_8' },
      getUuid() { return crypto.randomUUID(); },
      sleep() {}
    },
    UrlFetchApp: {
      fetch(url, params) {
        fetchLog.push({ url, params });
        const res = fetchHandler(url, params || {});
        const status = res.status || 200;
        const body = typeof res.body === 'string' ? res.body : JSON.stringify(res.body || {});
        if (status >= 400 && !(params && params.muteHttpExceptions)) throw new Error('HTTP ' + status);
        return { getResponseCode() { return status; }, getContentText() { return body; }, getBlob() { return env.Utilities.newBlob(Array.from(Buffer.from(body)), res.mime || 'application/octet-stream', 'content'); }, getHeaders() { return res.headers || {}; } };
      }
    },
    ScriptApp: {
      getProjectTriggers() { return triggers.slice(); },
      deleteTrigger(t) { const i = triggers.indexOf(t); if (i >= 0) triggers.splice(i, 1); },
      newTrigger(fn) {
        const t = { fn, getHandlerFunction() { return fn; } };
        const b = { timeBased() { return b; }, everyMinutes(m) { t.everyMinutes = m; return b; }, everyHours(h) { t.everyHours = h; return b; }, everyDays(d) { t.everyDays = d; return b; }, everyWeeks(w) { t.everyWeeks = w; return b; }, atHour(h) { t.atHour = h; return b; }, onWeekDay(d) { t.weekDay = d; return b; }, inTimezone() { return b; }, create() { triggers.push(t); return t; } };
        return b;
      },
      WeekDay: { MONDAY: 'MONDAY', SUNDAY: 'SUNDAY' },
      getService() { return { getUrl() { return 'https://script.google.com/macros/s/TEST/exec'; } }; }
    },
    DriveApp: {
      getFolderById(id) {
        return {
          getId() { return id; },
          getFiles() { let i = 0; const list = driveFiles.filter(f => f.folder === id); return { hasNext() { return i < list.length; }, next() { return list[i++]; } }; },
          createFile(blob) { const f = { id: 'F' + driveFiles.length, folder: id, name: blob.getName ? blob.getName() : 'file', created: new Date(), getId() { return f.id; }, getName() { return f.name; }, getDateCreated() { return f.created; }, setTrashed() { f.trashed = true; }, getUrl() { return 'https://drive.google.com/file/d/' + f.id; } }; driveFiles.push(f); return f; },
          getSharingAccess() { return 'PRIVATE'; }
        };
      },
      getFileById(id) {
        const f = { id, getId() { return id; }, getName() { return 'file-' + id; }, makeCopy(name, folder) { const c = folder.createFile({ getName() { return name; } }); c.isCopy = true; return c; }, setTrashed() { f.trashed = true; }, getDateCreated() { return new Date(); } };
        return f;
      },
      Access: { PRIVATE: 'PRIVATE' }, Permission: { NONE: 'NONE' }
    },
    ContentService: {
      createTextOutput(text) { const o = { text, mime: null, setMimeType(m) { o.mime = m; return o; }, getContent() { return text; } }; return o; },
      MimeType: { JSON: 'JSON', TEXT: 'TEXT' }
    },
    Logger: { logs: [], log(m) { this.logs.push(String(m)); if (options.verbose) console.log('[Logger]', m); } },
    console: { log(...a) { if (options.verbose) console.log(...a); }, error(...a) { if (options.verbose) console.error(...a); }, warn() {} },
    Session: { getScriptTimeZone() { return 'Asia/Bangkok'; }, getActiveUser() { return { getEmail() { return 'owner@example.com'; } }; } },
    MailApp: { sendEmail() {} },
    // test helpers
    __mock: {
      props, cache, fetchLog, lockState, triggers, driveFiles, spreadsheets,
      setFetchHandler(fn) { fetchHandler = fn; },
      getSpreadsheet
    }
  };
  return env;
}

module.exports = { createEnvironment, createMockSpreadsheet, formatDate };
