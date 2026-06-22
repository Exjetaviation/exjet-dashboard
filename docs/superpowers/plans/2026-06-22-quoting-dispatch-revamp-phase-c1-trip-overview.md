# Quoting → Dispatch Revamp — Phase C1 (Trip Overview shell) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Refactor `SchedulingTripDetail.jsx` into the approved LevelFlight-style **tabbed Trip Overview** — a Trip Info header + actions rail + `Legs · Fees · Crew · Pax · Documents` tabs — moving the existing sections under tabs **with their behavior unchanged**, and surfacing the already-loaded Quote#/Trip#, Purpose, Company→Contact, Rate, and Booked-by.

**Architecture:** Three small presentational components (`TripTabs`, `TripInfoCard`, `TripActionsRail`) + a render-structure refactor of `SchedulingTripDetail.jsx`. ALL existing state and handlers stay in `SchedulingTripDetail`; the new components are pure (props in, callbacks out). No backend changes. No behavior changes — this is a structural/visual reorganization. The richer Fees editor, FBO pickers, functional checklist, and native-quote view come in C2–C4.

**Tech Stack:** React + Vite, inline styles with the app's CSS variables (`--bg-card`, `--accent`, `--text-primary`, `--text-secondary`, `--border`, `--danger`). Verify with `cd frontend && npm run build`.

**Phase context:** C1 of Phase C (the foundation). Backend endpoints already exist (Phase A/B). The trip GET response already returns `quote_number, purpose, rate_name, company_name, contact{name,email,phone}, checklist, booked_by, booked_at, pricing{...}, status, actions[]` — C1 just renders the ones not yet shown.

**Mirror these existing patterns:** the tab pattern in `frontend/src/pages/Scheduling.jsx` (`SectionTab` buttons: accent color + 2px underline when active, conditional render per section); the `Section` card + inline-style conventions already in `SchedulingTripDetail.jsx`.

---

## File Structure

**Create:**
- `frontend/src/components/trip/TripTabs.jsx` — tab nav (id/label buttons, active underline).
- `frontend/src/components/trip/TripInfoCard.jsx` — read-only Trip Info (Aircraft · Company→Contact · Purpose · Rate · Created/Booked-by).
- `frontend/src/components/trip/TripActionsRail.jsx` — status pill + workflow action buttons + View Itinerary/Trip Sheet/Send-Itinerary.

**Modify:**
- `frontend/src/pages/SchedulingTripDetail.jsx` — render the two-column Overview (InfoCard + ActionsRail) + tab nav, and move the existing sections under tab panels. State/handlers unchanged.

---

## Task 1: TripTabs component

**Files:** Create `frontend/src/components/trip/TripTabs.jsx`

- [ ] **Step 1: Write the component**

```jsx
// Tab navigation for the Trip Overview. Mirrors the SectionTab pattern in
// pages/Scheduling.jsx (accent text + 2px underline when active).
export default function TripTabs({ tabs, active, onSelect }) {
  return (
    <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)', marginBottom: 16, flexWrap: 'wrap' }}>
      {tabs.map((t) => (
        <button key={t.id} onClick={() => onSelect(t.id)}
          style={{
            padding: '8px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer', background: 'none', border: 'none',
            color: active === t.id ? 'var(--accent)' : 'var(--text-secondary)',
            borderBottom: active === t.id ? '2px solid var(--accent)' : '2px solid transparent',
          }}>
          {t.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Build check**

Run: `cd frontend && npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/trip/TripTabs.jsx
git commit -m "feat(trip): tab navigation component"
```

---

## Task 2: TripInfoCard component

**Files:** Create `frontend/src/components/trip/TripInfoCard.jsx`

- [ ] **Step 1: Write the component** (read-only display of the trip's identity fields)

```jsx
// Read-only Trip Info panel for the Trip Overview. Renders the fields the trip GET
// already returns (purpose/company_name/contact/rate_name/booked_by) plus tail/type.
const Row = ({ label, children }) => (
  <div style={{ display: 'flex', gap: 12, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
    <span style={{ flex: '0 0 96px', fontSize: 11, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '.04em', paddingTop: 2 }}>{label}</span>
    <span style={{ flex: 1, fontSize: 13, color: 'var(--text-primary)' }}>{children || <span style={{ color: 'var(--text-secondary)' }}>—</span>}</span>
  </div>
);

export default function TripInfoCard({ trip, tail, aircraftType, client }) {
  const c = trip?.contact || null;
  const contactLine = c ? [c.name, c.email, c.phone].filter(Boolean).join(' · ') : null;
  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, flex: '1 1 320px' }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 10 }}>Trip Info</div>
      <Row label="Aircraft">{[tail, aircraftType].filter(Boolean).join(' · ')}</Row>
      <Row label="Company">{trip?.company_name || client}</Row>
      <Row label="Contact">{contactLine}</Row>
      <Row label="Purpose">{trip?.purpose ? trip.purpose[0].toUpperCase() + trip.purpose.slice(1) : null}</Row>
      <Row label="Rate">{trip?.rate_name}</Row>
      <Row label="Booked by">{trip?.booked_by}</Row>
    </div>
  );
}
```

- [ ] **Step 2: Build check** — `cd frontend && npm run build` → succeeds.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/trip/TripInfoCard.jsx
git commit -m "feat(trip): read-only Trip Info card"
```

