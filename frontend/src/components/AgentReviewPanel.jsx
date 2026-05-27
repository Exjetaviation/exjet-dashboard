import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { apiFetch } from '../lib/api';

// Side panel that streams a flight readiness review and supports follow-up
// questions. Backend streams NDJSON events from /api/agent/review and
// /api/agent/chat — we render a live activity feed while the agent works,
// then a structured checklist when it calls render_review.
//
// Event types we handle:
//   { type: 'iteration', n }
//   { type: 'tool_start', name, input }
//   { type: 'tool_complete', name, status: 'ok'|'error', ms, error? }
//   { type: 'final', review|null, text|null, toolCalls, grounding, reviewId }
//   { type: 'error', message }   (backend signaled agent failure mid-stream)

const PANEL_WIDTH = 640;

const STATUS_META = {
  clean:     { icon: '✓', color: 'var(--success, #22c55e)', label: 'Clean'     },
  watch:     { icon: '⚠', color: 'var(--warning, #f59e0b)', label: 'Watch'     },
  action:    { icon: '✗', color: 'var(--danger)',           label: 'Action'    },
  uncertain: { icon: '?', color: 'var(--text-secondary)',   label: 'Uncertain' },
};

const TOOL_LABELS = {
  list_flights: 'Flight list',
  get_flight: 'Flight record',
  get_performance: 'Performance',
  get_runway_analysis: 'Runway analysis',
  get_weather_briefing: 'Weather briefing',
  get_airport_weather: 'Airport weather',
  list_aircraft: 'Fleet list',
  get_aircraft: 'Aircraft record',
  get_aircraft_compliance: 'Aircraft compliance',
  get_crew_availability: 'Crew availability',
  get_airport_safety_history: 'Airport safety history',
  render_review: 'Compiling review',
};

// Fixed display order and titles for the six checks. The model supplies
// titles too — we prefer those, falling back to these so a missing or odd
// title never derails the layout.
const CHECK_ORDER = [
  { id: 'crew',                 title: 'Crew' },
  { id: 'compliance',           title: 'Aircraft compliance' },
  { id: 'weather',              title: 'Weather' },
  { id: 'airport_runway',       title: 'Airport & runway' },
  { id: 'performance',          title: 'Performance' },
  { id: 'airport_intelligence', title: 'Airport intelligence' },
];

function formatAge(timestamp) {
  if (!timestamp) return '';
  const t = typeof timestamp === 'string' ? Date.parse(timestamp) : timestamp;
  if (!Number.isFinite(t)) return '';
  const diff = Date.now() - t;
  if (diff < 60_000) return 'just now';
  const min = Math.round(diff / 60_000);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return new Date(t).toLocaleDateString();
}

// Turn a saved toolCalls array (no per-tool ms timing) into the same shape
// the live activity feed uses, so the collapsed Activity log reads the
// same whether we just streamed it or loaded it from the database.
function toolCallsToActivity(toolCalls) {
  if (!Array.isArray(toolCalls)) return [];
  return toolCalls
    .filter((c) => c.name !== 'render_review')
    .map((c) => ({
      name: c.name,
      input: c.input,
      status: c.result?.error ? 'error' : 'ok',
      ...(c.result?.error ? { error: c.result.error } : {}),
    }));
}

function describeToolCall(name, input) {
  const label = TOOL_LABELS[name] || name;
  if (!input || typeof input !== 'object') return label;
  if (name === 'get_airport_weather' && Array.isArray(input.icaos) && input.icaos.length) {
    return `${label} · ${input.icaos.join(', ')}`;
  }
  if (name === 'get_aircraft_compliance' && input.tail) return `${label} · ${input.tail}`;
  if (name === 'get_airport_safety_history' && input.icao) return `${label} · ${input.icao}`;
  if (name === 'get_aircraft' && input.tail_or_id) return `${label} · ${input.tail_or_id}`;
  if (name === 'list_flights' && input.tail) return `${label} · ${input.tail}`;
  return label;
}

