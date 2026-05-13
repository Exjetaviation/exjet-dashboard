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
      system: `You are an aviation charter quote parser. Extract trip details from charter quote request emails. ROUND TRIP: if client mentions returning, two dates, or coming back = is_round_trip true. Return ONLY valid JSON: {"is_quote_request":boolean,"origin":"ICAO or city","destination":"ICAO or city","departure_date":"YYYY-MM-DD or null","return_date":"YYYY-MM-DD or null","passengers":number or null,"is_round_trip":boolean,"special_requests":"string or null","client_name":"string or null","client_email":"string or null"}`,
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
  try { return JSON.parse(text.replace(/```json|```/g, '').trim()); }
  catch { return { is_quote_request: false }; }
};

const getFlightTime = async (origin, destination) => {
  try {
    const res = await lf.getScheduledLegs(Date.now());
    const legs = res?.legs || [];
    const matches = legs.filter(l =>
      l.status === 3 &&
      l.departure?.airport === origin &&
      l.arrival?.airport === destination &&
      l._calc?._minutes > 0
    );
    if (matches.length > 0) {
      const avg = Math.round(matches.reduce((s, l) => s + l._calc._minutes, 0) / matches.length);
      console.log(`Flight time ${origin}->${destination}: ${avg} mins from ${matches.length} historical flights`);
      return avg;
    }
    const rev = legs.filter(l =>
      l.status === 3 &&
      l.departure?.airport === destination &&
      l.arrival?.airport === origin &&
      l._calc?._minutes > 0
    );
    if (rev.length > 0) {
      const avg = Math.round(rev.reduce((s, l) => s + l._calc._minutes, 0) / rev.length);
      console.log(`Flight time ${origin}->${destination}: ${avg} mins from ${rev.length} reverse historical flights`);
      return avg;
    }
  } catch (e) { console.error('getFlightTime error:', e.message); }
  console.log(`No history for ${origin}->${destination}, using 150min default`);
  return 150;
};

const calcLeg = (mins, rateCard) => {
  const hrs = mins / 60;
  const applyMin = rateCard.min_hours > 0 ? Math.max(hrs, rateCard.min_hours) : hrs;
  let cost = applyMin * rateCard.hourly_rate;
  if (rateCard.short_leg_time > 0 && hrs < rateCard.short_leg_time) {
    cost = Math.max(cost, rateCard.short_leg_amount || 0);
  }
  return { hrs: Math.round(hrs * 100) / 100, mins, cost: Math.round(cost) };
};

const calculateTripQuote = async (parsed, rateCard, pax) => {
  const outMins = await getFlightTime(parsed.origin, parsed.destination);
  const outLeg = calcLeg(outMins, rateCard);
  let retLeg = null;
  if (parsed.is_round_trip) {
    const retMins = await getFlightTime(parsed.destination, parsed.origin);
    retLeg = calcLeg(retMins, rateCard);
  }
  const flightCost = outLeg.cost + (retLeg?.cost || 0);
  const totalHrs = outLeg.hrs + (retLeg?.hrs || 0);
  const legs = parsed.is_round_trip ? 2 : 1;
  const depDate = parsed.departure_date ? new Date(parsed.departure_date) : new Date();
  const retDate = parsed.return_date ? new Date(parsed.return_date) : null;
  const nights = retDate ? Math.ceil((retDate - depDate) / 86400000) : 0;
  const billableNights = Math.max(0, nights - (rateCard.overnight_threshold || 3));
  const overnightCost = billableNights * (rateCard.overnight_fee || 0);
  const segmentFee = (rateCard.segment_fee_per_pax || 0) * legs * pax;
  const subtotal = flightCost + overnightCost + segmentFee;
  const fetAmount = subtotal * (rateCard.fet_rate || 0);
  const total = subtotal + fetAmount;
  return {
    outLeg: { ...outLeg, from: parsed.origin, to: parsed.destination },
    retLeg: retLeg ? { ...retLeg, from: parsed.destination, to: parsed.origin } : null,
    isRoundTrip: parsed.is_round_trip,
    legs, totalHrs: Math.round(totalHrs * 100) / 100,
    flightCost: Math.round(flightCost),
    nights, billableNights,
    overnightCost: Math.round(overnightCost),
    segmentFee: Math.round(segmentFee),
    subtotal: Math.round(subtotal),
    fetRate: rateCard.fet_rate || 0,
    fetAmount: Math.round(fetAmount),
    total: Math.round(total),
    rate: rateCard.hourly_rate,
    aircraft: rateCard.aircraft_tail,
  };
};

const buildQuoteDraft = async (parsed, calc) => {
  const f = v => '$' + Number(v).toLocaleString();
  const legLines = calc.isRoundTrip
    ? `  Outbound ${calc.outLeg.from} to ${calc.outLeg.to}: ${calc.outLeg.hrs}hrs x $${calc.rate}/hr = ${f(calc.outLeg.cost)}\n  Return ${calc.retLeg.from} to ${calc.retLeg.to}: ${calc.retLeg.hrs}hrs x $${calc.rate}/hr = ${f(calc.retLeg.cost)}`
    : `  ${calc.outLeg.from} to ${calc.outLeg.to}: ${calc.outLeg.hrs}hrs x $${calc.rate}/hr = ${f(calc.outLeg.cost)}`;
  const overnightLine = calc.billableNights > 0 ? `  Overnight fees (${calc.billableNights} billable nights): ${f(calc.overnightCost)}\n` : '';
  const segLine = calc.segmentFee > 0 ? `  Segment fees: ${f(calc.segmentFee)}\n` : '';
  const fetLine = calc.fetRate > 0 ? `  Federal Excise Tax (${Math.round(calc.fetRate * 100)}%): ${f(calc.fetAmount)}\n` : '';
  const prompt = `Draft a professional charter quote email for Exjet Aviation, Part 135 charter company, Fort Lauderdale FL (KFXE).

Trip: ${calc.isRoundTrip ? 'Round Trip' : 'One Way'}
Route: ${parsed.origin} to ${parsed.destination}${calc.isRoundTrip ? ' and back' : ''}
Dates: ${parsed.departure_date || 'TBD'}${parsed.return_date ? ' returning ' + parsed.return_date : ''}
Passengers: ${parsed.passengers || 'TBD'}
Aircraft: ${calc.aircraft}
${parsed.special_requests ? 'Special requests: ' + parsed.special_requests : ''}

Pricing breakdown:
${legLines}
${overnightLine}${segLine}${fetLine}  TOTAL: ${f(calc.total)}

Write warm professional email with clear pricing. Sign off as Exjet Aviation Operations Team. Under 300 words.`;
  const res = await axios.post(
    'https://api.anthropic.com/v1/messages',
    { model: 'claude-haiku-4-5-20251001', max_tokens: 1024, messages: [{ role: 'user', content: prompt }] },
    { headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' } }
  );
  return res.data.content?.[0]?.text || '';
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
    email_id: email.id, email_from: email.from,
    email_subject: email.subject, email_body: email.body,
    parsed_origin: parsed.origin, parsed_destination: parsed.destination,
    parsed_date: parsed.departure_date, parsed_pax: pax,
    parsed_notes: parsed.special_requests, aircraft_tail: calc.aircraft,
    flight_time_hrs: calc.totalHrs, distance_nm: null,
    fuel_cost: 0, overnight_total: calc.overnightCost,
    fees_total: calc.segmentFee, fet_amount: calc.fetAmount,
    grand_total: calc.total, quote_draft: draft,
  }]).select().single();
  if (error) throw error;
  return quote;
};
