/** Time.gs — accounting dates are computed in Asia/Bangkok. */

function timeZone_() { return getConfig('TIMEZONE') || 'Asia/Bangkok'; }

/** Overridable clock (tests set __timeNowOverride). */
var __timeNowOverride = null;
function timeNow_() { return __timeNowOverride ? new Date(__timeNowOverride.getTime()) : new Date(); }

/** "yyyy-MM-dd" for a Date, in Bangkok time. */
function timeDateISO(date) {
  return Utilities.formatDate(date, timeZone_(), 'yyyy-MM-dd');
}

function timeNowISO() {
  return timeNow_().toISOString();
}

function timeTodayISO(now) {
  return timeDateISO(now || timeNow_());
}

/** Adds days to a "yyyy-MM-dd" string (calendar arithmetic, timezone-safe). */
function timeAddDays(dateISO, days) {
  var p = dateISO.split('-').map(Number);
  var d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + days));
  return d.toISOString().slice(0, 10);
}

function timeMonthOf(dateISO) { return dateISO.slice(0, 7); }

function timeCurrentMonth(now) { return timeMonthOf(timeTodayISO(now)); }

function timePreviousMonth(month) {
  var p = month.split('-').map(Number);
  var d = new Date(Date.UTC(p[0], p[1] - 2, 1));
  return d.toISOString().slice(0, 7);
}

function timeDaysInMonth(month) {
  var p = month.split('-').map(Number);
  return new Date(Date.UTC(p[0], p[1], 0)).getUTCDate();
}

function timeIsValidDateISO(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  var p = s.split('-').map(Number);
  var d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  return d.getUTCFullYear() === p[0] && d.getUTCMonth() === p[1] - 1 && d.getUTCDate() === p[2];
}

var THAI_MONTHS = {
  'ม.ค.': 1, 'มค': 1, 'มกรา': 1, 'มกราคม': 1,
  'ก.พ.': 2, 'กพ': 2, 'กุมภา': 2, 'กุมภาพันธ์': 2,
  'มี.ค.': 3, 'มีค': 3, 'มีนา': 3, 'มีนาคม': 3,
  'เม.ย.': 4, 'เมย': 4, 'เมษา': 4, 'เมษายน': 4,
  'พ.ค.': 5, 'พค': 5, 'พฤษภา': 5, 'พฤษภาคม': 5,
  'มิ.ย.': 6, 'มิย': 6, 'มิถุนา': 6, 'มิถุนายน': 6,
  'ก.ค.': 7, 'กค': 7, 'กรกฎา': 7, 'กรกฎาคม': 7,
  'ส.ค.': 8, 'สค': 8, 'สิงหา': 8, 'สิงหาคม': 8,
  'ก.ย.': 9, 'กย': 9, 'กันยา': 9, 'กันยายน': 9,
  'ต.ค.': 10, 'ตค': 10, 'ตุลา': 10, 'ตุลาคม': 10,
  'พ.ย.': 11, 'พย': 11, 'พฤศจิกา': 11, 'พฤศจิกายน': 11,
  'ธ.ค.': 12, 'ธค': 12, 'ธันวา': 12, 'ธันวาคม': 12
};

function timeThaiMonthLabel(month) {
  var names = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  var p = month.split('-').map(Number);
  return names[p[1] - 1] + ' ' + p[0];
}

function timeThaiDateLabel(dateISO) {
  var p = dateISO.split('-').map(Number);
  return p[2] + ' ' + timeThaiMonthLabel(dateISO.slice(0, 7));
}

/** ISO 8601 string for "now + seconds". */
function timePlusSecondsISO(seconds, now) {
  var d = new Date((now || timeNow_()).getTime() + seconds * 1000);
  return d.toISOString();
}

function timeIsPastISO(iso, now) {
  if (!iso) return true;
  var t = Date.parse(iso);
  if (isNaN(t)) return true;
  return t < (now || timeNow_()).getTime();
}
