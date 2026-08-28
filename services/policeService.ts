
import { PoliceEvent } from '../types';
import { policeEventsUrl } from './policeLocation.mjs';

/**
 * Fetches the latest events from the Swedish Police API.
 * Can filter by location (län).
 */
export const fetchPoliceEvents = async (locationName?: string): Promise<PoliceEvent[]> => {
  const response = await fetch(policeEventsUrl(locationName));
  if (!response.ok) {
    throw new Error(`Failed to fetch events: ${response.statusText}`);
  }

  return response.json() as Promise<PoliceEvent[]>;
};
