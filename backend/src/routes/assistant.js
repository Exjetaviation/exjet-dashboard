import express from 'express';
import axios from 'axios';
import * as lf from '../services/levelflight.js';
import * as ff from '../services/foreflight.js';
import { supabase } from '../services/supabase.js';
import {
  getProfitAndLoss, getRevenueByCustomer,
  getOutstandingInvoices
} from '../services/quickbooks.js';

const router = express.Router();

const buildContext = async () => {
  const now = Date.now();
  const todayStart = new Date(); todayStart.setHours(0,0,0,0);
  const startOfYear = `${new Date().getFullYear()}-01-01`;
  const today = new Date().toISOString().split('T')[0];

  try {
    const [
      legsRes, dutyRes, crewRes, pilotsRes, aircraftRes,
      quotesRes, rateCardsRes, maintRes,
      plRes, customersRes, invoicesRes
    ] = await Promise.allSettled([
      lf.getScheduledLegs(now),
      lf.getDutyTimes(now),
      ff.getCrew(),
      lf.getPilots(1),
      ff.getAircraft(),
      supabase.from('quotes').select('*').order('created_at', { ascending: false }).limit(20),
      supabase.from('rate_cards').select('*'),
      supabase.from('maintenance_events').select('*').order('start_time', { ascending: true }),
      getProfitAndLoss(startOfYear, today),
      getRevenueByCustomer(startOfYear, today),
      getOutstandingInvoices(),
    ]);

    const legs       = legsRes.status      === 'fulfilled' ? (legsRes.value?.legs       || []) : [];
    const duties     = dutyRes.status      === 'fulfilled' ? (dutyRes.value?.dutyTimes   || []) : [];
    const crew       = crewRes.status      === 'fulfilled' ? (crewRes.value              || []) : [];
    const pilots     = pilotsRes.status    === 'fulfilled' ? (pilotsRes.value?.users     || []) : [];
    const aircraft   = aircraftRes.status  === 'fulfilled' ? (aircraftRes.value           || []) : [];
    const quotes     = quotesRes.status    === 'fulfilled' ? (quotesRes.value?.data       || []) : [];
    const rateCards  = rateCardsRes.status === 'fulfilled' ? (rateCardsRes.value?.data    || []) : [];
    const maintEvents= maintRes.status     === 'fulfilled' ? (maintRes.value?.data        || []) : [];
    const pl         = plRes.status        === 'fulfilled' ? plRes.value                         : null;
    const customers  = customersRes.status === 'fulfilled' ? customersRes.value                  : null;
    const invoices   = invoicesRes.status  === 'fulfilled' ? (invoicesRes.value           || []) : [];

    const upcomingLegs = legs.filter(l=>(l.departure?.time||0)>=todayStart.getTime()).sort((a,b)=>(a.departure?.time||0)-(b.departure?.time||0)).slice(0,20);
    const recentLegs   = legs.filter(l=>(l.departure?.time||0)<now).sort((a,b)=>(b.departure?.time||0)-(a.departure?.time||0)).slice(0,10);

    const fmtTime = ms => ms ? new Date(ms).toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit',timeZoneName:'short'}) : 'N/A';
    const fmt$ = v => { const n=parseFloat(v)||0; return n<0?`-$${Math.abs(n).toLocaleString()}`:`$${n.toLocaleString()}`; };

    const fmtLeg = l => {
      const pilotStr = l.pilots?.map(p=>`${p.user.firstName} ${p.user.lastName} (${p.seat===2?'PIC':'SIC'})`).join(', ')||'No pilots';
      const STATUS = {0:'Scheduled',1:'Active',2:'Booked',3:'Completed'};
      return `- Trip #${l.dispatch?.tripId||'N/A'} | ${l.departure?.airport} → ${l.arrival?.airport} | ${l.dispatch?.aircraft?.tailNumber||'N/A'} | Dep: ${fmtTime(l.departure?.time)} | Arr: ${fmtTime(l.arrival?.time)} | ${l._calc?.time||'N/A'} | ${l._calc?.distance?.value||'N/A'} nm | Pax: ${l.passengerCount||0} | ${STATUS[l.status]||'Unknown'} | Client: ${l.dispatch?.client?.company?.name||'N/A'} | Pilots: ${pilotStr}`;
    };

    const getSection = (rows,group) => rows?.find(r=>r.group===group)?.Summary?.ColData?.slice(-1)[0]?.value||'0';
    const plRows = pl?.Rows?.Row||[];
    const revenue  = getSection(plRows,'Income');
    const netIncome= getSection(plRows,'NetIncome');
    const cogs     = getSection(plRows,'COGS');
    const opExp    = getSection(plRows,'Expenses');

    const topCustomers = customers?.Rows?.Row?.filter(r=>r.ColData)
      .map(r=>({name:r.ColData[0]?.value,total:parseFloat(r.ColData[1]?.value||0)}))
      .filter(c=>c.total>0).sort((a,b)=>b.total-a.total).slice(0,10)||[];

    const topExpenses = (() => {
      const items=[];
      const addRows = section => (section?.Rows?.Row||[]).forEach(row=>{
        if(row.type==='Data'){const n=row.ColData?.[0]?.value,t=parseFloat(row.ColData?.slice(-1)[0]?.value||0);if(n&&t>0)items.push({name:n,total:t});}
      });
      addRows(plRows.find(r=>r.group==='COGS'));
      addRows(plRows.find(r=>r.group==='Expenses'));
      return items.sort((a,b)=>b.total-a.total).slice(0,10);
    })();

    const pendingQuotes = quotes.filter(q=>q.status==='pending');
    const approvedQuotes= quotes.filter(q=>q.status==='approved');

    return `
You are an expert aviation operations assistant for Exjet Aviation, a Part 135 certified charter company based in Fort Lauderdale, Florida (KFXE/Banyan Air Service). You have full access to ALL live company data below — operations, financials, crew, quotes, and maintenance. Be concise, accurate, and insightful. Reference actual data in your answers. You can help with anything: dispatching, scheduling, pricing, client questions, financial analysis, regulatory compliance, and strategic decisions.

Today: ${new Date().toLocaleString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit',timeZoneName:'short'})}

=== FLEET ===
${aircraft.map(a=>`- ${a.aircraftRegistration} | ${a.aircraftModelCode} | Licenses: ${a.aircraftLicenses?.join(', ')||'N/A'}`).join('\n')||'No aircraft data'}

=== RATE CARDS ===
${rateCards.map(r=>`- ${r.aircraft_tail} | Hourly: $${r.hourly_rate} | Positioning: $${r.positioning_rate} | Min hours: ${r.min_hours} | Overnight fee: $${r.overnight_fee} | Segment fee/pax: $${r.segment_fee_per_pax} | FET: ${r.fet_rate*100}%`).join('\n')||'No rate cards'}

=== UPCOMING FLIGHTS (next 20) ===
${upcomingLegs.length>0?upcomingLegs.map(fmtLeg).join('\n'):'No upcoming flights'}

=== RECENT COMPLETED FLIGHTS (last 10) ===
${recentLegs.length>0?recentLegs.map(fmtLeg).join('\n'):'No recent flights'}

=== PILOT ROSTER ===
${pilots.map(p=>`- ${p.firstName} ${p.lastName} | ${p.title||'Pilot'} | ${p.email} | Active: ${p.active?'Yes':'No'}`).join('\n')||'No pilot data'}

=== CREW (ForeFlight) ===
${crew.map(c=>`- ${c.fullname} | ${c.username}`).join('\n')||'No crew data'}

=== DUTY TIMES THIS MONTH ===
${duties.slice(0,20).map(d=>{
  const ds=Math.min(d.out,d.in),de=Math.max(d.out,d.in);
  const mins=Math.round((de-ds)/60000);
  const DTYPE={3:'Flight Duty',4:'Ground Duty',6:'Rest',11:'Flight'};
  return `- ${DTYPE[d.type]||`Type ${d.type}`} | Start: ${fmtTime(ds)} | End: ${fmtTime(de)} | Duration: ${Math.floor(mins/60)}h ${mins%60}m`;
}).join('\n')||'No duty data'}

=== FINANCIALS YTD (QuickBooks) ===
Revenue: ${fmt$(revenue)}
Net Income: ${fmt$(netIncome)}
Cost of Goods: ${fmt$(cogs)}
Operating Expenses: ${fmt$(opExp)}

Top Clients by Revenue:
${topCustomers.map((c,i)=>`${i+1}. ${c.name}: ${fmt$(c.total)}`).join('\n')||'No data'}

Top Expense Categories:
${topExpenses.map((e,i)=>`${i+1}. ${e.name}: ${fmt$(e.total)}`).join('\n')||'No data'}

Outstanding Invoices: ${invoices.length} invoices totaling ${fmt$(invoices.reduce((sum,inv)=>sum+(parseFloat(inv.Balance)||0),0))}

=== QUOTES ===
Pending: ${pendingQuotes.length} | Approved: ${approvedQuotes.length}
${quotes.slice(0,10).map(q=>`- ${q.client_name||'Unknown'} | ${q.origin} → ${q.destination} | ${q.trip_date} | $${q.total_price?.toLocaleString()||'N/A'} | ${q.status} | ${q.aircraft_tail}`).join('\n')||'No quotes'}

=== MAINTENANCE EVENTS ===
${maintEvents.length>0?maintEvents.map(e=>`- ${e.aircraft_tail} | ${e.title} | ${e.type} | ${fmtTime(e.start_time)} → ${fmtTime(e.end_time)}${e.notes?` | ${e.notes}`:''}`).join('\n'):'No scheduled maintenance'}
`.trim();

  } catch (err) {
    return `You are an aviation operations assistant for Exjet Aviation. Live data temporarily unavailable. Error: ${err.message}`;
  }
};

router.post('/chat', async (req, res) => {
  const { messages } = req.body;
  if (!messages||!Array.isArray(messages)) return res.status(400).json({ error: 'messages array required' });
  try {
    const systemPrompt = await buildContext();
    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      { model: 'claude-opus-4-5', max_tokens: 2048, system: systemPrompt, messages },
      { headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' } }
    );
    res.json({ reply: response.data.content?.[0]?.text || 'No response generated.' });
  } catch (err) {
    console.error('Assistant error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Assistant error', detail: err.message });
  }
});

export default router;
