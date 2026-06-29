# Mobile Responsive Foundation (Tier 0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the shared responsive foundation (breakpoint hook, design tokens, utility CSS, and the AppShell + navigation primitives) so phones get a bottom tab bar + drawer and iPad-portrait gets an icon-rail sidebar, while the desktop (≥1024px) experience stays pixel-for-pixel unchanged.

**Architecture:** Styling is inline `style={{}}`, so responsive behavior is JS-driven via a `useBreakpoint()` hook plus conditional rendering, with a thin `responsive.css` utility layer for things that don't need JS. A new `AppShell` component owns all shell/nav layout for both the Dashboard and Scheduling shells; its desktop branch reproduces today's exact markup. New primitives (`Sheet`, `ResponsiveTable`) are built here but adopted by later tiers.

**Tech Stack:** React 19, React Router 7, Vite 8, no TypeScript. Pure-logic modules live in `src/lib/` and are tested with `node:test`; components are verified with `vite build` + manual responsive checks (the repo has no component-render test harness — see Testing Approach).

**Prerequisite:** Work is on branch `feat/mobile-responsive-optimization` (already created; the design spec is committed there). Spec: `docs/superpowers/specs/2026-06-28-mobile-ipad-responsive-design.md`.

**Testing Approach:**
- **Pure modules** (`breakpoints.js`, `navConfig.js`, `responsiveTable.js`) → full TDD with `node:test`, run via `node --test frontend/src/lib/<file>.test.js`.
- **React components/hooks** → no jsdom/testing-library exists in this repo and we are not adding one (out of scope). Verification is `cd frontend && npm run build` (must compile) plus the manual responsive check in the final task. This matches CLAUDE.md §23.

**Desktop-unchanged invariant (applies to EVERY task):** Nothing rendered at ≥1024px may change. All new behavior is gated to `< 1024px`. The final task includes a side-by-side desktop check against `main`.

---

### Task 1: Breakpoint helper (pure)

**Files:**
- Create: `frontend/src/lib/breakpoints.js`
- Test: `frontend/src/lib/breakpoints.test.js`

- [ ] **Step 1: Write the failing test**

```js
// frontend/src/lib/breakpoints.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { breakpointFor, BREAKPOINTS } from './breakpoints.js';

test('phone at and below 767px', () => {
  assert.equal(breakpointFor(320), 'phone');
  assert.equal(breakpointFor(767), 'phone');
});

test('tablet from 768px to 1023px', () => {
  assert.equal(breakpointFor(768), 'tablet');
  assert.equal(breakpointFor(1023), 'tablet');
});

test('desktop at and above 1024px', () => {
  assert.equal(breakpointFor(1024), 'desktop');
  assert.equal(breakpointFor(1920), 'desktop');
});

test('exposes the cutoff constants', () => {
  assert.equal(BREAKPOINTS.phoneMax, 767);
  assert.equal(BREAKPOINTS.tabletMax, 1023);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && node --test src/lib/breakpoints.test.js`
Expected: FAIL — cannot find module `./breakpoints.js`.

- [ ] **Step 3: Write minimal implementation**

```js
// frontend/src/lib/breakpoints.js
// Single source of truth for responsive cutoffs.
// phone: < 768 | tablet: 768–1023 (iPad portrait) | desktop: >= 1024 (unchanged)
export const BREAKPOINTS = { phoneMax: 767, tabletMax: 1023 };

export function breakpointFor(width) {
  if (width <= BREAKPOINTS.phoneMax) return 'phone';
  if (width <= BREAKPOINTS.tabletMax) return 'tablet';
  return 'desktop';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && node --test src/lib/breakpoints.test.js`
Expected: PASS — 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/breakpoints.js frontend/src/lib/breakpoints.test.js
git commit -m "feat(responsive): add breakpoint helper

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Navigation config (pure)

**Files:**
- Create: `frontend/src/lib/navConfig.js`
- Test: `frontend/src/lib/navConfig.test.js`

> The sidebar link list moves out of `Sidebar.jsx` so the sidebar, bottom bar, and drawer all share one source. `sidebarLinks()` MUST reproduce today's exact sidebar order (Overview, Fleet Map, Calendar, Flights, Crew, Aircraft, Clients, Quotes, Finances, AI Assistant, Crew Calendar — with Rate Cards & Maintenance hidden).

- [ ] **Step 1: Write the failing test**