const styles = {
  backdrop: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
    zIndex: 90, animation: 'agentFadeIn 120ms ease-out',
  },
  panel: {
    position: 'fixed', top: 0, right: 0, bottom: 0, width: PANEL_WIDTH, maxWidth: '95vw',
    background: 'var(--bg-card)', borderLeft: '1px solid var(--border)',
    zIndex: 91, display: 'flex', flexDirection: 'column',
    boxShadow: '-10px 0 30px rgba(0,0,0,0.35)',
  },
  header: {
    padding: '16px 20px', borderBottom: '1px solid var(--border)',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px',
  },
  headerActions: {
    display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap',
    justifyContent: 'flex-end',
  },
  savedAtChip: {
    fontSize: '11px', color: 'var(--text-secondary)',
    background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)',
    borderRadius: '6px', padding: '4px 8px', whiteSpace: 'nowrap',
  },
  body: { flex: 1, overflowY: 'auto', padding: '20px' },
  tabStrip: {
    display: 'flex', alignItems: 'center', gap: '4px',
    padding: '8px 16px', borderBottom: '1px solid var(--border)',
    overflowX: 'auto', whiteSpace: 'nowrap',
    background: 'var(--bg-card)',
  },
  tab: {
    padding: '6px 12px', fontSize: '12px',
    background: 'transparent', color: 'var(--text-secondary)',
    border: '1px solid transparent', borderRadius: '6px',
    cursor: 'pointer', whiteSpace: 'nowrap',
  },
  tabActive: {
    padding: '6px 12px', fontSize: '12px', fontWeight: 600,
    background: 'rgba(79,142,247,0.12)', color: 'var(--accent)',
    border: '1px solid rgba(79,142,247,0.35)', borderRadius: '6px',
    cursor: 'pointer', whiteSpace: 'nowrap',
  },
  tabNew: {
    padding: '6px 12px', fontSize: '12px',
    background: 'transparent', color: 'var(--accent)',
    border: '1px dashed rgba(79,142,247,0.45)', borderRadius: '6px',
    cursor: 'pointer', whiteSpace: 'nowrap',
  },
  regenBtn: {
    background: 'transparent', border: '1px solid var(--accent)',
    color: 'var(--accent)', borderRadius: '8px',
    padding: '6px 12px', fontSize: '13px', cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  closeBtn: {
    background: 'transparent', border: '1px solid var(--border)',
    color: 'var(--text-secondary)', borderRadius: '8px',
    padding: '6px 12px', fontSize: '13px', cursor: 'pointer',
  },
  // Live activity feed (during stream).
  activityFeed: {
    margin: '4px 0 16px',
    display: 'flex', flexDirection: 'column', gap: '6px',
  },
  activityRow: {
    display: 'flex', alignItems: 'center', gap: '10px',
    fontSize: '13px', color: 'var(--text-secondary)',
    padding: '6px 0',
  },
  activityIcon: { width: 16, display: 'inline-flex', justifyContent: 'center', fontSize: '13px' },
  activityName: { color: 'var(--text-primary)' },
  activityMs: { fontSize: '11px', color: 'var(--text-secondary)', marginLeft: 'auto' },
  activityError: { fontSize: '12px', color: 'var(--danger)', marginLeft: '6px' },
  // Overall summary block.
  summaryBlock: {
    display: 'flex', gap: '14px', alignItems: 'flex-start',
    padding: '16px', borderRadius: '10px',
    background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)',
    marginBottom: '16px',
  },
  summaryIcon: { fontSize: '22px', lineHeight: 1, marginTop: '2px' },
  summaryTextWrap: { flex: 1 },
  summaryStatusLabel: {
    fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em',
    fontWeight: 600,
  },
  summaryText: {
    fontSize: '13.5px', color: 'var(--text-primary)', lineHeight: 1.55, marginTop: '4px',
  },
  // Checklist rows.
  checkRow: {
    border: '1px solid var(--border)', borderRadius: '8px',
    marginBottom: '8px', background: 'rgba(255,255,255,0.02)',
    overflow: 'hidden',
  },
  checkRowHead: {
    display: 'flex', alignItems: 'center', gap: '12px',
    padding: '12px 14px', cursor: 'pointer', userSelect: 'none',
  },
  checkRowIcon: {
    width: 22, height: 22, borderRadius: '50%',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    fontSize: '13px', fontWeight: 700, flexShrink: 0,
  },
  checkRowTitle: {
    fontSize: '13.5px', color: 'var(--text-primary)', fontWeight: 600,
  },
  checkRowHeadline: {
    fontSize: '12.5px', color: 'var(--text-secondary)', marginTop: '2px',
  },
  checkRowChevron: {
    color: 'var(--text-secondary)', fontSize: '14px', transition: 'transform 120ms ease',
  },
  checkRowBody: {
    padding: '4px 14px 14px 48px',
    borderTop: '1px solid var(--border)',
    fontSize: '13px', color: 'var(--text-primary)', lineHeight: 1.55,
  },
  checkRowCaveats: {
    marginTop: '12px', padding: '10px 12px',
    background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.25)',
    borderRadius: '6px',
  },
  checkRowCaveatsTitle: {
    fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em',
    color: 'var(--warning, #f59e0b)', fontWeight: 600, marginBottom: '4px',
  },
  // General caveats block (below the rows).
  generalCaveats: {
    marginTop: '14px', padding: '12px 14px',
    background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)',
    borderRadius: '8px',
  },
  generalCaveatsTitle: {
    fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em',
    color: 'var(--text-secondary)', fontWeight: 600, marginBottom: '6px',
  },
  generalCaveatsList: { paddingLeft: '18px', margin: 0, fontSize: '12.5px', color: 'var(--text-secondary)', lineHeight: 1.6 },
  // Activity log (collapsed under the review).
  activityLog: {
    marginTop: '16px', padding: '8px 10px',
    background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)',
    borderRadius: '8px', fontSize: '12px',
  },
  activityLogHead: {
    display: 'flex', alignItems: 'center', gap: '8px',
    color: 'var(--text-secondary)', cursor: 'pointer', userSelect: 'none',
  },
  // Follow-up reply.
  reply: { marginTop: '20px' },
  replyQuestion: {
    fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px',
    textTransform: 'uppercase', letterSpacing: '0.05em',
  },
  replyBody: { fontSize: '13.5px', color: 'var(--text-primary)', lineHeight: 1.6 },
  // Meta row (tool chips + grounding).
  metaRow: {
    display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap',
    marginTop: '12px', paddingTop: '12px', borderTop: '1px dashed var(--border)',
  },
  toolChip: {
    fontSize: '11px', color: 'var(--text-secondary)',
    background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)',
    borderRadius: '6px', padding: '2px 8px',
  },
  toolChipError: {
    fontSize: '11px', color: 'var(--danger)',
    background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)',
    borderRadius: '6px', padding: '2px 8px',
  },
  groundingOk: {
    fontSize: '11px', color: 'var(--success, #22c55e)',
    background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.3)',
    borderRadius: '6px', padding: '2px 8px',
  },
  groundingWarn: {
    fontSize: '11px', color: 'var(--warning, #f59e0b)',
    background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.35)',
    borderRadius: '6px', padding: '2px 8px',
  },
  // Footer (input).
  footer: {
    borderTop: '1px solid var(--border)', padding: '12px 16px',
    display: 'flex', gap: '8px', background: 'var(--bg-card)',
  },
  input: {
    flex: 1, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)',
    borderRadius: '8px', padding: '10px 12px', color: 'var(--text-primary)',
    fontSize: '13px', outline: 'none',
  },
  button: {
    background: 'var(--accent)', color: '#fff', border: 'none',
    borderRadius: '8px', padding: '10px 18px', fontSize: '13px', fontWeight: 500,
    cursor: 'pointer',
  },
  buttonDisabled: { opacity: 0.5, cursor: 'not-allowed' },
  errorBox: {
    background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
    color: 'var(--danger)', borderRadius: '8px', padding: '12px 14px',
    fontSize: '13px', marginTop: '12px',
  },
};

