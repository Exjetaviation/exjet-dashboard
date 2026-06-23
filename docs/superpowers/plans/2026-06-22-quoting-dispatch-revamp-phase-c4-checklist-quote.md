# Quoting → Dispatch Revamp — Phase C4 (Checklist + native Quote + cosmetics) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the Trip Checklist functional, surface the native **Quote** document in the Documents tab (view / PDF / copy client link), and sweep up the small cosmetics deferred from C1/C2.

**Architecture:** All frontend, two files (`SchedulingTripDetail.jsx` + `components/trip/TripActionsRail.jsx`). The backend endpoints already exist: `PATCH /api/scheduling/trips/:id/checklist` (Phase A) persists the booleans; the native quote renders at `${API_BASE}/quote/:uuid` and `/pdf` (Phase B). No backend changes, no migration.

**Tech Stack:** React + Vite, inline styles + app CSS variables. Build check: `cd frontend && npm run build`.

**Phase context:** C4 of Phase C; depends on C1 (the tabbed Overview, merged) and Phase A/B (the checklist route + native quote, merged). Includes the cosmetics deferred from C1 (the released "Closes automatically…" note) and C2 (the Fees "· adjusted" badge + the FET-off label).

---

## File Structure

**Modify:**
- `frontend/src/pages/SchedulingTripDetail.jsx` — functional checklist (handler + UI), native-quote actions in the Documents tab, and the two Fees-panel cosmetic fixes.
- `frontend/src/components/trip/TripActionsRail.jsx` — restore the released "Closes automatically…" note.

---

## Task 1: Functional Trip Checklist

**Files:** Modify `frontend/src/pages/SchedulingTripDetail.jsx`

**READ the file.** The Trip Checklist is the `<Section title="Trip Checklist">` block (under the `docs` tab) — currently a display-only list of 3 boxes with a "Display-only — wired to the live trip checklist later." note. `meta.checklist` (loaded from the trip GET) holds `{contractReceived, paymentReceived, paymentProcessed}` (or null). `setMeta`, `id`, `load`, `setError`, `apiFetch` already exist.

- [ ] **Step 1: Add a checklist constant + toggle handler** (near the other handlers):

```jsx
  const CHECKLIST_ITEMS = [
    { key: 'contractReceived', label: 'Contract received' },
    { key: 'paymentReceived', label: 'Payment received' },
    { key: 'paymentProcessed', label: 'Payment processed' },
  ];
  const toggleChecklist = async (key) => {
    const cur = meta?.checklist || {};
    const next = { ...cur, [key]: !cur[key] };
    setMeta((m) => ({ ...m, checklist: next })); // optimistic
    setError(null);
    try {
      const r = await apiFetch(`/api/scheduling/trips/${id}/checklist`, { method: 'PATCH', body: JSON.stringify({ [key]: next[key] }) });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || `Save failed (${r.status})`); }
      const j = await r.json();
      setMeta((m) => ({ ...m, checklist: j.checklist }));
    } catch (e) { setError(e.message); await load(); }
  };
```

- [ ] **Step 2: Replace the Trip Checklist `<Section>` body** with functional checkboxes (replace the inner `<div>...map...</div>` AND remove the "Display-only…" `<p>`):

```jsx
      <Section title="Trip Checklist">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {CHECKLIST_ITEMS.map((it) => (
            <label key={it.key} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: 'var(--text-primary)', cursor: 'pointer' }}>
              <input type="checkbox" checked={!!(meta?.checklist || {})[it.key]} onChange={() => toggleChecklist(it.key)} />
              {it.label}
            </label>
          ))}
        </div>
      </Section>
```

