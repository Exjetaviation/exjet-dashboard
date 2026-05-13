import express from 'express';
import {
  getAuthUrl, getTokensFromCode,
  getProfitAndLoss, getOutstandingInvoices,
  getRevenueByCustomer, getExpensesByVendor,
  getAccountBalances, getTransactionsByClass
} from '../services/quickbooks.js';

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
  const rows = txData?.Rows?.Row || [];
  const cols = txData?.Columns?.Column || [];

  const getColIdx = (key) => cols.findIndex(c => c.MetaData?.[0]?.Value === key);
  const dateIdx    = getColIdx('tx_date');
  const typeIdx    = getColIdx('txn_type');
  const accountIdx = getColIdx('account_name');
  const creditIdx  = getColIdx('credit_amt');
  const debitIdx   = getColIdx('debit_amt');

  let revenue = 0, fuel = 0, crew = 0, landing = 0, maintenance = 0, totalExpenses = 0;
  const expenseMap = {};
  const monthlyMap = {};

  rows.forEach(row => {
    if (!row.ColData) return;
    const credit  = parseFloat(row.ColData[creditIdx]?.value || 0);
    const debit   = parseFloat(row.ColData[debitIdx]?.value  || 0);
    const account = row.ColData[accountIdx]?.value || '';
    const txType  = row.ColData[typeIdx]?.value    || '';
    const date    = row.ColData[dateIdx]?.value    || '';
    const month   = date.slice(0, 7);
    const amount  = credit > 0 ? credit : debit;

    if (!monthlyMap[month]) monthlyMap[month] = { revenue: 0, expenses: 0 };

    const isIncome = txType === 'Invoice' || txType === 'Sales Receipt' || account.toLowerCase().includes('income') || account.toLowerCase().includes('charter sales');
    const isExpense = txType === 'Bill' || txType === 'Check' || txType === 'Expense' || txType === 'Credit Card Expense';

    if (isIncome && credit > 0) {
      revenue += credit;
      monthlyMap[month].revenue += credit;
    } else if (isExpense && debit > 0) {
      totalExpenses += debit;
      monthlyMap[month].expenses += debit;
      expenseMap[account] = (expenseMap[account] || 0) + debit;
      const acc = account.toLowerCase();
      if (acc.includes('fuel'))        fuel        += debit;
      else if (acc.includes('crew') || acc.includes('pilot') || acc.includes('flight attendant')) crew += debit;
      else if (acc.includes('landing') || acc.includes('ramp')) landing     += debit;
      else if (acc.includes('repair') || acc.includes('maintenance') || acc.includes('parts'))   maintenance += debit;
    }
  });

  const expenseBreakdown = Object.entries(expenseMap)
    .map(([name, total]) => ({ name, total: Math.round(total) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);

  const monthly = Object.entries(monthlyMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, vals]) => ({ month, ...vals }));

  const net = revenue - totalExpenses;
  const margin = revenue > 0 ? Math.round((net / revenue) * 100) : 0;

  return {
    revenue:      Math.round(revenue),
    totalExpenses: Math.round(totalExpenses),
    fuel:         Math.round(fuel),
    crew:         Math.round(crew),
    landing:      Math.round(landing),
    maintenance:  Math.round(maintenance),
    net:          Math.round(net),
    margin,
    expenseBreakdown,
    monthly,
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
