import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { apiFetch } from '../lib/api';
import FlightsFilterBar from '../components/FlightsFilterBar';
import FlightsList from '../components/FlightsList';
import TripsList from '../components/TripsList';
import Calendar from './Calendar';
import SchedulingOverview from './scheduling/Overview';
import SchedulingRequests from './scheduling/Requests';
import SchedulingCrew from './scheduling/Crew';
import SchedulingAircraft from './scheduling/Aircraft';
import SchedulingClients from './scheduling/Clients';
import SchedulingPeople from './scheduling/People';
import RateCards from './RateCards';
import FuelPrices from './FuelPrices';

// The new Scheduling section — sourced from the MIRROR (scheduling_legs) rather
// than a live LevelFlight call. "Schedule" is the board (mirror-backed Calendar);
// "Trips" reuses the existing list components. The board is what distinguishes
// this section from the live Flights page.
export default function Scheduling() {
  const [params, setParams] = useSearchParams();
  const [section, setSection] = useState(params.get('section') || 'overview');
  const navigate = useNavigate();

  const selectSection = (id) => {
    setSection(id);
    setParams((p) => { const n = new URLSearchParams(p); id === 'overview' ? n.delete('section') : n.set('section', id); return n; }, { replace: true });
  };

  const SectionTab = ({ id, label }) => (
    <button onClick={() => selectSection(id)}
      style={{ padding: '8px 18px', fontSize: 13, fontWeight: 500, cursor: 'pointer', background: 'none', border: 'none',
        color: section === id ? 'var(--accent)' : 'var(--text-secondary)',
        borderBottom: section === id ? '2px solid var(--accent)' : '2px solid transparent' }}>
      {label}
    </button>
  );

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: '16px', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: '600', color: 'var(--text-primary)' }}>Scheduling</h1>
          <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginTop: '4px' }}>Synced from LevelFlight</p>
        </div>
        <button onClick={() => navigate('/scheduling/new')}
          style={{ padding: '9px 18px', fontSize: 13, fontWeight: 600, background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}>+ New Quote</button>
      </div>

      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)', marginBottom: 16, flexWrap: 'wrap' }}>
        <SectionTab id="overview" label="Overview" />
        <SectionTab id="schedule" label="Schedule" />
        <SectionTab id="quotes" label="Quotes" />
        <SectionTab id="trips" label="Trips" />
        <SectionTab id="requests" label="Requests" />
        <SectionTab id="crew" label="Crew" />
        <SectionTab id="aircraft" label="Aircraft" />
        <SectionTab id="clients" label="Clients" />
        <SectionTab id="people" label="Passengers" />
        <SectionTab id="ratecards" label="Rate Cards" />
        <SectionTab id="fuel" label="Fuel" />
      </div>

      {section === 'overview' && <SchedulingOverview onJump={setSection} />}
      {section === 'schedule' && <Calendar legsEndpoint="/api/scheduling/legs" tripBasePath="/scheduling/trips" />}
      {section === 'quotes' && <QuotesView />}
      {section === 'trips' && <TripsView />}
      {section === 'requests' && <SchedulingRequests />}
      {section === 'crew' && <SchedulingCrew />}
      {section === 'aircraft' && <SchedulingAircraft />}
      {section === 'clients' && <SchedulingClients />}
      {section === 'people' && <SchedulingPeople />}
      {section === 'ratecards' && <RateCards />}
      {section === 'fuel' && <FuelPrices />}
    </div>
  );
}

