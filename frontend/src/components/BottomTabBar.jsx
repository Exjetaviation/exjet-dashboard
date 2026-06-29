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