```js
// frontend/src/lib/navConfig.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NAV_LINKS, sidebarLinks, BOTTOM_TABS, SHELL_TABS, isNavActive } from './navConfig.js';

test('sidebarLinks reproduces the current visible sidebar order', () => {
  assert.deepEqual(
    sidebarLinks().map((l) => l.to),
    ['/', '/map', '/calendar', '/flights', '/crew', '/aircraft', '/clients', '/quotes', '/finances', '/assistant', '/crew-calendar'],
  );
});

test('NAV_LINKS also includes the hidden rate-cards and maintenance for the drawer', () => {
  const tos = NAV_LINKS.map((l) => l.to);
  assert.ok(tos.includes('/rate-cards'));
  assert.ok(tos.includes('/maintenance'));
});

test('BOTTOM_TABS are Calendar, Flights, Quotes, Overview in order', () => {
  assert.deepEqual(BOTTOM_TABS.map((t) => t.to), ['/calendar', '/flights', '/quotes', '/']);
});

test('SHELL_TABS isActive distinguishes scheduling from dashboard', () => {
  const [dash, sched] = SHELL_TABS;
  assert.equal(dash.isActive('/calendar'), true);
  assert.equal(dash.isActive('/scheduling/quotes/3001'), false);
  assert.equal(sched.isActive('/scheduling'), true);
  assert.equal(sched.isActive('/'), false);
});

test('isNavActive: root matches only exact "/", others match prefix segments', () => {
  assert.equal(isNavActive('/', '/'), true);
  assert.equal(isNavActive('/', '/flights'), false);
  assert.equal(isNavActive('/flights', '/flights'), true);
  assert.equal(isNavActive('/flights', '/flights/abc'), true);
  assert.equal(isNavActive('/flights', '/flightsfoo'), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && node --test src/lib/navConfig.test.js`
Expected: FAIL — cannot find module `./navConfig.js`.

- [ ] **Step 3: Write minimal implementation**

```js
// frontend/src/lib/navConfig.js
// Shared navigation source for Sidebar (desktop/tablet), NavDrawer (phone),
// and BottomTabBar (phone). Icons match the existing sidebar glyphs.
export const NAV_LINKS = [
  { to: '/', label: 'Overview', icon: '◈' },
  { to: '/map', label: 'Fleet Map', icon: '🗺' },
  { to: '/calendar', label: 'Calendar', icon: '▦' },
  { to: '/flights', label: 'Flights', icon: '✈' },
  { to: '/crew', label: 'Crew', icon: '👤' },
  { to: '/aircraft', label: 'Aircraft', icon: '🛩' },
  { to: '/clients', label: 'Clients', icon: '◎' },
  { to: '/quotes', label: 'Quotes', icon: '📋' },
  { to: '/finances', label: 'Finances', icon: '💰' },
  // Hidden from the sidebar today, but reachable from the phone drawer.
  { to: '/rate-cards', label: 'Rate Cards', icon: '＄', hideFromSidebar: true },
  { to: '/maintenance', label: 'Maintenance', icon: '🔧', hideFromSidebar: true },
  { to: '/assistant', label: 'AI Assistant', icon: '✦' },
  { to: '/crew-calendar', label: 'Crew Calendar', icon: '📅' },
];

export function sidebarLinks() {
  return NAV_LINKS.filter((l) => !l.hideFromSidebar);
}

// Phone bottom tab bar destinations (a Menu button is appended by the bar).
export const BOTTOM_TABS = [
  { to: '/calendar', label: 'Calendar', icon: '📅' },
  { to: '/flights', label: 'Flights', icon: '✈' },
  { to: '/quotes', label: 'Quotes', icon: '📋' },
  { to: '/', label: 'Overview', icon: '◈' },
];

// Dashboard <-> Scheduling shell switch (mirrors TopNav's existing TABS).
export const SHELL_TABS = [
  { label: 'Dashboard', to: '/', isActive: (p) => !p.startsWith('/scheduling') },
  { label: 'Scheduling', to: '/scheduling', isActive: (p) => p.startsWith('/scheduling') },
];

export function isNavActive(to, pathname) {
  if (to === '/') return pathname === '/';
  return pathname === to || pathname.startsWith(to + '/');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && node --test src/lib/navConfig.test.js`
Expected: PASS — 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/navConfig.js frontend/src/lib/navConfig.test.js
git commit -m "feat(responsive): add shared nav config

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: useBreakpoint hook

**Files:**
- Create: `frontend/src/hooks/useBreakpoint.js`

- [ ] **Step 1: Write the implementation**

```js
// frontend/src/hooks/useBreakpoint.js
import { useState, useEffect } from 'react';
import { breakpointFor } from '../lib/breakpoints';

function read() {
  const w = typeof window === 'undefined' ? 1280 : window.innerWidth;
  return { width: w, bp: breakpointFor(w) };
}

// Single source for structural responsive swaps. Re-renders on resize only
// when the breakpoint band actually changes.
export function useBreakpoint() {
  const [state, setState] = useState(read);
  useEffect(() => {
    const onResize = () => {
      setState((prev) => {
        const next = read();
        return prev.bp === next.bp && prev.width === next.width ? prev : next;
      });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return {
    width: state.width,
    isPhone: state.bp === 'phone',
    isTablet: state.bp === 'tablet',
    isDesktop: state.bp === 'desktop',
  };
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd frontend && npm run build`
Expected: build succeeds with no errors referencing `useBreakpoint`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/useBreakpoint.js
git commit -m "feat(responsive): add useBreakpoint hook

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Design tokens + responsive utility CSS

**Files:**
- Modify: `frontend/src/index.css` (append tokens inside `:root`)
- Create: `frontend/src/styles/responsive.css`
- Modify: `frontend/src/main.jsx:3` (import the new stylesheet)

- [ ] **Step 1: Add spacing/type/page-pad tokens to `:root` in `index.css`**

In `frontend/src/index.css`, inside the existing `:root { ... }` block, immediately after the `--danger: #ef4444;` line, add:

