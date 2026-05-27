import { useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

// Reactive filter bar for a list of flight "legs". Owns URL state so the
// selection survives refresh and copy-paste. Pure presentational — the
// parent passes `legs`, this component computes the filtered/limited
// slice and emits it via onChange. No Apply button; every change is live.
//
// URL params (no prefix — each page has its own URL):
//   range = upcoming | past | next7 | next30 | thisMonth | thisYear | all | custom
//   from  = datetime-local string  (only when range=custom)
//   to    = datetime-local string  (only when range=custom)
//   limit = 25 | 50 | 100 | all
//
// Defaults: range=upcoming, limit=50.

const DEFAULT_RANGE = 'upcoming';
const DEFAULT_LIMIT = '50';

const RANGES = [
  { key: 'upcoming',  label: 'Upcoming' },
  { key: 'past',      label: 'Past' },
  { key: 'next7',     label: 'Next 7 days' },
  { key: 'next30',    label: 'Next 30 days' },
  { key: 'thisMonth', label: 'This month' },
  { key: 'thisYear',  label: 'This year' },
  { key: 'all',       label: 'All time' },
  { key: 'custom',    label: 'Custom' },
];

const LIMITS = ['25', '50', '100', 'all'];
const DAY_MS = 86400000;

// Convert a range key (plus optional from/to for custom) into ms bounds.
// Returns { startMs, endMs } where endMs===Infinity means "no upper bound."
// Exported for unit tests.
export function rangeToWindow(range, from, to, now = Date.now()) {
  switch (range) {
    case 'upcoming': return { startMs: now, endMs: Infinity };
    case 'past':     return { startMs: 0,   endMs: now };
    case 'next7':    return { startMs: now, endMs: now + 7 * DAY_MS };
    case 'next30':   return { startMs: now, endMs: now + 30 * DAY_MS };
    case 'thisMonth': {
      const d = new Date(now);
      const start = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
      const end   = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime() - 1;
      return { startMs: start, endMs: end };
    }
    case 'thisYear': {
      const d = new Date(now);
      const start = new Date(d.getFullYear(), 0, 1).getTime();
      const end   = new Date(d.getFullYear() + 1, 0, 1).getTime() - 1;
      return { startMs: start, endMs: end };
    }
    case 'all':      return { startMs: 0, endMs: Infinity };
    case 'custom': {
      const f = from ? Date.parse(from) : NaN;
      const t = to   ? Date.parse(to)   : NaN;
      return {
        startMs: Number.isFinite(f) ? f : 0,
        endMs:   Number.isFinite(t) ? t : Infinity,
      };
    }
    default: return { startMs: now, endMs: Infinity };
  }
}

const btnBase = {
  padding: '6px 14px', fontSize: '12px',
  borderRadius: '8px', cursor: 'pointer',
  whiteSpace: 'nowrap',
};
const btnActive = {
  ...btnBase, fontWeight: 600,
  background: 'var(--accent)', color: '#fff',
  border: '1px solid var(--accent)',
};
const btnIdle = {
  ...btnBase, fontWeight: 400,
  background: 'var(--bg-card)', color: 'var(--text-secondary)',
  border: '1px solid var(--border)',
};

const selectStyle = {
  padding: '6px 10px', fontSize: '12px',
  background: 'var(--bg-card)', border: '1px solid var(--border)',
  borderRadius: '8px', color: 'var(--text-primary)',
};
const dateInputStyle = {
  ...selectStyle,
  padding: '6px 10px',
};

export default function FlightsFilterBar({ legs, onChange }) {
  const [params, setParams] = useSearchParams();
  const range = params.get('range') || DEFAULT_RANGE;
  const from  = params.get('from')  || '';
  const to    = params.get('to')    || '';
  const limit = params.get('limit') || DEFAULT_LIMIT;

  // Read/write params without trampling other params on the URL.
  const setParam = (key, value, fallback) => {
    const next = new URLSearchParams(params);
    if (!value || value === fallback) next.delete(key);
    else next.set(key, value);
    // Drop custom-only params when leaving the custom range.
    if (key === 'range' && value !== 'custom') {
      next.delete('from');
      next.delete('to');
    }
    setParams(next, { replace: true });
  };

  const filtered = useMemo(() => {
    const { startMs, endMs } = rangeToWindow(range, from, to);
    const inRange = (Array.isArray(legs) ? legs : []).filter((l) => {
      const t = l?.departure?.time;
      if (typeof t !== 'number') return false;
      return t >= startMs && t <= endMs;
    });
    if (limit === 'all') return inRange;
    const n = parseInt(limit, 10);
    return Number.isFinite(n) ? inRange.slice(0, n) : inRange;
  }, [legs, range, from, to, limit]);

  // Push the filtered slice to the parent whenever it changes.
  useEffect(() => { onChange?.(filtered); }, [filtered, onChange]);

  return (
    <div style={{ marginBottom: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {RANGES.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setParam('range', key, DEFAULT_RANGE)}
              style={range === key ? btnActive : btnIdle}
            >
              {label}
            </button>
          ))}
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <label style={{ fontSize: '11px', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Show</label>
          <select
            value={limit}
            onChange={(e) => setParam('limit', e.target.value, DEFAULT_LIMIT)}
            style={selectStyle}
          >
            {LIMITS.map((v) => (
              <option key={v} value={v}>{v === 'all' ? 'All' : v}</option>
            ))}
          </select>
        </div>
      </div>

      {range === 'custom' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '10px', flexWrap: 'wrap' }}>
          <label style={{ fontSize: '11px', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>From</label>
          <input
            type="datetime-local"
            value={from}
            onChange={(e) => setParam('from', e.target.value)}
            style={dateInputStyle}
          />
          <label style={{ fontSize: '11px', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>To</label>
          <input
            type="datetime-local"
            value={to}
            onChange={(e) => setParam('to', e.target.value)}
            style={dateInputStyle}
          />
        </div>
      )}
    </div>
  );
}