---

## Task 3: TripActionsRail component

**Files:** Create `frontend/src/components/trip/TripActionsRail.jsx`

This holds the status pill, the backend-driven workflow actions (Book/Release/Cancel), the LevelFlight conflict Revert, and the document links. All behavior is delegated via props — no new logic.

- [ ] **Step 1: Write the component**

```jsx
import { API_BASE } from '../../lib/api';

const ACTION_COLOR = { book: '#a855f7', release: '#3b82f6', cancel: '#ef4444' };

// Right-hand actions rail for the Trip Overview. Pure: receives the trip meta + the
// handlers that already live in SchedulingTripDetail.
export default function TripActionsRail({ meta, id, busy, onAction, onRevert, onSendItinerary, released }) {
  const btn = { padding: '8px 14px', fontSize: 13, fontWeight: 600, borderRadius: 8, border: 'none', cursor: busy ? 'default' : 'pointer', color: '#fff', opacity: busy ? 0.6 : 1, textAlign: 'center', textDecoration: 'none', display: 'block' };
  const linkBtn = { padding: '8px 14px', fontSize: 13, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', cursor: 'pointer', textAlign: 'center', textDecoration: 'none', display: 'block' };
  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, flex: '0 0 220px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: 11, letterSpacing: 2, color: 'var(--text-secondary)' }}>STATUS</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 20, padding: '3px 10px' }}>{meta?.status_label || '—'}</span>
      </div>
      {(meta?.actions || []).map((a) => (
        <button key={a.action} onClick={() => onAction(a.status)} disabled={busy || !meta}
          style={{ ...btn, background: ACTION_COLOR[a.action] || 'var(--accent)' }}>{a.label}</button>
      ))}
      {meta?.locally_modified && meta?.origin === 'levelflight' && (
        <button onClick={onRevert} disabled={busy} style={{ ...linkBtn, color: '#f59e0b', borderColor: 'rgba(245,158,11,0.4)' }}>⟲ Revert to LevelFlight</button>
      )}
      <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
      <a href={`${API_BASE}/itinerary/${id}`} target="_blank" rel="noopener noreferrer" style={linkBtn}>View Passenger Itinerary ↗</a>
      <button onClick={onSendItinerary} disabled={busy} style={{ ...btn, background: 'var(--accent)' }}>✉ Send Itinerary</button>
      {released && <a href={`/scheduling/trips/${id}/sheet`} target="_blank" rel="noopener noreferrer" style={linkBtn}>View Crew Trip Sheet ↗</a>}
    </div>
  );
}
```

- [ ] **Step 2: Build check** — `cd frontend && npm run build` → succeeds.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/trip/TripActionsRail.jsx
git commit -m "feat(trip): actions rail (status + workflow actions + doc links)"
```

---

## Task 4: Refactor SchedulingTripDetail into the tabbed Overview

**Files:** Modify `frontend/src/pages/SchedulingTripDetail.jsx`

**READ the current file first.** Keep ALL existing `useState`, data-loading, and handler functions exactly as they are. This task only changes the RETURNED JSX structure: it adds a tab state, renders the header + a two-column Overview (`TripInfoCard` + `TripActionsRail`) + the tab nav, and wraps the existing section JSX blocks in tab panels — moving them, not rewriting them.

- [ ] **Step 1: Add imports + tab state**

At the top with the other imports:
```jsx
import TripTabs from '../components/trip/TripTabs';
import TripInfoCard from '../components/trip/TripInfoCard';
import TripActionsRail from '../components/trip/TripActionsRail';
```
Inside the component, with the other `useState` calls:
```jsx
  const [tab, setTab] = useState('legs');
  const TABS = [
    { id: 'legs', label: 'Legs' },
    { id: 'fees', label: 'Fees' },
    { id: 'crew', label: 'Crew' },
    { id: 'pax', label: 'Passengers' },
    { id: 'docs', label: 'Documents' },
  ];
```

- [ ] **Step 2: Update the header subtitle to show Quote#/Trip#**

In the header block, change the `subtitle` line so it includes the Quote# and Trip# (the values already exist on `meta`). Replace the existing `subtitle` definition:
```js
  const subtitle = [
    meta?.trip_number ? `Trip #${meta.trip_number}` : null,
    meta?.quote_number ? `Quote ${meta.quote_number}` : null,
    tail, client,
  ].filter(Boolean).join(' · ');
