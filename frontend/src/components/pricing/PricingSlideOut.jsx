import { recomputeInputs } from '../../lib/feesMath';
import { fmtHrs, usd, pinPatch, unpinPatch } from './pricingRows';
import { FEE_CODES } from '../../lib/feeCatalog';

// Right-side drawer for editing pricing, LevelFlight-style. Presentational +
// controlled: shows live values from `pricing`, emits edits via onPatch(patch)
// and onRecalculate() / onClose(). A $ edit pins the line (overrides); a rate/count
// edit sets the input. props: { pricing, onPatch, onRecalculate, onClose }
export default function PricingSlideOut({ pricing, onPatch, onRecalculate, onClose }) {
  if (!pricing) return null;
  const live = recomputeInputs(pricing);
  const ov = pricing.overrides || {};
  const pinned = (k) => ov[k] !== undefined && ov[k] !== null && ov[k] !== '';

  // $ line — editable amount that pins the line; shows a reset control when pinned.
  const dollarRow = (label, line, value) => (
    <div style={{ ...row, ...(pinned(line) ? rowPinned : null) }} key={line}>
      <span style={rl}>{label}{pinned(line) && <span title="Pinned" style={dot}>●</span>}</span>
      <span style={rv}>
        <input type="number" value={value} style={numInp}
          onChange={(e) => onPatch(pinPatch(ov, line, e.target.value))} />
        {pinned(line) && <button title="Reset to calculated" style={resetBtn} onClick={() => onPatch(unpinPatch(ov, line))}>↺</button>}
      </span>
    </div>
  );
  // rate/count input — sets a plain input field (recomputes its line unless pinned).
  const inputRow = (label, field, value) => (
    <div style={row} key={field}>
      <span style={rl}>{label}</span>
      <span style={rv}><input type="number" value={value ?? ''} style={numInp}
        onChange={(e) => onPatch({ [field]: e.target.value })} /></span>
    </div>
  );
  const roRow = (label, val, opts = {}) => (
    <div style={{ ...row, ...(opts.subtotal ? rowSub : null) }} key={label}>
      <span style={{ ...rl, ...(opts.subtotal ? { fontWeight: 800, color: '#fff' } : null) }}>{label}</span>
      <span style={{ ...rv, color: opts.accent ? 'var(--accent)' : (opts.subtotal ? '#fff' : 'var(--text-secondary)') }}>{val}</span>
    </div>
  );

  return (
    <div style={overlay} onClick={onClose}>
      <div style={drawer} onClick={(e) => e.stopPropagation()}>
        <div style={head}>
          <button style={recalc} onClick={onRecalculate}>↻ Recalculate</button>
          <span style={{ fontSize: 16, fontWeight: 700, flex: 1, color: 'var(--text-primary)' }}>Pricing</span>
          <span style={{ color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 16 }} onClick={onClose}>✕</span>
        </div>
        <div style={{ overflow: 'auto', padding: '10px 12px' }}>
          <div style={colHead}><span>Item</span><span>Price</span></div>
          {inputRow('Cost / Hr', 'costPerHr', pricing.costPerHr)}
          {inputRow('Pos / Hr', 'posRate', pricing.posRate)}
          {roRow('Flight Time', fmtHrs(pricing.hours))}
          {dollarRow('Flight Time Cost', 'flightCost', pricing.overrides?.flightCost ?? live.flightCost)}
          {roRow('Flight Base Cost', usd(live.flightCost), { subtotal: true })}
          {roRow('Effective Hourly', usd(live.effectiveHourly), { accent: true })}

          <div style={sectionLbl}>Additional</div>
          {dollarRow('Fuel Surcharge', 'surcharge', pricing.overrides?.surcharge ?? live.surcharge)}
          {dollarRow('Landings', 'landingCost', pricing.overrides?.landingCost ?? live.landingCost)}
          {inputRow('RON Days', 'nights', pricing.nights)}
          {dollarRow('RON Cost', 'overnightCost', pricing.overrides?.overnightCost ?? live.overnightCost)}
          {inputRow('FA Days', 'faCount', pricing.faCount)}
          {dollarRow('FA Cost', 'faCost', pricing.overrides?.faCost ?? live.faCost)}
          {inputRow('Crew Days', 'crewCount', pricing.crewCount)}
          {dollarRow('Crew Cost', 'crewCost', pricing.overrides?.crewCost ?? live.crewCost)}
          {dollarRow('Segment', 'segmentFee', pricing.overrides?.segmentFee ?? live.segmentFee)}

          <div style={row}>
            <span style={rl}><input type="checkbox" checked={pricing.fetEnabled !== false}
              onChange={(e) => onPatch({ fetEnabled: e.target.checked })} /> FET ({Math.round((pricing.fetRate || 0) * 1000) / 10}%)</span>
            <span style={{ ...rv, color: 'var(--text-secondary)' }}>{usd(live.fetAmount)}</span>
          </div>

          {(pricing.fees || []).map((f, idx) => (
            <div style={row} key={`fee${idx}`}>
              <span style={rl}>
                <select value={f.code || ''} style={selInp}
                  onChange={(e) => onPatch({ fees: pricing.fees.map((x, i) => (i === idx ? { ...x, code: e.target.value } : x)) })}>
                  {FEE_CODES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <label style={{ fontSize: 11, marginLeft: 6 }}><input type="checkbox" checked={!!f.taxable}
                  onChange={(e) => onPatch({ fees: pricing.fees.map((x, i) => (i === idx ? { ...x, taxable: e.target.checked } : x)) })} /> tax</label>
              </span>
              <span style={rv}><input type="number" value={f.amount} style={numInp}
                onChange={(e) => onPatch({ fees: pricing.fees.map((x, i) => (i === idx ? { ...x, amount: e.target.value } : x)) })} /></span>
            </div>
          ))}
          <div style={row}>
            <button style={addFee} onClick={() => onPatch({ fees: [...(pricing.fees || []), { code: FEE_CODES[0], description: '', amount: 0, taxable: true }] })}>+ Add fee</button>
          </div>

          <div style={{ ...row, ...rowTotal }}>
            <span style={{ ...rl, fontWeight: 800 }}>Total Price</span>
            <span style={rv}>
              <input type="number" value={pricing.totalOverride ?? ''} placeholder={String(live.computedTotal)} style={{ ...numInp, fontWeight: 800, width: 100 }}
                onChange={(e) => onPatch({ totalOverride: e.target.value === '' ? null : e.target.value })} />
              {pricing.totalOverride != null && <button style={resetBtn} title="Clear override" onClick={() => onPatch({ totalOverride: null })}>↺</button>}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

const overlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 50, display: 'flex', justifyContent: 'flex-end' };
const drawer = { width: 400, maxWidth: '92vw', background: 'var(--bg-card)', borderLeft: '1px solid var(--border)', boxShadow: '-12px 0 28px rgba(0,0,0,.5)', display: 'flex', flexDirection: 'column' };
const head = { display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' };
const recalc = { display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer' };
const colHead = { display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: 'var(--bg-secondary)', borderRadius: 8, fontSize: 11, letterSpacing: '.06em', color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: 8 };
const row = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 9, marginBottom: 7, background: 'var(--bg-secondary)' };
const rowPinned = { borderColor: 'var(--accent)' };
const rowSub = { background: '#23232e', borderColor: '#33333f' };
const rowTotal = { border: '1px solid var(--accent)' };
const rl = { fontSize: 13, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 6 };
const rv = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' };
const numInp = { width: 90, textAlign: 'right', padding: '5px 8px', fontSize: 13, background: '#0d0d12', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 6 };
const selInp = { padding: '4px 6px', fontSize: 12, background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 6 };
const sectionLbl = { fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-secondary)', margin: '16px 0 8px' };
const dot = { color: 'var(--accent)', fontSize: 9 };
const resetBtn = { padding: '2px 7px', fontSize: 12, background: 'var(--bg-card)', color: 'var(--text-secondary)', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer' };
const addFee = { padding: '4px 12px', fontSize: 12, background: 'var(--bg-card)', color: 'var(--accent)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer' };
