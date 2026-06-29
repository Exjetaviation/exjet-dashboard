// frontend/src/components/TopNav.jsx
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import logo from '../assets/logo.png';

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
        <img src={logo} alt="Exjet Aviation" style={{ height: 26, objectFit: 'contain', filter: 'brightness(0) invert(1)' }} />
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