// Markdown overrides — match the dashboard's visual language.
const md = {
  h1: ({ children }) => <h3 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', margin: '14px 0 8px' }}>{children}</h3>,
  h2: ({ children }) => <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '14px 0 8px' }}>{children}</h3>,
  h3: ({ children }) => <h4 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', margin: '10px 0 6px' }}>{children}</h4>,
  p:  ({ children }) => <p style={{ margin: '6px 0' }}>{children}</p>,
  ul: ({ children }) => <ul style={{ paddingLeft: '20px', margin: '6px 0' }}>{children}</ul>,
  ol: ({ children }) => <ol style={{ paddingLeft: '20px', margin: '6px 0' }}>{children}</ol>,
  li: ({ children }) => <li style={{ margin: '3px 0' }}>{children}</li>,
  strong: ({ children }) => <strong style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{children}</strong>,
  // react-markdown v9+ dropped the `inline` prop. Detect a fenced block by
  // the `language-*` className it sets on highlighted code; everything else
  // is inline. Rendering <pre> for inline code nests <pre> inside <p>,
  // which throws a React hydration warning.
  code: ({ className, children, ...props }) => {
    const isBlock = /(^|\s)language-/.test(className || '');
    return isBlock
      ? <pre style={{ background: 'rgba(255,255,255,0.04)', padding: '10px', borderRadius: '6px', overflowX: 'auto', fontSize: '12px', margin: '6px 0' }}><code className={className} {...props}>{children}</code></pre>
      : <code style={{ background: 'rgba(255,255,255,0.06)', padding: '1px 5px', borderRadius: '4px', fontSize: '12px' }} {...props}>{children}</code>;
  },
  a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer noopener" style={{ color: 'var(--accent)', wordBreak: 'break-all' }}>{children}</a>,
  table: ({ children }) => <div style={{ overflowX: 'auto', margin: '8px 0' }}><table style={{ borderCollapse: 'collapse', fontSize: '12px', width: '100%' }}>{children}</table></div>,
  th: ({ children }) => <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--border)', color: 'var(--text-secondary)', fontWeight: 500, textTransform: 'uppercase', fontSize: '11px', letterSpacing: '0.04em' }}>{children}</th>,
  td: ({ children }) => <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)' }}>{children}</td>,
};

