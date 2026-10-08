import assert from 'node:assert/strict';
import test from 'node:test';
import {
  comparePoliceTimestampsDesc,
  formatPoliceTimestamp,
  policeTimestampMs,
  toPoliceIsoTimestamp,
} from './policeTime.mjs';

const MORNING = '2026-10-08 7:03:04 +02:00';
const AFTERNOON = '2026-10-06 20:00:32 +02:00';
const FORMAT = {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
};

test('pads unpadded police hours and drops the space before the offset', () => {
  assert.equal(toPoliceIsoTimestamp(MORNING), '2026-10-08T07:03:04+02:00');
  assert.equal(toPoliceIsoTimestamp(AFTERNOON), '2026-10-06T20:00:32+02:00');
  assert.equal(policeTimestampMs(MORNING), Date.parse('2026-10-08T07:03:04+02:00'));
  assert.equal(policeTimestampMs(MORNING), 1791435784000);
  assert.equal(policeTimestampMs(AFTERNOON), 1791309632000);
});

test('rejects the unpadded ISO form that a space-to-T rewrite would produce', () => {
  assert.ok(Number.isNaN(Date.parse('2026-10-08T7:03:04+02:00')));
  assert.equal(policeTimestampMs(MORNING), Date.parse('2026-10-08T07:03:04+02:00'));
});

test('formats a police timestamp with the article card options', () => {
  const formatted = formatPoliceTimestamp(MORNING);
  assert.notEqual(formatted, 'Invalid Date');
  assert.equal(
    formatted,
    new Date('2026-10-08T07:03:04+02:00').toLocaleString('sv-SE', FORMAT),
  );
});

test('sorts Dalarna-style feeds newest first when the API pins an older event first', () => {
  const feed = [
    '2026-10-06 20:00:32 +02:00',
    '2026-10-07 19:09:01 +02:00',
    MORNING,
  ];
  const sorted = [...feed].sort(comparePoliceTimestampsDesc);
  assert.deepEqual(sorted, [
    MORNING,
    '2026-10-07 19:09:01 +02:00',
    '2026-10-06 20:00:32 +02:00',
  ]);
});

test('keeps unparseable timestamps from throwing or sorting ahead of real events', () => {
  assert.equal(toPoliceIsoTimestamp('not a date'), null);
  assert.ok(Number.isNaN(policeTimestampMs('not a date')));
  assert.equal(formatPoliceTimestamp('not a date'), 'not a date');
  assert.equal(formatPoliceTimestamp(''), '');
  const ordered = ['not a date', AFTERNOON].sort(comparePoliceTimestampsDesc);
  assert.deepEqual(ordered, [AFTERNOON, 'not a date']);
});

test('accepts a winter offset and a Zulu suffix', () => {
  assert.equal(
    toPoliceIsoTimestamp('2026-01-08 7:03:04 +01:00'),
    '2026-01-08T07:03:04+01:00',
  );
  assert.equal(
    policeTimestampMs('2026-01-08 7:03:04 +01:00'),
    Date.parse('2026-01-08T07:03:04+01:00'),
  );
  assert.equal(
    toPoliceIsoTimestamp('2026-10-08 07:03:04Z'),
    '2026-10-08T07:03:04Z',
  );
});
