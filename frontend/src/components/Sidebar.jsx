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
