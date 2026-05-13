import express from 'express';
import { getAuthUrl, getTokensFromCode, getProfitAndLoss, getOutstandingInvoices, getRevenueByCustomer, getExpensesByCategory, getAccountBalances } from '../services/quickbooks.js';

const router = express.Router();

router.get('/auth-url', (req, res) => {
  try {
    const url = getAuthUrl();
    res.json({ url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/callback', async (req, res) => {
  try {
    const tokens = await getTokensFromCode(req.url);
    const realmId = req.query.realmId;
    res.json({
      message: 'Copy these to your .env file',
      QB_REFRESH_TOKEN: tokens.refresh_token,
      QB_REALM_ID: realmId,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/summary', async (req, res) => {
  try {
    const now = new Date();
    const startOfYear = `${now.getFullYear()}-01-01`;
    const today = now.toISOString().split('T')[0];
    const lastYear = `${now.getFullYear() - 1}-01-01`;
    const endLastYear = `${now.getFullYear() - 1}-12-31`;

    const [plThis, plLast, invoices, customers, expenses, accounts] = await Promise.allSettled([
      getProfitAndLoss(startOfYear, today),
      getProfitAndLoss(lastYear, endLastYear),
      getOutstandingInvoices(),
      getRevenueByCustomer(startOfYear, today),
      getExpensesByCategory(startOfYear, today),
      getAccountBalances(),
    ]);

    res.json({
      profitAndLoss:    plThis.status === 'fulfilled'    ? plThis.value    : null,
      profitAndLossLY:  plLast.status === 'fulfilled'    ? plLast.value    : null,
      invoices:         invoices.status === 'fulfilled'  ? invoices.value  : [],
      customers:        customers.status === 'fulfilled' ? customers.value : null,
      expenses:         expenses.status === 'fulfilled'  ? expenses.value  : null,
      accounts:         accounts.status === 'fulfilled'  ? accounts.value  : [],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
