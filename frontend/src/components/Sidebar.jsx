import { NavLink } from 'react-router-dom';
import logo from '../assets/logo.png';

const links = [
  { to: '/', label: 'Overview', icon: '◈' },
  { to: '/map', label: 'Fleet Map', icon: '🗺' },
  { to: '/calendar', label: 'Calendar', icon: '▦' },
  { to: '/flights', label: 'Flights', icon: '✈' },
  { to: '/crew', label: 'Crew', icon: '👤' },
  { to: '/aircraft', label: 'Aircraft', icon: '🛩' },
  { to: '/clients', label: 'Clients', icon: '◎' },
  { to: '/quotes', label: 'Quotes', icon: '📋' },
  { to: '/finances', label: 'Finances', icon: '💰' },
  { to: '/rate-cards', label: 'Rate Cards', icon: '＄' },
  { to: '/maintenance', label: 'Maintenance', icon: '🔧' },
];

export default function Sidebar({ open = true }) {
  return (
    <aside style={{
      width: '220px', minHeight: '100vh',
      background: 'var(--bg-secondary)',
      borderRight: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column',
      position: 'fixed', top: 0, left: 0, zIndex: 100,
      transform: open ? 'translateX(0)' : 'translateX(-220px)',
      transition: 'transform 0.2s ease',
    }}>
      <div style={{ padding: '24px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <img src={logo} alt="Exjet Aviation" style={{ width: '200px', objectFit: 'contain', filter: 'brightness(0) invert(1)' }} />
      </div>
      <nav style={{ padding: '12px 0', flex: 1, overflowY: 'auto' }}>
        {links.map(({ to, label, icon }) => (
          <NavLink key={to} to={to} end={to === '/'} style={({ isActive }) => ({
            display: 'flex', alignItems: 'center', gap: '12px', padding: '11px 20px',
            color: isActive ? 'var(--accent)' : 'var(--text-secondary)',
            background: isActive ? 'rgba(79,142,247,0.08)' : 'transparent',
            borderLeft: isActive ? '2px solid var(--accent)' : '2px solid transparent',
            textDecoration: 'none', fontSize: '14px',
            fontWeight: isActive ? '500' : '400', transition: 'all 0.15s',
          })}>
            <span style={{ fontSize: '15px' }}>{icon}</span>
            {label}
          </NavLink>
        ))}
      </nav>
      <div style={{ padding: '16px 20px', borderTop: '1px solid var(--border)', fontSize: '11px', color: 'var(--text-secondary)' }}>
        Exjet Aviation · Ops Dashboard
      </div>
    </aside>
  );
}
