
import { PoliceEvent } from '../types';
import { policeEventsUrl } from './policeLocation.mjs';

/**
 * Fetches the latest events from the Swedish Police API.
 * Can filter by location (län).
 */
export const fetchPoliceEvents = async (locationName?: string): Promise<PoliceEvent[]> => {
  try {
    const url = policeEventsUrl(locationName);
    
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch events: ${response.statusText}`);
    }
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error fetching police events:', error);
    return [];
  }
};
