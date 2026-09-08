/**
 * Money.gs — all amounts are integers in satang (1 baht = 100 satang).
 * Never use floats as the stored value.
 */

var THAI_DIGITS = { '๐': '0', '๑': '1', '๒': '2', '๓': '3', '๔': '4', '๕': '5', '๖': '6', '๗': '7', '๘': '8', '๙': '9' };

function moneyNormalizeDigits(text) {
  return String(text == null ? '' : text).replace(/[๐-๙]/g, function (c) { return THAI_DIGITS[c]; });
}

/**
 * Parses a decimal string such as "1,234.50" into satang (123450).
 * Returns null when the input is not a valid amount with at most 2 decimals.
 */
function moneyParseToSatang(text) {
  if (text === null || text === undefined) return null;
  var s = moneyNormalizeDigits(text).trim().replace(/[฿,\s]/g, '').replace(/(บาท|บ\.|บ)$/, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  var parts = s.split('.');
  var baht = parseInt(parts[0], 10);
  var satang = 0;
  if (parts.length === 2) {
    var frac = parts[1];
    if (frac.length === 1) frac = frac + '0';
    satang = parseInt(frac, 10);
  }
  if (baht > 900000000) return null; // > 900M baht is certainly a typo for a household
  return baht * 100 + satang;
}

/** Formats satang as "1,234.50" (drops ".00"). */
function moneyFormat(satang) {
  var n = Math.abs(parseInt(satang, 10) || 0);
  var baht = Math.floor(n / 100);
  var st = n % 100;
  var bahtStr = String(baht).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  var out = st === 0 ? bahtStr : bahtStr + '.' + (st < 10 ? '0' + st : String(st));
  return (satang < 0 ? '-' : '') + out;
}

function moneyFormatBaht(satang) {
  return moneyFormat(satang) + ' บาท';
}

/** Converts satang to decimal string "12.34" without float artefacts. */
function moneyToDecimalString(satang) {
  var n = parseInt(satang, 10) || 0;
  var sign = n < 0 ? '-' : '';
  n = Math.abs(n);
  var st = n % 100;
  return sign + Math.floor(n / 100) + '.' + (st < 10 ? '0' + st : st);
}

function moneyAssertInt(satang, label) {
  if (typeof satang !== 'number' || !isFinite(satang) || Math.floor(satang) !== satang || satang < 0) {
    throw new Error('MONEY_INVALID:' + (label || '') + ':' + satang);
  }
  return satang;
}
