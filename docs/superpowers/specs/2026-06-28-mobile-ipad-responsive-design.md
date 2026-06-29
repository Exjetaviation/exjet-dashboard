# Mobile & iPad Responsive Optimization — Design

- **Date:** 2026-06-28
- **Status:** Approved design (pre-implementation)
- **Area:** `frontend/` (React 19 + Vite, React Router 7, no TypeScript)
- **Related:** CLAUDE.md §20 (Frontend) — must be kept current as surfaces change.

---

## 1. Problem

The dashboard is effectively **0% mobile-optimized**. A survey of `frontend/src` found:

- A viewport meta tag is present (`index.html`), but **zero active responsive rules**. The only file with `@media` queries is `App.css`, which is **dead/unimported** (Vite boilerplate).
- Styling is almost entirely **inline `style={{}}` objects** keyed off CSS color variables. Tailwind is installed but used in ~6 places. There is **no spacing or typography scale** — only color tokens in `index.css`.
- Layout is desktop-first with fixed pixels: a `position:fixed` **220px sidebar**, `32px` page padding, fixed-width modals/drawers (`PricingSlideOut` 400px, `DivertModal` 380px), and wide `whiteSpace:nowrap` tables.
- The **Calendar** is a continuous horizontal Gantt — on a 375px phone it is a ~4,000px-wide canvas of tiny columns, effectively unusable.
- No shared layout primitives (Card/Table/Modal/Drawer/Grid); each page rolls its own inline-styled divs. The only ad-hoc responsiveness is `window.innerWidth`/`ResizeObserver` inside `Calendar.jsx` (zoom/autofit).

### Key consequence (drives the approach)

Because styling is inline, **`@media` queries cannot override component styles** — a "drop in a responsive stylesheet" retrofit does not work here. Structural responsive behavior must be **JS-driven** (a breakpoint hook + conditional rendering), with a thin CSS utility layer only for things that don't need JS.

---

## 2. Goals & non-goals

**Goals**
- Full **parity across all ~36 screens** on phone and iPad (portrait + landscape). No surface is "desktop-only."
- A reusable responsive **foundation** (breakpoint hook, tokens, shell, primitives) so each page adapts consistently rather than re-solving "what is a phone" 36 times.
- Native-feeling phone navigation and legible phone layouts for the wide views (Calendar, tables, maps, finances).

**Non-goals**
- **No change to the desktop experience** (see invariant below).
- No backend changes. No new data, routes, or migrations.
- No visual redesign/rebrand — same dark "Midnight" theme, same colors. This is layout/responsiveness only.
- No framework swap (staying with inline styles + a small utility CSS layer; not migrating to Tailwind wholesale).

---

## 3. The desktop-unchanged invariant (load-bearing)

**Desktop (≥1024px) renders the existing code paths, pixel-for-pixel unchanged.**

- All responsive behavior is **additive and gated to `< 1024px`**. Existing desktop branches are never altered, only branched around.
- New CSS (`responsive.css`, token-based padding overrides, touch-target/min-font rules) is scoped inside `@media (max-width: 1023px)` (or narrower). Nothing new applies at ≥1024px.
- The tablet **icon-rail** applies only at 768–1023px; desktop sidebar is untouched.
- New CSS **variables** may be *defined* globally in `:root` (harmless), but existing desktop inline styles keep their current literal values unless a component's desktop branch is intentionally left identical.
- **Acceptance check for every tier:** at ≥1024px the page is visually identical to `main` (side-by-side / screenshot diff).

---

## 4. Decisions (locked during brainstorming)

| Decision | Choice |
|---|---|
| Primary mobile users | **Everyone — full parity** (all roles, all screens) |
| Build strategy | **Foundation-first**, then sweep tier-by-tier (vs per-page bespoke) |
| Phone navigation | **Hybrid:** bottom tab bar + Menu drawer on phone; persistent sidebar on iPad/desktop |
| Phone bottom tabs | **Calendar · Flights · Quotes · Overview** (+ Menu) |
| Calendar on phone | **Hybrid:** Agenda day-list by default + a List/Gantt toggle |
| Wide tables | **Smart per type:** record lists → cards; numeric matrices → frozen-first-column horizontal scroll |
| iPad portrait nav | **Slim icon-rail** sidebar (tap to expand) — recommendation accepted |

---

## 5. Breakpoints & design tokens

**Breakpoints (single source of truth):**

| Name | Range | Devices |
|---|---|---|
| `phone` | `< 768px` | iPhone portrait/landscape |
| `tablet` | `768–1023px` | iPad portrait |
| `desktop` | `≥ 1024px` | iPad landscape + desktop (**unchanged**) |

