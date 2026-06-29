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
