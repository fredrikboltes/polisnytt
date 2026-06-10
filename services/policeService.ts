
import { PoliceEvent } from '../types';

/**
 * Fetches the latest events from the Swedish Police API.
 * Can filter by location (län).
 */
export const fetchPoliceEvents = async (locationName?: string): Promise<PoliceEvent[]> => {
  const url = new URL('/api/police-events', window.location.origin);
  if (locationName) {
    url.searchParams.set('locationname', locationName);
  }

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Failed to fetch events: ${response.status} ${response.statusText}`);
  }

  return await response.json();
};
