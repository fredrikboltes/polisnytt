/**
 * UI county labels mapped to official Swedish Police API `locationname` values.
 * Short display names such as "Skåne" do not match the API and return an empty feed.
 */
export const COUNTY_API_LOCATION_NAMES = Object.freeze({
  Blekinge: 'Blekinge län',
  Dalarna: 'Dalarnas län',
  Gotland: 'Gotlands län',
  Gävleborg: 'Gävleborgs län',
  Halland: 'Hallands län',
  Jämtland: 'Jämtlands län',
  Jönköping: 'Jönköpings län',
  Kalmar: 'Kalmar län',
  Kronoberg: 'Kronobergs län',
  Norrbotten: 'Norrbottens län',
  Skåne: 'Skåne län',
  Stockholm: 'Stockholms län',
  Södermanland: 'Södermanlands län',
  Uppsala: 'Uppsala län',
  Värmland: 'Värmlands län',
  Västerbotten: 'Västerbottens län',
  Västernorrland: 'Västernorrlands län',
  Västmanland: 'Västmanlands län',
  'Västra Götaland': 'Västra Götalands län',
  Örebro: 'Örebro län',
  Östergötland: 'Östergötlands län',
});

export const POLICE_EVENTS_API = 'https://polisen.se/api/events';

export const toPoliceLocationName = (county) =>
  COUNTY_API_LOCATION_NAMES[county] ?? county;

export const policeEventsUrl = (locationName) => {
  const url = new URL(POLICE_EVENTS_API);
  if (locationName) {
    url.searchParams.append('locationname', toPoliceLocationName(locationName));
  }
  return url.toString();
};
