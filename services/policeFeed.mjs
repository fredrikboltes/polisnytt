import { policeEventsUrl } from './policeLocation.mjs';

/**
 * Polisen occasionally answers `locationname=Jämtlands län` with a body that
 * contains only overnight summaries. That snapshot omits the county's newer
 * mixed-type incidents (measured 2026-10-28: 183 summaries whose newest event
 * was 3.5 hours older than the 500-event feed, and the real newest id was
 * absent). Caching it also makes those newer ids 404 until the feed is
 * refreshed. Retry the bounded fetch and keep the last summary if the mixed
 * feed never arrives.
 */
export const NIGHT_SUMMARY_TYPE = 'Sammanfattning natt';
export const MAX_POLICE_FEED_ATTEMPTS = 5;

export const isNightSummaryOnlyFeed = (events) =>
  Array.isArray(events) &&
  events.length > 0 &&
  events.every((event) => event?.type === NIGHT_SUMMARY_TYPE);

const readEvents = async (response) => {
  if (!response.ok) {
    throw new Error(`Police API returned status ${response.status}`);
  }

  const events = await response.json();
  if (!Array.isArray(events)) {
    throw new Error('Police API returned an invalid response');
  }
  return events;
};

export const fetchPoliceFeed = async (
  locationName,
  { fetchImpl = fetch, attempts = MAX_POLICE_FEED_ATTEMPTS } = {},
) => {
  const url = policeEventsUrl(locationName);
  let lastSummary = null;

  for (let attempt = 0; attempt < attempts; attempt++) {
    let events;
    try {
      events = await readEvents(await fetchImpl(url));
    } catch (error) {
      if (lastSummary) return lastSummary;
      throw error;
    }

    if (events.length === 0) {
      // Unknown locations are legitimately empty. Do not retry those.
      // An empty body after a summary snapshot is a flake; keep looking.
      if (lastSummary) continue;
      return events;
    }

    if (!isNightSummaryOnlyFeed(events)) return events;
    lastSummary = events;
  }

  return lastSummary;
};
