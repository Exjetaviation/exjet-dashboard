// backend/src/fleet/lfAircraftMap.js
// Pure: LevelFlight aircraft object -> our aircraft/component rows. No I/O.

const oid = (v) => (v && typeof v === 'object' && v.$oid) ? v.$oid : (v == null ? null : String(v));
const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

export function mapLfAircraft(lf) {
  if (!lf) return null;
  const lim = lf.limits || {};
  const burns = Array.isArray(lf.fuelBurns) ? lf.fuelBurns : [];
  return {
    tail: (lf.tailNumber || '').trim().toUpperCase(),
    lf_aircraft_oid: oid(lf._id),
    origin: 'levelflight',
    active: lf.active !== false,
    serial: lf.serial ?? null,
    color: lf.color ?? null,
    call_sign: lf.callSign ?? null,
    cbp_decal_number: lf.cbpDecalNumber ?? null,
    year: num(lf.year),
    amenities: lf.amenities ?? null,
    base_icao: lf.airport ?? null,
    fbo_name: lf.fbo?.name ?? null,
    is_91_only: lf.is91Only ?? null,
    owner_company: lf.owner?.owner?.company ?? null,
    foreflight_enabled: lf.foreflight?.active ?? null,
    pax_seats: num(lf.paxSeats),
    aircraft_type: lf.type?.name ?? null,
    engines_count: num(lf.type?.engines),
    cruise_speed_kt: num(lf.cruiseSpeed),
    fuel_burn_1_lbs: num(burns[0]),
    fuel_burn_2_lbs: num(burns[1]),
    fuel_burn_3_lbs: num(burns[2]),
    max_altitude_ft: num(lim.maxAltitude),
    max_landing_weight_lbs: num(lim.maxLandingWeight),
    min_landing_distance_ft: num(lim.minLandingDistance),
    max_gross_takeoff_weight_lbs: num(lim.maxGrossTakeoffWeight),
    max_fuel_capacity_lbs: num(lim.maxFuelCapacity),
    lf_synced_snapshot: lf,
  };
}

function engineRow(pos, e) {
  return {
    lf_component_oid: oid(e?._id),
    component_type: 'engine', position: pos,
    serial: e?.serial ?? null, model: e?.model ?? null, manufacturer: e?.manufacturer ?? null,
    note: null, accrues_flight_time: true, tracks_cycles: true,
    baseline_hours: 0, baseline_cycles: 0,
  };
}

export function mapLfComponents(lf) {
  const out = [];
  out.push({
    lf_component_oid: null, component_type: 'airframe', position: 'airframe',
    serial: lf?.serial ?? null, model: lf?.type?.name ?? null, manufacturer: null, note: null,
    accrues_flight_time: true, tracks_cycles: true,
    baseline_hours: num(lf?.legacy?.time) ?? 0, baseline_cycles: num(lf?.legacy?.cycles) ?? 0,
  });
  const eng = lf?.components?.engines || {};
  if (eng['1']) out.push(engineRow('engine_1', eng['1']));
  if (eng['2']) out.push(engineRow('engine_2', eng['2']));
  const apu = lf?.components?.apu;
  if (apu) {
    out.push({
      lf_component_oid: oid(apu._id),
      component_type: 'apu', position: 'apu',
      serial: apu.serial ?? null, model: apu.model ?? null, manufacturer: apu.manufacturer ?? null,
      note: null, accrues_flight_time: false, tracks_cycles: false,
      baseline_hours: 0, baseline_cycles: 0,
    });
  }
  return out;
}
