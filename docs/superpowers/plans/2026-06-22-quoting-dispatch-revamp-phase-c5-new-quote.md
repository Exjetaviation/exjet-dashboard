# Quoting → Dispatch Revamp — Phase C5 (New-Quote page upgrade) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Upgrade the **New-Quote page** (`SchedulingNewTrip.jsx`) to LevelFlight parity: **Purpose** (owner/charter, drives the rate card), **Company + Contact** (instead of a single customer string), a **dynamic fleet** picker, optional per-leg **FBO pickers**, and a **live price preview** as the quote is built. This is the last slice of the revamp.

**Architecture:** Mostly frontend, plus one thin backend route. The create endpoint (`POST /api/scheduling/trips`) already accepts `purpose`, `company_name`, `contact` (Phase A) and forwards per-leg `dep_fbo`/`arr_fbo` (Phase C3). A new `POST /api/scheduling/quote-preview` reuses `priceQuoteLegs` to price the in-progress legs WITHOUT persisting, so the page can show a live total.

**Tech Stack:** Node + Express, React + Vite. Reuse `frontend/src/components/trip/FboPicker.jsx` (C3) and `frontend/src/lib/feesMath.js`/`usd`. Build check: `cd frontend && npm run build`. Backend import smoke for the route.

**Phase context:** C5 of Phase C; depends on Phase A (purpose/company/contact on create + `priceQuoteLegs(purpose)`), B (rate selection), C3 (`FboPicker` + leg FBO pass-through). After C5 the quote→dispatch revamp is feature-complete.

---

## File Structure

**Modify:**
- `backend/src/routes/scheduling.js` — add `POST /quote-preview` (no persistence).
- `frontend/src/pages/SchedulingNewTrip.jsx` — dynamic fleet, Purpose, Company+Contact, per-leg FBO pickers, live price preview, updated create payload.

---

## Task 1: Backend — quote-preview route

**Files:** Modify `backend/src/routes/scheduling.js` (`priceQuoteLegs` is already imported).

- [ ] **Step 1: Add the route** near the other `requireSchedulingEditor` POSTs (e.g. just before `POST /trips`):

```js
// POST /api/scheduling/quote-preview — price legs WITHOUT persisting, for the
// New-Quote page's live total. Same engine as create (priceQuoteLegs).
router.post('/quote-preview', requireSchedulingEditor, async (req, res) => {
  try {
    const b = req.body || {};
    const legs = Array.isArray(b.legs) ? b.legs : [];
    if (!legs.length) return res.json({ pricing: null });
    const pricing = await priceQuoteLegs({
      tail: (b.aircraft_tail || '').trim() || null,
      aircraftType: null,
      legs: legs.map((l) => ({
        dep_icao: (l.dep_icao || '').trim().toUpperCase(),
        arr_icao: (l.arr_icao || '').trim().toUpperCase(),
        pax: Number(l.pax) || 0,
        isPositioning: !!l.positioning,
      })),
      nights: Number(b.nights) || 0,
      purpose: (b.purpose || '').trim() || null,
    });
    res.json({ pricing });
  } catch (e) {
    console.error('POST /api/scheduling/quote-preview:', e.message);
    res.status(500).json({ error: 'Failed to price' });
  }
});
```

- [ ] **Step 2: Smoke-test imports** — `cd backend && node --input-type=module -e "import('./src/routes/scheduling.js').then(()=>console.log('IMPORT_OK')).catch(e=>{console.error(e.message);process.exit(1)})"` → IMPORT_OK. Run `node --test src/scheduling/*.test.js` → 0 fail.

- [ ] **Step 3: Commit**

```bash
git add backend/src/routes/scheduling.js
git commit -m "feat(scheduling): quote-preview route (price legs without persisting)"
```

---

## Task 2: New-Quote — Purpose, Company + Contact, dynamic fleet

**Files:** Modify `frontend/src/pages/SchedulingNewTrip.jsx`

**READ the file.** Current state: `tail` (default `FLEET[0]`), `customer` (string), `tripNumber`, `legs`, `busy`, `error`, `addingClient`; `useApi('/api/scheduling/legs')` → `distinctClients`. The form card has Aircraft (hardcoded `FLEET`) + Customer (client picker) + Trip#. `save()` POSTs `{aircraft_tail, customer_name, trip_number, legs}`.

