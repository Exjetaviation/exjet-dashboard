// backend/src/services/itineraryEmail.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildItineraryEmail, itinerarySummary } from './itineraryEmail.js';

const VM = {
  dispatchId: 'abc',
  tripNumber: '25093',
  tail: 'N69FP',
  aircraftType: 'Gulfstream GIV SP',
  client: { name: 'Emily Johnson' },
  legs: [{ depTime: Date.parse('2026-06-21T14:00:00Z'), pax: 4 }, { depTime: Date.parse('2026-06-23T14:00:00Z'), pax: 2 }],
};

test('itinerarySummary derives date, aircraft, pax (max across legs)', () => {
  const s = itinerarySummary(VM);
  assert.equal(s.tripNumber, '25093');
  assert.match(s.date, /2026/);
  assert.equal(s.aircraft, 'Gulfstream GIV SP (N69FP)');
  assert.equal(s.pax, 4);
});

test('buildItineraryEmail: subject format + greeting first name + button link', () => {
  const { subject, html, recipientName } = buildItineraryEmail(VM, { link: 'https://x/itinerary/abc' });
  assert.equal(subject, 'Exjet Aviation – Passenger Itinerary | Trip #25093');
  assert.equal(recipientName, 'Emily');           // first name from client
  assert.match(html, /Dear Emily,/);
  assert.match(html, /Trip #25093/);
  assert.match(html, /Gulfstream GIV SP \(N69FP\)/);
  assert.match(html, /href="https:\/\/x\/itinerary\/abc"/);
  assert.match(html, />View Itinerary</);
  assert.match(html, /Jaime A Torres/);
  assert.match(html, /\(407\) 677-7792/);
});

test('buildItineraryEmail: explicit recipientName overrides client name', () => {
  const { html, recipientName } = buildItineraryEmail(VM, { recipientName: 'Mr. Smith', link: '#' });
  assert.equal(recipientName, 'Mr. Smith');
  assert.match(html, /Dear Mr\. Smith,/);
});

test('buildItineraryEmail: escapes HTML in names', () => {
  const { html } = buildItineraryEmail({ ...VM, client: { name: '<script>x' } }, { link: '#' });
  assert.doesNotMatch(html, /<script>x/);
  assert.match(html, /&lt;script&gt;x/);
});
