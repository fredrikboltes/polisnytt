
import { PoliceEvent } from '../types';
import { fetchPoliceFeed } from './policeFeed.mjs';

/**
 * Fetches the latest events from the Swedish Police API.
 * Can filter by location (län).
 * Night-summary-only snapshots are retried; those omit newer incidents.
 */
export const fetchPoliceEvents = async (locationName?: string): Promise<PoliceEvent[]> => {
  return fetchPoliceFeed(locationName) as Promise<PoliceEvent[]>;
};
