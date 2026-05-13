import { useState, useEffect } from 'react';

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const fmt$ = v => {
  const n = parseFloat(v) || 0;
  return n < 0
    ? `-$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
    : `$${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
};

const getSection = (rows, group) =>
  rows?.find(r => r.group === group)?.Summary?.ColData?.slice(-1)[0]?.value || '0';

const getMonthlyData = (pl) => {
  if (!pl?.Columns?.Column) return [];
  const cols = pl.Columns.Column.filter(c => c.ColType === 'Money');
  const incomeRow = pl.Rows?.Row?.find(r => r.group === 'Income');
  const cogsRow   = pl.Rows?.Row?.find(r => r.group === 'COGS');
  const netRow    = pl.Rows?.Row?.find(r => r.group === 'NetIncome');
  return cols.filter(c => c.ColTitle !== 'Total').map((col, i) => ({
    month:   col.ColTitle,
    revenue: parseFloat(incomeRow?.Summary?.ColData?.[i + 1]?.value || 0),
    cogs:    parseFloat(cogsRow?.Summary?.ColData?.[i + 1]?.value   || 0),
    net:     parseFloat(netRow?.Summary?.ColData?.[i + 1]?.value    || 0),
  }));
};

const getExpenseBreakdown = (pl) => {
  if (!pl?.Rows?.Row) return [];
  const cogsSection = pl.Rows.Row.find(r => r.group === 'COGS');
  const expSection  = pl.Rows.Row.find(r => r.group === 'Expenses');
  const items = [];
  const addRows = (section) => {
    (section?.Rows?.Row || []).forEach(row => {
      if (row.type === 'Data') {
        const name  = row.ColData?.[0]?.value;
        const total = parseFloat(row.ColData?.slice(-1)[0]?.value || 0);
        if (name && total > 0) items.push({ name, total });
      } else if (row.type === 'Section') {
        const name  = row.Header?.ColData?.[0]?.value;
        const total = parseFloat(row.Summary?.ColData?.slice(-1)[0]?.value || 0);
        if (name && total > 0) items.push({ name, total });
      }
    });
  };
  addRows(cogsSection);
  addRows(expSection);
  return items.sort((a, b) => b.total - a.total).slice(0, 10);
};

const BAR_COLORS = ['#4f8ef7','#22c55e','#a855f7','#f59e0b','#ef4444','#06b6d4','#f97316','#84cc16','#ec4899','#8b5cf6'];

export default function Finances() {
  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState(null);
  const [tab, setTab]       = useState('overview');

  useEffect(() => {
    fetch(`${BASE_URL}/api/finances/summary`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, []);

  if (loading) return <div style={{ padding: '60px', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading financials...</div>;
  if (error)   return <div style={{ padding: '60px', textAlign: 'center', color: 'var(--danger)' }}>Error: {error}</div>;

  const pl   = data?.profitAndLoss;
  const plLY = data?.profitAndLossLY;
  const rows = pl?.Rows?.Row || [];

  const totalRevenue  = getSection(rows, 'Income');
  const totalCOGS     = getSection(rows, 'COGS');
  const grossProfit   = getSection(rows, 'GrossProfit');
  const totalExpenses = getSection(rows, 'Expenses');
  const netIncome     = getSection(rows, 'NetIncome');

  const lyRows      = plLY?.Rows?.Row || [];
  const lyRevenue   = getSection(lyRows, 'Income');
  const lyNetIncome = getSection(lyRows, 'NetIncome');

  const monthlyData = getMonthlyData(pl);
  const expenses    = getExpenseBreakdown(pl);
  const customers   = data?.customers?.Rows?.Row?.filter(r => r.ColData)
    .map(r => ({ name: r.ColData[0]?.value, total: parseFloat(r.ColData[1]?.value || 0) }))
    .filter(c => c.total > 0)
    .sort((a, b) => b.total - a.total) || [];

  const maxMonthlyRev = Math.max(...monthlyData.map(m => m.revenue), 1);
  const maxExpense    = Math.max(...expenses.map(e => e.total), 1);
  const maxCustomer   = Math.max(...customers.map(c => c.total), 1);

  const statCard = (label, value, sub, color) => (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', padding: '18px 20px', borderTop: `3px solid ${color}` }}>
      <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: '0 0 6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</p>
      <p style={{ fontSize: '26px', fontWeight: '700', color: 'var(--text-primary)', margin: '0 0 4px' }}>{fmt$(value)}</p>
      {sub && <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0 }}>{sub}</p>}
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: '600', color: 'var(--text-primary)', margin: 0 }}>Financial Overview</h1>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '3px' }}>
            Live data from QuickBooks · {new Date().getFullYear()} YTD
          </p>
        </div>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {['overview', 'monthly', 'expenses', 'clients', 'aircraft'].map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: '7px 14px', fontSize: '13px', fontWeight: tab === t ? '600' : '400',
              background: tab === t ? 'var(--accent)' : 'var(--bg-card)',
              color: tab === t ? '#fff' : 'var(--text-secondary)',
              border: `1px solid ${tab === t ? 'var(--accent)' : 'var(--border)'}`,
              borderRadius: '8px', cursor: 'pointer', textTransform: 'capitalize',
            }}>{t}</button>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
        {statCard('Total Revenue',  totalRevenue,  `vs ${fmt$(lyRevenue)} last year`, '#4f8ef7')}
        {statCard('Gross Profit',   grossProfit,   'After direct costs', '#22c55e')}
        {statCard('Net Income',     netIncome,     `vs ${fmt$(lyNetIncome)} last year`, parseFloat(netIncome) >= 0 ? '#22c55e' : '#ef4444')}
        {statCard('Total Expenses', totalExpenses, 'Operating expenses', '#f59e0b')}
        {statCard('Cost of Goods',  totalCOGS,     'Fuel, crew, landing fees', '#a855f7')}
      </div>

      {tab === 'overview' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', padding: '18px 20px' }}>
            <p style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)', margin: '0 0 16px' }}>Year over Year</p>
            {[['Revenue', totalRevenue, lyRevenue, '#4f8ef7'], ['Net Income', netIncome, lyNetIncome, '#22c55e']].map(([label, thisY, lastY, color]) => {
              const diff = parseFloat(thisY) - parseFloat(lastY);
              const pct  = parseFloat(lastY) !== 0 ? ((diff / Math.abs(parseFloat(lastY))) * 100).toFixed(1) : 'N/A';
              const maxVal = Math.max(Math.abs(parseFloat(thisY)), Math.abs(parseFloat(lastY)));
              return (
                <div key={label} style={{ marginBottom: '16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                    <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{label}</span>
                    <span style={{ fontSize: '12px', color: diff >= 0 ? 'var(--success)' : 'var(--danger)', fontWeight: '600' }}>{diff >= 0 ? '▲' : '▼'} {pct}%</span>
                  </div>
                  {[['2025', lastY, 'var(--border)'], ['2026', thisY, color]].map(([yr, val, clr]) => (
                    <div key={yr} style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '4px' }}>
                      <span style={{ fontSize: '12px', color: 'var(--text-secondary)', width: '40px' }}>{yr}</span>
                      <div style={{ flex: 1, height: '8px', background: 'var(--border)', borderRadius: '4px' }}>
                        <div style={{ width: `${Math.min(Math.abs(parseFloat(val)) / maxVal * 100, 100)}%`, height: '100%', background: clr, borderRadius: '4px' }} />
                      </div>
                      <span style={{ fontSize: '12px', color: clr === 'var(--border)' ? 'var(--text-secondary)' : clr, fontWeight: '600', width: '80px', textAlign: 'right' }}>{fmt$(val)}</span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', padding: '18px 20px' }}>
            <p style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)', margin: '0 0 16px' }}>Top Expense Categories</p>
            {expenses.slice(0, 6).map((e, i) => (
              <div key={e.name} style={{ marginBottom: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{e.name}</span>
                  <span style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-primary)' }}>{fmt$(e.total)}</span>
                </div>
                <div style={{ height: '6px', background: 'var(--border)', borderRadius: '3px' }}>
                  <div style={{ width: `${(e.total / maxExpense) * 100}%`, height: '100%', background: BAR_COLORS[i % BAR_COLORS.length], borderRadius: '3px' }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'monthly' && (
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', padding: '18px 20px' }}>
          <p style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)', margin: '0 0 20px' }}>Monthly Revenue vs Net Income</p>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', height: '200px' }}>
            {monthlyData.map((m, i) => (
              <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', height: '100%', justifyContent: 'flex-end' }}>
                <div style={{ width: '100%', display: 'flex', gap: '2px', alignItems: 'flex-end', flex: 1 }}>
                  <div style={{ flex: 1, background: '#4f8ef7', borderRadius: '3px 3px 0 0', height: `${(m.revenue / maxMonthlyRev) * 100}%`, minHeight: m.revenue > 0 ? '4px' : '0' }} />
                  <div style={{ flex: 1, background: m.net >= 0 ? '#22c55e' : '#ef4444', borderRadius: '3px 3px 0 0', height: `${(Math.abs(m.net) / maxMonthlyRev) * 100}%`, minHeight: Math.abs(m.net) > 0 ? '4px' : '0' }} />
                </div>
                <span style={{ fontSize: '9px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{m.month.split(' ')[0]}</span>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '16px', marginTop: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><div style={{ width: '10px', height: '10px', background: '#4f8ef7', borderRadius: '2px' }} /><span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Revenue</span></div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><div style={{ width: '10px', height: '10px', background: '#22c55e', borderRadius: '2px' }} /><span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Net Income</span></div>
          </div>
          <div style={{ marginTop: '20px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {monthlyData.map((m, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: i % 2 === 0 ? 'var(--bg-secondary)' : 'transparent', borderRadius: '6px', fontSize: '13px' }}>
                <span style={{ color: 'var(--text-secondary)' }}>{m.month}</span>
                <span style={{ color: 'var(--accent)' }}>{fmt$(m.revenue)}</span>
                <span style={{ color: m.net >= 0 ? 'var(--success)' : 'var(--danger)' }}>{fmt$(m.net)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'expenses' && (
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', padding: '18px 20px' }}>
          <p style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)', margin: '0 0 16px' }}>All Expense Categories YTD</p>
          {expenses.map((e, i) => (
            <div key={e.name} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
              <div style={{ width: '10px', height: '10px', borderRadius: '2px', background: BAR_COLORS[i % BAR_COLORS.length], flexShrink: 0 }} />
              <span style={{ flex: 1, fontSize: '13px', color: 'var(--text-secondary)' }}>{e.name}</span>
              <div style={{ width: '120px', height: '6px', background: 'var(--border)', borderRadius: '3px' }}>
                <div style={{ width: `${(e.total / maxExpense) * 100}%`, height: '100%', background: BAR_COLORS[i % BAR_COLORS.length], borderRadius: '3px' }} />
              </div>
              <span style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)', width: '90px', textAlign: 'right' }}>{fmt$(e.total)}</span>
            </div>
          ))}
        </div>
      )}

      {tab === 'clients' && (
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', padding: '18px 20px' }}>
          <p style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)', margin: '0 0 16px' }}>Revenue by Client YTD</p>
          {customers.map((c, i) => (
            <div key={c.name} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
              <span style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-secondary)', width: '20px' }}>{i + 1}</span>
              <span style={{ flex: 1, fontSize: '13px', color: 'var(--text-primary)' }}>{c.name}</span>
              <div style={{ width: '140px', height: '6px', background: 'var(--border)', borderRadius: '3px' }}>
                <div style={{ width: `${(c.total / maxCustomer) * 100}%`, height: '100%', background: BAR_COLORS[i % BAR_COLORS.length], borderRadius: '3px' }} />
              </div>
              <span style={{ fontSize: '13px', fontWeight: '600', color: 'var(--accent)', width: '100px', textAlign: 'right' }}>{fmt$(c.total)}</span>
            </div>
          ))}
        </div>
      )}

{tab === 'aircraft' && (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
    {(data?.byClass || []).map(ac => {
      const s = ac.stats || {};
      if (s.error) return (
        <div key={ac.name} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', padding: '20px' }}>
          <span style={{ color: 'var(--accent)', fontWeight: '700', fontSize: '18px' }}>{ac.name}</span>
          <p style={{ color: 'var(--danger)', fontSize: '13px', marginTop: '8px' }}>Error: {s.error}</p>
        </div>
      );
      const maxExp = Math.max(...(s.expenseBreakdown || []).map(e => e.total), 1);
      const maxMonth = Math.max(...(s.monthly || []).map(m => m.revenue), 1);
      return (
        <div key={ac.name} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{ fontSize: '22px', fontWeight: '700', color: 'var(--accent)' }}>{ac.name}</span>
              <span style={{ fontSize: '12px', padding: '3px 10px', borderRadius: '20px', background: s.net >= 0 ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)', color: s.net >= 0 ? 'var(--success)' : 'var(--danger)', border: `1px solid ${s.net >= 0 ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}`, fontWeight: '600' }}>
                {s.margin}% margin
              </span>
            </div>
            <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>YTD {new Date().getFullYear()}</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
            {[
              ['Revenue',     s.revenue,       '#4f8ef7'],
              ['Net Income',  s.net,            s.net >= 0 ? '#22c55e' : '#ef4444'],
              ['Total Costs', s.totalExpenses,  '#f59e0b'],
              ['Fuel',        s.fuel,           '#a855f7'],
              ['Crew',        s.crew,           '#06b6d4'],
              ['Maintenance', s.maintenance,    '#f97316'],
            ].map(([label, value, color]) => (
              <div key={label} style={{ padding: '14px 18px', borderRight: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}>
                <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</p>
                <p style={{ fontSize: '18px', fontWeight: '700', color, margin: 0 }}>{fmt$(value || 0)}</p>
              </div>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0' }}>
            <div style={{ padding: '16px 20px', borderRight: '1px solid var(--border)' }}>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Expense breakdown</p>
              {(s.expenseBreakdown || []).slice(0, 8).map((e, i) => (
                <div key={e.name} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                  <div style={{ width: '8px', height: '8px', borderRadius: '2px', background: BAR_COLORS[i % BAR_COLORS.length], flexShrink: 0 }} />
                  <span style={{ flex: 1, fontSize: '11px', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.name}</span>
                  <div style={{ width: '60px', height: '4px', background: 'var(--border)', borderRadius: '2px' }}>
                    <div style={{ width: `${(e.total / maxExp) * 100}%`, height: '100%', background: BAR_COLORS[i % BAR_COLORS.length], borderRadius: '2px' }} />
                  </div>
                  <span style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-primary)', width: '70px', textAlign: 'right' }}>{fmt$(e.total)}</span>
                </div>
              ))}
            </div>

            <div style={{ padding: '16px 20px' }}>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Monthly revenue</p>
              <div style={{ display: 'flex', gap: '4px', alignItems: 'flex-end', height: '80px' }}>
                {(s.monthly || []).map((m, i) => (
                  <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px', height: '100%', justifyContent: 'flex-end' }}>
                    <div style={{ width: '100%', background: '#4f8ef7', borderRadius: '2px 2px 0 0', height: `${(m.revenue / maxMonth) * 100}%`, minHeight: m.revenue > 0 ? '3px' : '0' }} />
                    <span style={{ fontSize: '8px', color: 'var(--text-secondary)' }}>{m.month.slice(5)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      );
    })}
  </div>
)}
    </div>
  );
}