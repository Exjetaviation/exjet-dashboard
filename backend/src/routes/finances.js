import express from 'express';
import {
  getAuthUrl, getTokensFromCode,
  getProfitAndLoss, getOutstandingInvoices,
  getRevenueByCustomer, getExpensesByVendor,
  getAccountBalances, getGeneralLedger,getTransactionsByClass
} from '../services/quickbooks.js';
import * as lf from '../services/levelflight.js';
import { supabase } from '../services/supabase.js';

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

router.get('/gl-test', async (req, res) => {
  try {
    const now = new Date();
    const result = await getGeneralLedger(`${now.getFullYear()}-01-01`, now.toISOString().split('T')[0], 'N69FP');
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const getAircraftStats = async () => {
  const now = Date.now();
  const startOfYear = new Date(`${new Date().getFullYear()}-01-01`).getTime();
  const [legsRes, rateCardsRes] = await Promise.all([
    lf.getScheduledLegs(now),
    supabase.from('rate_cards').select('*'),
  ]);
  const legs = legsRes?.legs || [];
  const rateCards = rateCardsRes.data || [];
  const completedLegs = legs.filter(l =>
    l.status === 3 && l.departure?.time >= startOfYear && l._calc?._minutes > 0
  );
  const byAircraft = {};
  completedLegs.forEach(leg => {
    const tail = leg.dispatch?.aircraft?.tailNumber;
    if (!tail) return;
    if (!byAircraft[tail]) byAircraft[tail] = { tail, legs: [] };
    byAircraft[tail].legs.push(leg);
  });
  const results = [];
  for (const [tail, data] of Object.entries(byAircraft)) {
    const rateCard = rateCards.find(r => r.aircraft_tail === tail);
    const hourlyRate = rateCard?.hourly_rate || 0;
    let totalFlightHrs = 0, totalRevenue = 0;
    const monthlyMap = {}, clientMap = {};
    data.legs.forEach(leg => {
      const hrs = leg._calc._minutes / 60;
      totalFlightHrs += hrs;
      const depDate = new Date(leg.departure.time);
      const month = `${depDate.getFullYear()}-${String(depDate.getMonth() + 1).padStart(2, '0')}`;
      if (!monthlyMap[month]) monthlyMap[month] = { revenue: 0, hours: 0 };
      const legRevenue = hrs * hourlyRate;
      totalRevenue += legRevenue;
      monthlyMap[month].revenue += legRevenue;
      monthlyMap[month].hours += hrs;
      const client = leg.dispatch?.client?.company?.name || 'Unknown';
      clientMap[client] = (clientMap[client] || 0) + legRevenue;
    });
    results.push({
      tail,
      totalLegs: data.legs.length,
      totalFlightHrs: Math.round(totalFlightHrs * 10) / 10,
      totalRevenue: Math.round(totalRevenue),
      hourlyRate,
      monthly: Object.entries(monthlyMap).sort(([a],[b]) => a.localeCompare(b)).map(([month, v]) => ({ month, revenue: Math.round(v.revenue), hours: Math.round(v.hours * 10) / 10 })),
      topClients: Object.entries(clientMap).map(([name, revenue]) => ({ name, revenue: Math.round(revenue) })).sort((a,b) => b.revenue - a.revenue).slice(0, 5),
    });
  }
  return results.sort((a, b) => b.totalRevenue - a.totalRevenue);
};

router.get('/summary', async (req, res) => {
  try {
    const now = new Date();
    const startOfYear = `${now.getFullYear()}-01-01`;
    const today = now.toISOString().split('T')[0];
    const lastYearStart = `${now.getFullYear() - 1}-01-01`;
    const lastYearEnd = `${now.getFullYear() - 1}-12-31`;

    const [plThis, plLast, invoices, customers, expenses, accounts, aircraftStats] = await Promise.allSettled([
      getProfitAndLoss(startOfYear, today),
      getProfitAndLoss(lastYearStart, lastYearEnd),
      getOutstandingInvoices(),
      getRevenueByCustomer(startOfYear, today),
      getExpensesByVendor(startOfYear, today),
      getAccountBalances(),
      getAircraftStats(),
    ]);

    res.json({
      profitAndLoss:   plThis.status    === 'fulfilled' ? plThis.value    : { error: plThis.reason?.message },
      profitAndLossLY: plLast.status    === 'fulfilled' ? plLast.value    : { error: plLast.reason?.message },
      invoices:        invoices.status  === 'fulfilled' ? invoices.value  : [],
      customers:       customers.status === 'fulfilled' ? customers.value : { error: customers.reason?.message },
      expenses:        expenses.status  === 'fulfilled' ? expenses.value  : { error: expenses.reason?.message },
      accounts:        accounts.status  === 'fulfilled' ? accounts.value  : [],
      aircraftStats:   aircraftStats.status === 'fulfilled' ? aircraftStats.value : [],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
router.get('/by-aircraft', async (req, res) => {
  try {
    const now = new Date();
    const startDate = `${now.getFullYear()}-01-01`;
    const endDate = now.toISOString().split('T')[0];
    const classes = ['N69FP', 'N408JS'];

    const results = await Promise.all(classes.map(async (tail) => {
      const [txData, gl] = await Promise.all([
        getTransactionsByClass(startDate, endDate, tail),
        getGeneralLedger(startDate, endDate, tail)
      ]);

      // Parse revenue from CustomerSales
      const revRows = txData.revList?.Rows?.Row || [];
      let revenue = 0;
      for (const row of revRows) {
        const cols = row.ColData || [];
        const amt = parseFloat(cols[1]?.value || '0');
        if (!isNaN(amt)) revenue += amt;
      }

      // Parse expenses from GeneralLedger
      const glRows = gl?.Rows?.Row || [];
      let expenses = 0;
      for (const row of glRows) {
        if (row.type === 'Section') {
          for (const sub of row.Rows?.Row || []) {
            const cols = sub.ColData || [];
            const debit = parseFloat(cols[4]?.value || '0');
            if (!isNaN(debit)) expenses += debit;
          }
        }
      }

      return {
        tail,
        revenue: Math.round(revenue),
        expenses: Math.round(expenses),
        net: Math.round(revenue - expenses)
      };
    }));

    res.json(results);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
export default router;
