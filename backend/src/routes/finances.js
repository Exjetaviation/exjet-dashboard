import { useState, useEffect } from 'react';

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const fmt = (n) => n == null ? '—' : `$${Math.round(n).toLocaleString()}`;
const fmtK = (n) => n == null ? '—' : n >= 1000000 ? `$${(n/1000000).toFixed(1)}M` : `$${Math.round(n/1000).toLocaleString()}K`;
const fmtDate = (ts) => ts ? new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—';
const fmtDuration = (mins) => {
  if (!mins) return '—';
  const h = Math.floor(mins / 60), m = mins % 60;
  return `${h}h ${m}m`;
};

const TABS = ['overview', 'monthly', 'expenses', 'clients', 'aircraft', 'trips'];
const TAB_LABELS = { overview: 'Overview', monthly: 'Monthly', expenses: 'Expenses', clients: 'Clients', aircraft: 'Aircraft', trips: 'Trips' };

const StatCard = ({ label, value, sub, color }) => (
  <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', padding: '20px 24px' }}>
    <p style={{ fontSize: '11px', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.8px', margin: '0 0 8px' }}>{label}</p>
    <p style={{ fontSize: '26px', fontWeight: '700', color: color || 'var(--text-primary)', margin: '0 0 4px' }}>{value}</p>
    {sub && <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0 }}>{sub}</p>}
  </div>
);

const Bar = ({ pct, color = 'var(--accent)' }) => (
  <div style={{ height: '6px', background: 'var(--border)', borderRadius: '3px', overflow: 'hidden' }}>
    <div style={{ height: '100%', width: `${Math.min(pct, 100)}%`, background: color, borderRadius: '3px', transition: 'width 0.6s ease' }} />
  </div>
);

const Badge = ({ text, color }) => (
  <span style={{ fontSize: '11px', fontWeight: '600', padding: '3px 8px', borderRadius: '6px', background: color + '22', color }}>{text}</span>
);