```css
  /* Spacing scale */
  --sp-1: 4px; --sp-2: 8px; --sp-3: 12px; --sp-4: 16px;
  --sp-5: 24px; --sp-6: 32px; --sp-7: 48px; --sp-8: 64px;
  /* Type scale */
  --text-xs: 11px; --text-sm: 13px; --text-base: 14px;
  --text-lg: 16px; --text-xl: 22px; --text-2xl: 28px;
  /* Responsive page padding (stepped down for tablet/phone in responsive.css) */
  --page-pad: 32px;
```

- [ ] **Step 2: Create `responsive.css`**

```css
/* frontend/src/styles/responsive.css
   ALL rules are scoped to < 1024px. Desktop (>= 1024px) is never affected. */

/* Step page padding down below desktop. */
@media (max-width: 1023px) {
  :root { --page-pad: 20px; }
}
@media (max-width: 767px) {
  :root { --page-pad: 14px; }

  /* iOS zooms when a focused input has font-size < 16px. */
  input, select, textarea { font-size: 16px; }

  /* Comfortable touch targets on phone. */
  button { min-height: 44px; }
}

/* Horizontal-scroll frame for wide content (matrices, tab strips). */
.scroll-x {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}

/* Visibility helpers. */
@media (max-width: 767px) { .hide-phone { display: none !important; } }
@media (min-width: 768px) { .only-phone { display: none !important; } }
```

- [ ] **Step 3: Import `responsive.css` in `main.jsx`**

In `frontend/src/main.jsx`, add the import on the line immediately after `import './index.css'`:

```js
import './index.css'
import './styles/responsive.css'
```

- [ ] **Step 4: Verify it compiles**

Run: `cd frontend && npm run build`
Expected: build succeeds; `responsive.css` is bundled.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/index.css frontend/src/styles/responsive.css frontend/src/main.jsx
git commit -m "feat(responsive): add design tokens and responsive.css utility layer

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: ResponsiveTable card-field helper (pure)

**Files:**
- Create: `frontend/src/lib/responsiveTable.js`
- Test: `frontend/src/lib/responsiveTable.test.js`

- [ ] **Step 1: Write the failing test**

```js
// frontend/src/lib/responsiveTable.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardFields } from './responsiveTable.js';

test('uses the column marked role:title as the card title', () => {
  const cols = [
    { key: 'date', label: 'Date' },
    { key: 'route', label: 'Route', role: 'title' },
    { key: 'pax', label: 'Pax' },
  ];
  const { title, meta } = cardFields(cols);
  assert.equal(title.key, 'route');
  assert.deepEqual(meta.map((c) => c.key), ['date', 'pax']);
});

test('falls back to the first column when no title role is set', () => {
  const cols = [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }];
  const { title, meta } = cardFields(cols);
  assert.equal(title.key, 'a');
  assert.deepEqual(meta.map((c) => c.key), ['b']);
});

test('omits columns marked role:hide from the card meta', () => {
  const cols = [
    { key: 'a', label: 'A', role: 'title' },
    { key: 'b', label: 'B' },
    { key: 'c', label: 'C', role: 'hide' },
  ];
  const { meta } = cardFields(cols);
  assert.deepEqual(meta.map((c) => c.key), ['b']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && node --test src/lib/responsiveTable.test.js`
Expected: FAIL — cannot find module `./responsiveTable.js`.

- [ ] **Step 3: Write minimal implementation**

```js
// frontend/src/lib/responsiveTable.js
// Decide which columns become a phone card's title vs its meta line.
// columns: [{ key, label, render?, role?: 'title' | 'hide' }]
export function cardFields(columns) {
  const title = columns.find((c) => c.role === 'title') || columns[0];
  const meta = columns.filter((c) => c !== title && c.role !== 'hide');
  return { title, meta };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && node --test src/lib/responsiveTable.test.js`
Expected: PASS — 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/responsiveTable.js frontend/src/lib/responsiveTable.test.js
git commit -m "feat(responsive): add ResponsiveTable card-field helper

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: ResponsiveTable component

**Files:**
- Create: `frontend/src/components/ResponsiveTable.jsx`

> Generic table primitive for later tiers. Not wired to any existing page in Tier 0, so it cannot regress desktop. `variant="records"` → phone cards / table otherwise. `variant="matrix"` → frozen-first-column horizontal scroll below 1024px / plain table at desktop.

- [ ] **Step 1: Write the implementation**