// Drain an NDJSON stream from a fetch Response, dispatching parsed events.
// Throws on network / non-NDJSON failures so the caller can surface them.
async function readNdjson(res, onEvent) {
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json())?.error || ''; } catch { /* not JSON */ }
    throw new Error(`${res.status} ${res.statusText}${detail ? ` — ${detail}` : ''}`);
  }
  const ct = (res.headers.get('content-type') || '').toLowerCase();
  if (!ct.includes('application/x-ndjson')) {
    // Backend chose to reply non-streaming (e.g. legacy). Treat the whole
    // body as one final-shaped object so the UI still progresses.
    const data = await res.json();
    onEvent({ type: 'final', ...data });
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const flushLine = (line) => {
    const s = line.trim();
    if (!s) return;
    try { onEvent(JSON.parse(s)); } catch (e) { console.warn('bad NDJSON line', s, e); }
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      flushLine(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
    }
  }
  if (buffer) flushLine(buffer);
}

function StatusPill({ status }) {
  const meta = STATUS_META[status] || STATUS_META.uncertain;
  return (
    <span style={{ ...styles.checkRowIcon, color: meta.color, border: `1.5px solid ${meta.color}`, background: 'transparent' }}>
      {meta.icon}
    </span>
  );
}

function CheckRow({ check, fallbackTitle }) {
  const [open, setOpen] = useState(false);
  const status = check?.status || 'uncertain';
  const title = check?.title || fallbackTitle;
  const headline = check?.headline || '(no headline)';
  return (
    <div style={styles.checkRow}>
      <div style={styles.checkRowHead} onClick={() => setOpen((o) => !o)}>
        <StatusPill status={status} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={styles.checkRowTitle}>{title}</div>
          <div style={styles.checkRowHeadline}>{headline}</div>
        </div>
        <span style={{ ...styles.checkRowChevron, transform: open ? 'rotate(90deg)' : 'rotate(0)' }}>›</span>
      </div>
      {open && (
        <div style={styles.checkRowBody}>
          {check?.evidence
            ? <ReactMarkdown remarkPlugins={[remarkGfm]} components={md}>{check.evidence}</ReactMarkdown>
            : <em style={{ color: 'var(--text-secondary)' }}>No evidence provided.</em>}
          {Array.isArray(check?.caveats) && check.caveats.length > 0 && (
            <div style={styles.checkRowCaveats}>
              <div style={styles.checkRowCaveatsTitle}>Caveats</div>
              <ul style={{ paddingLeft: '18px', margin: 0 }}>
                {check.caveats.map((c, i) => <li key={i} style={{ margin: '3px 0' }}>{c}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ChecklistView({ review }) {
  const byId = new Map((review?.checks || []).map((c) => [c.id, c]));
  const overall = STATUS_META[review?.overall_status] || STATUS_META.uncertain;
  return (
    <>
      <div style={styles.summaryBlock}>
        <span style={{ ...styles.summaryIcon, color: overall.color }}>{overall.icon}</span>
        <div style={styles.summaryTextWrap}>
          <div style={{ ...styles.summaryStatusLabel, color: overall.color }}>{overall.label}</div>
          <div style={styles.summaryText}>{review?.summary || '(no summary provided)'}</div>
        </div>
      </div>
      <div>
        {CHECK_ORDER.map(({ id, title }) => (
          <CheckRow key={id} check={byId.get(id)} fallbackTitle={title} />
        ))}
      </div>
      {Array.isArray(review?.global_caveats) && review.global_caveats.length > 0 && (
        <div style={styles.generalCaveats}>
          <div style={styles.generalCaveatsTitle}>General caveats</div>
          <ul style={styles.generalCaveatsList}>
            {review.global_caveats.map((c, i) => <li key={i}>{c}</li>)}
          </ul>
        </div>
      )}
    </>
  );
}

function ActivityFeed({ activity }) {
  if (!activity?.length) return null;
  return (
    <div style={styles.activityFeed}>
      {activity.map((a, i) => {
        const meta = a.status === 'ok'    ? { icon: '✓', color: 'var(--success, #22c55e)' }
                   : a.status === 'error' ? { icon: '✗', color: 'var(--danger)' }
                   :                        { icon: '▸', color: 'var(--accent)' };
        return (
          <div key={i} style={styles.activityRow}>
            <span style={{ ...styles.activityIcon, color: meta.color }}>{meta.icon}</span>
            <span style={styles.activityName}>{describeToolCall(a.name, a.input)}</span>
            {a.status === 'running' && <span style={{ color: 'var(--text-secondary)' }}>…</span>}
            {a.status === 'error' && a.error && <span style={styles.activityError}>{a.error}</span>}
            {typeof a.ms === 'number' && <span style={styles.activityMs}>{a.ms}ms</span>}
          </div>
        );
      })}
    </div>
  );
}

function ActivityLog({ activity }) {
  const [open, setOpen] = useState(false);
  if (!activity?.length) return null;
  return (
    <div style={styles.activityLog}>
      <div style={styles.activityLogHead} onClick={() => setOpen((o) => !o)}>
        <span style={{ transition: 'transform 120ms', transform: open ? 'rotate(90deg)' : 'rotate(0)' }}>›</span>
        Activity log ({activity.length} {activity.length === 1 ? 'tool' : 'tools'})
      </div>
      {open && <div style={{ marginTop: '8px' }}><ActivityFeed activity={activity} /></div>}
    </div>
  );
}

function ToolChips({ toolCalls }) {
  if (!toolCalls?.length) return <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>no tools called</span>;
  return toolCalls.map((c, i) => (
    <span key={i} style={c.result?.error ? styles.toolChipError : styles.toolChip} title={c.result?.error || JSON.stringify(c.input)}>
      {c.result?.error ? '✗ ' : '✓ '}{c.name}
    </span>
  ));
}

function Grounding({ g }) {
  if (!g) return null;
  if (g.grounded) {
    const t = g.checked?.tails?.length || 0;
    const i = g.checked?.icaos?.length || 0;
    return <span style={styles.groundingOk}>✓ all sources verified ({t} tail / {i} ICAO)</span>;
  }
  const items = (g.unverified || []).map((u) => `${u.value} (${u.type})`).join(', ');
  return <span style={styles.groundingWarn}>⚠ unverified: {items}</span>;
}

function MetaRow({ toolCalls, grounding }) {
  return (
    <div style={styles.metaRow}>
      <ToolChips toolCalls={toolCalls} />
      <Grounding g={grounding} />
    </div>
  );
}

export default function AgentReviewPanel({ flight, onClose }) {
  // `flight` is the minimum context the dashboard already has for a row:
  //   { tail, departure, destination, departureDate, flightId? }

  const [review, setReview] = useState(null);
  const [reviewMeta, setReviewMeta] = useState(null); // { toolCalls, grounding, activity, reviewId }
  const [savedAt, setSavedAt] = useState(null);       // ISO string or epoch ms
  const [replies, setReplies] = useState([]);         // [{ question, text, toolCalls, grounding, reviewId }]
  const [activity, setActivity] = useState([]);       // in-flight tool list
  const [loading, setLoading] = useState(true);
  const [streamKind, setStreamKind] = useState('review'); // 'review' | 'chat'
  const [pendingQuestion, setPendingQuestion] = useState(null);
  const [error, setError] = useState(null);
  const [followUp, setFollowUp] = useState('');
  const [conversation, setConversation] = useState([]); // [{role, content}] for /chat
  const [tabs, setTabs] = useState([]);                  // [{id, created_at, review}] of past reviews
  const [activeTabId, setActiveTabId] = useState(null);  // tab id | 'new' | null while listing
  const bodyRef = useRef(null);
  const startedRef = useRef(false);

  const kickoffSummary = () => `Readiness review — ${flight?.tail || ''} ${flight?.departure || ''}→${flight?.destination || ''}`.trim();

  // Update one in-flight activity entry (matched by name + earliest 'running')
  // when a tool_complete arrives.
  const markActivityComplete = (name, status, ms, errMsg) => {
    setActivity((prev) => {
      const next = [...prev];
      for (let i = 0; i < next.length; i++) {
        if (next[i].name === name && next[i].status === 'running') {
          next[i] = { ...next[i], status, ms, ...(errMsg ? { error: errMsg } : {}) };
          return next;
        }
      }
      return next;
    });
  };

  const handleEvent = (evt, { question }) => {
    if (!evt || typeof evt !== 'object') return;
    if (evt.type === 'tool_start') {
      if (evt.name === 'render_review') return;          // skip the pseudo-tool
      setActivity((prev) => [...prev, { name: evt.name, input: evt.input, status: 'running' }]);
      return;
    }
    if (evt.type === 'tool_complete') {
      if (evt.name === 'render_review') return;
      markActivityComplete(evt.name, evt.status, evt.ms, evt.error);
      return;
    }
    if (evt.type === 'iteration') {
      // Could surface iteration count, but the activity feed already gives
      // a tighter sense of progress. Keep this as a no-op for now.
      return;
    }
    if (evt.type === 'error') {
      setError(evt.message || 'Agent stream failed');
      return;
    }
    if (evt.type === 'final') {
      const { review: rev, text, toolCalls, grounding, reviewId } = evt;
      if (rev) {
        // Fresh review (initial or follow-up): replace the checklist.
        setActivity((curr) => {
          setReviewMeta({ toolCalls, grounding, activity: curr, reviewId });
          return [];
        });
        setReview(rev);
        setSavedAt(Date.now()); // backend persisted it; show "just now"
        // Append a tab for this freshly-streamed review so future clicks
        // can return to it without re-running the agent. Skip if reviewId
        // is null (Supabase wasn't configured / persistence soft-failed).
        if (reviewId) {
          const newTab = { id: reviewId, created_at: new Date().toISOString(), review: rev };
          setTabs((prev) => [newTab, ...prev.filter((t) => t.id !== reviewId)]);
          setActiveTabId(reviewId);
        }
        // Carry the model's reply forward for follow-up continuity. Use a
        // compact text rendering so the chat history isn't bloated.
        const synth = rev.summary || '(structured review)';
        setConversation((c) => {
          // If this was the initial review, seed the conversation; otherwise
          // append assistant turn.
          if (c.length === 0) {
            return [
              { role: 'user', content: question },
              { role: 'assistant', content: synth },
            ];
          }
          return [...c, { role: 'assistant', content: synth }];
        });
      } else if (text) {
        // Text reply (follow-up or fallback). Append to replies, do NOT
        // touch the existing checklist.
        setReplies((r) => [...r, { question, text, toolCalls, grounding, reviewId }]);
        setActivity([]);
        setConversation((c) => {
          if (c.length === 0) {
            return [
              { role: 'user', content: question },
              { role: 'assistant', content: text },
            ];
          }
          return [...c, { role: 'assistant', content: text }];
        });
      } else {
        // Degenerate: neither review nor text. Surface activity as an error.
        setError('Agent returned an empty final event.');
      }
      return;
    }
  };

  // Drive one streaming request through readNdjson. Handles loading flags,
  // error capture, and event dispatch. `question` is what to label this
  // turn with (used by final.text replies).
  const streamRequest = async (endpoint, body, question) => {
    setLoading(true);
    setError(null);
    setActivity([]);
    setPendingQuestion(question);
    try {
      let res;
      try {
        res = await apiFetch(endpoint, { method: 'POST', body: JSON.stringify(body) });
      } catch (networkErr) {
        throw new Error(`Network error: ${networkErr?.message || networkErr}`);
      }
      await readNdjson(res, (evt) => handleEvent(evt, { question }));
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
      setPendingQuestion(null);
    }
  };

  // Apply a saved review payload (from GET) to component state. Mirrors
  // what handleEvent does on a successful stream so the rendered output is
  // identical whether we generated or loaded.
  const applySavedReview = (saved) => {
    const { review: rev, toolCalls, grounding, reviewId, savedAt: ts } = saved || {};
    setReview(rev || null);
    setReviewMeta({ toolCalls, grounding, activity: toolCallsToActivity(toolCalls), reviewId });
    setSavedAt(ts || null);
    setConversation([
      { role: 'user', content: kickoffSummary() },
      { role: 'assistant', content: rev?.summary || '(structured review)' },
    ]);
    setActivity([]);
    setError(null);
    setLoading(false);
  };

  // Kick off a fresh streaming review (called on cache miss, and from
  // Generate again).
  const startReviewStream = () => {
    setStreamKind('review');
    streamRequest('/api/agent/review', flight, kickoffSummary());
  };

  // On mount: list every saved review whose kickoff matches this flight
  // context (tail + route + date). If we have any, auto-open the most
  // recent (matches the load-by-flightId behavior we replaced). If we
  // have none, start a fresh stream — same as before.
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    (async () => {
      const params = new URLSearchParams();
      if (flight?.tail) params.set('tail', flight.tail);
      if (flight?.departure) params.set('departure', flight.departure);
      if (flight?.destination) params.set('destination', flight.destination);
      if (flight?.departureDate) params.set('departureDate', flight.departureDate);

      // No filters at all → can't list; just stream.
      if ([...params.keys()].length === 0) {
        setActiveTabId('new');
        startReviewStream();
        return;
      }

      try {
        const res = await apiFetch(`/api/agent/reviews?${params.toString()}`);
        if (res.ok) {
          const { reviews = [] } = await res.json();
          if (reviews.length > 0) {
            setTabs(reviews);
            const latest = reviews[0];
            setActiveTabId(latest.id);
            applySavedReview({
              review: latest.review,
              toolCalls: [],
              grounding: null,
              reviewId: latest.id,
              savedAt: latest.created_at,
            });
            return;
          }
        }
        // Empty list / error → stream a fresh one.
      } catch {
        // Network blip — also fall through to a fresh stream.
      }
      setActiveTabId('new');
      startReviewStream();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flight]);

  // Generate Again / "+ New review": drop the cached review locally and
  // stream a fresh one. The backend writes a new row; the `final` handler
  // appends a tab for it on success.
  const regenerate = () => {
    if (loading) return;
    setActiveTabId('new');
    setReview(null);
    setReviewMeta(null);
    setSavedAt(null);
    setReplies([]);
    setConversation([]);
    setActivity([]);
    setError(null);
    startReviewStream();
  };

  // Click handler for a past tab — render its saved review without
  // running the agent. The list endpoint returns minimal rows; toolCalls
  // and grounding are absent and MetaRow / ActivityLog already tolerate
  // empty arrays / nulls.
  const selectTab = (tab) => {
    if (loading) return;
    setActiveTabId(tab.id);
    setReplies([]);
    applySavedReview({
      review: tab.review,
      toolCalls: [],
      grounding: null,
      reviewId: tab.id,
      savedAt: tab.created_at,
    });
  };

  // Compact "MMM D · HH:MM" label for a tab's created_at in local time.
  const tabLabel = (iso) => {
    if (!iso) return '—';
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return '—';
    const d = new Date(t);
    const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    return `${date} · ${time}`;
  };

  // Auto-scroll on new activity or reply.
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [activity.length, replies.length, loading, review]);

  const submitFollowUp = () => {
    const text = followUp.trim();
    if (!text || loading) return;
    setFollowUp('');
    const nextConvo = [...conversation, { role: 'user', content: text }];
    setConversation(nextConvo);
    setStreamKind('chat');
    streamRequest('/api/agent/chat', { messages: nextConvo, flightId: flight?.flightId || null }, text);
  };

  return (
    <>
      <div style={styles.backdrop} onClick={onClose} />
      <div style={styles.panel} role="dialog" aria-label="AI Readiness Review">
        <div style={styles.header}>
          <div>
            <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)' }}>AI Analysis</div>
            <div style={{ fontSize: '15px', color: 'var(--text-primary)', fontWeight: 600, marginTop: '2px' }}>
              {flight?.tail || '—'} · {flight?.departure || '—'} → {flight?.destination || '—'}
            </div>
          </div>
          <div style={styles.headerActions}>
            {review && savedAt && (
              <span style={styles.savedAtChip} title={typeof savedAt === 'string' ? savedAt : new Date(savedAt).toISOString()}>
                Saved {formatAge(savedAt)}
              </span>
            )}
            {review && (
              <button
                style={{ ...styles.regenBtn, ...(loading ? styles.buttonDisabled : null) }}
                onClick={regenerate}
                disabled={loading}
                title="Regenerate a fresh review (replaces the cached one)"
              >
                Generate again
              </button>
            )}
            <button style={styles.closeBtn} onClick={onClose}>Close</button>
          </div>
        </div>

        {(tabs.length > 0 || activeTabId === 'new') && (
          <div style={styles.tabStrip}>
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => selectTab(tab)}
                disabled={loading}
                style={activeTabId === tab.id ? styles.tabActive : styles.tab}
                title={new Date(tab.created_at).toLocaleString()}
              >
                {tabLabel(tab.created_at)}
              </button>
            ))}
            <button
              onClick={regenerate}
              disabled={loading}
              style={activeTabId === 'new' ? styles.tabActive : styles.tabNew}
              title="Run a fresh readiness review"
            >
              + New review
            </button>
          </div>
        )}

        <div style={styles.body} ref={bodyRef}>
          {/* The checklist (if we have one yet). */}
          {review && (
            <>
              <ChecklistView review={review} />
              {reviewMeta && <MetaRow toolCalls={reviewMeta.toolCalls} grounding={reviewMeta.grounding} />}
              {reviewMeta?.activity && <ActivityLog activity={reviewMeta.activity} />}
            </>
          )}

          {/* Follow-up text replies, in order. */}
          {replies.map((r, i) => (
            <div key={i} style={styles.reply}>
              <div style={styles.replyQuestion}>You · {r.question}</div>
              <div style={styles.replyBody}>
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={md}>{r.text || '(no answer)'}</ReactMarkdown>
              </div>
              <MetaRow toolCalls={r.toolCalls} grounding={r.grounding} />
            </div>
          ))}

          {/* Live activity feed while a stream is in-flight. */}
          {loading && (
            <div style={{ marginTop: review || replies.length ? '20px' : 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--text-secondary)', fontSize: '13px', marginBottom: '8px' }}>
                <span className="agent-spinner" style={{
                  width: 12, height: 12, borderRadius: '50%',
                  border: '2px solid var(--border)',
                  borderTopColor: 'var(--accent)',
                  animation: 'agentSpin 0.8s linear infinite',
                  display: 'inline-block',
                }} />
                {streamKind === 'review' && !review
                  ? `Running readiness review${pendingQuestion ? '' : '…'}`
                  : 'Thinking…'}
              </div>
              <ActivityFeed activity={activity} />
            </div>
          )}

          {error && (
            <div style={styles.errorBox}>{error}</div>
          )}
        </div>

        <div style={styles.footer}>
          <input
            style={styles.input}
            placeholder={loading ? 'Waiting for the agent…' : 'Ask a follow-up about this flight'}
            value={followUp}
            onChange={(e) => setFollowUp(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submitFollowUp(); }}
            disabled={loading}
          />
          <button
            style={{ ...styles.button, ...((loading || !followUp.trim()) ? styles.buttonDisabled : null) }}
            onClick={submitFollowUp}
            disabled={loading || !followUp.trim()}
          >
            Ask
          </button>
        </div>
      </div>

      <style>{`
        @keyframes agentFadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes agentSpin { from { transform: rotate(0) } to { transform: rotate(360deg) } }
      `}</style>
    </>
  );
}
