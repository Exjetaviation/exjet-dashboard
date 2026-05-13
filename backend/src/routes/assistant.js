import express from 'express';
import axios from 'axios';
import * as lf from '../services/levelflight.js';
import * as ff from '../services/foreflight.js';

const router = express.Router();

const buildContext = async () => {
  const now = Date.now();
  const todayStart = new Date();
  todayStart.setHours(0,0,0,0);

  try {
    const [legsRes, dutyRes, crewRes, pilotsRes, aircraftRes] = await Promise.allSettled([
      lf.getScheduledLegs(now),
      lf.getDutyTimes(now),
      ff.getCrew(),
      lf.getPilots(1),
      ff.getAircraft(),
    ]);

    const legs     = legsRes.status     === 'fulfilled' ? (legsRes.value?.legs     || []) : [];
    const duties   = dutyRes.status     === 'fulfilled' ? (dutyRes.value?.dutyTimes || []) : [];
    const crew     = crewRes.status     === 'fulfilled' ? (crewRes.value            || []) : [];
    const pilots   = pilotsRes.status   === 'fulfilled' ? (pilotsRes.value?.users   || []) : [];
    const aircraft = aircraftRes.status === 'fulfilled' ? (aircraftRes.value         || []) : [];

    const upcomingLegs = legs
      .filter(l => (l.departure?.time || 0) >= todayStart.getTime())
      .sort((a, b) => (a.departure?.time || 0) - (b.departure?.time || 0))
      .slice(0, 20);

    const recentLegs = legs
      .filter(l => (l.departure?.time || 0) < now)
      .sort((a, b) => (b.departure?.time || 0) - (a.departure?.time || 0))
      .slice(0, 10);

    const fmtTime = ms => ms ? new Date(ms).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit', timeZoneName: 'short'
    }) : 'N/A';

    const fmtLeg = l => {
      const pilots = l.pilots?.map(p => `${p.user.firstName} ${p.user.lastName} (${p.seat === 2 ? 'PIC' : 'SIC'})`).join(', ') || 'No pilots assigned';
      const pax = l.passengers?.map(p => `${p.user.firstName} ${p.user.lastName}`).join(', ') || 'No passengers';
      const STATUS = { 0: 'Scheduled', 1: 'Active', 2: 'Booked', 3: 'Completed' };
      return `- Trip #${l.dispatch?.tripId || 'N/A'} | ${l.departure?.airport} → ${l.arrival?.airport} | Aircraft: ${l.dispatch?.aircraft?.tailNumber || 'N/A'} (${l.dispatch?.aircraft?.type?.name || ''}) | Dep: ${fmtTime(l.departure?.time)} | Arr: ${fmtTime(l.arrival?.time)} | Flight time: ${l._calc?.time || 'N/A'} | Distance: ${l._calc?.distance?.value || 'N/A'} nm | Pax: ${l.passengerCount || 0} | Status: ${STATUS[l.status] || 'Unknown'} | Client: ${l.dispatch?.client?.company?.name || 'N/A'} | Pilots: ${pilots} | Passengers: ${pax} | Dep FBO: ${l.departure?.fbo?.name || 'N/A'} | Arr FBO: ${l.arrival?.fbo?.name || 'N/A'}`;
    };

    const fmtDuty = d => {
      const DTYPE = { 3: 'Flight Duty', 4: 'Ground Duty', 6: 'Rest', 11: 'Flight' };
      const dur = d.out && d.in ? Math.round((d.in - d.out) / 60000) : 0;
      const hrs = Math.floor(dur / 60), mins = dur % 60;
      return `- ${DTYPE[d.type] || `Type ${d.type}`} | Aircraft/Airport: ${d.craft?.tailNumber || d.airport || 'N/A'} | Start: ${fmtTime(d.out)} | End: ${fmtTime(d.in)} | Duration: ${hrs}h ${mins}m`;
    };

    const fmtPilot = p => {
      const certs = Object.entries(p.ratings?.[0]?.seats || {}).map(([c, s]) => `${c} ${s === 2 ? 'PIC' : 'SIC'}`).join(', ');
      return `- ${p.firstName} ${p.lastName} | ${p.title || 'Pilot'} | ${p.email} | Certs: ${certs || 'N/A'} | Active: ${p.active ? 'Yes' : 'No'}`;
    };

    const fmtAircraft = a => `- ${a.aircraftRegistration} | Type: ${a.aircraftModelCode} | Licenses: ${a.aircraftLicenses?.join(', ') || 'N/A'}`;

    return `
You are an expert aviation operations assistant for Exjet Aviation, a Part 135 certified charter company based in Fort Lauderdale, Florida (KFXE/Banyan Air Service). You have full access to live operational data below. Be concise, accurate, and helpful. When answering about specific flights or crew, always reference the actual data provided. You can help with dispatching, scheduling, client communications, regulatory questions, and anything else the operations team needs.

Today: ${new Date().toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' })}

=== FLEET ===
${aircraft.map(fmtAircraft).join('\n') || 'No aircraft data available'}

=== UPCOMING FLIGHTS (next 20) ===
${upcomingLegs.length > 0 ? upcomingLegs.map(fmtLeg).join('\n') : 'No upcoming flights'}

=== RECENT COMPLETED FLIGHTS (last 10) ===
${recentLegs.length > 0 ? recentLegs.map(fmtLeg).join('\n') : 'No recent flights'}

=== PILOT ROSTER ===
${pilots.map(fmtPilot).join('\n') || 'No pilot data available'}

=== FOREFLIGHT CREW (${crew.length} members) ===
${crew.map(c => `- ${c.fullname} | ${c.username}`).join('\n') || 'No crew data'}

=== DUTY TIMES THIS MONTH ===
${duties.length > 0 ? duties.map(fmtDuty).join('\n') : 'No duty time data'}
`.trim();

  } catch (err) {
    return `You are an aviation operations assistant for Exjet Aviation. Live data is temporarily unavailable. Error: ${err.message}`;
  }
};

router.post('/chat', async (req, res) => {
  const { messages } = req.body;
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages array required' });
  }

  try {
    const systemPrompt = await buildContext();

    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-opus-4-5',
        max_tokens: 1024,
        system: systemPrompt,
        messages,
      },
      {
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
      }
    );

    const text = response.data.content?.[0]?.text || 'No response generated.';
    res.json({ reply: text });

  } catch (err) {
    console.error('Assistant error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Assistant error', detail: err.message });
  }
});

export default router;