```jsx
// frontend/src/components/ResponsiveTable.jsx
import { useBreakpoint } from '../hooks/useBreakpoint';
import { cardFields } from '../lib/responsiveTable';

const val = (col, row) => (col.render ? col.render(row) : row[col.key]);

// columns: [{ key, label, render?, role?: 'title' | 'hide' }]
export default function ResponsiveTable({ columns, rows, variant = 'records', getKey, onRowClick }) {
  const { isPhone, isDesktop } = useBreakpoint();
  const keyOf = getKey || ((_, i) => i);

  // Numeric matrix below desktop: horizontal scroll + frozen first column.
  if (variant === 'matrix' && !isDesktop) {
    const stickyHead = (i) => ({
      position: i === 0 ? 'sticky' : undefined, left: i === 0 ? 0 : undefined,
      background: 'var(--bg-secondary)', zIndex: i === 0 ? 2 : 1,
      textAlign: 'left', padding: '8px 10px', fontSize: 'var(--text-xs)',
      color: 'var(--text-secondary)', whiteSpace: 'nowrap',
    });
    const stickyCell = (i) => ({
      position: i === 0 ? 'sticky' : undefined, left: i === 0 ? 0 : undefined,
      background: 'var(--bg-card)', zIndex: i === 0 ? 1 : 0,
      padding: '8px 10px', fontSize: 'var(--text-sm)', whiteSpace: 'nowrap',
    });
    return (
      <div className="scroll-x">
        <table style={{ borderCollapse: 'collapse', minWidth: 'max-content' }}>
          <thead><tr>{columns.map((c, i) => <th key={c.key} style={stickyHead(i)}>{c.label}</th>)}</tr></thead>
          <tbody>{rows.map((row, ri) => (
            <tr key={keyOf(row, ri)}>{columns.map((c, i) => <td key={c.key} style={stickyCell(i)}>{val(c, row)}</td>)}</tr>
          ))}</tbody>
        </table>
      </div>
    );
  }

  // Record list on phone: cards.
  if (variant === 'records' && isPhone) {
    const { title, meta } = cardFields(columns);
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
        {rows.map((row, ri) => (
          <div key={keyOf(row, ri)} onClick={onRowClick ? () => onRowClick(row) : undefined}
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8,
              padding: 'var(--sp-3)', cursor: onRowClick ? 'pointer' : 'default' }}>
            <div style={{ fontWeight: 600, fontSize: 'var(--text-base)', marginBottom: 'var(--sp-1)' }}>{val(title, row)}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
              {meta.map((c) => <span key={c.key}>{c.label}: {val(c, row)}</span>)}
            </div>
          </div>
        ))}
      </div>
    );
  }

  // Default table (desktop, tablet, and non-phone record lists).
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead><tr>{columns.map((c) => (
        <th key={c.key} style={{ textAlign: 'left', padding: '8px 10px', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', borderBottom: '1px solid var(--border)' }}>{c.label}</th>
      ))}</tr></thead>
      <tbody>{rows.map((row, ri) => (
        <tr key={keyOf(row, ri)} onClick={onRowClick ? () => onRowClick(row) : undefined} style={{ cursor: onRowClick ? 'pointer' : 'default' }}>
          {columns.map((c) => <td key={c.key} style={{ padding: '8px 10px', fontSize: 'var(--text-sm)', borderBottom: '1px solid var(--border)' }}>{val(c, row)}</td>)}
        </tr>
      ))}</tbody>
    </table>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd frontend && npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/ResponsiveTable.jsx
git commit -m "feat(responsive): add ResponsiveTable component

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Sheet (modal/drawer base)

**Files:**
- Create: `frontend/src/components/Sheet.jsx`

> Phone: full-screen sheet. `variant="modal"` (≥768): centered overlay. `variant="drawer"` (≥768): right-side panel. Adopted by later tiers (PricingSlideOut, DivertModal, etc.). Not wired to anything in Tier 0.

- [ ] **Step 1: Write the implementation**

```jsx
// frontend/src/components/Sheet.jsx
import { useBreakpoint } from '../hooks/useBreakpoint';