**Token additions to `index.css`** (alongside existing color vars; additive, non-breaking):
- **Spacing scale:** `--sp-1: 4px` … `--sp-8: 64px` (4 / 8 / 12 / 16 / 24 / 32 / 48 / 64).
- **Type scale:** `--text-xs` … `--text-2xl`.
- **Responsive page padding:** `--page-pad`, set to `32px` at root and stepped down via media queries to `20px` (tablet) and `14px` (phone). Pages that adopt it replace literal `padding: 32px`.

These tokens are introduced opportunistically — a page only switches to them when it is being adapted; we do not do a global find-replace.

---

## 6. Foundation components & files (Tier 0)

### 6.1 `useBreakpoint()` — `frontend/src/hooks/useBreakpoint.js`
- Wraps `matchMedia('(max-width: 767px)')` and `(max-width: 1023px)`; returns `{ isPhone, isTablet, isDesktop, width }`.
- Subscribes to `matchMedia` change events (cleanup on unmount); no per-pixel resize thrash.
- Becomes the single source for structural swaps (Gantt↔agenda, sidebar↔bottom-bar, table↔cards, modal↔sheet).
- **Migrates** the ad-hoc `window.innerWidth`/`ResizeObserver` usage in `Calendar.jsx` to this hook where it concerns breakpoint logic (the zoom-autofit `ResizeObserver` may stay as-is if it measures the container, not the viewport).

### 6.2 `responsive.css` — small utility layer (imported once in `main.jsx`)
Real CSS classes for the things that don't need JS, all scoped `< 1024px`:
- `.container` (fluid max-width + `--page-pad`), `.scroll-x` (overflow-x frame with momentum), `.stack-on-phone` (flex column < 768), `.hide-phone` / `.only-phone`.
- Base phone rules: form controls `font-size: 16px` (prevents iOS zoom-on-focus) and interactive targets `min-height: 44px`.

### 6.3 `AppShell` — `frontend/src/components/AppShell.jsx`
Wraps **both** the Dashboard shell and the SchedulingApp shell so nav is consistent. Renders by breakpoint:
- **Desktop (≥1024):** existing persistent 220px sidebar (collapsible) + `TopNav` + `main` with `padding:32px`. **Unchanged.**
- **Tablet (768–1023):** sidebar defaults to a **~64px icon rail**; tap expands to the full 220px as an overlay. Reclaims ~150px.
- **Phone (<768):** no sidebar. Renders `BottomTabBar` + compact `TopNav`; `NavDrawer` mounts on demand.

`Sidebar.jsx` and `TopNav.jsx` are refactored so AppShell owns positioning; they no longer `position:fixed` themselves.

### 6.4 `BottomTabBar` — `frontend/src/components/BottomTabBar.jsx`
- Fixed bottom bar, phone only. Tabs: **Calendar, Flights, Quotes, Overview**, + **Menu (☰)**.
- `env(safe-area-inset-bottom)` padding so it clears the iPhone home indicator.
- Active tab reflects the current route; "Quotes" routes into the Scheduling area.
- Global across both shells on phone.

### 6.5 `NavDrawer` — `frontend/src/components/NavDrawer.jsx`
- Off-canvas overlay (scrim + tap-to-close) opened by Menu.
- Holds the **full** nav list (including sidebar-hidden `RateCards` / `Maintenance`), the **Dashboard ↔ Scheduling shell switch**, and **Sign out**.

### 6.6 `Sheet` — `frontend/src/components/Sheet.jsx`
- Base for modals/drawers. **<768 → full-screen (or bottom) sheet**; **≥768 → renders as today** (centered modal / right-side drawer, caller-controlled).
- Existing overlays route through it (§8).

### 6.7 `ResponsiveTable` — `frontend/src/components/ResponsiveTable.jsx`
- Two modes via a `variant` prop:
  - `variant="records"`: **<768 → card list** (config: which fields are card title vs meta); **≥768 → existing table markup, unchanged.**
  - `variant="matrix"`: **<1024 → horizontal-scroll frame with frozen first column** (`position:sticky; left:0`); **≥1024 → unchanged.**
- Plus lightweight `Card` / `Stack` helpers as needed.

---

## 7. Calendar (agenda + Gantt toggle)

- **Desktop & iPad-landscape (≥1024):** existing Gantt, **unchanged**.
- **Tablet (768–1023):** Gantt with touch polish only (momentum scroll, sticky tail labels). No structural change.
- **Phone (<768):** default **Agenda** view — vertical list grouped by day; each leg is a card showing route, tail, scheduled→actual times + delay, status-color edge, pax/crew summary, and on-ground / diversion indicators. A **List/Gantt segmented toggle** drops into the existing Gantt inside a `.scroll-x` frame.
- Card content **reuses existing selectors** (`legStateColor`, `lib/delaySegments`, `lib/dutyGroups`) — no duplication of calendar logic.
- **Leg interactions on phone:** the fixed-position popover/tooltip is replaced by a bottom **Sheet** with details + actions (Open, Mark diverted…); `DivertModal` routes through that Sheet. Desktop popover unchanged.
- **Map page on phone:** with the sidebar gone (via AppShell) the Leaflet map goes full-bleed; Leaflet touch (pinch/pan) already works. Controls/legend reposition to avoid the bottom tab bar; "Awaiting signal" / legend becomes a collapsible panel. Desktop map unchanged.

