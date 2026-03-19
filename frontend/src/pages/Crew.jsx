import { useApi } from '../hooks/useApi';
import { useNavigate } from 'react-router-dom';

const getSeatLabel = (seats) => {
  if (!seats) return 'Crew';
  const keys = Object.keys(seats);
  if (!keys.length) return 'Crew';
  const maxSeat = Math.max(...Object.values(seats));
  if (maxSeat === 2) return 'Captain (PIC)';
  if (maxSeat === 3) return 'First Officer (SIC)';
  return 'Crew';
};

const getGroup = (pilot) => {
  const title = pilot.title?.toLowerCase() || '';
  const seats = pilot.ratings?.[0]?.seats || {};
  const hasPart135 = 'Part 135' in seats;

  if (title.includes('maintenance')) return 'Maintenance / Pilot';
  if (title.includes('chief')) return 'Chief Pilot';
  if (hasPart135) return 'Part 135 Pilots';
  return 'Part 91 Pilots';
};

const GROUP_ORDER = ['Chief Pilot', 'Part 135 Pilots', 'Maintenance / Pilot', 'Part 91 Pilots'];
const GROUP_COLORS = {
  'Chief Pilot': '#f59e0b',
  'Part 135 Pilots': 'var(--accent)',
  'Maintenance / Pilot': 'var(--success)',
  'Part 91 Pilots': '#a855f7',
};

export default function Crew() {
  const { data: pilotData, loading } = useApi('/api/levelflight/pilots');
  const { data: dutyData } = useApi('/api/levelflight/duty');
  const navigate = useNavigate();

  const pilots = pilotData?.users || [];
  const dutyTimes = dutyData?.dutyTimes || [];

  const getDutyCount = (pilotId) =>
    dutyTimes.filter(d => d.user?.$oid === pilotId || d.user === pilotId).length;

  const grouped = GROUP_ORDER.reduce((acc, group) => {
    const members = pilots.filter(p => getGroup(p) === group);
    if (members.length > 0) acc[group] = members;
    return acc;
  }, {});

  return (
    <div>
      <div style={{ marginBottom: '28px' }}>
        <h1 style={{ fontSize: '24px', fontWeight: '600', color: 'var(--text-primary)' }}>Crew</h1>
        <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginTop: '4px' }}>
          {loading ? 'Loading...' : `${pilots.length} crew members · click a member to view duty times`}
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px', marginBottom: '32px' }}>
        {Object.entries(grouped).map(([group, members]) => (
          <div key={group} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', padding: '20px 24px', borderTop: `3px solid ${GROUP_COLORS[group]}` }}>
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{group}</p>
            <p style={{ fontSize: '32px', fontWeight: '600', color: 'var(--text-primary)', lineHeight: 1 }}>{members.length}</p>
          </div>
        ))}
      </div>

      {Object.entries(grouped).map(([group, members]) => (
        <div key={group} style={{ marginBottom: '28px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
            <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: GROUP_COLORS[group] }} />
            <h2 style={{ fontSize: '14px', fontWeight: '500', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{group}</h2>
          </div>
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', overflow: 'hidden' }}>
            {members.map((pilot, i) => {
              const seats = pilot.ratings?.[0]?.seats || {};
              const dutyCount = getDutyCount(pilot._id?.$oid);
              return (
                <div key={pilot._id?.$oid || i}
                  onClick={() => navigate(`/crew/${pilot._id?.$oid}`, { state: { pilot, dutyTimes } })}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '14px 20px',
                    borderBottom: i < members.length - 1 ? '1px solid var(--border)' : 'none',
                    cursor: 'pointer', transition: 'background 0.1s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(79,142,247,0.06)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{
                      width: '38px', height: '38px', borderRadius: '50%',
                      background: `${GROUP_COLORS[group]}22`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '13px', fontWeight: '500', color: GROUP_COLORS[group], flexShrink: 0,
                    }}>
                      {pilot.firstName?.[0]}{pilot.lastName?.[0]}
                    </div>
                    <div>
                      <p style={{ fontSize: '14px', color: 'var(--text-primary)', fontWeight: '500' }}>
                        {pilot.firstName} {pilot.lastName}
                      </p>
                      <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                        {pilot.title || getSeatLabel(seats)} · {pilot.email}
                      </p>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <div style={{ textAlign: 'right' }}>
                      {Object.entries(seats).map(([cert, seat]) => (
                        <span key={cert} style={{
                          background: cert === 'Part 135' ? 'rgba(79,142,247,0.15)' : 'rgba(255,255,255,0.05)',
                          color: cert === 'Part 135' ? 'var(--accent)' : 'var(--text-secondary)',
                          border: `1px solid ${cert === 'Part 135' ? 'rgba(79,142,247,0.3)' : 'var(--border)'}`,
                          borderRadius: '20px', padding: '2px 8px', fontSize: '11px', fontWeight: '500',
                          marginLeft: '6px',
                        }}>
                          {cert} · {seat === 2 ? 'PIC' : 'SIC'}
                        </span>
                      ))}
                    </div>
                    {dutyCount > 0 && (
                      <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{dutyCount} duty periods</span>
                    )}
                    <span style={{ color: 'var(--text-secondary)', fontSize: '16px' }}>›</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