// variant: 'modal' (centered) | 'drawer' (right side) — desktop/tablet only.
// On phone, both render as a full-screen sheet.
export default function Sheet({ open, onClose, title, children, variant = 'modal', desktopStyle = {} }) {
  const { isPhone } = useBreakpoint();
  if (!open) return null;

  if (isPhone) {
    return (
      <div style={{
        position: 'fixed', inset: 0, zIndex: 400, background: 'var(--bg-primary)',
        display: 'flex', flexDirection: 'column', overflowY: 'auto',
        padding: 'calc(env(safe-area-inset-top) + 12px) 16px calc(env(safe-area-inset-bottom) + 16px)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
          <strong style={{ fontSize: 'var(--text-lg)', flex: 1 }}>{title}</strong>
          <button onClick={onClose} aria-label="Close" style={{
            background: 'none', border: 'none', color: 'var(--text-secondary)',
            fontSize: 24, cursor: 'pointer', minHeight: 44, minWidth: 44,
          }}>×</button>
        </div>
        {children}
      </div>
    );
  }

  if (variant === 'drawer') {
    return (
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(0,0,0,0.5)' }}>
        <div onClick={(e) => e.stopPropagation()} style={{
          position: 'absolute', top: 0, right: 0, bottom: 0, width: 400, maxWidth: '92vw',
          background: 'var(--bg-card)', borderLeft: '1px solid var(--border)',
          overflowY: 'auto', padding: 20, boxShadow: '-6px 0 24px rgba(0,0,0,0.5)', ...desktopStyle,
        }}>{children}</div>
      </div>
    );
  }

  // modal
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12,
        maxHeight: '90vh', overflowY: 'auto', padding: 20, ...desktopStyle,
      }}>{children}</div>
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd frontend && npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/Sheet.jsx
git commit -m "feat(responsive): add Sheet modal/drawer base

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: BottomTabBar (phone)

**Files:**
- Create: `frontend/src/components/BottomTabBar.jsx`

- [ ] **Step 1: Write the implementation**

```jsx
// frontend/src/components/BottomTabBar.jsx
import { useLocation, useNavigate } from 'react-router-dom';
import { BOTTOM_TABS, isNavActive } from '../lib/navConfig';

export default function BottomTabBar({ onMenu }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();

  const tabStyle = (active) => ({
    flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
    justifyContent: 'center', gap: 2, padding: '6px 0', minHeight: 44,
    background: 'none', border: 'none', cursor: 'pointer', fontSize: 18,
    color: active ? 'var(--accent)' : 'var(--text-secondary)',
  });
  const labelStyle = { fontSize: 10 };

  return (
    <nav style={{
      position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 250, display: 'flex',
      background: 'var(--bg-secondary)', borderTop: '1px solid var(--border)',
      paddingBottom: 'env(safe-area-inset-bottom)',
    }}>
      {BOTTOM_TABS.map((t) => {
        const active = isNavActive(t.to, pathname);
        return (
          <button key={t.to} onClick={() => navigate(t.to)} style={tabStyle(active)}>
            <span>{t.icon}</span><span style={labelStyle}>{t.label}</span>
          </button>
        );
      })}
      <button onClick={onMenu} style={tabStyle(false)}>
        <span>☰</span><span style={labelStyle}>Menu</span>
      </button>
    </nav>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd frontend && npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/BottomTabBar.jsx
git commit -m "feat(responsive): add phone BottomTabBar

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: NavDrawer (phone)

**Files:**
- Create: `frontend/src/components/NavDrawer.jsx`

- [ ] **Step 1: Write the implementation**

```jsx
// frontend/src/components/NavDrawer.jsx
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { NAV_LINKS, SHELL_TABS } from '../lib/navConfig';
import { supabase } from '../lib/supabase';

export default function NavDrawer({ open, onClose }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  if (!open) return null;

  const go = (to) => { navigate(to); onClose(); };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.5)' }}>
      <aside onClick={(e) => e.stopPropagation()} style={{
        position: 'absolute', top: 0, bottom: 0, left: 0, width: 'min(280px, 82vw)',
        background: 'var(--bg-secondary)', borderRight: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column', boxShadow: '6px 0 24px rgba(0,0,0,0.5)',
        paddingTop: 'env(safe-area-inset-top)',
      }}>
        {/* Dashboard <-> Scheduling shell switch */}
        <div style={{ display: 'flex', gap: 4, padding: 12, borderBottom: '1px solid var(--border)' }}>
          {SHELL_TABS.map((t) => {
            const active = t.isActive(pathname);
            return (
              <button key={t.to} onClick={() => go(t.to)} style={{
                flex: 1, padding: 10, fontSize: 'var(--text-sm)', fontWeight: 600, borderRadius: 8,
                cursor: 'pointer', border: '1px solid var(--border)',
                background: active ? 'rgba(79,142,247,0.12)' : 'var(--bg-card)',
                color: active ? 'var(--accent)' : 'var(--text-secondary)',
              }}>{t.label}</button>
            );
          })}
        </div>

        <nav style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
          {NAV_LINKS.map(({ to, label, icon }) => (
            <NavLink key={to} to={to} end={to === '/'} onClick={onClose} style={({ isActive }) => ({
              display: 'flex', alignItems: 'center', gap: 12, padding: '13px 18px',
              color: isActive ? 'var(--accent)' : 'var(--text-secondary)',
              background: isActive ? 'rgba(79,142,247,0.08)' : 'transparent',
              borderLeft: isActive ? '2px solid var(--accent)' : '2px solid transparent',
              textDecoration: 'none', fontSize: 'var(--text-lg)',
            })}>
              <span style={{ fontSize: 16 }}>{icon}</span>{label}
            </NavLink>
          ))}
        </nav>

        <button onClick={() => { supabase.auth.signOut(); onClose(); }} style={{
          margin: 12, padding: 12, fontSize: 'var(--text-sm)', background: 'var(--bg-card)',
          border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-secondary)', cursor: 'pointer',
        }}>Sign out</button>
      </aside>
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd frontend && npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/NavDrawer.jsx
git commit -m "feat(responsive): add phone NavDrawer

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Sidebar — add collapsed (icon-rail) variant + shared links

**Files:**
- Modify: `frontend/src/components/Sidebar.jsx` (full rewrite below)

> Desktop default `collapsed={false}` MUST render identically to today. The only desktop-visible change is sourcing links from `navConfig` (which reproduces the same list). The `collapsed` rail is used by AppShell on tablet only.

- [ ] **Step 1: Rewrite `Sidebar.jsx`**