---

## 8. Tables, forms, modals, drawers

### 8.1 Tables (via `ResponsiveTable`)
- **Record lists** → `variant="records"`: `FlightsList`, `TripsList`, People, `Clients`, `Crew`, `RateCards`, `Maintenance`, `Quotes`, Fuel imports.
- **Numeric matrices** → `variant="matrix"`: Finances P&L by-month, by-aircraft, by-trips. The 6 Finances **tabs become a scrollable strip** on phone; inline charts go full-width and stack.

### 8.2 Modals / drawers (via `Sheet`)
- `PricingSlideOut`: phone → full-screen Sheet, stacked label/value rows, full-width ≥44px inputs; ≥768 → existing 400px right drawer.
- `DivertModal`, `ItinerarySendModal`, `AddComponentModal`: phone → full-screen Sheet; ≥768 → existing centered modal.

### 8.3 Editors & forms
- `QuoteEditor`, `SchedulingTripDetail`: leg rows stack to a single column <768; tab rows become scrollable strips; `AirportInput` dropdown clamps to viewport width.
- Inputs get correct `inputmode` / `type` for mobile keyboards; `font-size:16px` on phone (from `responsive.css`).

---

## 9. Global polish (phone/tablet only, scoped `< 1024px`)
- Responsive page padding (32 → 20 → 14) via `--page-pad`.
- Fluid logo width (replace `width:200px`).
- `env(safe-area-inset-*)` for notch/home-indicator (bottom bar + full-screen sheets).
- 44px min touch targets; 16px min input font on phone.

---

## 10. New / changed files (summary)

**New**
- `frontend/src/hooks/useBreakpoint.js`
- `frontend/src/styles/responsive.css` (imported in `main.jsx`)
- `frontend/src/components/AppShell.jsx`
- `frontend/src/components/BottomTabBar.jsx`
- `frontend/src/components/NavDrawer.jsx`
- `frontend/src/components/Sheet.jsx`
- `frontend/src/components/ResponsiveTable.jsx` (+ `Card`/`Stack` helpers)

**Changed (representative)**
- `index.css` (token additions), `main.jsx` (import responsive.css)
- `App.jsx`, `Sidebar.jsx`, `TopNav.jsx` (render through AppShell)
- `Calendar.jsx` (agenda view + toggle + phone leg Sheet; migrate innerWidth → hook)
- `Map.jsx`, `Finances.jsx`, `FlightsList.jsx`, `TripsList.jsx`, and the editors/modals listed above
- Remaining Tier-3 pages adopt primitives as swept.

---

## 11. Rollout tiers

- **Tier 0 — Foundation:** `useBreakpoint`, tokens, `responsive.css`, `AppShell`, `BottomTabBar`, `NavDrawer`, `Sheet`, `ResponsiveTable`.
- **Tier 1 — Highest traffic / worst offenders:** Calendar, Flights/Trips, Overview, Map, Finances.
- **Tier 2 — Scheduling editors:** `QuoteEditor`, `SchedulingTripDetail`, `PricingSlideOut`, modals.
- **Tier 3 — Remainder:** Crew, Aircraft, Clients, Fleet (List/Detail/Components), RateCards, Maintenance, CrewCalendar, Assistant, FuelPrices, People/PersonProfile.

Each tier ships independently; implementation will be split into **per-tier plans** rather than one monolithic plan.

---

## 12. Verification

Per tier:
- `cd frontend && npm run build` (must pass).
- Manual responsive checks at **390px (phone), 834px (iPad portrait), 1024px+ (iPad landscape/desktop)**.
- **Desktop-unchanged gate:** confirm the page at ≥1024px is visually identical to `main` (screenshot/side-by-side).
- Update **CLAUDE.md §20** for any surface whose structure changes (golden rule: keep the guide current in the same change).

---

## 13. Risks & open questions

- **Scope:** ~36 screens is large; the tier split keeps each plan reviewable. Tier 1 delivers most of the user-visible value.
- **Inline-style refactors are touch-y:** moving `Sidebar`/`TopNav` positioning into `AppShell` is the riskiest change for desktop regressions — the desktop-unchanged gate exists specifically to catch this.
- **Calendar agenda view** is net-new UI (not just a reflow); it carries the most new code in Tier 1.
- **Open:** exact card field priority per record list (which fields are title vs meta) — decided per page during implementation.
- **Open:** whether iPad-portrait Calendar should also offer the agenda toggle (currently: Gantt at ≥768). Revisit if dispatchers want it.
