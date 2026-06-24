import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../lib/api';

const card = { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, marginBottom: 16 };
const primaryBtn = { padding: '8px 18px', fontSize: 13, fontWeight: 600, background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' };
const inp = { padding: '8px 12px', fontSize: 13, background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 8, boxSizing: 'border-box' };
const th = { textAlign: 'left', fontSize: 11, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '.04em', padding: '6px 10px', borderBottom: '1px solid var(--border)' };
const td = { fontSize: 13, color: 'var(--text-primary)', padding: '6px 10px', borderBottom: '1px solid var(--border)' };
const usd = (n) => (n == null ? '—' : '$' + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2 }));
const fmtDate = (d) => (d ? String(d).slice(0, 10) : '');

export default function FuelPrices() {
  const [imports, setImports] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState(null);
  const [error, setError] = useState(null);

  const [icao, setIcao] = useState('');
  const [prices, setPrices] = useState(null);
  const [lookingUp, setLookingUp] = useState(false);

  const loadImports = useCallback(async () => {
    try {
      const r = await apiFetch('/api/fuel/imports');
      const j = await r.json();
      setImports(j.imports || []);
    } catch { /* soft */ }
  }, []);
  useEffect(() => { loadImports(); }, [loadImports]);

  const runScan = async () => {
    setScanning(true); setError(null); setScanResult(null);
    try {
      const r = await apiFetch('/api/fuel/scan', { method: 'POST' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `Scan failed (${r.status})`);
      setScanResult(j);
      await loadImports();
    } catch (e) { setError(e.message); }
    setScanning(false);
  };

  const lookup = async () => {
    const code = icao.trim().toUpperCase();
    if (code.length < 3) { setError('Enter an ICAO (e.g. KFXE).'); return; }
    setLookingUp(true); setError(null);
    try {
      const r = await apiFetch(`/api/fuel/prices?icao=${encodeURIComponent(code)}`);
      const j = await r.json();
      setPrices(j.prices || []);
    } catch (e) { setError(e.message); setPrices([]); }
    setLookingUp(false);
  };

  const statusColor = (s) => (s === 'ok' ? 'var(--success)' : s === 'error' ? 'var(--danger)' : 'var(--text-secondary)');

  return (
    <div style={{ maxWidth: 980 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>Fuel Prices</h1>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 3 }}>Vendor fuel-price CSVs (World Fuel, Everest) scanned from operations@flyexjet.vip.</p>
        </div>
        <button onClick={runScan} disabled={scanning} style={{ ...primaryBtn, opacity: scanning ? 0.6 : 1, cursor: scanning ? 'default' : 'pointer' }}>
          {scanning ? 'Scanning…' : '↻ Run scan now'}
        </button>
      </div>

      {error && <div style={{ ...card, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: 'var(--danger)' }}>{error}</div>}

      {scanResult && (
        <div style={{ ...card, border: `1px solid ${scanResult.ok ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}` }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>
            {scanResult.ok ? `Scan complete — ${scanResult.scanned || 0} message(s) checked` : `Scan: ${scanResult.error || 'not configured'}`}
          </div>
          {(scanResult.results || []).map((r, i) => (
            <div key={i} style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              {r.vendor ? `${r.vendor}: ${r.rows} rows imported` : r.skipped ? `skipped — ${r.skipped}` : `error — ${r.error}`}
            </div>
          ))}
        </div>
      )}

      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 10 }}>Recent imports</div>
        {imports.length ? (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>Vendor</th><th style={th}>File</th><th style={th}>Rows</th><th style={th}>Effective</th><th style={th}>Status</th><th style={th}>Imported</th></tr></thead>
            <tbody>
              {imports.map((im) => (
                <tr key={im.gmail_message_id}>
                  <td style={td}>{im.vendor || '—'}</td>
                  <td style={td}>{im.file_name || '—'}</td>
                  <td style={td}>{im.rows_imported ?? '—'}</td>
                  <td style={td}>{fmtDate(im.effective_date)}</td>
                  <td style={{ ...td, color: statusColor(im.status), fontWeight: 600 }}>{im.status || '—'}{im.status === 'error' && im.message ? ` · ${im.message}` : ''}</td>
                  <td style={td}>{fmtDate(im.imported_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>No imports yet. Run a scan, or wait for the weekly worker.</p>}
      </div>

      <div style={card}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Look up prices</span>
          <input value={icao} onChange={(e) => setIcao(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && lookup()} placeholder="ICAO (e.g. KFXE)" style={{ ...inp, width: 160 }} />
          <button onClick={lookup} disabled={lookingUp} style={{ ...primaryBtn, background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}>{lookingUp ? 'Looking up…' : 'Look up'}</button>
        </div>
        {prices != null && (prices.length ? (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>Vendor</th><th style={th}>FBO</th><th style={th}>Fuel</th><th style={th}>Tier (gal)</th><th style={th}>Price</th><th style={th}>Total</th><th style={th}>Exp</th></tr></thead>
            <tbody>
              {prices.map((p, i) => (
                <tr key={i}>
                  <td style={td}>{p.vendor}</td>
                  <td style={td}>{p.fbo_name}{p.fbo_alt_name ? ` (${p.fbo_alt_name})` : ''}</td>
                  <td style={td}>{p.fuel_type || '—'}</td>
                  <td style={td}>{p.tier_from_gal ?? '—'}{p.tier_to_gal ? `–${p.tier_to_gal}` : '+'}</td>
                  <td style={td}>{usd(p.price)}</td>
                  <td style={td}>{usd(p.total_price)}</td>
                  <td style={td}>{fmtDate(p.exp_date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>No prices stored for that airport yet.</p>)}
      </div>
    </div>
  );
}