```

- [ ] **Step 3: Restructure the render.** Keep the existing top block (back button, h1 title + subtitle, Edit trip / Delete buttons) and the `error` banner exactly as-is. Immediately AFTER the error banner, REPLACE the old "Status & Actions" card AND remove the standalone Crew/Pax/Documents/History `<Section>`s from their current positions by relocating them — restructure to this shape:

```jsx
      {/* error banner stays here, unchanged */}

      {/* Overview: Trip Info + Actions rail (two columns) */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
        <TripInfoCard trip={meta} tail={tail} aircraftType={legsForView[0]?.dispatch?.aircraft?.type?.name || null} client={client} />
        <TripActionsRail
          meta={meta} id={id} busy={busy}
          onAction={setStatus} onRevert={revert} onSendItinerary={() => setShowSend(true)} released={released}
        />
      </div>
      {meta?.stage === 'closed' && <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '0 0 12px' }}>This trip is closed.</p>}
      {meta?.stage === 'cancelled' && <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '0 0 12px' }}>This trip is cancelled.</p>}

      {/* keep the itinerary send modal mount available anywhere on the page */}
      {showSend && <ItinerarySendModal dispatchId={id} onClose={() => setShowSend(false)} />}

      <TripTabs tabs={TABS} active={tab} onSelect={setTab} />

      {tab === 'legs' && (<>
        {/* MOVE HERE: the existing "Edit trip" form block (detailsEdit != null ? ... ) AND the Legs display block (the `<div ...>Legs</div>` + FlightsList / "No legs" fallback). Unchanged. */}
      </>)}

      {tab === 'fees' && (<>
        {/* MOVE HERE: the existing pricing card block — the whole `{meta?.pricing && (meta.pricing.error ? ... : (() => { ... })())}` expression. Unchanged. (C2 rebuilds this tab.) */}
      </>)}

      {tab === 'crew' && (
        {/* MOVE HERE: the existing <Section title="Crew" ...> block. Unchanged. */}
      )}

      {tab === 'pax' && (
        {/* MOVE HERE: the existing <Section title="Passengers" ...> block. Unchanged. */}
      )}

      {tab === 'docs' && (<>
        {/* MOVE HERE: the existing <Section title="Trip Checklist"> block, the <Section title="Documents"> block, and the <Section title="History"> block. Unchanged. (C4 wires the checklist + adds View/Send Quote.) */}
      </>)}
```

Notes for the move:
- The old standalone **Status & Actions** card (the `<div>` with the "Status" label, the `meta.actions` buttons, the released Crew-Trip-Sheet link, and the locally-modified Revert) is now represented by `TripActionsRail` — DELETE that old card. The Revert/actions/itinerary/sheet behaviors are preserved via the rail's props (`onAction={setStatus}`, `onRevert={revert}`, the itinerary link, the released sheet link).
- The **Documents** section currently also renders the "Send Itinerary" button + `ItinerarySendModal` and the itinerary/sheet links; since the rail now owns Send-Itinerary + the itinerary/sheet links, REMOVE those three controls from inside the Documents section but KEEP the document **upload + list + delete** UI there. Leave the `showSend`/`ItinerarySendModal` logic intact (now triggered from the rail; the modal is mounted near the top per the scaffold above).
- Everything else (all handlers, the edit-trip form, crew/pax editors, pricing edit) stays byte-for-byte; you are only relocating JSX blocks under the tab conditionals.

- [ ] **Step 4: Build check**

Run: `cd frontend && npm run build`
Expected: build succeeds with no unused-import or undefined-variable errors. (If `released`, `legsForView`, `client`, `tail`, `setStatus`, `revert`, `setShowSend` are reported undefined, they are existing locals — ensure the relocations kept them in scope.)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/SchedulingTripDetail.jsx
git commit -m "feat(trip): tabbed Trip Overview (Legs/Fees/Crew/Pax/Documents) + Info/Actions"
```

---

## Task 5: Behavior-preservation verification

C1 must not regress anything. There are no unit tests for this page, so verify by build + a manual click-through (the user runs the app against a real native trip).

- [ ] **Step 1: Build is green** — `cd frontend && npm run build`.

- [ ] **Step 2: Manual checklist** (user, against a native trip at `/scheduling/trips/:id`):
  - Header shows route title + **Quote #** and **Trip #** (when booked) + Edit/Delete (native).
  - Overview shows the Trip Info card (Aircraft/Company/Contact/Purpose/Rate/Booked-by) + the Actions rail (status pill, Book/Release/Cancel as applicable, Revert for edited LF trips, View Itinerary, Send Itinerary, View Trip Sheet when released).
  - Tabs switch correctly: **Legs** (list + Edit-trip still adds/removes/reprices), **Fees** (pricing card + edit/re-price still works), **Crew** (assign still works), **Passengers** (manifest editor still works), **Documents** (upload/list/delete still works; checklist still shows; history shows).
  - Status actions, Send-Itinerary modal, Revert, Delete all behave exactly as before.

- [ ] **Step 3:** Note for the user: C1 is presentational. The Fees tab is still the old card (C2 rebuilds it), the checklist is still display-only (C4 wires it), and FBO pickers + native-quote view come in C3/C4.

---

## C1 — Definition of Done

- `cd frontend && npm run build` passes.
- The three components exist and are used; `SchedulingTripDetail` renders the tabbed Overview.
- No behavior lost (manual click-through clean): status workflow, pricing edit/re-price, edit-trip, crew, pax, documents, send-itinerary, revert, delete all still work.
- Quote#/Trip#/Purpose/Company/Contact/Booked-by are now visible.