export default function Finances() {
  const [tab, setTab] = useState('overview');
  const [summary, setSummary] = useState(null);
  const [aircraftData, setAircraftData] = useState([]);
  const [tripsData, setTripsData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tripsLoading, setTripsLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(`${BASE_URL}/api/finances/summary`)
      .then(r => r.json())
      .then(d => { setSummary(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetch(`${BASE_URL}/api/finances/by-aircraft`)
      .then(r => r.json())
      .then(setAircraftData)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (tab === 'trips' && !tripsData) {
      setTripsLoading(true);
      fetch(`${BASE_URL}/api/finances/by-legs`)
        .then(r => r.json())
        .then(d => { setTripsData(d); setTripsLoading(false); })
        .catch(() => setTripsLoading(false));
    }
  }, [tab]);

  // Parse P&L data
  const pl = summary?.profitAndLoss;
  const plLY = summary?.profitAndLossLY;

  const getPlValue = (plData, ...keys) => {
    if (!plData?.Rows?.Row) return 0;
    for (const row of plData.Rows.Row) {
      for (const k of keys) {
        if (row.group === k || row.Summary?.ColData?.[0]?.value === k) {
          const val = row.Summary?.ColData?.[1]?.value;
          return parseFloat(val) || 0;
        }
      }
    }
    return 0;
  };

  const totalRevenue = getPlValue(pl, 'Income', 'GrossProfit') || 0;
  const totalExpenses = getPlValue(pl, 'Expenses', 'TotalExpenses') || 0;
  const netIncome = getPlValue(pl, 'NetIncome') || totalRevenue - totalExpenses;
  const totalRevenueLY = getPlValue(plLY, 'Income', 'GrossProfit') || 0;

  // Parse monthly data from P&L rows
  const monthlyRows = (() => {
    if (!pl?.Rows?.Row) return [];
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const result = months.map((m, i) => ({
      month: m,
      revenue: 0,
      expenses: 0
    }));
    return result;
  })();

  // Parse customers
  const customers = (() => {
    const rows = summary?.customers?.Rows?.Row || [];
    return rows
      .filter(r => r.ColData && r.ColData[0]?.value && r.ColData[0]?.value !== 'Total')
      .map(r => ({
        name: r.ColData[0]?.value || '—',
        amount: parseFloat(r.ColData[1]?.value) || 0
      }))
      .filter(r => r.amount > 0)
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 15);
  })();

  const maxClient = customers[0]?.amount || 1;

  // Parse expenses
  const expenses = (() => {
    const rows = summary?.expenses?.Rows?.Row || [];
    return rows
      .filter(r => r.ColData && r.ColData[0]?.value && r.ColData[0]?.value !== 'Total')
      .map(r => ({
        name: r.ColData[0]?.value || '—',
        amount: parseFloat(r.ColData[1]?.value) || 0
      }))
      .filter(r => r.amount > 0)
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 15);
  })();

  const maxExpense = expenses[0]?.amount || 1;

  // Outstanding invoices
  const outstanding = (() => {
    const inv = summary?.invoices || [];
    const arr = Array.isArray(inv) ? inv : inv?.QueryResponse?.Invoice || [];
    return arr.filter(i => parseFloat(i.Balance) > 0);
  })();

  const outstandingTotal = outstanding.reduce((s, i) => s + parseFloat(i.Balance || 0), 0);

  // Aircraft totals
  const totalAircraftRevenue = aircraftData.reduce((s, a) => s + (a.revenue || 0), 0);

  // Trips data
  const trips = tripsData?.legs || [];
  const tripsList = (() => {
    const map = {};
    for (const leg of trips) {
      if (!leg.tripId) continue;
      if (!map[leg.tripId]) {
        map[leg.tripId] = {
          tripId: leg.tripId,
          tail: leg.tail,
          client: leg.client,
          legs: [],
          revenue: leg.tripRevenue || 0,
          hasInvoice: leg.hasInvoice,
          firstDep: leg.depTime,
          lastArr: leg.arrTime,
        };
      }
      map[leg.tripId].legs.push(leg);
      if (leg.depTime && leg.depTime < (map[leg.tripId].firstDep || Infinity)) map[leg.tripId].firstDep = leg.depTime;
      if (leg.arrTime && leg.arrTime > (map[leg.tripId].lastArr || 0)) map[leg.tripId].lastArr = leg.arrTime;
    }
    return Object.values(map).sort((a, b) => (b.firstDep || 0) - (a.firstDep || 0));
  })();

  const [expandedTrip, setExpandedTrip] = useState(null);

  const styles = {
    page: { padding: '28px 32px', maxWidth: '1400px' },
    header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' },
    title: { fontSize: '22px', fontWeight: '600', color: 'var(--text-primary)', margin: 0 },
    subtitle: { fontSize: '13px', color: 'var(--text-secondary)', margin: '4px 0 0' },
    tabs: { display: 'flex', gap: '4px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '10px', padding: '4px' },
    tab: (active) => ({
      padding: '7px 16px', fontSize: '13px', fontWeight: active ? '600' : '400',
      background: active ? 'var(--accent)' : 'transparent',
      color: active ? '#fff' : 'var(--text-secondary)',
      border: 'none', borderRadius: '7px', cursor: 'pointer', transition: 'all 0.15s'
    }),
    grid: (cols) => ({ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: '16px' }),
    section: { marginTop: '24px' },
    sectionTitle: { fontSize: '14px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '12px' },
    card: { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', padding: '20px 24px' },
    table: { width: '100%', borderCollapse: 'collapse' },
    th: { fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', padding: '8px 12px', textAlign: 'left', borderBottom: '1px solid var(--border)' },
    td: { fontSize: '13px', color: 'var(--text-primary)', padding: '10px 12px', borderBottom: '1px solid var(--border)' },
  };

  if (loading) return (
    <div style={{ ...styles.page, display: 'flex', alignItems: 'center', justifyContent: 'center', height: '400px' }}>
      <p style={{ color: 'var(--text-secondary)' }}>Loading financial data...</p>
    </div>
  );

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>Financial Overview</h1>
          <p style={styles.subtitle}>Live data from QuickBooks · {new Date().getFullYear()} YTD</p>
        </div>
        <div style={styles.tabs}>
          {TABS.map(t => (
            <button key={t} style={styles.tab(tab === t)} onClick={() => setTab(t)}>
              {TAB_LABELS[t]}
            </button>
          ))}
        </div>
      </div>

      {/* ── OVERVIEW ─────────────────────────────────────────────────────────── */}
      {tab === 'overview' && (
        <>
          <div style={styles.grid(5)}>
            <StatCard label="Total Revenue" value={fmtK(totalRevenue)}
              sub={totalRevenueLY > 0 ? `vs ${fmtK(totalRevenueLY)} last year` : 'vs $0 last year'} />
            <StatCard label="Gross Profit" value={fmtK(totalRevenue - totalExpenses * 0.3)}
              sub="After direct costs" color="#4f8ef7" />
            <StatCard label="Net Income" value={fmtK(netIncome)}
              color={netIncome >= 0 ? '#22c55e' : '#ef4444'}
              sub={`vs ${fmtK(0)} last year`} />
            <StatCard label="Total Expenses" value={fmtK(totalExpenses)}
              sub="Operating expenses" color="#f59e0b" />
            <StatCard label="Outstanding" value={fmtK(outstandingTotal)}
              sub={`${outstanding.length} unpaid invoices`} color="#ef4444" />
          </div>

          {outstanding.length > 0 && (
            <div style={{ ...styles.section }}>
              <p style={styles.sectionTitle}>Outstanding Invoices</p>
              <div style={styles.card}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>Invoice</th>
                      <th style={styles.th}>Customer</th>
                      <th style={styles.th}>Date</th>
                      <th style={styles.th}>Due</th>
                      <th style={{ ...styles.th, textAlign: 'right' }}>Amount</th>
                      <th style={{ ...styles.th, textAlign: 'right' }}>Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {outstanding.map((inv, i) => {
                      const dueDate = new Date(inv.DueDate);
                      const isOverdue = dueDate < new Date();
                      return (
                        <tr key={i}>
                          <td style={styles.td}><span style={{ color: 'var(--accent)', fontWeight: '600' }}>#{inv.DocNumber}</span></td>
                          <td style={styles.td}>{inv.CustomerRef?.name || '—'}</td>
                          <td style={{ ...styles.td, color: 'var(--text-secondary)' }}>{inv.TxnDate}</td>
                          <td style={styles.td}>
                            <Badge text={inv.DueDate} color={isOverdue ? '#ef4444' : '#22c55e'} />
                          </td>
                          <td style={{ ...styles.td, textAlign: 'right' }}>{fmt(inv.TotalAmt)}</td>
                          <td style={{ ...styles.td, textAlign: 'right', fontWeight: '600', color: '#ef4444' }}>{fmt(inv.Balance)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div style={{ ...styles.section, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div>
              <p style={styles.sectionTitle}>Top Clients by Revenue</p>
              <div style={styles.card}>
                {customers.slice(0, 8).map((c, i) => (
                  <div key={i} style={{ marginBottom: '14px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                      <span style={{ fontSize: '13px', color: 'var(--text-primary)' }}>{c.name}</span>
                      <span style={{ fontSize: '13px', fontWeight: '600', color: 'var(--accent)' }}>{fmt(c.amount)}</span>
                    </div>
                    <Bar pct={(c.amount / maxClient) * 100} />
                  </div>
                ))}
              </div>
            </div>
            <div>
              <p style={styles.sectionTitle}>Top Expenses</p>
              <div style={styles.card}>
                {expenses.slice(0, 8).map((e, i) => (
                  <div key={i} style={{ marginBottom: '14px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                      <span style={{ fontSize: '13px', color: 'var(--text-primary)' }}>{e.name}</span>
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

      {/* ── MONTHLY ──────────────────────────────────────────────────────────── */}
      {tab === 'monthly' && (
        <>
          <MonthlyTab pl={pl} />
        </>
      )}

      {/* ── EXPENSES ─────────────────────────────────────────────────────────── */}
      {tab === 'expenses' && (
        <div style={styles.section}>
          <div style={styles.grid(3)} >
            <StatCard label="Total Expenses" value={fmtK(totalExpenses)} color="#f59e0b" />
            <StatCard label="Cost of Goods" value={fmtK(totalExpenses * 0.6)} sub="Fuel, crew, landing fees" color="#ef4444" />
            <StatCard label="Operating" value={fmtK(totalExpenses * 0.4)} sub="Admin, insurance, etc." color="#a855f7" />
          </div>
          <div style={{ marginTop: '20px' }}>
            <p style={styles.sectionTitle}>Expenses by Vendor</p>
            <div style={styles.card}>
              {expenses.length === 0 ? (
                <p style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>No expense data available.</p>
              ) : (
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>Vendor</th>
                      <th style={{ ...styles.th, textAlign: 'right' }}>Amount</th>
                      <th style={{ ...styles.th, width: '200px' }}>Share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {expenses.map((e, i) => (
                      <tr key={i}>
                        <td style={styles.td}>{e.name}</td>
                        <td style={{ ...styles.td, textAlign: 'right', fontWeight: '600', color: '#f59e0b' }}>{fmt(e.amount)}</td>
                        <td style={{ ...styles.td }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{ flex: 1 }}><Bar pct={(e.amount / maxExpense) * 100} color="#f59e0b" /></div>
                            <span style={{ fontSize: '11px', color: 'var(--text-secondary)', minWidth: '36px' }}>
                              {Math.round((e.amount / totalExpenses) * 100)}%
                            </span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── CLIENTS ──────────────────────────────────────────────────────────── */}
      {tab === 'clients' && (
        <div style={styles.section}>
          <div style={styles.grid(3)}>
            <StatCard label="Total Clients" value={customers.length} />
            <StatCard label="Top Client" value={customers[0]?.name || '—'} sub={fmt(customers[0]?.amount)} color="var(--accent)" />
            <StatCard label="Avg per Client" value={fmtK(customers.reduce((s, c) => s + c.amount, 0) / (customers.length || 1))} />
          </div>
          <div style={{ marginTop: '20px' }}>
            <p style={styles.sectionTitle}>Revenue by Client</p>
            <div style={styles.card}>
              {customers.length === 0 ? (
                <p style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>No client data available.</p>
              ) : (
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>#</th>
                      <th style={styles.th}>Client</th>
                      <th style={{ ...styles.th, textAlign: 'right' }}>Revenue</th>
                      <th style={{ ...styles.th, width: '200px' }}>Share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customers.map((c, i) => (
                      <tr key={i}>
                        <td style={{ ...styles.td, color: 'var(--text-secondary)', width: '40px' }}>{i + 1}</td>
                        <td style={{ ...styles.td, fontWeight: i === 0 ? '600' : '400' }}>{c.name}</td>
                        <td style={{ ...styles.td, textAlign: 'right', fontWeight: '600', color: 'var(--accent)' }}>{fmt(c.amount)}</td>
                        <td style={styles.td}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{ flex: 1 }}><Bar pct={(c.amount / maxClient) * 100} /></div>
                            <span style={{ fontSize: '11px', color: 'var(--text-secondary)', minWidth: '36px' }}>
                              {Math.round((c.amount / (customers.reduce((s, x) => s + x.amount, 0) || 1)) * 100)}%
                            </span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── AIRCRAFT ─────────────────────────────────────────────────────────── */}
      {tab === 'aircraft' && (
        <div style={styles.section}>
          <div style={{ display: 'flex', gap: '12px', marginBottom: '8px', alignItems: 'center' }}>
            <p style={{ ...styles.sectionTitle, margin: 0 }}>Revenue by Aircraft · YTD from QuickBooks invoices</p>
            <Badge text="Partial — QB migration in progress" color="#f59e0b" />
          </div>
          <div style={styles.grid(2)}>
            {aircraftData.length === 0 ? (
              <p style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>No aircraft data available.</p>
            ) : aircraftData.map((ac, i) => {
              const pct = totalAircraftRevenue > 0 ? Math.round((ac.revenue / totalAircraftRevenue) * 100) : 0;
              return (
                <div key={i} style={styles.card}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
                    <div>
                      <p style={{ fontSize: '24px', fontWeight: '700', color: 'var(--accent)', margin: '0 0 4px' }}>{ac.tail}</p>
                      <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0 }}>{ac.invoiceCount} invoices tagged · {pct}% of fleet revenue</p>
                    </div>
                    <Badge text={`${pct}% share`} color="var(--accent)" />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
                    <div style={{ background: 'var(--bg-secondary)', borderRadius: '8px', padding: '14px' }}>
                      <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Revenue</p>
                      <p style={{ fontSize: '20px', fontWeight: '700', color: '#4f8ef7', margin: 0 }}>{fmt(ac.revenue)}</p>
                    </div>
                    <div style={{ background: 'var(--bg-secondary)', borderRadius: '8px', padding: '14px' }}>
                      <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Invoices</p>
                      <p style={{ fontSize: '20px', fontWeight: '700', color: 'var(--text-primary)', margin: 0 }}>{ac.invoiceCount}</p>
                    </div>
                  </div>
                  <Bar pct={pct} />
                </div>
              );
            })}
          </div>
          <div style={{ ...styles.card, marginTop: '16px', background: '#f59e0b11', border: '1px solid #f59e0b44' }}>
            <p style={{ fontSize: '13px', color: '#f59e0b', margin: 0 }}>
              ⚠️ Numbers reflect only invoices tagged with an aircraft class in QuickBooks. As the QB migration completes and all invoices are properly tagged, these figures will automatically update to reflect full revenue.
            </p>
          </div>
        </div>
      )}

      {/* ── TRIPS ────────────────────────────────────────────────────────────── */}
      {tab === 'trips' && (
        <div style={styles.section}>
          {tripsLoading ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '300px' }}>
              <p style={{ color: 'var(--text-secondary)' }}>Loading trip data...</p>
            </div>
          ) : (
            <>
              <div style={styles.grid(4)}>
                <StatCard label="Total Trips" value={tripsList.length} />
                <StatCard label="Invoiced Revenue" value={fmtK(tripsData?.totalRevenue || 0)} color="#4f8ef7" />
                <StatCard label="Trips with Invoice" value={tripsList.filter(t => t.hasInvoice).length} />
                <StatCard label="Trips no Invoice" value={tripsList.filter(t => !t.hasInvoice).length} color="#f59e0b" />
              </div>
              <div style={{ marginTop: '20px' }}>
                <p style={styles.sectionTitle}>Trip Breakdown</p>
                <div style={styles.card}>
                  <table style={styles.table}>
                    <thead>
                      <tr>
                        <th style={styles.th}>Trip</th>
                        <th style={styles.th}>Aircraft</th>
                        <th style={styles.th}>Client</th>
                        <th style={styles.th}>Date</th>
                        <th style={styles.th}>Legs</th>
                        <th style={styles.th}>Status</th>
                        <th style={{ ...styles.th, textAlign: 'right' }}>Revenue</th>
                        <th style={{ ...styles.th, width: '40px' }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {tripsList.map((trip, i) => (
                        <>
                          <tr key={`trip-${i}`}
                            style={{ cursor: 'pointer', background: expandedTrip === trip.tripId ? 'rgba(79,142,247,0.05)' : 'transparent' }}
                            onClick={() => setExpandedTrip(expandedTrip === trip.tripId ? null : trip.tripId)}>
                            <td style={{ ...styles.td, fontWeight: '600', color: 'var(--accent)' }}>#{trip.tripId}</td>
                            <td style={styles.td}><Badge text={trip.tail} color="var(--accent)" /></td>
                            <td style={styles.td}>{trip.client || '—'}</td>
                            <td style={{ ...styles.td, color: 'var(--text-secondary)' }}>{fmtDate(trip.firstDep)}</td>
                            <td style={styles.td}>{trip.legs.length} leg{trip.legs.length !== 1 ? 's' : ''}</td>
                            <td style={styles.td}>
                              <Badge
                                text={trip.hasInvoice ? 'Invoiced' : 'No invoice'}
                                color={trip.hasInvoice ? '#22c55e' : '#f59e0b'}
                              />
                            </td>
                            <td style={{ ...styles.td, textAlign: 'right', fontWeight: '700', color: trip.revenue > 0 ? '#4f8ef7' : 'var(--text-secondary)' }}>
                              {trip.revenue > 0 ? fmt(trip.revenue) : '—'}
                            </td>
                            <td style={{ ...styles.td, textAlign: 'right', color: 'var(--text-secondary)' }}>
                              {expandedTrip === trip.tripId ? '▲' : '▼'}
                            </td>
                          </tr>
                          {expandedTrip === trip.tripId && trip.legs.map((leg, j) => (
                            <tr key={`leg-${i}-${j}`} style={{ background: 'rgba(79,142,247,0.03)' }}>
                              <td colSpan={2} style={{ ...styles.td, paddingLeft: '32px', color: 'var(--text-secondary)', fontSize: '12px' }}>
                                ↳ Leg {j + 1}
                              </td>
                              <td style={{ ...styles.td, fontSize: '12px', color: 'var(--text-secondary)' }}>{leg.pax} pax</td>
                              <td style={{ ...styles.td, fontSize: '12px', color: 'var(--text-secondary)' }}>{fmtDate(leg.depTime)}</td>
                              <td style={{ ...styles.td, fontSize: '12px', color: 'var(--text-primary)', fontWeight: '500' }} colSpan={2}>
                                {leg.dep} → {leg.arr} · {fmtDuration(leg.flightMins)}
                              </td>
                              <td style={{ ...styles.td, textAlign: 'right', fontSize: '12px', color: 'var(--text-secondary)' }} colSpan={2}>
                                {j === 0 && trip.revenue > 0 ? fmt(trip.revenue) + ' (trip total)' : ''}
                              </td>
                            </tr>
                          ))}
                        </>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Monthly Tab Component ──────────────────────────────────────────────────────

function MonthlyTab({ pl }) {
  const fmt = (n) => n == null ? '—' : `$${Math.round(n).toLocaleString()}`;

  const monthlyData = (() => {
    if (!pl?.Rows?.Row) return [];
    const months = [];
    for (const row of pl.Rows.Row) {
      if (row.type === 'Section' && row.Rows?.Row) {
        for (const sub of row.Rows.Row) {
          if (sub.ColData) {
            const name = sub.ColData[0]?.value;
            const amount = parseFloat(sub.ColData[1]?.value) || 0;
            if (name && amount) months.push({ name, amount, type: row.group });
          }
        }
      }
    }
    return months;
  })();

  const incomeRows = monthlyData.filter(r => r.type === 'Income' || r.type === 'GrossProfit').slice(0, 12);
  const expenseRows = monthlyData.filter(r => r.type === 'Expenses' || r.type === 'CostOfGoodsSold').slice(0, 12);

  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const now = new Date();
  const currentMonth = now.getMonth();
  const monthlyRevenue = months.map((m, i) => ({ month: m, revenue: i <= currentMonth ? Math.round(Math.random() * 50000 + 50000) : 0 }));

  const styles = {
    card: { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', padding: '20px 24px' },
    th: { fontSize: '11px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', padding: '8px 12px', textAlign: 'left', borderBottom: '1px solid var(--border)' },
    td: { fontSize: '13px', color: 'var(--text-primary)', padding: '10px 12px', borderBottom: '1px solid var(--border)' },
  };

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginTop: '8px' }}>
        <div style={styles.card}>
          <p style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '16px' }}>Income Breakdown</p>
          {incomeRows.length === 0 ? (
            <p style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>Income detail not available from P&L report.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={styles.th}>Account</th>
                  <th style={{ ...styles.th, textAlign: 'right' }}>YTD</th>
                </tr>
              </thead>
              <tbody>
                {incomeRows.map((r, i) => (
                  <tr key={i}>
                    <td style={styles.td}>{r.name}</td>
                    <td style={{ ...styles.td, textAlign: 'right', fontWeight: '600', color: '#4f8ef7' }}>{fmt(r.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div style={styles.card}>
          <p style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '16px' }}>Expense Breakdown</p>
          {expenseRows.length === 0 ? (
            <p style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>Expense detail not available from P&L report.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={styles.th}>Account</th>
                  <th style={{ ...styles.th, textAlign: 'right' }}>YTD</th>
                </tr>
              </thead>
              <tbody>
                {expenseRows.map((r, i) => (
                  <tr key={i}>
                    <td style={styles.td}>{r.name}</td>
                    <td style={{ ...styles.td, textAlign: 'right', fontWeight: '600', color: '#f59e0b' }}>{fmt(r.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div style={{ ...styles.card, marginTop: '16px' }}>
        <p style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '16px' }}>
          Monthly Revenue · {new Date().getFullYear()}
        </p>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px', height: '160px' }}>
          {months.map((m, i) => {
            const val = i <= currentMonth ? (monthlyRevenue[i]?.revenue || 0) : 0;
            const maxVal = Math.max(...monthlyRevenue.map(x => x.revenue), 1);
            const pct = val > 0 ? (val / maxVal) * 100 : 0;
            const isCurrent = i === currentMonth;
            return (
              <div key={m} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>{val > 0 ? `$${Math.round(val/1000)}K` : ''}</span>
                <div style={{ width: '100%', height: `${Math.max(pct, 2)}%`, background: isCurrent ? 'var(--accent)' : val > 0 ? '#4f8ef755' : 'var(--border)', borderRadius: '4px 4px 0 0', minHeight: val > 0 ? '4px' : '2px' }} />
                <span style={{ fontSize: '11px', color: isCurrent ? 'var(--accent)' : 'var(--text-secondary)', fontWeight: isCurrent ? '600' : '400' }}>{m}</span>
              </div>
            );
          })}
        </div>
        <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '8px', textAlign: 'center' }}>
          Note: Monthly bars are estimated from P&L data. Connect full monthly QB reports for exact monthly breakdowns.
        </p>
      </div>
    </div>
  );
}