import { useState, useEffect } from 'react';

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const fmt$ = v => v != null ? `$${Math.round(v).toLocaleString()}` : '—';
const fmtPct = v => v != null ? `${Math.round(v * 100)}%` : '—';

const ConfidenceBar = ({ value }) => {
  const pct = Math.round(value * 100);
  const color = pct >= 70 ? '#22c55e' : pct >= 40 ? '#f59e0b' : '#ef4444';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
      <div style={{ flex: 1, height: '6px', background: 'var(--border)', borderRadius: '3px' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: '3px', transition: 'width .4s' }} />
      </div>
      <span style={{ fontSize: '13px', fontWeight: '600', color, minWidth: '36px' }}>{pct}%</span>
    </div>
  );
};

export default function PricingModel() {
  const [model, setModel] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [syncMsg, setSyncMsg] = useState(null);
  const [estimate, setEstimate] = useState(null);
  const [estimating, setEstimating] = useState(false);
  const [form, setForm] = useState({
    aircraft_tail: '',
    flight_mins: '',
    overnight_count: 0,
    is_wholesale: false,
    is_international: false,
    route: '',
    quarter: Math.ceil((new Date().getMonth() + 1) / 3),
  });

  const loadModel = async () => {
    setLoading(true);
    const res = await fetch(`${BASE_URL}/api/pricing/model`);
    const data = await res.json();
    setModel(data);
    setLoading(false);
  };

  useEffect(() => { loadModel(); }, []);

  const sync = async () => {
    setSyncing(true); setSyncMsg(null);
    try {
      const res = await fetch(`${BASE_URL}/api/pricing/sync`, { method: 'POST' });
      const data = await res.json();
      setSyncMsg({ type: 'success', text: `Synced ${data.inserted} trips from LevelFlight` });
      await loadModel();
    } catch (err) {
      setSyncMsg({ type: 'error', text: err.message });
    } finally {
      setSyncing(false);
    }
  };

  const runEstimate = async () => {
    if (!form.aircraft_tail || !form.flight_mins) return;
    setEstimating(true);
    try {
      const res = await fetch(`${BASE_URL}/api/pricing/estimate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, flight_mins: Number(form.flight_mins), overnight_count: Number(form.overnight_count) }),
      });
      const data = await res.json();
      setEstimate(data);
    } catch (err) {
      setEstimate({ error: err.message });
    } finally {
      setEstimating(false);
    }
  };

  const tails = model?.models ? Object.keys(model.models) : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: '600', color: 'var(--text-primary)', margin: 0 }}>Pricing Intelligence</h1>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '3px' }}>
            Regression model trained on your historical charter trips
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          {syncMsg && (
            <span style={{ fontSize: '12px', color: syncMsg.type === 'error' ? 'var(--danger)' : 'var(--success)' }}>
              {syncMsg.text}
            </span>
          )}
          <button onClick={sync} disabled={syncing} style={{
            padding: '8px 18px', fontSize: '13px', fontWeight: '600',
            background: syncing ? 'var(--border)' : 'var(--accent)',
            color: '#fff', border: 'none', borderRadius: '8px', cursor: syncing ? 'default' : 'pointer',
          }}>
            {syncing ? 'Syncing...' : '↻ Sync Historical Data'}
          </button>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: '60px', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading model...</div>
      ) : model?.error ? (
        <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '10px', padding: '20px', color: 'var(--danger)' }}>
          {model.error} — Click "Sync Historical Data" to build the model.
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px' }}>
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', padding: '18px 20px', borderTop: '3px solid var(--accent)' }}>
              <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: '0 0 6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Trips Analyzed</p>
              <p style={{ fontSize: '28px', fontWeight: '700', color: 'var(--text-primary)', margin: 0 }}>{model.totalTrips || 0}</p>
            </div>
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', padding: '18px 20px', borderTop: '3px solid var(--success)' }}>
              <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: '0 0 6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Aircraft Modeled</p>
              <p style={{ fontSize: '28px', fontWeight: '700', color: 'var(--text-primary)', margin: 0 }}>{tails.length}</p>
            </div>
            {tails.map(tail => {
              const m = model.models[tail];
              if (m.insufficient) return null;
              return (
                <div key={tail} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', padding: '18px 20px', borderTop: '3px solid #a855f7' }}>
                  <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: '0 0 6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{tail} · Avg Trip</p>
                  <p style={{ fontSize: '28px', fontWeight: '700', color: 'var(--text-primary)', margin: 0 }}>{fmt$(m.avgTotal)}</p>
                </div>
              );
            })}
          </div>

          {tails.map(tail => {
            const m = model.models[tail];
            return (
              <div key={tail} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', overflow: 'hidden' }}>
                <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span style={{ fontSize: '18px', fontWeight: '700', color: 'var(--accent)' }}>{tail}</span>
                    {m.insufficient ? (
                      <span style={{ fontSize: '12px', color: 'var(--warning)', background: 'rgba(245,158,11,0.1)', padding: '3px 8px', borderRadius: '20px', border: '1px solid rgba(245,158,11,0.2)' }}>
                        Insufficient data ({m.count} trips)
                      </span>
                    ) : (
                      <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{m.count} trips · R² {fmtPct(m.regression?.r2)}</span>
                    )}
                  </div>
                </div>

                {!m.insufficient && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0' }}>
                    {[
                      ['Avg Hourly Rate', fmt$(m.avgHourlyRate)],
                      ['Avg Overnight Fee', fmt$(m.avgOvernightFee)],
                      ['Wholesale Rate/hr', fmt$(m.wholesaleAvgPerHr)],
                      ['Direct Rate/hr', fmt$(m.directAvgPerHr)],
                      ['Intl Premium', fmtPct(m.intlPremium)],
                      ['Trip Range', `${fmt$(m.minTotal)} – ${fmt$(m.maxTotal)}`],
                    ].map(([label, value]) => (
                      <div key={label} style={{ padding: '12px 18px', borderRight: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}>
                        <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</p>
                        <p style={{ fontSize: '15px', fontWeight: '500', color: 'var(--text-primary)', margin: 0 }}>{value}</p>
                      </div>
                    ))}
                  </div>
                )}

                {!m.insufficient && m.seasonalFactors && (
                  <div style={{ padding: '14px 18px', borderTop: '1px solid var(--border)' }}>
                    <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: '0 0 10px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Seasonal rate/hr</p>
                    <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                      {['q1','q2','q3','q4'].map(q => (
                        m.seasonalFactors[q] && (
                          <div key={q} style={{ background: 'var(--bg-secondary)', borderRadius: '8px', padding: '8px 14px', textAlign: 'center' }}>
                            <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: '0 0 3px' }}>Q{q[1]}</p>
                            <p style={{ fontSize: '14px', fontWeight: '600', color: 'var(--text-primary)', margin: 0 }}>{fmt$(m.seasonalFactors[q])}</p>
                          </div>
                        )
                      ))}
                    </div>
                  </div>
                )}

                {!m.insufficient && Object.keys(m.routeStats || {}).length > 0 && (
                  <div style={{ padding: '14px 18px', borderTop: '1px solid var(--border)' }}>
                    <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: '0 0 10px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Top routes</p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {Object.entries(m.routeStats).sort((a,b) => b[1].count - a[1].count).slice(0,5).map(([route, stats]) => (
                        <div key={route} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '13px' }}>
                          <span style={{ color: 'var(--accent)', fontWeight: '500' }}>{route}</span>
                          <span style={{ color: 'var(--text-secondary)' }}>{stats.count} trips · avg {fmt$(stats.avgTotal)} · {Math.round(stats.avgHrs * 60)}min</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', overflow: 'hidden' }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
              <h2 style={{ fontSize: '15px', fontWeight: '600', color: 'var(--text-primary)', margin: 0 }}>Price Estimator</h2>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '3px' }}>Test the model with a hypothetical trip</p>
            </div>
            <div style={{ padding: '18px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '14px' }}>
              {[
                { key: 'aircraft_tail', label: 'Aircraft Tail', type: 'text', placeholder: 'N69FP' },
                { key: 'flight_mins', label: 'Flight Time (mins)', type: 'number', placeholder: '137' },
                { key: 'route', label: 'Route (e.g. KFXE-TIST)', type: 'text', placeholder: 'KFXE-TIST' },
                { key: 'overnight_count', label: 'Overnights', type: 'number', placeholder: '0' },
                { key: 'quarter', label: 'Quarter (1-4)', type: 'number', placeholder: '2' },
              ].map(f => (
                <div key={f.key}>
                  <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '5px' }}>{f.label}</label>
                  <input type={f.type} value={form[f.key]} placeholder={f.placeholder}
                    onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                    style={{ width: '100%', padding: '8px 12px', fontSize: '13px', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box' }}
                  />
                </div>
              ))}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', justifyContent: 'flex-end' }}>
                {[
                  { key: 'is_wholesale', label: 'Wholesale client' },
                  { key: 'is_international', label: 'International flight' },
                ].map(f => (
                  <label key={f.key} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                    <input type="checkbox" checked={form[f.key]} onChange={e => setForm(p => ({ ...p, [f.key]: e.target.checked }))} />
                    {f.label}
                  </label>
                ))}
              </div>
            </div>
            <div style={{ padding: '0 18px 18px' }}>
              <button onClick={runEstimate} disabled={estimating || !form.aircraft_tail || !form.flight_mins} style={{
                padding: '9px 22px', fontSize: '13px', fontWeight: '600',
                background: 'var(--accent)', color: '#fff', border: 'none',
                borderRadius: '8px', cursor: 'pointer',
              }}>
                {estimating ? 'Estimating...' : 'Estimate Price'}
              </button>
            </div>

            {estimate && !estimate.error && (
              <div style={{ margin: '0 18px 18px', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: '10px', padding: '16px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '14px' }}>
                  <div>
                    <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Base price</p>
                    <p style={{ fontSize: '26px', fontWeight: '700', color: 'var(--text-primary)', margin: 0 }}>{fmt$(estimate.basePrice)}</p>
                  </div>
                  <div>
                    <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Adjusted price</p>
                    <p style={{ fontSize: '26px', fontWeight: '700', color: 'var(--accent)', margin: 0 }}>{fmt$(estimate.adjustedPrice)}</p>
                  </div>
                </div>
                <div style={{ marginBottom: '14px' }}>
                  <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: '0 0 6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Model confidence</p>
                  <ConfidenceBar value={estimate.confidence} />
                </div>
                {estimate.adjustments?.length > 0 && (
                  <div>
                    <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Adjustments applied</p>
                    {estimate.adjustments.map((adj, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', padding: '5px 0', borderBottom: '1px solid var(--border)' }}>
                        <span style={{ color: 'var(--text-secondary)' }}>{adj.factor} <span style={{ fontSize: '11px' }}>({adj.note})</span></span>
                        <span style={{ color: adj.amount >= 0 ? 'var(--success)' : 'var(--danger)', fontWeight: '500' }}>
                          {adj.amount >= 0 ? '+' : ''}{fmt$(adj.amount)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ marginTop: '10px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                  Based on {estimate.modelStats?.tripsAnalyzed} trips · R² {fmtPct(estimate.modelStats?.r2)} · avg rate {fmt$(estimate.modelStats?.avgHourlyRate)}/hr
                </div>
              </div>
            )}
            {estimate?.error && (
              <div style={{ margin: '0 18px 18px', padding: '12px', background: 'rgba(239,68,68,0.1)', borderRadius: '8px', color: 'var(--danger)', fontSize: '13px' }}>{estimate.error}</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