```jsx
// frontend/src/components/Sidebar.jsx
import { NavLink } from 'react-router-dom';
import logo from '../assets/logo.png';
import { sidebarLinks } from '../lib/navConfig';

export default function Sidebar({ open = true, collapsed = false }) {
  const width = collapsed ? 64 : 220;
  return (
    <aside style={{
      width, height: '100vh',
      background: 'var(--bg-secondary)',
      borderRight: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column',
      position: 'fixed', top: 0, left: 0, zIndex: 100,
      transform: open ? 'translateX(0)' : `translateX(-${width}px)`,
      transition: 'transform 0.2s ease',
    }}>
      <div style={{ padding: collapsed ? '20px 0' : '24px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <img src={logo} alt="Exjet Aviation" style={{ width: collapsed ? 36 : 200, objectFit: 'contain', filter: 'brightness(0) invert(1)' }} />
      </div>
      <nav style={{ padding: '12px 0', flex: 1, overflowY: 'auto' }}>
        {sidebarLinks().map(({ to, label, icon }) => (
          <NavLink key={to} to={to} end={to === '/'} title={collapsed ? label : undefined} style={({ isActive }) => ({
            display: 'flex', alignItems: 'center', gap: collapsed ? 0 : '12px',
            justifyContent: collapsed ? 'center' : 'flex-start',
            padding: collapsed ? '11px 0' : '11px 20px',
            color: isActive ? 'var(--accent)' : 'var(--text-secondary)',
            background: isActive ? 'rgba(79,142,247,0.08)' : 'transparent',
            borderLeft: isActive ? '2px solid var(--accent)' : '2px solid transparent',
            textDecoration: 'none', fontSize: '14px',
            fontWeight: isActive ? '500' : '400', transition: 'all 0.15s',
          })}>
            <span style={{ fontSize: '15px' }}>{icon}</span>
            {!collapsed && label}
          </NavLink>
        ))}
      </nav>
      {!collapsed && (
        <div style={{ padding: '16px 20px', borderTop: '1px solid var(--border)', fontSize: '11px', color: 'var(--text-secondary)' }}>
          Exjet Aviation · Ops Dashboard
        </div>
      )}
    </aside>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd frontend && npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/Sidebar.jsx
git commit -m "feat(responsive): add collapsed icon-rail variant to Sidebar

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: TopNav — add compact (phone) variant

**Files:**
- Modify: `frontend/src/components/TopNav.jsx` (full rewrite below)

> Desktop/tablet default (`compact={false}`) renders identically to today. On phone, AppShell passes `compact` + `onMenu`; the shell tabs and Sign out move to the drawer, so the compact bar shows just a brand label and a ☰ button.

- [ ] **Step 1: Rewrite `TopNav.jsx`**

```jsx
// frontend/src/components/TopNav.jsx
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';

// Global top-level tabs: switch between the existing Dashboard and the separate
// Scheduling page. Rendered at the top of both layouts.
const TABS = [
  { label: 'Dashboard', to: '/', isActive: (p) => !p.startsWith('/scheduling') },
  { label: 'Scheduling', to: '/scheduling', isActive: (p) => p.startsWith('/scheduling') },
];

export default function TopNav({ compact = false, onMenu }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();

  if (compact) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        borderBottom: '1px solid var(--border)', marginBottom: 16, paddingBottom: 8,
      }}>
        <strong style={{ fontSize: 'var(--text-lg)', color: 'var(--text-primary)' }}>Exjet</strong>
        <div style={{ flex: 1 }} />
        <button onClick={onMenu} aria-label="Open menu" style={{
          background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8,
          color: 'var(--text-primary)', fontSize: 18, padding: '4px 12px', cursor: 'pointer',
        }}>☰</button>
      </div>
    );
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 4,
      borderBottom: '1px solid var(--border)', marginBottom: 24,
    }}>
      {TABS.map((t) => {
        const active = t.isActive(pathname);
        return (
          <button key={t.to} onClick={() => navigate(t.to)} style={{
            padding: '12px 22px', fontSize: 14, fontWeight: 600, cursor: 'pointer',
            background: 'none', border: 'none',
            color: active ? 'var(--accent)' : 'var(--text-secondary)',
            borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
          }}>
            {t.label}
          </button>
        );
      })}
      <div style={{ flex: 1 }} />
      <button onClick={() => supabase.auth.signOut()} title="Sign out" style={{
        padding: '7px 14px', fontSize: 12, background: 'var(--bg-card)',
        border: '1px solid var(--border)', borderRadius: 8,
        color: 'var(--text-secondary)', cursor: 'pointer',
      }}>
        Sign out
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd frontend && npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/TopNav.jsx
git commit -m "feat(responsive): add compact phone variant to TopNav

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: AppShell — own all shell/nav layout

**Files:**
- Create: `frontend/src/components/AppShell.jsx`

> AppShell encapsulates the shell for BOTH layouts. The desktop branches reproduce today's exact `App.jsx` markup (literal `32px` padding, `220px` sidebar, toggle button). Hooks are called unconditionally before any branch.

- [ ] **Step 1: Write the implementation**

