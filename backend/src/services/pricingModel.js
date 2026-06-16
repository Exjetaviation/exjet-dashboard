import * as ss from 'simple-statistics';
import { supabase } from './supabase.js';
import * as lf from './levelflight.js';

export const extractAndStorePricingHistory = async () => {
  const months = 12;
  const timestamps = Array.from({ length: months }, (_, i) => {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    d.setDate(1);
    d.setHours(0,0,0,0);
    return d.getTime();
  });

  const results = await Promise.all(
    timestamps.map(ts => lf.getScheduledLegs(ts).catch(() => ({ legs: [] })))
  );

  const allLegs = results.flatMap(r => r.legs || []);
  const seen = new Set();
  const legs = allLegs.filter(l => {
    const id = l._id?.$oid;
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  
  const completed = legs.filter(l => {
    if (l.status !== 3) return false;
    if (!l.departure?.time || !l.arrival?.time) return false;
    if (!l._calc?._minutes || l._calc._minutes <= 0) return false;

    const flightHrs = l._calc._minutes / 60;
    const total = l._internal?.price?.breakdown?.calculatedTotal ||
      (l.dispatch?.rate?.hour ? flightHrs * l.dispatch.rate.hour : 0);
    const effectiveHourlyRate = flightHrs > 0 ? total / flightHrs : 0;

    const ratePerHr = l.dispatch?.rate?.hour || effectiveHourlyRate;
    return ratePerHr >= 7000;
  });

  const rows = completed.map(l => {
    const dep = new Date(l.departure.time);
    const fuelStart = parseFloat(l.postFlight?.fuel?.start || 0);
    const fuelStop  = parseFloat(l.postFlight?.fuel?.stop  || 0);
    const fuelBurned = fuelStart > 0 && fuelStop >= 0 ? fuelStart - fuelStop : l._calc?.fuel?.value || 0;
    const origin = l.departure?.airport || '';
    const dest   = l.arrival?.airport   || '';
    const isIntl = ['SB','TI','MX','CU'].some(p =>
      origin.startsWith(p) || dest.startsWith(p)
    ) || (origin.length === 4 && !origin.startsWith('K') && !origin.startsWith('P'));

    return {
      trip_id:          String(l.dispatch?.tripId || ''),
      leg_id:           l._id?.$oid || '',
      aircraft_tail:    l.dispatch?.aircraft?.tailNumber || '',
      aircraft_type:    l.dispatch?.aircraft?.type?.name || '',
      origin,
      destination: dest,
      route:            `${origin}-${dest}`,
      dep_time:         l.departure.time,
      arr_time:         l.arrival?.time || 0,
      flight_mins:      l._calc?._minutes || 0,
      distance_nm:      l._calc?.distance?.value || 0,
      fuel_start:       fuelStart,
      fuel_stop:        fuelStop,
      fuel_burned:      fuelBurned,
      overnight_count:  l._internal?.price?.breakdown?.overnightCount || 0,
      pax_count:        l.passengerCount || 0,
      client_name:      l.dispatch?.client?.company?.name || '',
      client_wholesale: l.dispatch?.client?.company?.wholesale || false,
      hourly_rate:      l.dispatch?.rate?.hour || 0,
    calculated_total: l._internal?.price?.breakdown?.calculatedTotal ||
      (l.dispatch?.rate?.hour ? (l._calc?._minutes / 60) * l.dispatch.rate.hour : 0),      flight_time_total:l._internal?.price?.breakdown?.flightMins || 0,
      month:            dep.getMonth() + 1,
      quarter:          Math.ceil((dep.getMonth() + 1) / 3),
      year:             dep.getFullYear(),
      day_of_week:      dep.getDay(),
      is_international: isIntl,
    };
  });

  if (rows.length === 0) return { inserted: 0 };

  await supabase.from('pricing_history').delete().neq('id', '00000000-0000-0000-0000-000000000000');

  const { error } = await supabase.from('pricing_history').insert(rows);
  if (error) throw error;

  return { inserted: rows.length };
};

export const buildRegressionModel = async () => {
  const { data: rows, error } = await supabase
    .from('pricing_history')
    .select('*')
    .gt('calculated_total', 0)
    .gt('flight_mins', 0);

  if (error || !rows || rows.length < 5) {
    return { error: 'Not enough data for regression', rows: rows?.length || 0 };
  }

  const byAircraft = {};
  rows.forEach(r => {
    if (!byAircraft[r.aircraft_tail]) byAircraft[r.aircraft_tail] = [];
    byAircraft[r.aircraft_tail].push(r);
  });

  const models = {};

  for (const [tail, data] of Object.entries(byAircraft)) {
    if (data.length < 3) {
      models[tail] = { insufficient: true, count: data.length };
      continue;
    }

    const pairs = data.map(r => [r.flight_mins / 60, r.calculated_total]);
    const regression = ss.linearRegression(pairs);
    const regressionLine = ss.linearRegressionLine(regression);
    const r2 = ss.rSquared(pairs, regressionLine);

    const avgHourlyRate = ss.mean(data.filter(r => r.hourly_rate > 0).map(r => r.hourly_rate));
    const avgOvernightFee = data.filter(r => r.overnight_count > 0).length > 0
      ? ss.mean(data.filter(r => r.overnight_count > 0).map(r => r.calculated_total / r.overnight_count))
      : 0;

    const wholesaleData = data.filter(r => r.client_wholesale);
    const directData    = data.filter(r => !r.client_wholesale);
    const wholesaleAvg  = wholesaleData.length > 0 ? ss.mean(wholesaleData.map(r => r.calculated_total / (r.flight_mins / 60))) : null;
    const directAvg     = directData.length > 0    ? ss.mean(directData.map(r => r.calculated_total / (r.flight_mins / 60))) : null;

    const q1Data = data.filter(r => r.quarter === 1);
    const q2Data = data.filter(r => r.quarter === 2);
    const q3Data = data.filter(r => r.quarter === 3);
    const q4Data = data.filter(r => r.quarter === 4);
    const seasonalFactors = {
      q1: q1Data.length > 0 ? ss.mean(q1Data.map(r => r.calculated_total / (r.flight_mins / 60))) : null,
      q2: q2Data.length > 0 ? ss.mean(q2Data.map(r => r.calculated_total / (r.flight_mins / 60))) : null,
      q3: q3Data.length > 0 ? ss.mean(q3Data.map(r => r.calculated_total / (r.flight_mins / 60))) : null,
      q4: q4Data.length > 0 ? ss.mean(q4Data.map(r => r.calculated_total / (r.flight_mins / 60))) : null,
    };

    const intlData  = data.filter(r => r.is_international);
    const domData   = data.filter(r => !r.is_international);
    const intlPremium = intlData.length > 0 && domData.length > 0
      ? (ss.mean(intlData.map(r => r.calculated_total / (r.flight_mins / 60))) /
         ss.mean(domData.map(r => r.calculated_total / (r.flight_mins / 60)))) - 1
      : 0;

    const routeStats = {};
    const byRoute = {};
    data.forEach(r => {
      if (!byRoute[r.route]) byRoute[r.route] = [];
      byRoute[r.route].push(r);
    });
    Object.entries(byRoute).forEach(([route, routeData]) => {
      if (routeData.length >= 2) {
        routeStats[route] = {
          count:   routeData.length,
          avgTotal: ss.mean(routeData.map(r => r.calculated_total)),
          avgHrs:   ss.mean(routeData.map(r => r.flight_mins / 60)),
        };
      }
    });

    models[tail] = {
      count: data.length,
      regression: { slope: regression.m, intercept: regression.b, r2 },
      avgHourlyRate: Math.round(avgHourlyRate || 0),
      avgOvernightFee: Math.round(avgOvernightFee || 0),
      wholesaleAvgPerHr: wholesaleAvg ? Math.round(wholesaleAvg) : null,
      directAvgPerHr:    directAvg    ? Math.round(directAvg)    : null,
      seasonalFactors,
      intlPremium: Math.round(intlPremium * 100) / 100,
      routeStats,
      minTotal: ss.min(data.map(r => r.calculated_total)),
      maxTotal: ss.max(data.map(r => r.calculated_total)),
      avgTotal: Math.round(ss.mean(data.map(r => r.calculated_total))),
    };
  }

  return { models, totalTrips: rows.length };
};

export const estimatePrice = async (params) => {
  const { aircraft_tail, flight_mins, overnight_count, is_wholesale, is_international, route, quarter } = params;
  const modelData = await buildRegressionModel();
  if (modelData.error) return { error: modelData.error };

  const model = modelData.models[aircraft_tail];
  if (!model || model.insufficient) {
    const allModels = Object.values(modelData.models).filter(m => !m.insufficient);
    if (allModels.length === 0) return { error: 'No model available' };
    const avgRate = ss.mean(allModels.map(m => m.avgHourlyRate).filter(r => r > 0));
    const hrs = flight_mins / 60;
    return {
      basePrice: Math.round(avgRate * hrs),
      confidence: 0.3,
      source: 'fleet_average',
      note: `No data for ${aircraft_tail}, using fleet average rate of $${Math.round(avgRate)}/hr`,
    };
  }

  const hrs = flight_mins / 60;
  let basePrice = Math.round(model.regression.slope * hrs + model.regression.intercept);
  basePrice = Math.max(basePrice, model.avgHourlyRate * hrs * 0.7);

  let adjustments = [];
  let adjustedPrice = basePrice;

  if (overnight_count > 0 && model.avgOvernightFee > 0) {
    const overnightTotal = overnight_count * model.avgOvernightFee;
    adjustedPrice += overnightTotal;
    adjustments.push({ factor: 'Overnights', amount: overnightTotal, note: `${overnight_count} x $${model.avgOvernightFee}` });
  }

  if (is_wholesale && model.wholesaleAvgPerHr && model.directAvgPerHr) {
    const discount = (model.directAvgPerHr - model.wholesaleAvgPerHr) * hrs;
    if (discount > 0) {
      adjustedPrice -= discount;
      adjustments.push({ factor: 'Wholesale discount', amount: -discount, note: `Based on historical wholesale pricing` });
    }
  }

  if (is_international && model.intlPremium > 0) {
    const premium = adjustedPrice * model.intlPremium;
    adjustedPrice += premium;
    adjustments.push({ factor: 'International premium', amount: premium, note: `${Math.round(model.intlPremium * 100)}% based on past intl trips` });
  }

  const q = quarter || Math.ceil((new Date().getMonth() + 1) / 3);
  const seasonalRate = model.seasonalFactors[`q${q}`];
  const baseRate     = model.seasonalFactors[`q${(q % 4) + 1}`] || model.avgHourlyRate;
  if (seasonalRate && baseRate && Math.abs(seasonalRate - baseRate) / baseRate > 0.05) {
    const seasonalAdj = (seasonalRate - baseRate) * hrs * 0.3;
    adjustedPrice += seasonalAdj;
    adjustments.push({ factor: 'Seasonal adjustment', amount: Math.round(seasonalAdj), note: `Q${q} pricing trend` });
  }

  if (route && model.routeStats[route]) {
    const routeStat = model.routeStats[route];
    const routeAvgPerHr = routeStat.avgTotal / routeStat.avgHrs;
    const routeAdj = (routeAvgPerHr - model.avgHourlyRate) * hrs * 0.5;
    if (Math.abs(routeAdj) > 200) {
      adjustedPrice += routeAdj;
      adjustments.push({ factor: 'Route history', amount: Math.round(routeAdj), note: `${routeStat.count} past trips on ${route}` });
    }
  }

  const confidence = Math.min(
    0.95,
    (model.regression.r2 * 0.5) +
    (Math.min(model.count, 20) / 20 * 0.3) +
    (route && model.routeStats[route] ? 0.2 : 0)
  );

  return {
    basePrice:     Math.round(basePrice),
    adjustedPrice: Math.round(adjustedPrice),
    confidence:    Math.round(confidence * 100) / 100,
    adjustments,
    modelStats: {
      tripsAnalyzed: model.count,
      r2: Math.round(model.regression.r2 * 100) / 100,
      avgHourlyRate: model.avgHourlyRate,
    },
    source: 'regression_model',
  };
};
