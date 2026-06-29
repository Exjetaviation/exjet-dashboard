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