- [ ] **Step 1: Add imports + dynamic-fleet/new state.** Add at top (with imports):
```jsx
import { useApi } from '../hooks/useApi';
```
(already imported — verify). Inside the component, replace the `tail` init and add new state:
```jsx
  const { data: rateCards } = useApi('/api/rate-cards');
  const fleet = [...new Set((Array.isArray(rateCards) ? rateCards : []).map((c) => c.aircraft_tail).filter(Boolean))];
  const FLEET_OPTIONS = fleet.length ? fleet : FLEET; // fallback to the static list until rate cards load
  const [tail, setTail] = useState(FLEET[0]);
  const [purpose, setPurpose] = useState('charter');
  const [company, setCompany] = useState('');
  const [contact, setContact] = useState({ name: '', email: '', phone: '' });
```
(Keep the existing `tripNumber`, `legs`, `busy`, `error` state. The old `customer`/`addingClient` state and the client `<select>` are REPLACED by Company + Contact below — remove `customer`, `addingClient`, and the `distinctClients` client picker usage, but keep `clients` for the Company datalist.)

- [ ] **Step 2: Replace the form card** (the `<div>` holding Aircraft + Customer + Trip#) with Aircraft (dynamic) + Purpose + Company + Contact + Trip#:
```jsx
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, marginBottom: 16, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 150px' }}>
          <label style={labelStyle}>Aircraft</label>
          <select value={tail} onChange={(e) => setTail(e.target.value)} style={inputStyle}>
            {FLEET_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div style={{ flex: '1 1 140px' }}>
          <label style={labelStyle}>Purpose</label>
          <select value={purpose} onChange={(e) => setPurpose(e.target.value)} style={inputStyle}>
            <option value="charter">Charter</option>
            <option value="owner">Owner</option>
          </select>
        </div>
        <div style={{ flex: '2 1 220px' }}>
          <label style={labelStyle}>Company</label>
          <input list="nq-clients" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Company or client" style={inputStyle} />
          <datalist id="nq-clients">{clients.map((c) => <option key={c.name} value={c.name} />)}</datalist>
        </div>
        <div style={{ flex: '1 1 140px' }}>
          <label style={labelStyle}>Trip # (optional)</label>
          <input value={tripNumber} onChange={(e) => setTripNumber(e.target.value)} placeholder="auto" style={inputStyle} />
        </div>
        <div style={{ flex: '1 1 100%', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 180px' }}><label style={labelStyle}>Contact name</label><input value={contact.name} onChange={(e) => setContact((c) => ({ ...c, name: e.target.value }))} placeholder="Jane Smith" style={inputStyle} /></div>
          <div style={{ flex: '1 1 180px' }}><label style={labelStyle}>Contact email</label><input value={contact.email} onChange={(e) => setContact((c) => ({ ...c, email: e.target.value }))} placeholder="jane@company.com" style={inputStyle} /></div>
          <div style={{ flex: '1 1 140px' }}><label style={labelStyle}>Contact phone</label><input value={contact.phone} onChange={(e) => setContact((c) => ({ ...c, phone: e.target.value }))} placeholder="(305) 555-0100" style={inputStyle} /></div>
        </div>
      </div>
```

- [ ] **Step 3: Update `save()`** to send the new fields (Company doubles as `customer_name` so the leg snapshot/list still shows it):
```jsx
      const hasContact = contact.name || contact.email || contact.phone;
      const r = await apiFetch('/api/scheduling/trips', {
        method: 'POST',
        body: JSON.stringify({
          aircraft_tail: tail, purpose,
          customer_name: company, company_name: company,
          contact: hasContact ? contact : null,
          trip_number: tripNumber, legs: cleaned,
        }),
      });
```
(Keep the rest of `save()` — the `cleaned` build, the navigate, the error handling.)

- [ ] **Step 4: Build check** — `cd frontend && npm run build` → succeeds (remove now-unused `customer`/`addingClient`; keep `clients`).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/SchedulingNewTrip.jsx
git commit -m "feat(new-quote): Purpose, Company + Contact, dynamic fleet"
```

---

## Task 3: New-Quote — per-leg FBO pickers

**Files:** Modify `frontend/src/pages/SchedulingNewTrip.jsx`

`blankLeg()` (top of file) is `{ dep_icao, arr_icao, dep_date, dep_clock, pax, positioning }`. `LegRow` renders the leg fields. The create payload's `cleaned` map (in `save()`) builds each leg object.

- [ ] **Step 1: Import + extend `blankLeg`:**
```jsx
import FboPicker from '../components/trip/FboPicker';
```
```jsx
const blankLeg = () => ({ dep_icao: '', arr_icao: '', dep_date: '', dep_clock: '', pax: '', positioning: false, dep_fbo: null, arr_fbo: null });
```

- [ ] **Step 2: Render FBO pickers in `LegRow`.** In `LegRow`, after the Ferry checkbox `<label>` (and the remove button), add a full-width row with the two pickers (the row is a `flexWrap` container, so add a `flexBasis:100%` wrapper):
```jsx
      <div style={{ flexBasis: '100%', display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 4 }}>
        <FboPicker label="Dep FBO" icao={leg.dep_icao} value={leg.dep_fbo} onChange={(fbo) => onUpdate(i, 'dep_fbo', fbo)} />
        <FboPicker label="Arr FBO" icao={leg.arr_icao} value={leg.arr_fbo} onChange={(fbo) => onUpdate(i, 'arr_fbo', fbo)} />
      </div>
```
(`onUpdate` is the existing `updateLeg` passed as the `onUpdate` prop.)

- [ ] **Step 3: Carry FBO in the create payload.** In `save()`'s `cleaned` map, add `dep_fbo`/`arr_fbo`:
```jsx
      .map((l) => ({ dep_icao: l.dep_icao.trim(), arr_icao: l.arr_icao.trim(), dep_time: legDepIso(l), pax: l.pax, positioning: l.positioning, dep_fbo: l.dep_fbo || null, arr_fbo: l.arr_fbo || null }));
```

- [ ] **Step 4: Build check** — `cd frontend && npm run build` → succeeds.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/SchedulingNewTrip.jsx
git commit -m "feat(new-quote): per-leg dep/arr FBO pickers"
```

---

## Task 4: New-Quote — live price preview

**Files:** Modify `frontend/src/pages/SchedulingNewTrip.jsx`

- [ ] **Step 1: Add a preview hook** (near the other helpers, after `useLegEstimate`). It debounces a POST to `/quote-preview`:
```jsx
function useQuotePreview(tail, purpose, legs) {
  const [pricing, setPricing] = useState(null);
  const [loading, setLoading] = useState(false);
  const cleaned = legs
    .filter((l) => (l.dep_icao || '').trim() && (l.arr_icao || '').trim())
    .map((l) => ({ dep_icao: l.dep_icao.trim(), arr_icao: l.arr_icao.trim(), pax: Number(l.pax) || 0, positioning: !!l.positioning }));
  const key = JSON.stringify({ tail, purpose, cleaned });
  useEffect(() => {
    if (!tail || !cleaned.length) { setPricing(null); return; }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await apiFetch('/api/scheduling/quote-preview', { method: 'POST', body: JSON.stringify({ aircraft_tail: tail, purpose, legs: cleaned }) });
        const j = await r.json();
        setPricing(r.ok ? j.pricing : null);
      } catch { setPricing(null); }
      setLoading(false);
    }, 500);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return { pricing, loading };
}
```
(`useEffect`/`apiFetch` are imported at the top of the file — verify `useEffect` is in the React import.)

- [ ] **Step 2: Use it + render a price card.** In the component, after the `legs` state:
```jsx
  const { pricing: preview, loading: pricing } = useQuotePreview(tail, purpose, legs);
```
And add a price card just before the "Create Quote" button (uses `usd` — define it locally if not present: `const usd = (n) => (n == null ? '—' : '$' + Number(n).toLocaleString());`):
```jsx
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Estimated quote</span>
        <span style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>
          {pricing ? '…' : (preview && !preview.error ? usd(preview.total) : <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 400 }}>{preview?.error || 'add legs to price'}</span>)}
        </span>
      </div>
```

- [ ] **Step 3: Build check** — `cd frontend && npm run build` → succeeds.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/SchedulingNewTrip.jsx
git commit -m "feat(new-quote): live price preview"
```

---

## Task 5: Verification

- [ ] **Step 1: Build + backend tests** — `cd frontend && npm run build` (green); `cd backend && node --test src/scheduling/*.test.js` (0 fail).

- [ ] **Step 2: Manual checklist** (user, `/scheduling/new`):
  - Aircraft list is the rate-card fleet (not hardcoded); **Purpose** owner/charter; **Company** (with autocomplete) + **Contact** name/email/phone; **Trip #**.
  - Each leg has dep/arr airports, ETD, pax, ferry, **+ Dep/Arr FBO pickers**.
  - As legs/aircraft/purpose change, the **Estimated quote** total updates live (debounced; charter vs owner give different totals — different rate cards).
  - **Create Quote** → lands on the new Trip Overview with the Purpose/Company/Contact populated, the FBOs on the legs, and a matching price.

---

## C5 — Definition of Done

- `POST /quote-preview` prices legs without persisting; `cd backend && node --test src/scheduling/*.test.js` green; route imports clean.
- New-Quote page captures Purpose + Company + Contact + dynamic fleet + per-leg FBO, shows a live total, and creates a native quote with all of it.
- `cd frontend && npm run build` green.

## After C5 — the revamp is feature-complete
Remaining (separate, later): native **itinerary + trip-sheet** rendering (now that native trips carry crew via the Crew tab + FBO via C3/C5); and the **LevelFlight cutover** (real Quote#/Trip# numbering, retiring LF). The two manual ops steps still stand: apply `019_quote_accept.sql`; run `node scripts/importFbos.mjs`.