- [ ] **Step 3: Build check** — `cd frontend && npm run build` → succeeds.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/SchedulingTripDetail.jsx
git commit -m "feat(trip): functional trip checklist (contract/payment/processed)"
```

---

## Task 2: Native Quote actions in the Documents tab

**Files:** Modify `frontend/src/pages/SchedulingTripDetail.jsx`

The Documents tab (`<Section title="Documents">`) currently holds the doc-type select + Upload + the uploaded-docs list. `API_BASE` is already imported (`import { apiFetch, API_BASE } from '../lib/api';`). The native quote renders at `${API_BASE}/quote/${id}` (id = the trip uuid) and `/pdf`.

- [ ] **Step 1: Add a Quote actions row** at the TOP of the Documents `<Section>` body (before the upload controls):

```jsx
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14, alignItems: 'center' }}>
          <a href={`${API_BASE}/quote/${id}`} target="_blank" rel="noopener noreferrer"
            style={{ padding: '6px 12px', fontSize: 12, fontWeight: 600, background: 'var(--accent)', color: '#fff', borderRadius: 8, textDecoration: 'none' }}>View Quote ↗</a>
          <a href={`${API_BASE}/quote/${id}/pdf`} target="_blank" rel="noopener noreferrer"
            style={{ padding: '6px 12px', fontSize: 12, background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 8, textDecoration: 'none' }}>Quote PDF ↗</a>
          <button onClick={() => navigator.clipboard?.writeText(`${API_BASE}/quote/${id}`)}
            style={{ padding: '6px 12px', fontSize: 12, background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer' }}>Copy client link</button>
        </div>
```

- [ ] **Step 2: Build check** — `cd frontend && npm run build` → succeeds.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/SchedulingTripDetail.jsx
git commit -m "feat(trip): native Quote view/PDF/copy-link in the Documents tab"
```

---

## Task 3: Cosmetic sweep (deferred from C1/C2)

**Files:** Modify `frontend/src/pages/SchedulingTripDetail.jsx` + `frontend/src/components/trip/TripActionsRail.jsx`

- [ ] **Step 1: Fees header "· adjusted" should key off the override, not the legacy `manual` flag.** In the Fees panel, the header reads `Quote — {usd(live.total)}{p.manual && !editing ? ' · adjusted' : ''}`. Change the condition to:

```jsx
{!editing && p.totalOverride != null ? ' · adjusted' : ''}
```

- [ ] **Step 2: Fees view-mode FET label shows "(off)" when FET is disabled.** In the FET `<tr>`, the non-editing branch renders `` `FET (${Math.round(fetRate * 1000) / 10}%)` ``. Change it to reflect a disabled toggle:

```jsx
                  ) : (p.fetEnabled === false ? 'FET (off)' : `FET (${Math.round(fetRate * 1000) / 10}%)`)}
```
(Only the non-editing string changes; the editing-mode checkbox label stays.)

- [ ] **Step 3: Restore the released "Closes automatically…" note** in `frontend/src/components/trip/TripActionsRail.jsx`. After the released Crew-Trip-Sheet `<a>` link (which renders when `released`), add a small note:

```jsx
      {released && <p style={{ fontSize: 11, color: 'var(--text-secondary)', margin: '2px 0 0' }}>Closes automatically once the flight is complete.</p>}
```

- [ ] **Step 4: Build check** — `cd frontend && npm run build` → succeeds.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/SchedulingTripDetail.jsx frontend/src/components/trip/TripActionsRail.jsx
git commit -m "fix(trip): adjusted-badge via override, FET-off label, restore released note"
```

---

## Task 4: Verification

- [ ] **Step 1: Build** — `cd frontend && npm run build` → green.

- [ ] **Step 2: Manual checklist** (user, on a native trip):
  - **Documents tab** → toggling **Contract received / Payment received / Payment processed** persists (reload the page → still checked; backend `PATCH /checklist`).
  - **Documents tab** → **View Quote ↗** opens the branded native quote; **Quote PDF ↗** downloads it; **Copy client link** copies `${API_BASE}/quote/<id>`.
  - **Fees tab** → the header shows "· adjusted" only when a total override is set (not for every line edit); the view-mode FET line shows "FET (off)" when FET is toggled off.
  - **Actions rail** (released trip) → shows "Closes automatically once the flight is complete."

---

## C4 — Definition of Done

- `cd frontend && npm run build` passes.
- Checklist checkboxes persist via `PATCH /checklist`.
- Documents tab links to the native quote (view/PDF/copy).
- The three deferred cosmetics are fixed.

## Notes for C5 (last slice)
- C5 upgrades the New-Quote page: Purpose (→ rate card), Company + Contact, dynamic fleet, and a live price preview (reuse `lib/feesMath.js` + the `priceQuoteLegs` estimate); it can also reuse `FboPicker` per leg.
