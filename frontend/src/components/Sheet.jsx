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
