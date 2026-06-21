// frontend/src/pages/scheduling/People.jsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi } from '../../hooks/useApi';

const card = { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 16px' };
const fullName = (p) => [p.first_name, p.middle_name, p.last_name].filter(Boolean).join(' ') || 'Unnamed';
const initials = (p) => [p.first_name, p.last_name].filter(Boolean).map((s) => s[0]).join('').toUpperCase() || '?';

// Worst alert severity -> badge. red beats amber.
function AlertBadge({ alerts }) {
  if (!alerts?.length) return null;
  const red = alerts.find((a) => a.severity === 'red');
  const a = red || alerts[0];
  const color = a.severity === 'red' ? '#ef4444' : '#f59e0b';
  return (
    <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 20, color, border: `1px solid ${color}55`, background: `${color}18` }}>
      {a.label} {a.reason === 'expired' ? 'expired' : 'expiring'}
    </span>
  );
}

export default function SchedulingPeople() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const { data, loading, error } = useApi(`/api/scheduling/people?q=${encodeURIComponent(q)}`);
  const people = data?.people || [];
  const total = data?.total ?? people.length;

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search passengers by name or DOB…"
          style={{ flex: '1 1 240px', maxWidth: 360, padding: '8px 12px', fontSize: 13, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-primary)', boxSizing: 'border-box' }}
        />
        <button onClick={() => navigate('/scheduling/people/new')}
          style={{ padding: '9px 16px', fontSize: 13, fontWeight: 600, background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', whiteSpace: 'nowrap' }}>+ Add passenger</button>
      </div>
      {!loading && !error && (
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 10 }}>
          {q
            ? `${people.length} match${people.length === 1 ? '' : 'es'}${total > people.length ? ` of ${total}` : ''}`
            : total > people.length
              ? `Showing ${people.length} of ${total} passengers — search to find anyone`
              : `${total} passenger${total === 1 ? '' : 's'}`}
        </p>
      )}
      {error && <div style={{ ...card, color: 'var(--danger)' }}>Error loading passengers: {error}</div>}
      {loading ? (
        <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Loading passengers…</p>
      ) : !people.length ? (
        <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{q ? 'No matches.' : 'No passengers yet — they appear here once added to a trip.'}</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {people.map((p) => (
            <div key={p.id} onClick={() => navigate(`/scheduling/people/${p.id}`)}
              style={{ ...card, display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
              <div style={{ width: 38, height: 38, borderRadius: '50%', background: 'rgba(79,142,247,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 600, color: 'var(--accent)' }}>{initials(p)}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{fullName(p)}</span>
                  {p.hasPassport && <span title="Passport on file" style={{ fontSize: 12 }}>🛂</span>}
                  <AlertBadge alerts={p.alerts} />
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  {p.dob ? `DOB ${p.dob}` : 'No DOB'} · {p.tripCount} trip{p.tripCount === 1 ? '' : 's'}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
