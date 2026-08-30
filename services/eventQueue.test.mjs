import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { ARTICLE_BATCH_SIZE, pickEventsToProcess } from './eventQueue.mjs';

const ids = (...values) => values.map(id => ({ id }));

test('takes the newest unprocessed events in feed order', () => {
  const newEvents = ids(101, 102, 103, 104, 105, 106);
  assert.deepEqual(
    pickEventsToProcess(newEvents).map(event => event.id),
    [101, 102, 103, 104, 105],
  );
  assert.equal(ARTICLE_BATCH_SIZE, 5);
});

test('retries a failed newest event instead of burying it behind the queue', () => {
  const newEvents = ids(1, 2, 3, 4, 5, 6);
  const failedEventIds = new Set([1]);

  const starved = [...newEvents]
    .sort((a, b) => Number(failedEventIds.has(a.id)) - Number(failedEventIds.has(b.id)))
    .slice(0, 5)
    .map(event => event.id);
  assert.deepEqual(starved, [2, 3, 4, 5, 6]);

  assert.deepEqual(
    pickEventsToProcess(newEvents).map(event => event.id),
    [1, 2, 3, 4, 5],
  );
});

test('returns an empty list when there are no new events', () => {
  assert.deepEqual(pickEventsToProcess([]), []);
  assert.deepEqual(pickEventsToProcess(undefined), []);
});

test('App.tsx uses newest-first selection and does not deprioritize failures', async () => {
  const source = await readFile(new URL('../App.tsx', import.meta.url), 'utf8');

  assert.match(source, /import \{ pickEventsToProcess \} from '\.\/services\/eventQueue\.mjs'/);
  assert.match(source, /pickEventsToProcess\(newEvents\)/);
  assert.doesNotMatch(source, /failedEventIdsRef/);
  assert.doesNotMatch(
    source,
    /Number\(failedEventIdsRef\.current\.has/,
  );
});