// The Quotes view — trips at the working 'quote' stage. Create a quote (+ New Quote)
// then Book it, which advances it to Booked and moves it out of this list.
function QuotesView() {
  const navigate = useNavigate();
  const [quotes, setQuotes] = useState(null);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    try {
      const r = await apiFetch('/api/scheduling/quotes');
      const j = await r.json();
      if (j.quotes) setQuotes(j.quotes); else setError(j.error || 'Failed to load quotes');
    } catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const book = async (id) => {
    setBusyId(id); setError(null);
    try {
      const r = await apiFetch(`/api/scheduling/trips/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'booked' }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `Book failed (${r.status})`);
      navigate(`/scheduling/trips/${j.trip?.trip_number || id}`); // it's a booked trip now
      return;
    } catch (e) { setError(e.message); }
    setBusyId(null);
  };

  const usd = (n) => '$' + Number(n).toLocaleString();
  const fmt = (ms) => (ms ? new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—');

  return (
    <div>
      {error && (
        <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '12px 16px', color: 'var(--danger)', marginBottom: 16 }}>{error}</div>
      )}
      {quotes === null ? (
        <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Loading quotes…</p>
      ) : quotes.length === 0 ? (
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: 40, textAlign: 'center' }}>
          <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 14 }}>No open quotes yet.</p>
          <button onClick={() => navigate('/scheduling/new')}
            style={{ padding: '9px 18px', fontSize: 13, fontWeight: 600, background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}>+ New Quote</button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {quotes.map((q) => (
            <div key={q.id} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{q.route || '—'}</span>
                  {q.trip_number && <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>#{q.trip_number}</span>}
                  <span style={{ background: 'rgba(79,142,247,0.12)', color: 'var(--accent)', border: '1px solid rgba(79,142,247,0.3)', borderRadius: 20, padding: '2px 9px', fontSize: 11 }}>Quote</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 3 }}>
                  {fmt(q.start)}{q.end && q.end !== q.start ? ` – ${fmt(q.end)}` : ''} · {q.tail || '—'} · {q.legCount} leg{q.legCount === 1 ? '' : 's'}{q.customer ? ` · ${q.customer}` : ''}{q.total != null ? ` · ${usd(q.total)}` : ''}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => book(q.id)} disabled={busyId === q.id}
                  style={{ padding: '7px 16px', fontSize: 13, fontWeight: 600, background: '#a855f7', color: '#fff', border: 'none', borderRadius: 8, cursor: busyId === q.id ? 'default' : 'pointer', opacity: busyId === q.id ? 0.6 : 1 }}>
                  {busyId === q.id ? 'Booking…' : 'Book'}
                </button>
                <button onClick={() => navigate(q.quote_number ? `/scheduling/quotes/${q.quote_number}` : `/scheduling/trips/${q.id}`)}
                  style={{ padding: '7px 12px', fontSize: 13, background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer' }}>View</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// The Trips list view — the existing list components fed by the mirror.
function TripsView() {
  const { data, loading, error } = useApi('/api/scheduling/legs');
  const legs = data?.legs || [];
  const [visible, setVisible] = useState([]);
  const [query, setQuery] = useState('');
  const [params, setParams] = useSearchParams();

  const q = query.trim().toLowerCase();
  const shown = q
    ? visible.filter((leg) => [
        leg.departure?.airport, leg.arrival?.airport,
        leg.dispatch?.aircraft?.tailNumber,
        leg.dispatch?.client?.company?.name,
        leg.dispatch?.tripId,
      ].some((v) => String(v ?? '').toLowerCase().includes(q)))
    : visible;
  const view = params.get('view') === 'legs' ? 'legs' : 'trips';
  const setView = (v) => setParams((p) => { const n = new URLSearchParams(p); v === 'legs' ? n.set('view', 'legs') : n.delete('view'); return n; }, { replace: true });

  const Tab = ({ id, label }) => (
    <button onClick={() => setView(id)}
      style={{ padding: '8px 18px', fontSize: 13, fontWeight: 500, cursor: 'pointer', background: 'none', border: 'none',
        color: view === id ? 'var(--accent)' : 'var(--text-secondary)',
        borderBottom: view === id ? '2px solid var(--accent)' : '2px solid transparent' }}>
      {label}
    </button>
  );

  return (
    <div>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search route, tail, client, or trip #…"
        style={{ width: '100%', maxWidth: 360, padding: '8px 12px', marginBottom: 12, fontSize: 13, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-primary)', boxSizing: 'border-box' }}
      />

      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)', marginBottom: 16 }}>
        <Tab id="trips" label="Trips" />
        <Tab id="legs" label="Legs" />
      </div>

      {error && (
        <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', padding: '12px 16px', color: 'var(--danger)', marginBottom: '16px' }}>
          Error loading scheduling: {error}
        </div>
      )}

      <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>
        {loading ? 'Loading from mirror...' : `${legs.length} legs · ${shown.length} shown`}
      </p>
      <FlightsFilterBar legs={legs} onChange={setVisible} />
      {view === 'legs'
        ? <FlightsList legs={shown} loading={loading} tripBasePath="/scheduling/trips" />
        : <TripsList legs={shown} loading={loading} basePath="/scheduling/trips" tripBasePath="/scheduling/trips" />}
    </div>
  );
}
