import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCrewArrays, readCrewFromSnapshot } from './crewAssignment.js';

const pic = { _id: { $oid: 'u1' }, firstName: 'Adolfo', lastName: 'Martinez', title: 'Chief Pilot', email: 'a@x.com' };
const sic = { id: 'u2', firstName: 'Ivan', lastName: 'Garcia', title: 'Pilot' };
const fa = { firstName: 'Orialis', lastName: 'Arce' };

test('buildCrewArrays maps PIC->seat2, SIC->seat3, FA->seat7', () => {
  const { pilots, attendants } = buildCrewArrays({ pic, sic, fa });
  assert.equal(pilots.length, 2);
  assert.equal(pilots[0].seat, 2);
  assert.equal(pilots[0].user.firstName, 'Adolfo');
  assert.equal(pilots[0].user.title, 'Chief Pilot');
  assert.equal(pilots[1].seat, 3);
  assert.deepEqual(pilots[1].user._id, { $oid: 'u2' }); // id coerced to {$oid}
  assert.equal(attendants.length, 1);
  assert.equal(attendants[0].seat, 7);
  assert.equal(attendants[0].user.lastName, 'Arce');
});

test('buildCrewArrays drops empty slots', () => {
  const { pilots, attendants } = buildCrewArrays({ pic, sic: null, fa: null });
  assert.equal(pilots.length, 1);
  assert.equal(attendants.length, 0);
  assert.deepEqual(buildCrewArrays({}), { pilots: [], attendants: [] });
});

test('readCrewFromSnapshot round-trips an assignment', () => {
  const { pilots, attendants } = buildCrewArrays({ pic, sic, fa });
  const got = readCrewFromSnapshot({ pilots, attendants });
  assert.equal(got.pic.firstName, 'Adolfo');
  assert.equal(got.sic.firstName, 'Ivan');
  assert.equal(got.fa.lastName, 'Arce');
});
