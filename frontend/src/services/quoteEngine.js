import axios from 'axios';
import { supabase } from './supabase.js';
import * as lf from './levelflight.js';
import dotenv from 'dotenv';
dotenv.config();

const parseEmailWithAI = async (emailBody, emailSubject) => {
  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: `You are an aviation charter quote parser for a Part 135 charter company. Extract trip details from charter quote request emails.

ROUND TRIP RULES — read carefully:
- "round trip", "return", "back", "coming back", "return flight", "return date" = is_round_trip: true
- Two dates mentioned (outbound + return) = is_round_trip: true
- Client says they want to go AND come back = is_round_trip: true
- Only one direction mentioned = is_round_trip: false

Return ONLY valid JSON, no markdown, no explanation:
{
  "is_quote_request": boolean,
  "origin": "ICAO or city",
  "destination": "ICAO or city",
  "departure_date": "YYYY-MM-DD or null",
  "return_date": "YYYY-MM-DD or null",
  "passengers": number or null,
  "is_round_trip": boolean,
  "special_requests": "string or null",
  "client_name": "string or null",
  "client_email": "string or null"
}`,
      messages: [{ role: 'user', content: `Subject: ${emailSubject}\n\n${emailBody}` }],
    },
    {
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
    }
  );

  const text = response.data.content?.[0]?.text || '{}';
  try {
    return JSON.parse(text.replace(/```json|```/g, '').trim());
  } catch {
    return { is_quote_request: false };
  }
};

const getFlightTimeFromHistory = async (origin, destination) => {
  try {
    const now = Date.now();
    const res = await lf.getScheduledLegs(now);
    const legs = res?.legs || [];

    const matches = legs.filter(l =>
      l.status === 3 &&
      l.departure?.airport === origin &&
      l.arrival?.airport === destination &&
      l._calc?._minutes > 0
    );

    if (matches.length > 0) {
      const avgMins = Math.round(
        matches.reduce((sum, l) => sum + l._calc._minutes, 0) / matches.length
      );
      console.log(`Found ${matches.length} historical flights ${origin}→${destination}, avg: ${avgMins} mins`);
      return { mins: avgMins, source: 'historical', count: matches.length };
    }

    const reverseMatches = legs.filter(l =>
      l.status === 3 &&
      l.departure?.airport === destination &&
      l.arrival?.airport === origin &&
      l._calc?._minutes > 0
    );

    if (reverseMatches.length > 0) {
      const avgMins = Math.round(
        reverseMatches.reduce((sum, l) => sum + l._calc._minutes, 0) / reverseMatches.length
      );
      console.log(`Found ${reverseMatches.length} reverse flights ${destination}→${origin}, avg: ${avgMins} mins`);
      return { mins: avgMins, source: 'reverse_historical', count: reverseMatches.length };
    }

    console.log(`No historical data for ${origin}→${destination}, using distance estimate`);
    return null;
  } catch (err) {
    console.error('Flight time lookup error:', err.message);
    return null;
  }
};

const estimateFlightTime = (origin, destination) => {
  const distances = {
    'KFXE-KTEB': 1100, 'KFXE-TIST': 967, 'KFXE-SBGO': 3146,
    'KFXE-KMIA': 25,   'KFXE-KOPF': 15,  'KFXE-KLAX': 2350,
    'KFXE-KORD': 1200, 'KFXE-KDAL': 1100,'KFXE-KHOU': 970,
  };
  const key = `${origin}-${destination}`;
  const revKey = `${destination}-${origin}`;
  const nm = distances[key] || distances[revKey];
  if (nm) {
    const mins = Math.round((nm / 480) * 60 + 30);
    return { mins, source: 'distance_estimate' };
  }
  return { mins: 150, source: 'default' };
};

const calcLegPrice = (flightMins, rateCard, pax, isPositioning = false) => {
  const flightHrs = flightMins / 60;
  const rate = isPositioning ? (rateCard.positioning_rate || rateCard.hourly_rate) : rateCard.hourly_rate;
  const applyMin = rateCard.min_hours > 0 ? Math.max(flightHrs, rateCard.min_hours) : flightHrs;
  let cost = applyMin * rate;
  if (rateCard.short_leg_time > 0 && flightHrs < rateCard.short_leg_time) {
    cost = Math.max(cost, rateCard.short_leg_amount || 0);
  }
  return { flightHrs: Math.round(flightHrs * 100) / 100, flightMins, cost: Math.round(cost), rate };
};

