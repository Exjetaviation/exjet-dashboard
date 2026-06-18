// backend/src/services/itineraryHtml.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderItineraryHtml } from './itineraryHtml.js';

const vm = {
  dispatchId: 'abc', tripNumber: '5012', quoteNumber: '8841',
  tail: 'N69FP', aircraftType: 'Hawker 800XP', maxPax: 8,
  client: { name: 'Jane Doe', company: 'Concierge One', address: 'London, UK' },
  legs: [{
    from: 'KFXE', to: 'KMIA', fromName: 'FXE', toName: 'MIA',
    depTime: 1000, arrTime: 4000, distance: 92, eft: '0:42', pax: 4,
    fromLatLng: [26.19, -80.17], toLatLng: [25.79, -80.29],
    depFbo: { name: 'Banyan', address: 'FLL', phone: '954' },
    arrFbo: { name: 'Signature', address: 'MIA', phone: '305' },
    crew: { pic: 'Pat Pic', sic: 'Sam Sic', ca: ['Ava Att'] },
  }],
  weather: [{ code: 'KFXE', name: 'FXE', forecast: [{ date: '2026-06-18', highF: 90, lowF: 75, condition: 'Clear' }] }],
  preparedOn: 'Jun 18, 2026',
};

test('renderItineraryHtml includes trip/quote #, crew, fbo, weather, map', () => {
  const h = renderItineraryHtml(vm, {});
  assert.match(h, /PASSENGER ITINERARY/);
  assert.match(h, /5012/);
  assert.match(h, /8841/);
  assert.match(h, /Pat Pic/);
  assert.match(h, /Sam Sic/);
  assert.match(h, /Ava Att/);
  assert.match(h, /Banyan/);
  assert.match(h, /Clear/);
  assert.match(h, /Jane Doe/);
  assert.match(h, /qplane/); // shared map script present
  assert.match(h, /id="map"/);
});

test('renderItineraryHtml web mode adds the Download PDF bar', () => {
  const h = renderItineraryHtml({ ...vm, pdfUrl: '/itinerary/abc/pdf' }, { web: true });
  assert.match(h, /Download PDF/);
  assert.match(h, /\/itinerary\/abc\/pdf/);
});
