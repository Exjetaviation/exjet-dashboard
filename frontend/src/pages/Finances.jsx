import React, { Fragment, useState, useEffect } from 'react';
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

  // Trips
  const tripList = trips?.trips || [];

  const [expandedTrip, setExpandedTrip] = useState(null);
  const [expandedCat, setExpandedCat] = useState(null);

  // Round 2a parsed feeds — A/R + A/P aging, balance sheet, cash flow,
  // per-aircraft bill totals, and the P&L Detail drill-down map.
  const arAging        = summary?.arAging;
  const apAging        = summary?.apAging;
  const balanceSheet   = summary?.balanceSheet;
  const cashFlowData   = summary?.cashFlow;
  const cogsByCategory = summary?.cogsByCategory || [];
  const expByCategory  = summary?.expensesByCategory || [];
  const plDetailMap    = summary?.plDetailByCategory || {};
  const plClasses      = summary?.plByClass?.classes || [];
  const tripsPL        = summary?.tripsProfitability?.trips || [];
  const outOfFleetPL   = summary?.tripsProfitability?.outOfFleet || null;

  // Merge per-trip P&L (income / costs / profit) with the per-invoice list
  // (paid status, line items). Key by trip ID extracted from the customer
  // name. Trips that exist in only one source still show up (some invoices
  // aren't yet customer-keyed; some sub-customers may have had bills but
  // no invoice yet).
  const tripsMerged = (() => {
    const byId = new Map();
    for (const t of tripsPL) {
      if (!t.tripId) continue;
      byId.set(t.tripId, { tripId: t.tripId, name: t.name, pl: t, invoices: [] });
    }
    for (const inv of tripList) {
      const id = inv.tripId;
      if (!id) continue;
      if (!byId.has(id)) byId.set(id, { tripId: id, name: inv.customer || `Trip ${id}`, pl: null, invoices: [] });
      byId.get(id).invoices.push(inv);
    }
    const merged = Array.from(byId.values()).map(t => {
      const invoiceTotal = t.invoices.reduce((s, i) => s + (i.total || 0), 0);
      const outstanding  = t.invoices.reduce((s, i) => s + (i.balance || 0), 0);
      const aircraft     = t.invoices.find(i => i.aircraft)?.aircraft || null;
      const lastDate     = t.invoices.map(i => i.date).filter(Boolean).sort().slice(-1)[0] || null;
      return { ...t, invoiceTotal, outstanding, aircraft, lastDate };
    });
    // Sort: trips with non-trivial revenue first (desc), then by latest date.
    merged.sort((a, b) => (b.pl?.income || b.invoiceTotal) - (a.pl?.income || a.invoiceTotal));
    return merged;
  })();

  const tripsTotalRevenue = tripsPL.reduce((s, t) => s + (t.income || 0), 0);
  const tripsTotalCosts   = tripsPL.reduce((s, t) => s + (t.totalExpenses || 0), 0);
  const allRevenue        = tripsTotalRevenue + (outOfFleetPL?.income || 0);
  const allCosts          = tripsTotalCosts + (outOfFleetPL?.totalExpenses || 0);
  const tripsLoaded       = tripsPL.length > 0 || outOfFleetPL != null;

  // Fleet aircraft (matching the QB class names). Anything QBO reports under a
  // different class — including its "Not Specified" no-class bucket — folds
  // into one "Other planes outside of fleet" row.
  const FLEET_TAILS = ['N69FP', 'N408JS'];
  const aircraftPL = (() => {
    const sumKey = k => plClasses.filter(c => !FLEET_TAILS.includes(c.className)).reduce((s, c) => s + (c[k] || 0), 0);
    const blank = { income: 0, cogs: 0, grossProfit: 0, expenses: 0, netIncome: 0 };
    const otherClassNames = plClasses.filter(c => !FLEET_TAILS.includes(c.className)).map(c => c.className);
    const cards = FLEET_TAILS.map(tail => {
      const c = plClasses.find(x => x.className === tail);
      return { tail, isFleet: true, ...(c ? { income: c.income, cogs: c.cogs, grossProfit: c.grossProfit, expenses: c.expenses, netIncome: c.netIncome } : blank) };
    });
    cards.push({
      tail: 'Other planes outside of fleet',
      isFleet: false,
      income:      sumKey('income'),
      cogs:        sumKey('cogs'),
      grossProfit: sumKey('grossProfit'),
      expenses:    sumKey('expenses'),
      netIncome:   sumKey('netIncome'),
      classNames:  otherClassNames,
    });
    return cards;
  })();

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

  // Bucket colors graduate from healthy (green) to alarming (deep red) so the
  // bars and the per-customer badges read at a glance.
  const BUCKETS = [
    { key: 'current', label: 'Current', short: 'Curr',  color: '#22c55e' },
    { key: 'b1to30',  label: '1 – 30',  short: '1-30',  color: '#4f8ef7' },
    { key: 'b31to60', label: '31 – 60', short: '31-60', color: '#f59e0b' },
    { key: 'b61to90', label: '61 – 90', short: '61-90', color: '#ef4444' },
    { key: 'b91plus', label: '91 +',    short: '91+',   color: '#dc2626' },
  ];

  const AgingPanel = ({ title, aging, emptyHint, nameLabel }) => {
    if (!aging) return null;
    const total = aging.totals?.total || 0;
    if (total === 0) {
      return (
        <div>
          <p style={s.stl}>{title}</p>
          <div style={s.card}><p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0 }}>{emptyHint || 'Nothing outstanding.'}</p></div>
        </div>
      );
    }
    // Sort worst first: most $ in 61+ days, tiebreaker by total balance.
    const sortedRows = [...aging.rows].sort((a, b) =>
      (b.b91plus + b.b61to90) - (a.b91plus + a.b61to90) || b.total - a.total
    );
    return (
      <div>
        <p style={s.stl}>{title} · {fmt(total)} total · as of {aging.asOf}</p>
        <div style={s.card}>
          <div style={{ display: 'grid', gridTemplateColumns: '78px 1fr 120px', columnGap: 10, rowGap: 7, alignItems: 'center' }}>
            {BUCKETS.map(b => {
              const amt = aging.totals[b.key] || 0;
              const pct = total > 0 ? (amt / total) * 100 : 0;
              return (
                <Fragment key={b.key}>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{b.label}</span>
                  <Bar pct={pct} color={b.color} />
                  <span style={{ fontSize: 12, textAlign: 'right', fontWeight: amt > 0 ? 600 : 400, color: amt > 0 ? b.color : 'var(--text-secondary)' }}>
                    {fmt(amt)} <span style={{ color: 'var(--text-secondary)', fontWeight: 400 }}>· {Math.round(pct)}%</span>
                  </span>
                </Fragment>
              );
            })}
          </div>
          <div style={{ marginTop: 18, borderTop: '1px solid var(--border)', paddingTop: 4 }}>
            <p style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.6, margin: '6px 0 4px' }}>{nameLabel} (worst-first)</p>
            {sortedRows.map((r, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderTop: i === 0 ? 'none' : '1px solid var(--border)' }}>
                <span style={{ flex: 1, fontSize: 13 }}>{r.name}</span>
                <div style={{ display: 'flex', gap: 8, fontSize: 10 }}>
                  {BUCKETS.filter(b => r[b.key] > 0).map(b => (
                    <span key={b.key} style={{ color: b.color, fontWeight: 600, padding: '1px 5px', borderRadius: 3, background: `${b.color}1f` }}>{b.short}&nbsp;{fmt(r[b.key])}</span>
                  ))}
                </div>
                <span style={{ fontWeight: 700, color: 'var(--text-primary)', minWidth: 88, textAlign: 'right' }}>{fmt(r.total)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  const BalanceSheetPanel = ({ bs }) => {
    if (!bs) return null;
    const Row = ({ label, value, bold, color }) => (
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '7px 0', borderTop: '1px solid var(--border)' }}>
        <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: bold ? 700 : 400 }}>{label}</span>
        <span style={{ fontSize: bold ? 15 : 13, fontWeight: bold ? 700 : 600, color: color || 'var(--text-primary)' }}>{fmt(value)}</span>
      </div>
    );
    return (
      <div>
        <p style={s.stl}>Balance Sheet · as of {bs.asOf}</p>
        <div style={{ ...s.grid(3), marginBottom: 14 }}>
          <StatCard label="Working Capital" value={fmtK(bs.workingCapital)} color={bs.workingCapital >= 0 ? '#22c55e' : '#ef4444'} sub="Current assets − current liabilities" />
          <StatCard label="Cash on Hand"    value={fmtK(bs.cash)} color="#22c55e" sub="Across bank accounts" />
          <StatCard label="Equity"          value={fmtK(bs.equity)} color="#4f8ef7" sub="Net of all liabilities" />
        </div>
        <div style={{ ...s.grid(2), gap: 14 }}>
          <div style={s.card}>
            <p style={{ fontSize: 11, fontWeight: 700, color: '#4f8ef7', textTransform: 'uppercase', letterSpacing: 0.5, margin: '0 0 6px' }}>Assets</p>
            <Row label="Cash"                 value={bs.cash} color="#22c55e" />
            <Row label="Accounts Receivable"  value={bs.ar} color="#4f8ef7" />
            <Row label="Other Current Assets" value={bs.otherCurrentAssets} />
            <Row label="Total Assets"         value={bs.totalAssets} bold />
          </div>
          <div style={s.card}>
            <p style={{ fontSize: 11, fontWeight: 700, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: 0.5, margin: '0 0 6px' }}>Liabilities &amp; Equity</p>
            <Row label="Accounts Payable"          value={bs.ap} color="#ef4444" />
            <Row label="Credit Cards"              value={bs.creditCards} color="#ef4444" />
            <Row label="Other Current Liabilities" value={bs.otherCurrentLiab} />
            <Row label="Long-Term Liabilities"     value={bs.longTermLiab} />
            <Row label="Total Liabilities"         value={bs.totalLiab} bold color="#ef4444" />
            <Row label="Equity"                    value={bs.equity} bold color="#22c55e" />
          </div>
        </div>
      </div>
    );
  };

  const CashFlowChart = ({ cf }) => {
    if (!cf || !cf.operating) return null;
    // QBO appends a 'Total' column — strip it from the per-month chart so
    // monthly bars are comparable to each other.
    const months = cf.columns.slice(0, -1);
    const oper   = cf.operating.slice(0, -1);
    const fin    = (cf.financing || []).slice(0, -1);
    const net    = (cf.netChange  || []).slice(0, -1);
    const totalOper = cf.operating[cf.operating.length - 1] || 0;
    const totalNet  = (cf.netChange?.[cf.netChange.length - 1]) || 0;
    const totalFin  = (cf.financing?.[cf.financing.length - 1]) || 0;
    const maxAbs = Math.max(1, ...oper.map(Math.abs), ...fin.map(Math.abs), ...net.map(Math.abs));
    return (
      <div style={{ ...s.card, marginTop: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
          <p style={{ ...s.stl, margin: 0 }}>Operating Cash Flow · Monthly</p>
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: 0 }}>
            YTD operating: <span style={{ fontWeight: 700, color: totalOper >= 0 ? '#22c55e' : '#ef4444' }}>{fmt(totalOper)}</span>
            {' · '}financing: <span style={{ fontWeight: 700, color: totalFin >= 0 ? '#22c55e' : '#ef4444' }}>{fmt(totalFin)}</span>
            {' · '}net change: <span style={{ fontWeight: 700, color: totalNet >= 0 ? '#22c55e' : '#ef4444' }}>{fmt(totalNet)}</span>
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, height: 200, marginBottom: 8 }}>
          {oper.map((v, i) => {
            const h = `${Math.max((Math.abs(v) / maxAbs) * 95, v !== 0 ? 3 : 0)}%`;
            const positive = v >= 0;
            return (
              <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, height: '100%', justifyContent: positive ? 'flex-end' : 'flex-start' }}>
                <div title={`${months[i]}: ${fmt(v)}`} style={{ width: '100%', height: h, background: positive ? '#22c55e' : '#ef4444', borderRadius: positive ? '3px 3px 0 0' : '0 0 3px 3px', minWidth: 8 }} />
                <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>{months[i]}</span>
              </div>
            );
          })}
        </div>
        <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--text-secondary)' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 10, height: 10, background: '#22c55e', borderRadius: 2, display: 'inline-block' }} /> Positive operating cash</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 10, height: 10, background: '#ef4444', borderRadius: 2, display: 'inline-block' }} /> Negative</span>
        </div>
      </div>
    );
  };

  // Category list with click-to-drill into the P&L Detail transactions.
  const CategoryGroup = ({ title, rows, accent, total }) => {
    if (!rows?.length) return null;
    const max = Math.max(...rows.map(r => r.amount), 1);
    return (
      <div style={{ ...s.sec }}>
        <p style={s.stl}>{title} · {fmtK(total)}</p>
        <div style={s.card}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={s.th}>Category</th>
                <th style={{ ...s.th, textAlign: 'right' }}>Amount</th>
                <th style={{ ...s.th, textAlign: 'right' }}>% of Group</th>
                <th style={{ ...s.th, width: '170px' }}>Share</th>
                <th style={{ ...s.th, textAlign: 'right', width: '78px' }}>Txns</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const txns = plDetailMap[r.category] || [];
                const isOpen = expandedCat === r.category;
                return (
                  <Fragment key={i}>
                    <tr onClick={() => setExpandedCat(isOpen ? null : r.category)}
                        style={{ cursor: txns.length ? 'pointer' : 'default', background: isOpen ? 'rgba(79,142,247,0.04)' : 'transparent' }}>
                      <td style={s.td}>
                        <span style={{ marginRight: 6, color: 'var(--text-secondary)', fontSize: 10 }}>{txns.length ? (isOpen ? '▼' : '▶') : ' '}</span>
                        {r.category}
                      </td>
                      <td style={{ ...s.td, textAlign: 'right', fontWeight: 600, color: accent }}>{fmt(r.amount)}</td>
                      <td style={{ ...s.td, textAlign: 'right', color: 'var(--text-secondary)' }}>{total > 0 ? Math.round((r.amount / total) * 100) : 0}%</td>
                      <td style={s.td}><Bar pct={(r.amount / max) * 100} color={accent} /></td>
                      <td style={{ ...s.td, textAlign: 'right', color: 'var(--text-secondary)' }}>{txns.length || '—'}</td>
                    </tr>
                    {isOpen && txns.length > 0 && (
                      <tr style={{ background: 'rgba(79,142,247,0.02)' }}>
                        <td colSpan={5} style={{ padding: '0 12px 12px' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 6 }}>
                            <thead>
                              <tr>
                                <th style={{ ...s.th, padding: '6px 8px' }}>Date</th>
                                <th style={{ ...s.th, padding: '6px 8px' }}>Type</th>
                                <th style={{ ...s.th, padding: '6px 8px' }}>Vendor / Source</th>
                                <th style={{ ...s.th, padding: '6px 8px' }}>Aircraft</th>
                                <th style={{ ...s.th, padding: '6px 8px' }}>Memo</th>
                                <th style={{ ...s.th, padding: '6px 8px', textAlign: 'right' }}>Amount</th>
                              </tr>
                            </thead>
                            <tbody>
                              {[...txns].sort((a, b) => (b.date || '').localeCompare(a.date || '')).map((t, j) => (
                                <tr key={j}>
                                  <td style={{ ...s.td, padding: '6px 8px', fontSize: 12, color: 'var(--text-secondary)' }}>{t.date}</td>
                                  <td style={{ ...s.td, padding: '6px 8px', fontSize: 12 }}>{t.type}</td>
                                  <td style={{ ...s.td, padding: '6px 8px', fontSize: 12 }}>{t.name || '—'}</td>
                                  <td style={{ ...s.td, padding: '6px 8px', fontSize: 12 }}>
                                    {t.klass ? <span style={{ fontSize: 11, padding: '1px 5px', borderRadius: 3, background: 'var(--accent)22', color: 'var(--accent)', fontWeight: 600 }}>{t.klass}</span> : <span style={{ color: 'var(--text-secondary)' }}>—</span>}
                                  </td>
                                  <td style={{ ...s.td, padding: '6px 8px', fontSize: 12, color: 'var(--text-secondary)', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.memo || '—'}</td>
                                  <td style={{ ...s.td, padding: '6px 8px', fontSize: 12, textAlign: 'right', fontWeight: 600, color: accent }}>{fmt(t.amount)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

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

          {/* Balance Sheet snapshot */}
          {balanceSheet && (
            <div style={s.sec}>
              <BalanceSheetPanel bs={balanceSheet} />
            </div>
          )}

          {/* A/R + A/P aging side by side */}
          {(arAging || apAging) && (
            <div style={{ ...s.sec, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
              <AgingPanel title="A/R Aging — what's owed to us" aging={arAging} nameLabel="Customers" emptyHint="No open invoices. Nothing outstanding." />
              <AgingPanel title="A/P Aging — what we owe vendors" aging={apAging} nameLabel="Vendors" emptyHint="No open bills." />
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

          {/* Cash flow per month */}
          <CashFlowChart cf={cashFlowData} />
        </div>
      )}

      {/* ── EXPENSES ── */}
      {tab === 'expenses' && (
        <div style={s.sec}>
          <div style={s.grid(3)}>
            <StatCard label="Total Expenses" value={fmtK(expenses + cogs)} color="#f59e0b" />
            <StatCard label="Cost of Goods Sold" value={fmtK(cogs)} sub="Fuel, crew, landing fees" color="#ef4444" />
            <StatCard label="Operating Expenses" value={fmtK(expenses)} sub="Admin, hangar, software" color="#a855f7" />
          </div>

          {/* Per-flight direct costs — what each trip burns through */}
          <CategoryGroup
            title="Direct Costs · Cost of Goods Sold"
            rows={cogsByCategory}
            accent="#ef4444"
            total={cogs}
          />

          {/* Operating overhead — what keeps the lights on */}
          <CategoryGroup
            title="Operating Expenses"
            rows={expByCategory}
            accent="#a855f7"
            total={expenses}
          />

          {(cogsByCategory.length === 0 && expByCategory.length === 0) && (
            <div style={{ ...s.card, marginTop: 16 }}>
              <p style={{ color: 'var(--text-secondary)', fontSize: 13, margin: 0 }}>No expense data from QuickBooks yet.</p>
            </div>
          )}

          <p style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 12, fontStyle: 'italic' }}>
            Click a category row to see the underlying transactions (date, vendor, aircraft tag, memo).
          </p>
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
            <p style={{ ...s.stl, margin: 0 }}>Profit by Aircraft · QuickBooks ProfitAndLoss by Class</p>
          </div>
          <div style={s.grid(3)}>
            {aircraftPL.map((ac, i) => {
              const expensesAll = (ac.cogs || 0) + (ac.expenses || 0);
              const ai = aircraft.find(a => a.tail === ac.tail);
              const profitColor = ac.netIncome >= 0 ? '#22c55e' : '#ef4444';
              return (
                <div key={i} style={s.card}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px' }}>
                    <p style={{ fontSize: ac.isFleet ? '22px' : '15px', fontWeight: '700', color: ac.isFleet ? 'var(--accent)' : 'var(--text-secondary)', margin: 0 }}>{ac.tail}</p>
                    {ai && (
                      <span style={{ fontSize: '11px', padding: '2px 7px', borderRadius: '5px', background: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}>
                        {ai.invoiceCount} invoice{ai.invoiceCount !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '7px 0', borderTop: '1px solid var(--border)' }}>
                    <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Income</span>
                    <span style={{ fontSize: 15, fontWeight: 700, color: '#4f8ef7' }}>{fmt(ac.income)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '7px 0', borderTop: '1px solid var(--border)' }}>
                    <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Direct costs (COGS)</span>
                    <span style={{ fontSize: 14, fontWeight: 600, color: '#ef4444' }}>{fmt(ac.cogs)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '7px 0', borderTop: '1px solid var(--border)' }}>
                    <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Operating expenses</span>
                    <span style={{ fontSize: 14, fontWeight: 600, color: '#a855f7' }}>{fmt(ac.expenses)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '7px 0', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}>
                    <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 700 }}>Net income</span>
                    <span style={{ fontSize: 17, fontWeight: 700, color: profitColor }}>{fmt(ac.netIncome)}</span>
                  </div>
                  {ac.income !== 0 && (
                    <p style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 8 }}>
                      Margin: <span style={{ color: profitColor, fontWeight: 600 }}>{Math.round((ac.netIncome / ac.income) * 100)}%</span>
                      {' · '}Expenses: {fmt(expensesAll)}
                    </p>
                  )}
                  {!ac.isFleet && ac.classNames?.length > 0 && (
                    <p style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 8 }}>
                      Rolls up: {ac.classNames.join(', ')}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
          {plClasses.length === 0 && (
            <div style={{ ...s.card, marginTop: 14 }}>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0 }}>
                P&amp;L by Class hasn't come back from QuickBooks yet. If this persists, check the debug dump at <code>/api/finances/debug/financials</code>.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── TRIPS ── */}
      {tab === 'trips' && (
        <div style={s.sec}>
          {/* No Profit StatCard here — per-trip costs are partial (sub-customer
              tagging on bills isn't strict), so a top-line profit number would
              mislead. The per-row table still shows margin for trips with valid
              cost data. */}
          <div style={s.grid(3)}>
            <StatCard label="Trips Tracked"
              value={tripsLoaded ? tripsPL.length : (trips?.totalTrips || 0)}
              sub={outOfFleetPL ? `+ ${outOfFleetPL.customerCount} planes outside of fleet` : `${trips?.totalTrips || 0} invoices`} />
            <StatCard label="Revenue" value={fmtK(allRevenue || trips?.totalRevenue)} color="#4f8ef7"
              sub={outOfFleetPL ? `${fmtK(tripsTotalRevenue)} trips · ${fmtK(outOfFleetPL.income)} outside fleet` : 'From QB per-trip P&L'} />
            <StatCard label="Outstanding" value={fmtK(trips?.totalOutstanding)} color="#ef4444"
              sub={`Collected ${fmtK((trips?.totalRevenue || 0) - (trips?.totalOutstanding || 0))}`} />
          </div>

          <div style={{ marginTop: '16px' }}>
            <p style={s.stl}>Per-Trip P&L · QuickBooks ProfitAndLoss by Customer (Trip sub-customers)</p>
            <div style={s.card}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={s.th}>Trip</th>
                    <th style={s.th}>Aircraft</th>
                    <th style={{ ...s.th, textAlign: 'right' }}>Revenue</th>
                    <th style={{ ...s.th, textAlign: 'right' }}>Costs</th>
                    <th style={s.th}>Status</th>
                    <th style={{ ...s.th, textAlign: 'right' }}>Invoiced</th>
                    <th style={{ ...s.th, width: '30px' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {tripsMerged.map((t) => {
                    const revenue = t.pl?.income || t.invoiceTotal || 0;
                    const costs   = t.pl ? (t.pl.cogs + t.pl.expenses) : 0;
                    const isOpen = expandedTrip === t.tripId;
                    const fullyPaid = t.invoices.length > 0 && t.outstanding === 0;
                    const noInvoice = t.invoices.length === 0;
                    return (
                      <Fragment key={`trip-${t.tripId}`}>
                        <tr onClick={() => setExpandedTrip(isOpen ? null : t.tripId)}
                            style={{ cursor: t.invoices.length ? 'pointer' : 'default', background: isOpen ? 'rgba(79,142,247,0.04)' : 'transparent' }}>
                          <td style={{ ...s.td, fontWeight: '600', color: 'var(--accent)' }}>
                            <span style={{ marginRight: 6, color: 'var(--text-secondary)', fontSize: 10 }}>{t.invoices.length ? (isOpen ? '▼' : '▶') : ' '}</span>
                            {t.name}
                          </td>
                          <td style={s.td}>
                            {t.aircraft
                              ? <span style={{ fontSize: '11px', padding: '2px 6px', borderRadius: '4px', background: 'var(--accent)22', color: 'var(--accent)', fontWeight: '600' }}>{t.aircraft}</span>
                              : <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>—</span>}
                          </td>
                          <td style={{ ...s.td, textAlign: 'right', fontWeight: '600', color: '#4f8ef7' }}>{fmt(revenue)}</td>
                          <td style={{ ...s.td, textAlign: 'right', color: t.pl ? '#f59e0b' : 'var(--text-secondary)' }}>{t.pl ? fmt(costs) : '—'}</td>
                          <td style={s.td}>
                            {noInvoice
                              ? <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>no invoice</span>
                              : <span style={{ fontSize: '11px', padding: '2px 6px', borderRadius: '4px', background: fullyPaid ? '#22c55e22' : '#ef444422', color: fullyPaid ? '#22c55e' : '#ef4444', fontWeight: '600' }}>
                                  {fullyPaid ? 'Paid' : `Open ${fmt(t.outstanding)}`}
                                </span>}
                          </td>
                          <td style={{ ...s.td, textAlign: 'right', color: 'var(--text-secondary)' }}>{t.invoices.length ? fmt(t.invoiceTotal) : '—'}</td>
                          <td style={{ ...s.td, color: 'var(--text-secondary)', textAlign: 'center' }}>{t.invoices.length ? (isOpen ? '▲' : '▼') : ''}</td>
                        </tr>
                        {isOpen && t.invoices.map((inv, j) => (
                          <Fragment key={`inv-${t.tripId}-${j}`}>
                            <tr style={{ background: 'rgba(79,142,247,0.03)' }}>
                              <td style={{ ...s.td, paddingLeft: '28px', fontSize: 12 }}>↳ Invoice #{inv.docNumber}</td>
                              <td style={{ ...s.td, fontSize: 12 }}>{inv.aircraft || '—'}</td>
                              <td style={{ ...s.td, fontSize: 12, color: 'var(--text-secondary)' }} colSpan={2}>{inv.description || '—'}</td>
                              <td style={{ ...s.td, fontSize: 12 }}>
                                <span style={{ fontSize: '11px', padding: '2px 6px', borderRadius: '4px', background: inv.paid ? '#22c55e22' : '#ef444422', color: inv.paid ? '#22c55e' : '#ef4444', fontWeight: '600' }}>
                                  {inv.paid ? 'Paid' : `Due ${inv.dueDate}`}
                                </span>
                              </td>
                              <td style={{ ...s.td, fontSize: 12, textAlign: 'right', fontWeight: 600, color: '#4f8ef7' }}>{fmt(inv.total)}</td>
                              <td />
                            </tr>
                            {inv.lines.map((line, k) => (
                              <tr key={`line-${t.tripId}-${j}-${k}`} style={{ background: 'rgba(79,142,247,0.02)' }}>
                                <td colSpan={2} style={{ ...s.td, paddingLeft: '56px', fontSize: 11, color: 'var(--text-secondary)' }}>· {line.description || `Line ${k + 1}`}</td>
                                <td style={{ ...s.td, fontSize: 11 }}>{line.aircraft || '—'}</td>
                                <td style={{ ...s.td, fontSize: 11, color: 'var(--text-secondary)' }}>{line.serviceDate || '—'}</td>
                                <td style={{ ...s.td, fontSize: 11 }}></td>
                                <td style={{ ...s.td, fontSize: 11, textAlign: 'right', color: '#4f8ef7' }}>{fmt(line.amount)}</td>
                                <td />
                              </tr>
                            ))}
                          </Fragment>
                        ))}
                      </Fragment>
                    );
                  })}
                  {outOfFleetPL && (
                    <Fragment>
                      <tr onClick={() => setExpandedTrip(expandedTrip === 'OUT_OF_FLEET' ? null : 'OUT_OF_FLEET')}
                          style={{ cursor: 'pointer', background: expandedTrip === 'OUT_OF_FLEET' ? 'rgba(245,158,11,0.06)' : 'rgba(245,158,11,0.03)', borderTop: '2px solid var(--border)' }}>
                        <td style={{ ...s.td, fontWeight: 700, color: '#f59e0b' }}>
                          <span style={{ marginRight: 6, color: 'var(--text-secondary)', fontSize: 10 }}>{expandedTrip === 'OUT_OF_FLEET' ? '▼' : '▶'}</span>
                          Planes outside of fleet
                          <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-secondary)', fontWeight: 400 }}>
                            ({outOfFleetPL.customerCount} customer{outOfFleetPL.customerCount !== 1 ? 's' : ''} without a trip sub-customer)
                          </span>
                        </td>
                        <td style={{ ...s.td, color: 'var(--text-secondary)', fontSize: 11 }}>—</td>
                        <td style={{ ...s.td, textAlign: 'right', fontWeight: 600, color: '#4f8ef7' }}>{fmt(outOfFleetPL.income)}</td>
                        <td style={{ ...s.td, textAlign: 'right', color: '#f59e0b' }}>{fmt(outOfFleetPL.totalExpenses)}</td>
                        <td style={s.td}>
                          <span style={{ fontSize: 11, padding: '2px 6px', borderRadius: 4, background: '#f59e0b22', color: '#f59e0b', fontWeight: 600 }}>no trip tag</span>
                        </td>
                        <td style={{ ...s.td, textAlign: 'right', color: 'var(--text-secondary)' }}>—</td>
                        <td style={{ ...s.td, color: 'var(--text-secondary)', textAlign: 'center' }}>{expandedTrip === 'OUT_OF_FLEET' ? '▲' : '▼'}</td>
                      </tr>
                      {expandedTrip === 'OUT_OF_FLEET' && outOfFleetPL.customerNames.map((cn, j) => (
                        <tr key={`oof-${j}`} style={{ background: 'rgba(245,158,11,0.02)' }}>
                          <td colSpan={7} style={{ ...s.td, paddingLeft: 32, fontSize: 12, color: 'var(--text-secondary)' }}>↳ {cn}</td>
                        </tr>
                      ))}
                    </Fragment>
                  )}
                  {tripsLoaded && (
                    <tr style={{ background: 'var(--bg-secondary)', borderTop: '2px solid var(--border)' }}>
                      <td style={{ ...s.td, fontWeight: 700 }}>TOTAL</td>
                      <td style={s.td}></td>
                      <td style={{ ...s.td, textAlign: 'right', fontWeight: 700, color: '#4f8ef7' }}>{fmt(allRevenue)}</td>
                      <td style={{ ...s.td, textAlign: 'right', fontWeight: 700, color: '#f59e0b' }}>{fmt(allCosts)}</td>
                      <td colSpan={3}></td>
                    </tr>
                  )}
                  {tripsMerged.length === 0 && !outOfFleetPL && (
                    <tr><td colSpan={7} style={{ ...s.td, textAlign: 'center', color: 'var(--text-secondary)', padding: '24px' }}>No trips yet for {new Date().getFullYear()}.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <p style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 12, fontStyle: 'italic' }}>
              Each trip is a QB sub-customer (e.g. "Trip 25079"). Revenue / Costs are pulled from QB's ProfitAndLoss summarized by Customer — they include every transaction tagged to that sub-customer. "Planes outside of fleet" rolls up every parent customer billed directly without a trip sub-customer. Per-trip profit is shown only where the cost data is complete enough to compute it.
            </p>
          </div>
        </div>
      )}

    </div>
  );
}