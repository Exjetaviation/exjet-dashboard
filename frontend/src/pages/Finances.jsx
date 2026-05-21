import { useState, useEffect } from 'react';
import { apiFetch } from '../lib/api';

const fmt  = (n) => `$${Math.round(n || 0).toLocaleString()}`;
const fmtK = (n) => {
  const v = Math.round(n || 0);
  if (Math.abs(v) >= 1000000) return `$${(v/1000000).toFixed(1)}M`;
  if (Math.abs(v) >= 1000)    return `$${Math.round(v/1000)}K`;
  return `$${v}`;
};

// Get last ColData value (YTD total in multi-column P&L)
const plVal = (rows, group) => {
  const row = (rows || []).find(r => r.group === group);
  const cols = row?.Summary?.ColData || [];
  return parseFloat(cols[cols.length - 1]?.value) || 0;
};

const TABS = ['overview','monthly','expenses','clients','aircraft','trips'];

export default function Finances() {
  const [tab, setTab]           = useState('overview');
  const [summary, setSummary]   = useState(null);
  const [aircraft, setAircraft] = useState([]);
  const [trips, setTrips]       = useState(null);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    apiFetch('/api/finances/summary')
      .then(r => r.json())
      .then(d => { setSummary(d); setLoading(false); })
      .catch(() => setLoading(false));
    apiFetch('/api/finances/by-aircraft')
      .then(r => r.json()).then(setAircraft).catch(() => {});
    apiFetch('/api/finances/by-trips')
      .then(r => r.json()).then(setTrips).catch(() => {});
  }, []);

  const pl     = summary?.profitAndLoss;
  const plLY   = summary?.profitAndLossLY;
  const plRows = pl?.Rows?.Row || [];
  const plRowsLY = plLY?.Rows?.Row || [];

  // Monthly columns from P&L
  const plCols = pl?.Columns?.Column || [];
  const monthCols = plCols.slice(1, -1); // skip label col and total col

  const getMonthlyVals = (group) => {
    const row = plRows.find(r => r.group === group);
    const cols = row?.Summary?.ColData || [];
    return cols.slice(1, -1).map(c => parseFloat(c.value) || 0);
  };

  const revenue      = plVal(plRows, 'Income');
  const cogs         = plVal(plRows, 'COGS');
  const grossProfit  = plVal(plRows, 'GrossProfit');
  const expenses     = plVal(plRows, 'Expenses');
  const netIncome    = plVal(plRows, 'NetIncome');
  const revenueLY    = plVal(plRowsLY, 'Income');

  const revByMonth   = getMonthlyVals('Income');
  const expByMonth   = getMonthlyVals('Expenses');
  const netByMonth   = getMonthlyVals('NetIncome');
  const maxMonthVal  = Math.max(...revByMonth, 1);

  // Outstanding invoices
  const outstandingList = (() => {
    const inv = summary?.invoices;
    const arr = Array.isArray(inv) ? inv : inv?.QueryResponse?.Invoice || [];
    return arr.filter(i => parseFloat(i.Balance || 0) > 0);
  })();
  const outstandingTotal = outstandingList.reduce((s, i) => s + parseFloat(i.Balance || 0), 0);

  // Customers
  const customerRows = (() => {
    const rows = summary?.customers?.Rows?.Row || [];
    return rows
      .filter(r => r.ColData && r.ColData[0]?.value && !r.ColData[0].value.includes('Total'))
      .map(r => ({ name: r.ColData[0]?.value, amount: parseFloat(r.ColData[1]?.value) || 0 }))
      .filter(r => r.amount > 0)
      .sort((a, b) => b.amount - a.amount);
  })();
  const maxCustomer = customerRows[0]?.amount || 1;

  // Expenses
  const expenseRows = (() => {
    const rows = summary?.expenses?.Rows?.Row || [];
    return rows
      .filter(r => r.ColData && r.ColData[0]?.value && !r.ColData[0].value.includes('Total'))
      .map(r => ({ name: r.ColData[0]?.value, amount: parseFloat(r.ColData[1]?.value) || 0 }))
      .filter(r => r.amount > 0)
      .sort((a, b) => b.amount - a.amount);
  })();
  const maxExpense = expenseRows[0]?.amount || 1;

  // Accounts
  const accounts = summary?.accounts || [];

  // Aircraft totals
  const totalAcRevenue = aircraft.filter(a => a.tail !== 'Untagged').reduce((s, a) => s + a.revenue, 0);

  // Trips
  const tripList = trips?.trips || [];

  const [expandedTrip, setExpandedTrip] = useState(null);

  const s = {
    page:  { padding: '28px 32px', maxWidth: '1400px' },
    hdr:   { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '24px', flexWrap: 'wrap', gap: '12px' },
    title: { fontSize: '22px', fontWeight: '700', color: 'var(--text-primary)', margin: 0 },
    sub:   { fontSize: '13px', color: 'var(--text-secondary)', margin: '4px 0 0' },
    tabs:  { display: 'flex', gap: '4px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '10px', padding: '4px', flexWrap: 'wrap' },
    tab:   (a) => ({ padding: '7px 14px', fontSize: '13px', fontWeight: a ? '600' : '400', background: a ? 'var(--accent)' : 'transparent', color: a ? '#fff' : 'var(--text-secondary)', border: 'none', borderRadius: '7px', cursor: 'pointer' }),
    grid:  (n) => ({ display: 'grid', gridTemplateColumns: `repeat(${n}, 1fr)`, gap: '14px' }),
    card:  { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', padding: '20px 22px' },
    sec:   { marginTop: '22px' },
    stl:   { fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '10px' },
    th:    { fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', padding: '8px 12px', textAlign: 'left', borderBottom: '1px solid var(--border)' },
    td:    { fontSize: '13px', color: 'var(--text-primary)', padding: '10px 12px', borderBottom: '1px solid var(--border)' },
  };

  const StatCard = ({ label, value, sub, color }) => (
    <div style={s.card}>
      <p style={{ fontSize: '11px', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.8px', margin: '0 0 8px' }}>{label}</p>
      <p style={{ fontSize: '26px', fontWeight: '700', color: color || 'var(--text-primary)', margin: '0 0 4px' }}>{value}</p>
      {sub && <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0 }}>{sub}</p>}
    </div>
  );

  const Bar = ({ pct, color = 'var(--accent)' }) => (
    <div style={{ height: '5px', background: 'var(--border)', borderRadius: '3px', overflow: 'hidden', marginTop: '5px' }}>
      <div style={{ height: '100%', width: `${Math.min(pct || 0, 100)}%`, background: color, borderRadius: '3px' }} />
    </div>
  );

  const Badge = ({ text, color }) => (
    <span style={{ fontSize: '11px', fontWeight: '600', padding: '2px 7px', borderRadius: '5px', background: `${color}22`, color }}>{text}</span>
  );

  if (loading) return (
    <div style={{ ...s.page, display: 'flex', alignItems: 'center', justifyContent: 'center', height: '400px' }}>
      <p style={{ color: 'var(--text-secondary)' }}>Loading QuickBooks data...</p>
    </div>
  );

  return (
    <div style={s.page}>

      {/* Header */}
      <div style={s.hdr}>
        <div>
          <h1 style={s.title}>Financial Overview</h1>
          <p style={s.sub}>QuickBooks · {new Date().getFullYear()} YTD</p>
        </div>
        <div style={s.tabs}>
          {TABS.map(t => (
            <button key={t} style={s.tab(tab === t)} onClick={() => setTab(t)}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* ── OVERVIEW ── */}
      {tab === 'overview' && (
        <>
          <div style={s.grid(5)}>
            <StatCard label="Total Revenue" value={fmtK(revenue)}
              sub={revenueLY > 0 ? `vs ${fmtK(revenueLY)} last year` : 'vs $0 last year'} />
            <StatCard label="Gross Profit" value={fmtK(grossProfit)}
              sub={`${revenue > 0 ? Math.round((grossProfit/revenue)*100) : 0}% margin`} color="#4f8ef7" />
            <StatCard label="Net Income" value={fmtK(netIncome)}
              color={netIncome >= 0 ? '#22c55e' : '#ef4444'}
              sub={`After all expenses`} />
            <StatCard label="Total Expenses" value={fmtK(expenses + cogs)}
              sub={`COGS ${fmtK(cogs)} · OpEx ${fmtK(expenses)}`} color="#f59e0b" />
            <StatCard label="Outstanding" value={fmtK(outstandingTotal)}
              sub={`${outstandingList.length} unpaid invoice${outstandingList.length !== 1 ? 's' : ''}`}
              color={outstandingTotal > 0 ? '#ef4444' : '#22c55e'} />
          </div>

          {/* Bank accounts */}
          {accounts.length > 0 && (
            <div style={s.sec}>
              <p style={s.stl}>Bank Accounts</p>
              <div style={s.grid(accounts.length)}>
                {accounts.map((acc, i) => (
                  <StatCard key={i} label={acc.Name} value={fmt(acc.CurrentBalance)}
                    color={acc.CurrentBalance >= 0 ? '#22c55e' : '#ef4444'}
                    sub={acc.AccountSubType} />
                ))}
              </div>
            </div>
          )}

          {/* Outstanding invoices */}
          {outstandingList.length > 0 && (
            <div style={s.sec}>
              <p style={s.stl}>Outstanding Invoices</p>
              <div style={s.card}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={s.th}>Invoice</th>
                      <th style={s.th}>Customer</th>
                      <th style={s.th}>Date</th>
                      <th style={s.th}>Due</th>
                      <th style={{ ...s.th, textAlign: 'right' }}>Amount</th>
                      <th style={{ ...s.th, textAlign: 'right' }}>Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {outstandingList.map((inv, i) => {
                      const overdue = new Date(inv.DueDate) < new Date();
                      return (
                        <tr key={i}>
                          <td style={s.td}><span style={{ color: 'var(--accent)', fontWeight: '600' }}>#{inv.DocNumber}</span></td>
                          <td style={s.td}>{inv.CustomerRef?.name || '—'}</td>
                          <td style={{ ...s.td, color: 'var(--text-secondary)' }}>{inv.TxnDate}</td>
                          <td style={s.td}><Badge text={inv.DueDate} color={overdue ? '#ef4444' : '#f59e0b'} /></td>
                          <td style={{ ...s.td, textAlign: 'right' }}>{fmt(inv.TotalAmt)}</td>
                          <td style={{ ...s.td, textAlign: 'right', fontWeight: '700', color: '#ef4444' }}>{fmt(inv.Balance)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Clients + Expenses side by side */}
          <div style={{ ...s.sec, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            <div>
              <p style={s.stl}>Top Clients</p>
              <div style={s.card}>
                {customerRows.slice(0, 8).map((c, i) => (
                  <div key={i} style={{ marginBottom: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: '13px' }}>{c.name}</span>
                      <span style={{ fontSize: '13px', fontWeight: '600', color: 'var(--accent)' }}>{fmt(c.amount)}</span>
                    </div>
                    <Bar pct={(c.amount / maxCustomer) * 100} />
                  </div>
                ))}
              </div>
            </div>
            <div>
              <p style={s.stl}>Top Expenses</p>
              <div style={s.card}>
                {expenseRows.slice(0, 8).map((e, i) => (
                  <div key={i} style={{ marginBottom: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: '13px' }}>{e.name}</span>
                      <span style={{ fontSize: '13px', fontWeight: '600', color: '#f59e0b' }}>{fmt(e.amount)}</span>
                    </div>
                    <Bar pct={(e.amount / maxExpense) * 100} color="#f59e0b" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── MONTHLY ── */}
      {tab === 'monthly' && (
        <div style={s.sec}>
          <div style={s.grid(3)}>
            <StatCard label="YTD Revenue"  value={fmtK(revenue)}  color="#4f8ef7" />
            <StatCard label="YTD Expenses" value={fmtK(expenses + cogs)} color="#f59e0b" />
            <StatCard label="YTD Net"      value={fmtK(netIncome)} color={netIncome >= 0 ? '#22c55e' : '#ef4444'} />
          </div>

          {/* Monthly bar chart */}
          <div style={{ ...s.card, marginTop: '16px' }}>
            <p style={{ ...s.stl, marginBottom: '20px' }}>Monthly Revenue vs Expenses</p>
            {revByMonth.length === 0 ? (
              <p style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>No monthly breakdown available.</p>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: '6px', height: '180px', marginBottom: '8px' }}>
                  {revByMonth.map((rev, i) => {
                    const exp = expByMonth[i] || 0;
                    const label = monthCols[i]?.ColTitle || `M${i+1}`;
                    return (
                      <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', height: '100%', justifyContent: 'flex-end' }}>
                        <div style={{ width: '100%', display: 'flex', gap: '2px', alignItems: 'flex-end', height: '160px', justifyContent: 'center' }}>
                          <div title={`Revenue: ${fmt(rev)}`} style={{ flex: 1, background: '#4f8ef7', borderRadius: '3px 3px 0 0', height: `${Math.max((rev/maxMonthVal)*100, rev > 0 ? 3 : 0)}%`, minWidth: '8px' }} />
                          <div title={`Expenses: ${fmt(exp)}`} style={{ flex: 1, background: '#f59e0b55', borderRadius: '3px 3px 0 0', height: `${Math.max((exp/maxMonthVal)*100, exp > 0 ? 3 : 0)}%`, minWidth: '8px' }} />
                        </div>
                        <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>{label}</span>
                      </div>
                    );
                  })}
                </div>
                <div style={{ display: 'flex', gap: '16px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><span style={{ width: '10px', height: '10px', background: '#4f8ef7', borderRadius: '2px', display: 'inline-block' }} /> Revenue</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><span style={{ width: '10px', height: '10px', background: '#f59e0b55', borderRadius: '2px', display: 'inline-block' }} /> Expenses</span>
                </div>
              </>
            )}
          </div>

          {/* Monthly table */}
          {revByMonth.length > 0 && (
            <div style={{ ...s.card, marginTop: '14px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={s.th}>Month</th>
                    <th style={{ ...s.th, textAlign: 'right' }}>Revenue</th>
                    <th style={{ ...s.th, textAlign: 'right' }}>Expenses</th>
                    <th style={{ ...s.th, textAlign: 'right' }}>Net</th>
                  </tr>
                </thead>
                <tbody>
                  {revByMonth.map((rev, i) => {
                    const exp = expByMonth[i] || 0;
                    const net = netByMonth[i] || 0;
                    const label = monthCols[i]?.ColTitle || `Month ${i+1}`;
                    if (rev === 0 && exp === 0) return null;
                    return (
                      <tr key={i}>
                        <td style={s.td}>{label}</td>
                        <td style={{ ...s.td, textAlign: 'right', color: '#4f8ef7', fontWeight: '600' }}>{fmt(rev)}</td>
                        <td style={{ ...s.td, textAlign: 'right', color: '#f59e0b' }}>{fmt(exp)}</td>
                        <td style={{ ...s.td, textAlign: 'right', fontWeight: '700', color: net >= 0 ? '#22c55e' : '#ef4444' }}>{fmt(net)}</td>
                      </tr>
                    );
                  })}
                  <tr style={{ background: 'var(--bg-secondary)' }}>
                    <td style={{ ...s.td, fontWeight: '700' }}>YTD Total</td>
                    <td style={{ ...s.td, textAlign: 'right', color: '#4f8ef7', fontWeight: '700' }}>{fmtK(revenue)}</td>
                    <td style={{ ...s.td, textAlign: 'right', color: '#f59e0b', fontWeight: '700' }}>{fmtK(expenses + cogs)}</td>
                    <td style={{ ...s.td, textAlign: 'right', fontWeight: '700', color: netIncome >= 0 ? '#22c55e' : '#ef4444' }}>{fmtK(netIncome)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── EXPENSES ── */}
      {tab === 'expenses' && (
        <div style={s.sec}>
          <div style={s.grid(3)}>
            <StatCard label="Total Expenses" value={fmtK(expenses + cogs)} color="#f59e0b" />
            <StatCard label="Cost of Goods Sold" value={fmtK(cogs)} sub="Fuel, crew, landing fees" color="#ef4444" />
            <StatCard label="Operating Expenses" value={fmtK(expenses)} sub="Admin, insurance, etc." color="#a855f7" />
          </div>
          <div style={{ marginTop: '16px' }}>
            <p style={s.stl}>All Vendors</p>
            <div style={s.card}>
              {expenseRows.length === 0 ? (
                <p style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>No expense data from QuickBooks.</p>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={s.th}>Vendor</th>
                      <th style={{ ...s.th, textAlign: 'right' }}>Amount</th>
                      <th style={{ ...s.th, textAlign: 'right' }}>% of Total</th>
                      <th style={{ ...s.th, width: '160px' }}>Share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {expenseRows.map((e, i) => (
                      <tr key={i}>
                        <td style={s.td}>{e.name}</td>
                        <td style={{ ...s.td, textAlign: 'right', fontWeight: '600', color: '#f59e0b' }}>{fmt(e.amount)}</td>
                        <td style={{ ...s.td, textAlign: 'right', color: 'var(--text-secondary)' }}>
                          {Math.round((e.amount / (expenses + cogs)) * 100)}%
                        </td>
                        <td style={s.td}><Bar pct={(e.amount / maxExpense) * 100} color="#f59e0b" /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── CLIENTS ── */}
      {tab === 'clients' && (
        <div style={s.sec}>
          <div style={s.grid(3)}>
            <StatCard label="Total Clients" value={customerRows.length} />
            <StatCard label="Top Client" value={customerRows[0]?.name || '—'}
              sub={fmt(customerRows[0]?.amount)} color="var(--accent)" />
            <StatCard label="Avg per Client"
              value={fmtK(customerRows.reduce((s,c)=>s+c.amount,0) / (customerRows.length||1))} />
          </div>
          <div style={{ marginTop: '16px' }}>
            <p style={s.stl}>Revenue by Client</p>
            <div style={s.card}>
              {customerRows.length === 0 ? (
                <p style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>No client data from QuickBooks.</p>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={{ ...s.th, width: '40px' }}>#</th>
                      <th style={s.th}>Client</th>
                      <th style={{ ...s.th, textAlign: 'right' }}>Revenue</th>
                      <th style={{ ...s.th, textAlign: 'right' }}>% of Total</th>
                      <th style={{ ...s.th, width: '160px' }}>Share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customerRows.map((c, i) => (
                      <tr key={i}>
                        <td style={{ ...s.td, color: 'var(--text-secondary)' }}>{i+1}</td>
                        <td style={{ ...s.td, fontWeight: i === 0 ? '600' : '400' }}>{c.name}</td>
                        <td style={{ ...s.td, textAlign: 'right', fontWeight: '600', color: 'var(--accent)' }}>{fmt(c.amount)}</td>
                        <td style={{ ...s.td, textAlign: 'right', color: 'var(--text-secondary)' }}>
                          {Math.round((c.amount / (customerRows.reduce((s,x)=>s+x.amount,0)||1)) * 100)}%
                        </td>
                        <td style={s.td}><Bar pct={(c.amount/maxCustomer)*100} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── AIRCRAFT ── */}
      {tab === 'aircraft' && (
        <div style={s.sec}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
            <p style={{ ...s.stl, margin: 0 }}>Revenue by Aircraft · from QB invoice class tags</p>
            <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '5px', background: '#f59e0b22', color: '#f59e0b', fontWeight: '600' }}>
              QB migration in progress — partial data
            </span>
          </div>
          <div style={s.grid(3)}>
            {aircraft.map((ac, i) => (
              <div key={i} style={s.card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                  <p style={{ fontSize: ac.tail === 'Untagged' ? '16px' : '22px', fontWeight: '700', color: ac.tail === 'Untagged' ? 'var(--text-secondary)' : 'var(--accent)', margin: 0 }}>{ac.tail}</p>
                  <span style={{ fontSize: '11px', padding: '2px 7px', borderRadius: '5px', background: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}>
                    {ac.invoiceCount} invoice{ac.invoiceCount !== 1 ? 's' : ''}
                  </span>
                </div>
                <p style={{ fontSize: '26px', fontWeight: '700', color: ac.tail === 'Untagged' ? 'var(--text-secondary)' : '#4f8ef7', margin: '0 0 8px' }}>{fmt(ac.revenue)}</p>
                <Bar pct={totalAcRevenue > 0 ? (ac.revenue / (totalAcRevenue + (aircraft.find(a=>a.tail==='Untagged')?.revenue||0))) * 100 : 0}
                  color={ac.tail === 'Untagged' ? '#888' : 'var(--accent)'} />
                {ac.tail === 'Untagged' && (
                  <p style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '8px' }}>
                    Invoices without an aircraft class tag
                  </p>
                )}
              </div>
            ))}
          </div>
          <div style={{ ...s.card, marginTop: '14px', borderColor: '#f59e0b44', background: '#f59e0b08' }}>
            <p style={{ fontSize: '13px', color: '#f59e0b', margin: 0 }}>
              ⚠️ As QB is fully migrated and all invoices are tagged with the correct aircraft class (N69FP / N408JS), the Untagged amount will move into the correct aircraft columns automatically.
            </p>
          </div>
        </div>
      )}

      {/* ── TRIPS ── */}
      {tab === 'trips' && (
        <div style={s.sec}>
          <div style={s.grid(4)}>
            <StatCard label="Total Invoices" value={trips?.totalTrips || 0} />
            <StatCard label="Total Revenue" value={fmtK(trips?.totalRevenue)} color="#4f8ef7" />
            <StatCard label="Outstanding" value={fmtK(trips?.totalOutstanding)} color="#ef4444" />
            <StatCard label="Collected" value={fmtK((trips?.totalRevenue||0) - (trips?.totalOutstanding||0))} color="#22c55e" />
          </div>
          <div style={{ marginTop: '16px' }}>
            <p style={s.stl}>All Invoices from QuickBooks</p>
            <div style={s.card}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={s.th}>Invoice</th>
                    <th style={s.th}>Customer</th>
                    <th style={s.th}>Description</th>
                    <th style={s.th}>Aircraft</th>
                    <th style={s.th}>Date</th>
                    <th style={s.th}>Status</th>
                    <th style={{ ...s.th, textAlign: 'right' }}>Amount</th>
                    <th style={{ ...s.th, width: '30px' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {tripList.map((t, i) => (
                    <>
                      <tr key={`t-${i}`}
                        onClick={() => setExpandedTrip(expandedTrip === t.invoiceId ? null : t.invoiceId)}
                        style={{ cursor: 'pointer', background: expandedTrip === t.invoiceId ? 'rgba(79,142,247,0.04)' : 'transparent' }}>
                        <td style={{ ...s.td, fontWeight: '600', color: 'var(--accent)' }}>#{t.docNumber}</td>
                        <td style={s.td}>{t.customer}</td>
                        <td style={{ ...s.td, color: 'var(--text-secondary)', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.description || '—'}</td>
                        <td style={s.td}>
                          {t.aircraft
                            ? <span style={{ fontSize: '11px', padding: '2px 6px', borderRadius: '4px', background: 'var(--accent)22', color: 'var(--accent)', fontWeight: '600' }}>{t.aircraft}</span>
                            : <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>—</span>}
                        </td>
                        <td style={{ ...s.td, color: 'var(--text-secondary)' }}>{t.date}</td>
                        <td style={s.td}>
                          <span style={{ fontSize: '11px', padding: '2px 6px', borderRadius: '4px', background: t.paid ? '#22c55e22' : '#ef444422', color: t.paid ? '#22c55e' : '#ef4444', fontWeight: '600' }}>
                            {t.paid ? 'Paid' : `Due ${t.dueDate}`}
                          </span>
                        </td>
                        <td style={{ ...s.td, textAlign: 'right', fontWeight: '700', color: '#4f8ef7' }}>{fmt(t.total)}</td>
                        <td style={{ ...s.td, color: 'var(--text-secondary)', textAlign: 'center' }}>
                          {expandedTrip === t.invoiceId ? '▲' : '▼'}
                        </td>
                      </tr>
                      {expandedTrip === t.invoiceId && t.lines.map((line, j) => (
                        <tr key={`l-${i}-${j}`} style={{ background: 'rgba(79,142,247,0.03)' }}>
                          <td colSpan={2} style={{ ...s.td, paddingLeft: '28px', fontSize: '12px', color: 'var(--text-secondary)' }}>↳ Line {j+1}</td>
                          <td style={{ ...s.td, fontSize: '12px' }} colSpan={2}>{line.description || '—'}</td>
                          <td style={{ ...s.td, fontSize: '12px', color: 'var(--text-secondary)' }}>{line.serviceDate || '—'}</td>
                          <td style={{ ...s.td, fontSize: '12px' }}>
                            {line.aircraft
                              ? <span style={{ fontSize: '11px', padding: '2px 6px', borderRadius: '4px', background: 'var(--accent)22', color: 'var(--accent)', fontWeight: '600' }}>{line.aircraft}</span>
                              : <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>no tag</span>}
                          </td>
                          <td style={{ ...s.td, textAlign: 'right', fontWeight: '600', color: '#4f8ef7', fontSize: '12px' }}>{fmt(line.amount)}</td>
                          <td />
                        </tr>
                      ))}
                    </>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}