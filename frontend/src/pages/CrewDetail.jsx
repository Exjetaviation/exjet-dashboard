import { useLocation, useNavigate } from 'react-router-dom';

const DUTY_TYPE = {
  3: { label: 'Flight Duty', color: '#4f8ef7' },
  4: { label: 'Ground Duty', color: '#f59e0b' },
  6: { label: 'Rest Period', color: '#a855f7' },
  11: { label: 'Flight', color: '#22c55e' },
};

const formatDate = (ms) => {
  if (!ms) return '—';
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const formatTime = (ms) => {
  if (!ms) return '—';
  return new Date(ms).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
};

const getDuration = (out, inn) => {
  if (!out || !inn) return '—';
  const mins = Math.round((inn - out) / 60000);
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
};

const getTotalMins = (duties) =>
  duties.reduce((acc, d) => {
    if (d.out && d.in) return acc + Math.round((d.in - d.out) / 60000);
    return acc;
  }, 0);

export default function CrewDetail() {
  const { state } = useLocation();
  const navigate = useNavigate();

  const pilot = state?.pilot;
  const allDuty = state?.dutyTimes || [];

  if (!pilot) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>
        <p>Crew member not found.</p>
        <button onClick={() => navigate('/crew')} style={{ marginTop: '16px', padding: '8px 20px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>
          Back to Crew
        </button>
      </div>
    );
  }

  const pilotId = pilot._id?.$oid;
  const duties = allDuty.filter(d => d.user?.$oid === pilotId || d.user === pilotId)
    .sort((a, b) => (b.out || 0) - (a.out || 0));

  const flightDuties = duties.filter(d => d.type === 11 || d.type === 3);
  const groundDuties = duties.filter(d => d.type === 4);
  const restPeriods = duties.filter(d => d.type === 6);

  const totalFlightMins = getTotalMins(flightDuties);
  const totalDutyMins = getTotalMins(duties);
  const seats = pilot.ratings?.[0]?.seats || {};

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '28px' }}>
        <button onClick={() => navigate('/crew')} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '8px', padding: '8px 14px', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '13px' }}>
          ← Crew
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: 'rgba(79,142,247,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', fontWeight: '500', color: 'var(--accent)' }}>
            {pilot.firstName?.[0]}{pilot.lastName?.[0]}
          </div>
          <div>
            <h1 style={{ fontSize: '24px', fontWeight: '600', color: 'var(--text-primary)' }}>
              {pilot.firstName} {pilot.middleName} {pilot.lastName}
            </h1>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px' }}>
              {pilot.title || 'Pilot'} · {pilot.email}
            </p>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px', marginBottom: '28px' }}>
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', padding: '20px 24px', borderTop: '3px solid var(--accent)' }}>
          <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Flight Time This Month</p>
          <p style={{ fontSize: '28px', fontWeight: '600', color: 'var(--text-primary)', lineHeight: 1 }}>
            {Math.floor(totalFlightMins / 60)}h {totalFlightMins % 60}m
          </p>
        </div>
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', padding: '20px 24px', borderTop: '3px solid var(--success)' }}>
          <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total Duty This Month</p>
          <p style={{ fontSize: '28px', fontWeight: '600', color: 'var(--text-primary)', lineHeight: 1 }}>
            {Math.floor(totalDutyMins / 60)}h {totalDutyMins % 60}m
          </p>
        </div>
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', padding: '20px 24px', borderTop: '3px solid #f59e0b' }}>
          <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Ground Duties</p>
          <p style={{ fontSize: '28px', fontWeight: '600', color: 'var(--text-primary)', lineHeight: 1 }}>{groundDuties.length}</p>
        </div>
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', padding: '20px 24px', borderTop: '3px solid #a855f7' }}>
          <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Rest Periods</p>
          <p style={{ fontSize: '28px', fontWeight: '600', color: 'var(--text-primary)', lineHeight: 1 }}>{restPeriods.length}</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '20px' }}>
        <div>
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', overflow: 'hidden', marginBottom: '20px' }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', background: 'rgba(255,255,255,0.02)' }}>
              <h2 style={{ fontSize: '14px', fontWeight: '500', color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Certifications</h2>
            </div>
            <div style={{ padding: '16px 20px' }}>
              {Object.entries(seats).map(([cert, seat]) => (
                <div key={cert} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ fontSize: '14px', color: 'var(--text-primary)' }}>{cert}</span>
                  <span style={{
                    background: cert === 'Part 135' ? 'rgba(79,142,247,0.15)' : 'rgba(255,255,255,0.05)',
                    color: cert === 'Part 135' ? 'var(--accent)' : 'var(--text-secondary)',
                    border: `1px solid ${cert === 'Part 135' ? 'rgba(79,142,247,0.3)' : 'var(--border)'}`,
                    borderRadius: '20px', padding: '3px 10px', fontSize: '12px', fontWeight: '500',
                  }}>
                    {seat === 2 ? 'Captain (PIC)' : 'First Officer (SIC)'}
                  </span>
                </div>
              ))}
              {Object.keys(seats).length === 0 && (
                <p style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>No certifications listed</p>
              )}
            </div>
          </div>

          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', overflow: 'hidden' }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', background: 'rgba(255,255,255,0.02)' }}>
              <h2 style={{ fontSize: '14px', fontWeight: '500', color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Contact</h2>
            </div>
            <div style={{ padding: '16px 20px' }}>
              <p style={{ fontSize: '11px', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Email</p>
              <p style={{ fontSize: '14px', color: 'var(--accent)', marginBottom: '14px' }}>{pilot.email}</p>
              <p style={{ fontSize: '11px', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Status</p>
              <span style={{
                background: pilot.active ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
                color: pilot.active ? 'var(--success)' : 'var(--danger)',
                borderRadius: '20px', padding: '3px 10px', fontSize: '12px', fontWeight: '500',
              }}>
                {pilot.active ? 'Active' : 'Inactive'}
              </span>
            </div>
          </div>
        </div>

        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', overflow: 'hidden' }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', background: 'rgba(255,255,255,0.02)' }}>
            <h2 style={{ fontSize: '14px', fontWeight: '500', color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Duty Times This Month
            </h2>
          </div>
          {duties.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>
              No duty times recorded this month
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', background: 'rgba(255,255,255,0.02)' }}>
                  {['Date', 'Type', 'Aircraft / Airport', 'Start', 'End', 'Duration'].map(h => (
                    <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: '11px', fontWeight: '500', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {duties.map((d, i) => {
                  const typeInfo = DUTY_TYPE[d.type] || { label: `Type ${d.type}`, color: '#888' };
                  return (
                    <tr key={d._id?.$oid || i}
                      style={{ borderBottom: '1px solid var(--border)' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <td style={{ padding: '12px 16px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                        {formatDate(d.out)}
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <span style={{
                          background: `${typeInfo.color}22`, color: typeInfo.color,
                          border: `1px solid ${typeInfo.color}44`,
                          borderRadius: '20px', padding: '3px 10px', fontSize: '12px', fontWeight: '500', whiteSpace: 'nowrap',
                        }}>
                          {typeInfo.label}
                        </span>
                      </td>
                      <td style={{ padding: '12px 16px', color: 'var(--accent)', fontWeight: '500' }}>
                        {d.craft?.tailNumber || d.airport || '—'}
                      </td>
                      <td style={{ padding: '12px 16px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                        {formatTime(d.out)}
                      </td>
                      <td style={{ padding: '12px 16px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                        {formatTime(d.in)}
                      </td>
                      <td style={{ padding: '12px 16px', color: 'var(--text-primary)', fontWeight: '500' }}>
                        {getDuration(d.out, d.in)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
