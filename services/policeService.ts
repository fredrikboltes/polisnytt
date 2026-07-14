
import { PoliceEvent } from '../types';

/**
 * Fetches the latest events from the Swedish Police API.
 * Can filter by location (län).
 */
export const fetchPoliceEvents = async (locationName?: string): Promise<PoliceEvent[]> => {
  const searchParams = new URLSearchParams();
  if (locationName) {
    searchParams.set('locationname', locationName);
  }

  const query = searchParams.toString();
  const response = await fetch(`/api/police-events${query ? `?${query}` : ''}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch events: ${response.statusText}`);
  }

  const data: unknown = await response.json();
  if (!Array.isArray(data)) {
    throw new Error('Police events response was not an array');
  }

  return data as PoliceEvent[];
};