const calculateTripQuote = async (parsed, rateCard, pax) => {
  const outboundTime = await getFlightTimeFromHistory(parsed.origin, parsed.destination)
    || estimateFlightTime(parsed.origin, parsed.destination);

  const outbound = calcLegPrice(outboundTime.mins, rateCard, pax);

  let returnLeg = null;
  let returnTime = null;

  if (parsed.is_round_trip) {
    returnTime = await getFlightTimeFromHistory(parsed.destination, parsed.origin)
      || estimateFlightTime(parsed.destination, parsed.origin);
    returnLeg = calcLegPrice(returnTime.mins, rateCard, pax);
  }

  const flightCost = outbound.cost + (returnLeg?.cost || 0);
  const totalFlightHrs = outbound.flightHrs + (returnLeg?.flightHrs || 0);
  const legs = parsed.is_round_trip ? 2 : 1;

  const depDate = parsed.departure_date ? new Date(parsed.departure_date) : new Date();
  const retDate = parsed.return_date ? new Date(parsed.return_date) : null;
  const nights = retDate ? Math.ceil((retDate - depDate) / 86400000) : 0;
  const threshold = rateCard.overnight_threshold || 3;
  const billableNights = Math.max(0, nights - threshold);
  const overnightCost = billableNights * (rateCard.overnight_fee || 0);

  const segmentFee = (rateCard.segment_fee_per_pax || 0) * legs * (pax || 1);
  const subtotal = flightCost + overnightCost + segmentFee;
  const fetRate = rateCard.fet_rate || 0;
  const fetAmount = subtotal * fetRate;
  const total = subtotal + fetAmount;

  return {
    outbound: { ...outbound, airport: parsed.origin, toAirport: parsed.destination, source: outboundTime.source, historyCount: outboundTime.count },
    returnLeg: returnLeg ? { ...returnLeg, airport: parsed.destination, toAirport: parsed.origin, source: returnTime.source, historyCount: returnTime.count } : null,
    isRoundTrip: parsed.is_round_trip,
    legs,
    totalFlightHrs: Math.round(totalFlightHrs * 100) / 100,
    flightCost: Math.round(flightCost),
    nights,
    billableNights,
    overnightCost: Math.round(overnightCost),
    segmentFee: Math.round(segmentFee),
    subtotal: Math.round(subtotal),
    fetRate,
    fetAmount: Math.round(fetAmount),
    total: Math.round(total),
    aircraft: rateCard.aircraft_tail,
  };
};

const buildQuoteDraft = async (parsed, calc) => {
  const fmt$ = v => `$${Number(v).toLocaleString()}`;
  const fmtHrs = h => `${h}hrs`;

  const legLines = calc.isRoundTrip
    ? `  - Outbound ${calc.outbound.airport} → ${calc.outbound.toAirport}: ${fmtHrs(calc.outbound.flightHrs)} @ $${calc.outbound.rate}/hr = ${fmt$(calc.outbound.cost)}
  - Return ${calc.returnLeg.airport} → ${calc.returnLeg.toAirport}: ${fmtHrs(calc.returnLeg.flightHrs)} @ $${calc.returnLeg.rate}/hr = ${fmt$(calc.returnLeg.cost)}`
    : `  - ${calc.outbound.airport} → ${calc.outbound.toAirport}: ${fmtHrs(calc.outbound.flightHrs)} @ $${calc.outbound.rate}/hr = ${fmt$(calc.outbound.cost)}`;

  const overnightLine = calc.billableNights > 0
    ? `  - Overnight fees (${calc.billableNights} nights): ${fmt$(calc.overnightCost)}\n` : '';
  const segmentLine = calc.segmentFee > 0
    ? `  - Segment fees: ${fmt$(calc.segmentFee)}\n` : '';
  const fetLine = calc.fetRate > 0
    ? `  - Federal Excise Tax (${Math.round(calc.fetRate * 100)}%): ${fmt$(calc.fetAmount)}\n` : '';

  const prompt = `Draft a professional charter quote email for Exjet Aviation, a Part 135 certified charter company based in Fort Lauderdale, Florida (home base: KFXE — Banyan Air Service).

Trip:
- Type: ${calc.isRoundTrip ? 'Round Trip' : 'One Way'}
- Route: ${parsed.origin} → ${parsed.destination}${calc.isRoundTrip ? ` → ${parsed.origin}` : ''}
- Dates: ${parsed.departure_date || 'TBD'}${parsed.return_date ? ` → ${parsed.return_date}` : ''}
- Passengers: ${parsed.passengers || 'TBD'}
- Aircraft: ${calc.aircraft}
${parsed.special_requests ? `- Special requests: ${parsed.special_requests}` : ''}

Pricing:
${legLines}
${overnightLine}${segmentLine}${fetLine}  - TOTAL: ${fmt$(calc.total)}

Write a warm, professional email with the pricing breakdown clearly shown.
Sign off as "Exjet Aviation Operations Team".
No placeholder brackets. Under 300 words.`;

  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    },
    {
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
    }
  );

  return response.data.content?.[0]?.text || '';
};

export const processEmail = async (email) => {
  const parsed = await parseEmailWithAI(email.body, email.subject);
  if (!parsed.is_quote_request) return null;

  const { data: rateCards } = await supabase.from('rate_cards').select('*');
  if (!rateCards || rateCards.length === 0) throw new Error('No rate cards configured');

  const rateCard = rateCards[0];
  const pax = parsed.passengers || 1;
  const calc = await calculateTripQuote(parsed, rateCard, pax);
  const draft = await buildQuoteDraft(parsed, calc);

  const { data: quote, error } = await supabase.from('quotes').insert([{
    status: 'pending',
    email_id: email.id,
    email_from: email.from,
    email_subject: email.subject,
    email_body: email.body,
    parsed_origin: parsed.origin,
    parsed_destination: parsed.destination,
    parsed_date: parsed.departure_date,
    parsed_pax: pax,
    parsed_notes: parsed.special_requests,
    aircraft_tail: calc.aircraft,
    flight_time_hrs: calc.totalFlightHrs,
    distance_nm: null,
    fuel_cost: 0,
    overnight_total: calc.overnightCost,
    fees_total: calc.segmentFee,
    fet_amount: calc.fetAmount,
    grand_total: calc.total,
    quote_draft: draft,
  }]).select().single();

  if (error) throw error;
  return quote;
};