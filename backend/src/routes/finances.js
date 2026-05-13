import express from 'express';
import {
  getAuthUrl, getTokensFromCode,
  getProfitAndLoss, getOutstandingInvoices,
  getRevenueByCustomer, getExpensesByVendor,
  getAccountBalances, getClassList, getPLForClass
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

router.get('/summary', async (req, res) => {
  try {
    const now = new Date();
    const startOfYear = `${now.getFullYear()}-01-01`;
    const today = now.toISOString().split('T')[0];
    const lastYearStart = `${now.getFullYear() - 1}-01-01`;
    const lastYearEnd = `${now.getFullYear() - 1}-12-31`;

    const [plThis, plLast, invoices, customers, expenses, accounts, classes] = await Promise.allSettled([
      getProfitAndLoss(startOfYear, today),
      getProfitAndLoss(lastYearStart, lastYearEnd),
      getOutstandingInvoices(),
      getRevenueByCustomer(startOfYear, today),
      getExpensesByVendor(startOfYear, today),
      getAccountBalances(),
      getClassList(),
    ]);

    const classList = classes.status === 'fulfilled' ? classes.value : [];

    const byClassResults = await Promise.allSettled(
      classList.map(c => getPLForClass(startOfYear, today, c.Name).then(pl => ({ name: c.Name, id: c.Id, pl })))
    );

    const byClass = byClassResults
      .filter(r => r.status === 'fulfilled')
      .map(r => r.value);

    res.json({
      profitAndLoss:   plThis.status    === 'fulfilled' ? plThis.value    : { error: plThis.reason?.message },
      profitAndLossLY: plLast.status    === 'fulfilled' ? plLast.value    : { error: plLast.reason?.message },
      invoices:        invoices.status  === 'fulfilled' ? invoices.value  : [],
      customers:       customers.status === 'fulfilled' ? customers.value : { error: customers.reason?.message },
      expenses:        expenses.status  === 'fulfilled' ? expenses.value  : { error: expenses.reason?.message },
      accounts:        accounts.status  === 'fulfilled' ? accounts.value  : [],
      classes:         classList,
      byClass,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
