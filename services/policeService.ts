
import { PoliceEvent } from '../types';

/**
 * Fetches the latest events from the Swedish Police API.
 * Can filter by location (län).
 */
export const fetchPoliceEvents = async (locationName?: string): Promise<PoliceEvent[]> => {
  try {
    const url = new URL('https://polisen.se/api/events');
    if (locationName) {
      url.searchParams.append('locationname', locationName);
    }
    
    const response = await fetch(url.toString());
    if (!response.ok) {
      throw new Error(`Failed to fetch events: ${response.statusText}`);
    }
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error fetching police events:', error);
    throw error;
  }
};
