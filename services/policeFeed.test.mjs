import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fetchPoliceFeed, isNightSummaryOnlyFeed } from './policeFeed.mjs';

const summaryEvent = (id) => ({
  id,
  type: 'Sammanfattning natt',
  datetime: '2026-10-28 7:55:18 +01:00',
  name: 'Sammanfattning natt',
  summary: 'Nattens händelser.',
  location: { name: 'Jämtlands län' },
});

const trafficEvent = (id) => ({
  id,
  type: 'Trafikolycka',
  datetime: '2026-10-28 11:26:37 +01:00',
  name: 'Trafikolycka',
  summary: 'En trafikolycka.',
  location: { name: 'Krokom' },
});

const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const fetchScript = (bodies) => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    const next = bodies.shift();
    if (next instanceof Error) throw next;
    return next;
  };
  return { calls, fetchImpl };
};

test('does not treat an empty or mixed feed as a night-summary snapshot', () => {
  assert.equal(isNightSummaryOnlyFeed([]), false);
  assert.equal(isNightSummaryOnlyFeed([summaryEvent(1), trafficEvent(2)]), false);
  assert.equal(isNightSummaryOnlyFeed([summaryEvent(1)]), true);
});

test('returns a mixed county feed without retrying', async () => {
  const mixed = [trafficEvent(657635), summaryEvent(657610)];
  const { calls, fetchImpl } = fetchScript([jsonResponse(mixed), jsonResponse([])]);

  const events = await fetchPoliceFeed('Jämtland', { fetchImpl, attempts: 5 });

  assert.deepEqual(events, mixed);
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0]).searchParams.get('locationname'), 'Jämtlands län');
});

test('retries a night-summary-only feed until a mixed feed arrives', async () => {
  const summary = [summaryEvent(657610)];
  const mixed = [trafficEvent(657635), summaryEvent(657610)];
  const { calls, fetchImpl } = fetchScript([
    jsonResponse(summary),
    jsonResponse(summary),
    jsonResponse(mixed),
  ]);

  const events = await fetchPoliceFeed('Jämtland', { fetchImpl, attempts: 5 });

  assert.equal(events[0].id, 657635);
  assert.equal(calls.length, 3);
});

test('returns the last night-summary feed when every attempt is summary-only', async () => {
  const first = [summaryEvent(1)];
  const last = [summaryEvent(2)];
  const { calls, fetchImpl } = fetchScript([
    jsonResponse(first),
    jsonResponse(last),
  ]);

  const events = await fetchPoliceFeed('Jämtland', { fetchImpl, attempts: 2 });

  assert.deepEqual(events, last);
  assert.equal(calls.length, 2);
});

test('does not retry a genuinely empty feed', async () => {
  const { calls, fetchImpl } = fetchScript([jsonResponse([]), jsonResponse([trafficEvent(1)])]);

  const events = await fetchPoliceFeed('Not A County', { fetchImpl, attempts: 5 });

  assert.deepEqual(events, []);
  assert.equal(calls.length, 1);
});

test('keeps a night-summary feed when a later attempt fails or comes back empty', async () => {
  const summary = [summaryEvent(657610)];
  const failed = fetchScript([
    jsonResponse(summary),
    jsonResponse(null, 503),
  ]);
  const kept = await fetchPoliceFeed('Jämtland', { fetchImpl: failed.fetchImpl, attempts: 5 });
  assert.deepEqual(kept, summary);
  assert.equal(failed.calls.length, 2);

  const flaky = fetchScript([
    jsonResponse(summary),
    jsonResponse([]),
    new Error('socket hang up'),
  ]);
  const afterFlake = await fetchPoliceFeed('Jämtland', { fetchImpl: flaky.fetchImpl, attempts: 5 });
  assert.deepEqual(afterFlake, summary);
  assert.equal(flaky.calls.length, 3);
});

test('throws the first failure when no feed has been read yet', async () => {
  const { fetchImpl } = fetchScript([jsonResponse({ error: true }, 500)]);

  await assert.rejects(
    () => fetchPoliceFeed('Jämtland', { fetchImpl, attempts: 3 }),
    /Police API returned status 500/,
  );
});

test('client and server both fetch county events through the retrying helper', async () => {
  const client = await readFile(new URL('./policeService.ts', import.meta.url), 'utf8');
  const server = await readFile(new URL('../server/articleApi.mjs', import.meta.url), 'utf8');
  const helper = await readFile(new URL('./policeFeed.mjs', import.meta.url), 'utf8');

  assert.match(client, /fetchPoliceFeed\(locationName\)/);
  assert.match(server, /fetchPoliceFeed\(locationName\)/);
  assert.match(helper, /policeEventsUrl\(locationName\)/);
  assert.doesNotMatch(client, /searchParams\.append\(['"]locationname['"], locationName\)/);
  assert.doesNotMatch(server, /searchParams\.append\(['"]locationname['"], locationName\)/);
});
