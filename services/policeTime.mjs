/**
 * Police API datetimes look like "2026-10-08 7:03:04 +02:00".
 * WebKit rejects that form: the space before the offset is left unparsed,
 * Date.parse returns NaN, and a T-swap without a zero-padded hour is also NaN.
 * Normalize to ECMAScript's date-time form before parsing.
 */
const POLICE_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?\s*([+-]\d{2}:\d{2}|Z)$/;

export const toPoliceIsoTimestamp = (value) => {
  if (typeof value !== 'string') return null;
  const match = POLICE_TIMESTAMP.exec(value.trim());
  if (!match) return null;

  const [, year, month, day, hour, minute, second, fraction, zone] = match;
  const fractionPart = fraction
    ? `.${fraction.padEnd(3, '0').slice(0, 3)}`
    : '';
  return `${year}-${month}-${day}T${hour.padStart(2, '0')}:${minute}:${second}${fractionPart}${zone === 'Z' ? 'Z' : zone}`;
};

export const policeTimestampMs = (value) => {
  const iso = toPoliceIsoTimestamp(value);
  if (!iso) return Number.NaN;
  return Date.parse(iso);
};

const DATE_FORMAT = {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
};

export const formatPoliceTimestamp = (value) => {
  const ms = policeTimestampMs(value);
  if (!Number.isFinite(ms)) {
    return typeof value === 'string' ? value.trim() : '';
  }
  return new Date(ms).toLocaleString('sv-SE', DATE_FORMAT);
};

/** Newest police timestamp first. Unparseable values sort last. */
export const comparePoliceTimestampsDesc = (left, right) => {
  const leftMs = policeTimestampMs(left);
  const rightMs = policeTimestampMs(right);
  const leftOk = Number.isFinite(leftMs);
  const rightOk = Number.isFinite(rightMs);
  if (leftOk && rightOk) return rightMs - leftMs;
  if (rightOk) return 1;
  if (leftOk) return -1;
  return 0;
};
