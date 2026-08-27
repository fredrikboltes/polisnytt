export const COUNTY_API_LOCATION_NAMES: Readonly<Record<string, string>>;
export const POLICE_EVENTS_API: string;

export function toPoliceLocationName(county: string): string;
export function policeEventsUrl(locationName?: string): string;
