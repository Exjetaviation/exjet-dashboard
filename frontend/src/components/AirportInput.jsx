import { useState, useEffect, useRef } from 'react';
import { apiFetch } from '../lib/api';

// Airport picker for the New Quote From/To fields. Uppercases as you type, queries
// the backend for matching airports (debounced), shows a name/city dropdown to pick
// from, and flags whether the current value is a known, quotable airport code.
//
// Props:
//   value       current code (uppercase)
//   onChange    (code) => void
//   placeholder placeholder text
//   inputStyle  base input style object (merged)
//   autoFocus   focus on mount
export default function AirportInput({ value = '', onChange, placeholder, inputStyle, autoFocus }) {
  const [results, setResults] = useState([]);   // matches for `resultsFor`
  const [resultsFor, setResultsFor] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);      // highlighted row index
  const [focused, setFocused] = useState(false);
  const boxRef = useRef(null);
  const blurTimer = useRef(null);
  const selectedCode = useRef(null);   // last value chosen from the dropdown — don't auto-reopen for it

  const code = (value || '').trim().toUpperCase();
  // Trust results only when they were fetched for the current value.
  const matches = resultsFor === code ? results : [];
  const known = matches.some((r) => r.code === code);
  const showInvalid = !focused && code.length >= 3 && resultsFor === code && !known;

  // Debounced search whenever the typed value changes (while the field is in use).
  useEffect(() => {
    if (!focused) return;
    if (code.length < 2) { setResults([]); setResultsFor(code); setOpen(false); return; }
    const timer = setTimeout(async () => {
      try {
        const r = await apiFetch(`/api/scheduling/airport-search?q=${encodeURIComponent(code)}`);
        const j = await r.json();
        setResults(j.airports || []);
        setResultsFor(code);
        setActive(-1);
        setOpen(code !== selectedCode.current);   // refetch validates the pick, but don't reopen the menu
      } catch { setResults([]); setResultsFor(code); }
    }, 250);
    return () => clearTimeout(timer);
  }, [code, focused]);

  const select = (item) => {
    selectedCode.current = item.code;
    onChange(item.code);
    setOpen(false);
    setActive(-1);
    if (blurTimer.current) clearTimeout(blurTimer.current);
  };

  const onKeyDown = (e) => {
    if (!open || !matches.length) {
      if (e.key === 'ArrowDown' && matches.length) setOpen(true);
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, matches.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); select(matches[active]); }
    else if (e.key === 'Escape') { setOpen(false); setActive(-1); }
  };

  const borderColor = known ? 'var(--accent)' : showInvalid ? '#f59e0b' : undefined;
  const mergedStyle = {
    ...inputStyle,
    textTransform: 'uppercase',
    paddingRight: known || showInvalid ? 26 : (inputStyle?.padding ? undefined : 10),
    ...(borderColor ? { borderColor } : {}),
  };

  return (
    <div ref={boxRef} style={{ position: 'relative' }}>
      <input
        value={value}
        autoFocus={autoFocus}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        style={mergedStyle}
        onChange={(e) => { selectedCode.current = null; onChange(e.target.value.toUpperCase()); }}
        onFocus={() => { setFocused(true); if (matches.length && code !== selectedCode.current) setOpen(true); }}
        onBlur={() => { blurTimer.current = setTimeout(() => { setFocused(false); setOpen(false); }, 120); }}
        onKeyDown={onKeyDown}
      />
      {(known || showInvalid) && (
        <span style={{ position: 'absolute', right: 9, top: '50%', transform: 'translateY(-50%)', fontSize: 12, color: known ? 'var(--accent)' : '#f59e0b', pointerEvents: 'none' }}>
          {known ? '✓' : '?'}
        </span>
      )}
      {open && matches.length > 0 && (
        <div style={{ position: 'absolute', zIndex: 20, top: 'calc(100% + 4px)', left: 0, right: 0, minWidth: 240, maxHeight: 240, overflowY: 'auto', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.35)' }}>
          {matches.map((m, i) => (
            <div
              key={m.code}
              onMouseDown={(e) => { e.preventDefault(); select(m); }}
              onMouseEnter={() => setActive(i)}
              style={{ padding: '7px 10px', cursor: 'pointer', background: i === active ? 'var(--bg-secondary)' : 'transparent', borderBottom: i < matches.length - 1 ? '1px solid var(--border)' : 'none' }}
            >
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)' }}>{m.code}</span>
              {m.name && (
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  {' — '}{m.name}{m.city ? `, ${m.city}` : ''}{m.region ? ` ${m.region}` : ''}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
