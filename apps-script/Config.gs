/**
 * Config.gs — central configuration.
 * Real secrets live ONLY in Script Properties (Project Settings > Script properties)
 * or are set with `configSetProperties_()` from a private, non-committed snippet.
 * Never hard-code secrets in this repository or in any sheet cell.
 */

var CONFIG_DEFAULTS = {
  TIMEZONE: 'Asia/Bangkok',
  AI_ENABLED: 'false',
  PUSH_ENABLED: 'false',
  AI_MODEL: 'gemini-2.5-flash-lite',
  AI_TIMEOUT_MS: '12000',
  AI_MAX_RETRIES: '1',
  AI_MAX_OUTPUT_TOKENS: '400',
  AI_MONTHLY_BUDGET_USD: '1.00',
  AI_RESERVE_USD_PER_CALL: '0.0005',
  AI_INPUT_USD_PER_MTOK: '0.10',
  AI_OUTPUT_USD_PER_MTOK: '0.40',
  ENVELOPE_MAX_AGE_SEC: '300',
  PROCESSING_DEADLINE_MS: '20000',
  LEASE_SECONDS: '120',
  MAX_ATTEMPTS: '3',
  PENDING_TTL_MINUTES: '30',
  PUSH_MONTHLY_QUOTA: '300',
  PUSH_RESERVE_FOR_RECOVERY: '30',
  ONBOARDING_ENABLED: 'false',
  LOCK_WAIT_MS: '10000',
  RETENTION_PENDING_DAYS: '7',
  RETENTION_EVENT_DAYS: '90',
  BACKUP_KEEP_COUNT: '8',
  BACKUP_FOLDER_ID: '',
  BUDGET_WARNING_PERCENTS: '80,100',
  DAILY_SUMMARY_ENABLED: 'false',
  WEEKLY_SUMMARY_ENABLED: 'false',
  // Phase 8 — slips and OCR
  OCR_ENABLED: 'false',
  OCR_MODEL: '',
  OCR_MAX_OUTPUT_TOKENS: '800',
  OCR_MONTHLY_BUDGET_USD: '1.00',
  OCR_RESERVE_USD_PER_CALL: '0.0030',
  ATTACHMENT_FOLDER_ID: ''
};

var CONFIG_SECRET_KEYS = [
  'LINE_CHANNEL_SECRET',
  'LINE_CHANNEL_ACCESS_TOKEN',
  'INTERNAL_SIGNING_SECRET',
  'GEMINI_API_KEY'
];

var CONFIG_REQUIRED_KEYS = ['SPREADSHEET_ID', 'ALLOWED_GROUP_ID', 'INTERNAL_SIGNING_SECRET'];

var __configCache = null;

function configAll_() {
  if (__configCache) return __configCache;
  var props = PropertiesService.getScriptProperties().getProperties() || {};
  var merged = {};
  Object.keys(CONFIG_DEFAULTS).forEach(function (k) { merged[k] = CONFIG_DEFAULTS[k]; });
  Object.keys(props).forEach(function (k) { merged[k] = props[k]; });
  __configCache = merged;
  return merged;
}

function configReset_() { __configCache = null; }

function getConfig(key, required) {
  var v = configAll_()[key];
  if ((v === undefined || v === null || v === '') && required) {
    throw new Error('CONFIG_MISSING:' + key);
  }
  return v === undefined || v === null ? null : String(v);
}

function getConfigInt(key) {
  var v = parseInt(getConfig(key), 10);
  if (isNaN(v)) throw new Error('CONFIG_NOT_INT:' + key);
  return v;
}

function getConfigFloat(key) {
  var v = parseFloat(getConfig(key));
  if (isNaN(v)) throw new Error('CONFIG_NOT_FLOAT:' + key);
  return v;
}

function getConfigBool(key) {
  var v = String(getConfig(key) || '').toLowerCase();
  return v === 'true' || v === '1' || v === 'yes';
}

function requireSecret(key) {
  return getConfig(key, true);
}

/** Redacts secret values for logs. */
function configRedact(text) {
  var s = String(text == null ? '' : text);
  var all = configAll_();
  CONFIG_SECRET_KEYS.forEach(function (k) {
    var v = all[k];
    if (v && v.length >= 8) s = s.split(v).join('[REDACTED:' + k + ']');
  });
  return s;
}

/**
 * Owner convenience: run once from the editor with real values, then remove
 * the values from the editor. Never commit a filled-in copy.
 */
function configSetProperties_(map) {
  PropertiesService.getScriptProperties().setProperties(map, false);
  configReset_();
}

/** Logs a config health report without revealing secrets. */
function configHealthCheck() {
  var all = configAll_();
  var report = [];
  CONFIG_REQUIRED_KEYS.concat(CONFIG_SECRET_KEYS).forEach(function (k) {
    report.push(k + ': ' + (all[k] ? 'set' : 'MISSING'));
  });
  report.push('AI_ENABLED=' + all.AI_ENABLED + ' PUSH_ENABLED=' + all.PUSH_ENABLED + ' AI_MODEL=' + all.AI_MODEL);
  Logger.log(report.join('\n'));
  return report;
}
