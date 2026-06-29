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
