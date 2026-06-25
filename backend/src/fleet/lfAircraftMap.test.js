import test from 'node:test';
import assert from 'node:assert/strict';
import { mapLfAircraft, mapLfComponents } from './lfAircraftMap.js';

const LF = {
  _id: { $oid: 'a1' }, tailNumber: 'N408JS', serial: '1402',
  type: { name: 'Gulfstream GIV SP', engines: 2 },
  airport: 'KFXE', color: 'White', year: 2000, is91Only: true, paxSeats: 14,
  owner: { owner: { company: 'Agro Lewis LLC' } }, fbo: { name: 'BANYAN AIR SERVICE' },
  cruiseSpeed: 464, fuelBurns: [4000, 3200, 3000],
  limits: { maxAltitude: 45000, maxLandingWeight: 66000, minLandingDistance: 3405,
            maxGrossTakeoffWeight: 74600, maxFuelCapacity: 29500 },
  foreflight: { active: true },
  legacy: { time: 9544.05, cycles: 5579 },
  components: {
    engines: {
      1: { _id: { $oid: 'e1' }, manufacturer: 'ROLLS-ROYCE', model: 'TAY611-8', serial: '16933' },
      2: { _id: { $oid: 'e2' }, manufacturer: 'ROLLS-ROYCE', model: 'TAY611-8', serial: '16934' },
    },
    apu: { _id: { $oid: 'au' }, manufacturer: 'HONEYWELL', model: 'GTCP36-150', serial: 'P-903' },
  },
};

test('mapLfAircraft pulls basic info + performance', () => {
  const a = mapLfAircraft(LF);
  assert.equal(a.tail, 'N408JS');
  assert.equal(a.lf_aircraft_oid, 'a1');
  assert.equal(a.origin, 'levelflight');
  assert.equal(a.pax_seats, 14);
  assert.equal(a.aircraft_type, 'Gulfstream GIV SP');
  assert.equal(a.engines_count, 2);
  assert.equal(a.owner_company, 'Agro Lewis LLC');
  assert.equal(a.fbo_name, 'BANYAN AIR SERVICE');
  assert.equal(a.cruise_speed_kt, 464);
  assert.equal(a.fuel_burn_1_lbs, 4000);
  assert.equal(a.fuel_burn_3_lbs, 3000);
  assert.equal(a.max_gross_takeoff_weight_lbs, 74600);
  assert.equal(a.foreflight_enabled, true);
});

test('mapLfComponents yields airframe + 2 engines + apu with identity + baseline', () => {
  const comps = mapLfComponents(LF);
  const byPos = Object.fromEntries(comps.map((c) => [c.position, c]));
  assert.deepEqual(Object.keys(byPos).sort(), ['airframe', 'apu', 'engine_1', 'engine_2']);
  assert.equal(byPos.airframe.component_type, 'airframe');
  assert.equal(byPos.airframe.baseline_hours, 9544.05);
  assert.equal(byPos.airframe.baseline_cycles, 5579);
  assert.equal(byPos.engine_1.serial, '16933');
  assert.equal(byPos.engine_1.lf_component_oid, 'e1');
  assert.equal(byPos.engine_1.accrues_flight_time, true);
  assert.equal(byPos.apu.accrues_flight_time, false);
  assert.equal(byPos.apu.tracks_cycles, false);
  assert.equal(byPos.apu.manufacturer, 'HONEYWELL');
});
