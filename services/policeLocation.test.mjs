import assert from 'node:assert/strict';
import test from 'node:test';
import { COUNTY_API_LOCATION_NAMES, policeEventsUrl, toPoliceLocationName } from './policeLocation.mjs';

const UI_COUNTIES = [
  'Blekinge', 'Dalarna', 'Gotland', 'Gävleborg', 'Halland',
  'Jämtland', 'Jönköping', 'Kalmar', 'Kronoberg', 'Norrbotten',
  'Skåne', 'Stockholm', 'Södermanland', 'Uppsala', 'Värmland',
  'Västerbotten', 'Västernorrland', 'Västmanland', 'Västra Götaland',
  'Örebro', 'Östergötland',
];

test('maps every UI county onto an official Police API län name', () => {
  assert.deepEqual(Object.keys(COUNTY_API_LOCATION_NAMES), UI_COUNTIES);

  for (const county of UI_COUNTIES) {
    const officialName = toPoliceLocationName(county);
    assert.notEqual(officialName, county, `${county} must not be sent to the API as-is`);
    assert.match(officialName, / län$/);
  }
});

test('rewrites empty-feed display names such as Skåne and Västra Götaland', () => {
  assert.equal(toPoliceLocationName('Skåne'), 'Skåne län');
  assert.equal(toPoliceLocationName('Västra Götaland'), 'Västra Götalands län');
  assert.equal(toPoliceLocationName('Blekinge'), 'Blekinge län');
  assert.equal(toPoliceLocationName('Dalarna'), 'Dalarnas län');
});

test('leaves unknown location strings unchanged', () => {
  assert.equal(toPoliceLocationName('Malmö'), 'Malmö');
});

test('builds Police API URLs with official locationname values', () => {
  const skane = new URL(policeEventsUrl('Skåne'));
  assert.equal(skane.searchParams.get('locationname'), 'Skåne län');

  const vastra = new URL(policeEventsUrl('Västra Götaland'));
  assert.equal(vastra.searchParams.get('locationname'), 'Västra Götalands län');

  const unfiltered = new URL(policeEventsUrl());
  assert.equal(unfiltered.searchParams.has('locationname'), false);
});

test('client event fetches use policeEventsUrl instead of raw UI county labels', async () => {
  const { readFile } = await import('node:fs/promises');
  const client = await readFile(new URL('./policeService.ts', import.meta.url), 'utf8');
  const helper = await readFile(new URL('./policeFeed.mjs', import.meta.url), 'utf8');

  assert.match(client, /fetchPoliceFeed\(locationName\)/);
  assert.match(helper, /policeEventsUrl\(locationName\)/);
  assert.doesNotMatch(client, /searchParams\.append\(['"]locationname['"], locationName\)/);
  assert.doesNotMatch(helper, /searchParams\.append\(['"]locationname['"], locationName\)/);
});
