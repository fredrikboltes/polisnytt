/**
 * Choose which unprocessed police events to turn into articles.
 *
 * The Police feed is newest-first. Keep that order so a transient generation
 * failure (404 from a warm feed cache, 429, 502) is retried on the next pass
 * instead of being sorted behind the rest of the 500-event queue.
 */
export const ARTICLE_BATCH_SIZE = 5;

export const pickEventsToProcess = (newEvents, limit = ARTICLE_BATCH_SIZE) => {
  if (!Array.isArray(newEvents)) return [];
  return newEvents.slice(0, limit);
};
