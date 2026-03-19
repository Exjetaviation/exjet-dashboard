import { NavLink } from 'react-router-dom';
import logo from '../assets/logo.png';

const links = [
  { to: '/', label: 'Overview', icon: '◈' },
  { to: '/flights', label: 'Flights', icon: '✈' },
  { to: '/crew', label: 'Crew', icon: '👤' },
  { to: '/aircraft', label: 'Aircraft', icon: '🛩' },
  { to: '/clients', label: 'Clients', icon: '◎' },
  { to: '/financials', label: 'Financials', icon: '＄' },
];

export default function Sidebar() {
  return (
    <aside style={{
      width: '220px', minHeight: '100vh', background: 'var(--bg-secondary)',
      borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column',
      position: 'fixed', top: 0, left: 0, zIndex: 100,
    }}>
      <div style={{ padding: '24px 20px', borderBottom: '1px solid var(--border)' }}>
        <img src={logo} alt="Exjet Aviation" style={{ width: '140px', objectFit: 'contain' }} />
      </div>
      <nav style={{ padding: '16px 0', flex: 1 }}>
        {links.map(({ to, label, icon }) => (
          <NavLink key={to} to={to} end={to === '/'} style={({ isActive }) => ({
            display: 'flex', alignItems: 'center', gap: '12px', padding: '11px 20px',
            color: isActive ? 'var(--accent)' : 'var(--text-secondary)',
            background: isActive ? 'rgba(79,142,247,0.08)' : 'transparent',
            borderLeft: isActive ? '2px solid var(--accent)' : '2px solid transparent',
            textDecoration: 'none', fontSize: '14px',
            fontWeight: isActive ? '500' : '400', transition: 'all 0.15s',
          })}>
            <span style={{ fontSize: '16px' }}>{icon}</span>
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
