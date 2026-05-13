
import express from 'express';
import {
  getAuthUrl, getTokensFromCode,
  getProfitAndLoss, getOutstandingInvoices,
  getRevenueByCustomer, getExpensesByVendor,
  getAccountBalances, getGeneralLedger
} from '../services/quickbooks.js';
router.get('/gl-test', async (req, res) => {
  try {
    const now = new Date();
    const result = await getGeneralLedger(`${now.getFullYear()}-01-01`, now.toISOString().split('T')[0], 'N69FP');
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
const router = express.Router();

router.get('/auth-url', (req, res) => {
  try { res.json({ url: getAuthUrl() }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/callback', async (req, res) => {
  try {
    const tokens = await getTokensFromCode(
      `https://exjet-dashboard-production.up.railway.app/api/finances/callback${req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : ''}`
    );
    res.json({ message: 'Copy these to your Railway variables', QB_REFRESH_TOKEN: tokens.refresh_token, QB_REALM_ID: req.query.realmId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});


const parseTransactions = (txData) => {
  const { txList, revList } = txData;
  const rows = txList?.Rows?.Row || [];
  const cols = txList?.Columns?.Column || [];

  // Get revenue from CustomerSales report
  let revenue = 0;
  const revRows = revList?.Rows?.Row || [];
  revRows.forEach(row => {
    if (row.ColData) {
      const total = parseFloat(row.ColData?.slice(-1)[0]?.value || 0);
      if (total > 0) revenue += total;
    }
  });

  let fuel = 0, crew = 0, landing = 0, maintenance = 0, totalExpenses = 0;
  const expenseMap = {};
  const monthlyMap = {};

  rows.forEach(row => {
    if (!row.ColData) return;
    const data = row.ColData;
    let date = '', txType = '', account = '', credit = 0, debit = 0;

    cols.forEach((col, i) => {
      const key = col.MetaData?.[0]?.Value || '';
      const val = data[i]?.value || '';
      if (key === 'tx_date')      date    = val;
      if (key === 'txn_type')     txType  = val;
      if (key === 'account_name') account = val;
      if (key === 'credit_amt')   credit  = parseFloat(val) || 0;
      if (key === 'debit_amt')    debit   = parseFloat(val) || 0;
    });

    const month = date.slice(0, 7);
    if (!monthlyMap[month]) monthlyMap[month] = { revenue: 0, expenses: 0 };

    const accLower = account.toLowerCase();
    const isExpense = ['Bill', 'Check', 'Expense', 'Credit Card Expense'].includes(txType);

    if (isExpense) {
      const amount = debit > 0 ? debit : credit;
      if (amount > 0) {
        totalExpenses += amount;
        monthlyMap[month].expenses += amount;
        expenseMap[account] = (expenseMap[account] || 0) + amount;
        if (accLower.includes('fuel'))                                                                    fuel        += amount;
        else if (accLower.includes('crew') || accLower.includes('pilot') || accLower.includes('flight attendant') || accLower.includes('co-pilot')) crew += amount;
        else if (accLower.includes('landing') || accLower.includes('ramp'))                               landing     += amount;
        else if (accLower.includes('repair') || accLower.includes('maintenance') || accLower.includes('parts')) maintenance += amount;
      }
    }
  });

  // Add monthly revenue from CustomerSales
  revRows.forEach(row => {
    if (!row.ColData) return;
    const month = '2026'; // approximate - CustomerSales doesn't break by month easily
  });

  const expenseBreakdown = Object.entries(expenseMap)
    .map(([name, total]) => ({ name, total: Math.round(total) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);

  const monthly = Object.entries(monthlyMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, vals]) => ({ month, revenue: Math.round(vals.revenue), expenses: Math.round(vals.expenses) }));

  const net = revenue - totalExpenses;
  const margin = revenue > 0 ? Math.round((net / revenue) * 100) : 0;

  return {
    revenue:       Math.round(revenue),
    totalExpenses: Math.round(totalExpenses),
    fuel:          Math.round(fuel),
    crew:          Math.round(crew),
    landing:       Math.round(landing),
    maintenance:   Math.round(maintenance),
    net:           Math.round(net),
    margin,
    expenseBreakdown,
    monthly,
    txCount: rows.length,
  };
};


router.get('/summary', async (req, res) => {
  try {
    const now = new Date();
    const startOfYear = `${now.getFullYear()}-01-01`;
    const today = now.toISOString().split('T')[0];
    const lastYearStart = `${now.getFullYear() - 1}-01-01`;
    const lastYearEnd = `${now.getFullYear() - 1}-12-31`;
    const AIRCRAFT = ['N69FP', 'N408JS'];

    const [plThis, plLast, invoices, customers, expenses, accounts, ...txResults] = await Promise.allSettled([
      getProfitAndLoss(startOfYear, today),
      getProfitAndLoss(lastYearStart, lastYearEnd),
      getOutstandingInvoices(),
      getRevenueByCustomer(startOfYear, today),
      getExpensesByVendor(startOfYear, today),
      getAccountBalances(),
      ...AIRCRAFT.map(name => getTransactionsByClass(startOfYear, today, name)),
    ]);

    const byClass = txResults.map((r, i) => ({
      name: AIRCRAFT[i],
      stats: r.status === 'fulfilled' ? parseTransactions(r.value) : { error: r.reason?.message },
    }));

    res.json({
      profitAndLoss:   plThis.status    === 'fulfilled' ? plThis.value    : { error: plThis.reason?.message },
      profitAndLossLY: plLast.status    === 'fulfilled' ? plLast.value    : { error: plLast.reason?.message },
      invoices:        invoices.status  === 'fulfilled' ? invoices.value  : [],
      customers:       customers.status === 'fulfilled' ? customers.value : { error: customers.reason?.message },
      expenses:        expenses.status  === 'fulfilled' ? expenses.value  : { error: expenses.reason?.message },
      accounts:        accounts.status  === 'fulfilled' ? accounts.value  : [],
      byClass,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