```jsx
// frontend/src/components/AppShell.jsx
import { useState } from 'react';
import { useBreakpoint } from '../hooks/useBreakpoint';
import Sidebar from './Sidebar';
import TopNav from './TopNav';
import BottomTabBar from './BottomTabBar';
import NavDrawer from './NavDrawer';

// withSidebar: true for the Dashboard shell, false for the Scheduling shell.
export default function AppShell({ withSidebar = false, children }) {
  const { isPhone, isTablet } = useBreakpoint();
  const [sidebarOpen, setSidebarOpen] = useState(true); // desktop toggle (existing behavior)
  const [drawerOpen, setDrawerOpen] = useState(false);  // phone drawer

  // ---- PHONE (<768): bottom tab bar + drawer, no sidebar ----
  if (isPhone) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg-primary)' }}>
        <main style={{
          padding: 'var(--page-pad)',
          paddingBottom: 'calc(64px + env(safe-area-inset-bottom) + var(--page-pad))',
          minHeight: '100vh', boxSizing: 'border-box', overflowX: 'hidden',
        }}>
          <TopNav compact onMenu={() => setDrawerOpen(true)} />
          {children}
        </main>
        <BottomTabBar onMenu={() => setDrawerOpen(true)} />
        <NavDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
      </div>
    );
  }

  // ---- TABLET (768–1023) Dashboard: icon-rail sidebar ----
  if (isTablet && withSidebar) {
    const RAIL = 64;
    return (
      <div style={{ display: 'flex', minHeight: '100vh' }}>
        <Sidebar open collapsed />
        <main style={{
          marginLeft: RAIL, flex: 1, padding: 'var(--page-pad)',
          minHeight: '100vh', background: 'var(--bg-primary)', overflowX: 'hidden',
          maxWidth: `calc(100vw - ${RAIL}px)`, boxSizing: 'border-box',
        }}>
          <TopNav />
          {children}
        </main>
      </div>
    );
  }

  // ---- Scheduling shell (full width): desktop unchanged; tablet uses --page-pad ----
  if (!withSidebar) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg-primary)' }}>
        <main style={{
          padding: isTablet ? 'var(--page-pad)' : '32px',
          minHeight: '100vh', boxSizing: 'border-box', overflowX: 'hidden',
        }}>
          <TopNav />
          {children}
        </main>
      </div>
    );
  }

  // ---- DESKTOP Dashboard (>=1024): EXACT existing markup ----
  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <Sidebar open={sidebarOpen} />

      <button
        onClick={() => setSidebarOpen((o) => !o)}
        title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
        style={{
          position: 'fixed', top: '50%', left: sidebarOpen ? '208px' : '0px',
          transform: 'translateY(-50%)', zIndex: 200, width: '20px', height: '48px',
          background: 'var(--bg-secondary)', border: '1px solid var(--border)',
          borderLeft: sidebarOpen ? '1px solid var(--border)' : 'none',
          borderRadius: '0 6px 6px 0', cursor: 'pointer',
          color: 'var(--text-secondary)', fontSize: '10px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'left 0.2s ease', padding: 0,
        }}
      >
        {sidebarOpen ? '‹' : '›'}
      </button>

      <main style={{
        marginLeft: sidebarOpen ? '220px' : '0px', flex: 1, padding: '32px',
        minHeight: '100vh', background: 'var(--bg-primary)', overflowX: 'hidden',
        maxWidth: sidebarOpen ? 'calc(100vw - 220px)' : '100vw',
        boxSizing: 'border-box',
        transition: 'margin-left 0.2s ease, max-width 0.2s ease',
      }}>
        <TopNav />
        {children}
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd frontend && npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/AppShell.jsx
git commit -m "feat(responsive): add AppShell owning shell + nav layout

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: Wire App.jsx through AppShell + final verification

**Files:**
- Modify: `frontend/src/App.jsx` (replace the `Dashboard` and `SchedulingApp` shell wrappers)
- Modify: `CLAUDE.md` (§20 — note the new responsive foundation)

> The `<Routes>` blocks are unchanged — only the surrounding shell markup is replaced with `AppShell`. `Sidebar`/`TopNav` are no longer imported by `App.jsx` (AppShell imports them); `useState` is no longer needed in `App.jsx`.

- [ ] **Step 1: Replace imports and shells in `App.jsx`**

Change the top imports — remove the `useState`, `Sidebar`, and `TopNav` imports and add `AppShell`:

```js
// Remove: import { useState } from 'react';
// Remove: import Sidebar from './components/Sidebar';
// Remove: import TopNav from './components/TopNav';
// Add:
import AppShell from './components/AppShell';
```

Replace the entire `Dashboard()` function (lines 36–91 in the current file) with:

```jsx
// The existing dashboard: sidebar (desktop) / icon-rail (tablet) / bottom bar (phone).
function Dashboard() {
  return (
    <AppShell withSidebar>
      <Routes>
        <Route path="/" element={<Overview />} />
        <Route path="/map" element={<ErrorBoundary label="Fleet Map"><Map /></ErrorBoundary>} />
        <Route path="/calendar" element={<Calendar />} />
        <Route path="/flights" element={<Flights />} />
        <Route path="/flights/:id" element={<FlightDetail />} />
        <Route path="/trips/:id" element={<TripDetail />} />
        <Route path="/crew" element={<Crew />} />
        <Route path="/crew/:id" element={<CrewDetail />} />
        <Route path="/aircraft" element={<Aircraft />} />
        <Route path="/aircraft/:tail" element={<AircraftDetail />} />
        <Route path="/clients" element={<Clients />} />
        <Route path="/clients/:id" element={<ClientDetail />} />
        <Route path="/rate-cards" element={<RateCards />} />
        <Route path="/finances" element={<Finances />} />
        <Route path="/maintenance" element={<Maintenance />} />
        <Route path="/assistant" element={<AssistantPage />} />
        <Route path="/crew-calendar" element={<CrewCalendar />} />
        <Route path="/quotes" element={<Quotes />} />
      </Routes>
    </AppShell>
  );
}
```

Replace the entire `SchedulingApp()` function (lines 95–113 in the current file) with:

```jsx
// The Scheduling system as its OWN shell — full width, no dashboard sidebar.
function SchedulingApp() {
  return (
    <AppShell>
      <Routes>
        <Route index element={<Scheduling />} />
        <Route path="new" element={<NewQuoteRedirect />} />
        <Route path="quotes/:quoteNo" element={<QuoteEditor />} />
        <Route path="trips/:id" element={<SchedulingTripDetail />} />
        <Route path="trips/:id/sheet" element={<SchedulingTripSheet />} />
        <Route path="people/:id" element={<PersonProfile />} />
        <Route path="aircraft/:tail" element={<FleetAircraftDetail />} />
        <Route path="components" element={<FleetComponents />} />
      </Routes>
    </AppShell>
  );
}
```

(The `App()` function with `BrowserRouter` and the top-level routes stays exactly as-is.)

- [ ] **Step 2: Verify it compiles**

Run: `cd frontend && npm run build`
Expected: build succeeds with no unused-import or undefined-variable errors.

- [ ] **Step 3: Run the full frontend lib test suite (no regressions)**

Run: `cd frontend && node --test src/lib/*.test.js`
Expected: PASS — all lib tests pass, including the new `breakpoints`, `navConfig`, and `responsiveTable` tests.

- [ ] **Step 4: Manual responsive verification**

Run: `cd frontend && npm run dev`, then in Chrome DevTools device toolbar check:
- **390px (iPhone):** no left sidebar; bottom tab bar shows Calendar/Flights/Quotes/Overview/Menu; tabs navigate; ☰ (top or bottom) opens the drawer; drawer lists all links incl. Rate Cards & Maintenance, shows the Dashboard/Scheduling switch and Sign out; content is not hidden behind the bottom bar.
- **834px (iPad portrait):** Dashboard shows the 64px icon rail (icons only, logo shrunk); Scheduling is full-width; no bottom bar.
- **1024px+ (desktop):** **identical to `main`** — 220px sidebar, working ‹/› toggle, 32px padding, full TopNav with Dashboard/Scheduling tabs + Sign out. Compare side-by-side with a `git stash`/branch checkout if unsure.

Record the result of each check in the task notes. Do not mark complete unless the 1024px+ view matches `main`.

- [ ] **Step 5: Update CLAUDE.md §20**

In `CLAUDE.md`, in the §20 Frontend section, add a bullet near the top of the section (after the "Two shells" bullet) documenting the new foundation:

```markdown
- **Responsive foundation (mobile/iPad):** `hooks/useBreakpoint.js` (phone <768 / tablet 768–1023 / desktop ≥1024, from `lib/breakpoints.js`) drives structural swaps. `components/AppShell.jsx` owns both shells' layout: desktop = existing sidebar (unchanged); iPad-portrait = 64px icon-rail `Sidebar collapsed`; phone = `BottomTabBar` (Calendar/Flights/Quotes/Overview + Menu) + `NavDrawer` (full nav incl. hidden Rate Cards/Maintenance + shell switch + Sign out), nav list shared via `lib/navConfig.js`. Primitives `Sheet` (modal/drawer→full-screen on phone) and `ResponsiveTable` (records→cards, matrix→frozen-first-column scroll) exist for later tiers. Utility CSS in `styles/responsive.css` + spacing/type/`--page-pad` tokens in `index.css`. **Invariant: desktop (≥1024px) is unchanged.**
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/App.jsx CLAUDE.md
git commit -m "feat(responsive): wire App shells through AppShell; document foundation

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## What's next (later plans)

This plan delivers the foundation + working phone navigation with desktop untouched. Subsequent tier plans (each its own file) adopt these primitives:
- **Tier 1:** Calendar (agenda + Gantt toggle), Flights/Trips (`ResponsiveTable` records), Overview, Map (full-bleed phone), Finances (`ResponsiveTable` matrix + scrollable tabs).
- **Tier 2:** Scheduling editors (`QuoteEditor`, `SchedulingTripDetail`), `PricingSlideOut` + modals → `Sheet`.
- **Tier 3:** Crew, Aircraft, Clients, Fleet, RateCards, Maintenance, CrewCalendar, Assistant, FuelPrices, People/PersonProfile.

## Self-review notes (completed by plan author)

- **Spec coverage:** Foundation items from spec §5/§6 (breakpoints, tokens, `useBreakpoint`, `responsive.css`, AppShell, BottomTabBar, NavDrawer, Sheet, ResponsiveTable) each have a task. Nav decisions (hybrid, bottom tabs Calendar/Flights/Quotes/Overview, iPad icon-rail) implemented in Tasks 2/8/9/10/12. Desktop-unchanged invariant enforced via AppShell desktop branches + Task 13 Step 4 gate. Tier 1–3 page sweeps are explicitly deferred to later plans (spec §11).
- **Placeholder scan:** none — every code step has complete code; every run step has a command + expected result.
- **Type/name consistency:** `breakpointFor`/`BREAKPOINTS` (Task 1) used by `useBreakpoint` (3); `sidebarLinks`/`NAV_LINKS`/`BOTTOM_TABS`/`SHELL_TABS`/`isNavActive` (Task 2) used by Sidebar (10)/BottomTabBar (8)/NavDrawer (9); `cardFields` (Task 5) used by ResponsiveTable (6); `Sidebar collapsed`, `TopNav compact/onMenu`, `AppShell withSidebar` props consistent across Tasks 10/11/12/13.
