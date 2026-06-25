import { recomputeInputs } from '../../lib/feesMath';
import { fmtHrs, usd } from './pricingRows';

// Collapsible Pricing summary bar (the "tab"). Presentational: shows the live
// breakdown from `pricing` and exposes Open / FET / Total-override handlers.
// props: { pricing, collapsed, onToggle, onOpen, editable }
export default function PricingSummary({ pricing, collapsed = false, onToggle, onOpen, editable = true }) {
  if (!pricing || pricing.error) {
    return (
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>Pricing</span>
          {editable && <button style={editBtn} onClick={onOpen}>✎ Edit pricing</button>}
        </div>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '10px 0 0' }}>{pricing?.error || 'No pricing yet.'}</p>
      </div>
    );
  }
  const live = recomputeInputs(pricing);
  const metric = (lbl, val, sub) => (
    <div style={metricStyle}>
      <div style={lblStyle}>{lbl}</div>
      <div style={valStyle}>{usd(val)}</div>
      {sub}
    </div>
  );
  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }} onClick={onToggle}>
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>Pricing</span>
        <span style={{ display: 'flex', gap: 14, alignItems: 'center', color: 'var(--text-secondary)', fontSize: 12 }}>
          {editable && <span style={editLink} onClick={(e) => { e.stopPropagation(); onOpen(); }}>✎ Edit pricing</span>}
          <span>{collapsed ? '▸' : '▾'}</span>
        </span>
      </div>
      {!collapsed && (
        <div style={{ display: 'flex', gap: 0, alignItems: 'stretch', marginTop: 14, flexWrap: 'wrap' }}>
          {metric('Effective Cost/Hr', live.effectiveHourly)}
          {metric(`Flight Time (${fmtHrs(pricing.hours)})`, live.flightCost)}
          {metric('Surcharge', live.surcharge)}
          {metric('Landings', live.landingCost)}
          {metric(`RON (${pricing.nights || 0})`, live.overnightCost)}
          {metric(`FA (${pricing.faCount || 0})`, live.faCost)}
          {metric(`Crew (${pricing.crewCount || 0})`, live.crewCost)}
          {metric('Segment', live.segmentFee)}
          <div style={totalCard}>
            <div style={{ fontSize: 11, letterSpacing: '.08em', color: 'var(--text-secondary)' }}>TOTAL PRICE</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-primary)' }}>
              {usd(live.total)}{pricing.totalOverride != null ? ' ·' : ''}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const card = { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, marginBottom: 16 };
const metricStyle = { flex: '1 1 110px', minWidth: 104, padding: '2px 14px', borderRight: '1px solid var(--border)' };
const lblStyle = { fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4, whiteSpace: 'nowrap' };
const valStyle = { fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' };
const totalCard = { flex: '0 0 200px', background: 'var(--bg-secondary)', border: '1px solid var(--accent)', borderRadius: 10, padding: '12px 16px', textAlign: 'right', marginLeft: 8, display: 'flex', flexDirection: 'column', justifyContent: 'center' };
const editBtn = { padding: '6px 12px', fontSize: 12, background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer' };
const editLink = { color: 'var(--accent)', fontWeight: 600, cursor: 'pointer' };
