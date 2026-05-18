import express from 'express';
import {
  getAuthUrl, getTokensFromCode,
  getProfitAndLoss, getOutstandingInvoices,
  getRevenueByCustomer, getExpensesByVendor,
  getAccountBalances, getGeneralLedger,
  getTransactionsByClass, getInvoicesByDateRange,
  getAllInvoicesYTD
} from '../services/quickbooks.js';
import * as lf from '../services/levelflight.js';
import { supabase } from '../services/supabase.js';

const router = express.Router();

// ─── Auth ────────────────────────────────────────────────────────────────────

router.get('/auth-url', (req, res) => {
  try { res.json({ url: getAuthUrl() }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/callback', async (req, res) => {
  try {
    const tokens = await getTokensFromCode(
      `https://exjet-dashboard-production.up.railway.app/api/finances/callback${req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : ''}`
    );
    res.json({
      message: 'Copy these to your Railway variables',
      QB_REFRESH_TOKEN: tokens.refresh_token,
      QB_REALM_ID: req.query.realmId
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── GL Test ─────────────────────────────────────────────────────────────────

router.get('/gl-test', async (req, res) => {
  try {
    const now = new Date();
    const result = await getGeneralLedger(
      `${now.getFullYear()}-01-01`,
      now.toISOString().split('T')[0],
      'N69FP'
    );
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Aircraft stats helper (uses LevelFlight legs + rate cards) ───────────────

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
      monthly: Object.entries(monthlyMap)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, v]) => ({
          month,
          revenue: Math.round(v.revenue),
          hours: Math.round(v.hours * 10) / 10
        })),
      topClients: Object.entries(clientMap)
        .map(([name, revenue]) => ({ name, revenue: Math.round(revenue) }))
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 5),
    });
  }
  return results.sort((a, b) => b.totalRevenue - a.totalRevenue);
};

// ─── Summary (P&L, invoices, customers, expenses) ────────────────────────────

router.get('/summary', async (req, res) => {
  try {
    const now = new Date();
    const startOfYear = `${now.getFullYear()}-01-01`;
    const today = now.toISOString().split('T')[0];
    const lastYearStart = `${now.getFullYear() - 1}-01-01`;
    const lastYearEnd   = `${now.getFullYear() - 1}-12-31`;

    const [plThis, plLast, invoices, customers, expenses, accounts, aircraftStats] =
      await Promise.allSettled([
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

// ─── Debug: count invoices ────────────────────────────────────────────────────

router.get('/by-aircraft-debug', async (req, res) => {
  try {
    const invoices = await getAllInvoicesYTD();
    res.json({
      fetched: invoices.length,
      invoices: invoices.map(i => ({
        doc:      i.DocNumber,
        date:     i.TxnDate,
        total:    i.TotalAmt,
        balance:  i.Balance,
        customer: i.CustomerRef?.name,
        class:    i.Line?.[0]?.SalesItemLineDetail?.ClassRef?.name
      }))
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Per-aircraft revenue from QB class tags ──────────────────────────────────

router.get('/by-aircraft', async (req, res) => {
  try {
    const invoices = await getAllInvoicesYTD();
    const totals = {
      'N69FP':  { revenue: 0, invoiceCount: 0 },
      'N408JS': { revenue: 0, invoiceCount: 0 }
    };

    for (const inv of invoices) {
      for (const line of inv.Line || []) {
        const classRef = line.SalesItemLineDetail?.ClassRef?.name;
        if (classRef && totals[classRef]) {
          totals[classRef].revenue      += line.Amount || 0;
          totals[classRef].invoiceCount += 1;
        }
      }
    }

    const result = Object.entries(totals).map(([tail, d]) => ({
      tail,
      revenue:      Math.round(d.revenue),
      invoiceCount: d.invoiceCount
    }));

    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
router.get('/raw-invoices', async (req, res) => {
  try {
    const invoices = await getAllInvoicesYTD();
    res.json(invoices);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
// ─── Per-leg revenue: join LevelFlight legs with QB invoices by tripId ────────

router.get('/by-legs', async (req, res) => {
  try {
    const AIRCRAFT = [
      { oid: '673d145b2c00002200f03411', tail: 'N69FP' },
      { oid: '69a0fae31c00002a00611199', tail: 'N408JS' }
    ];
    const now = Date.now();

    // Fetch LevelFlight legs for both aircraft
    const calendarResults = await Promise.all(
      AIRCRAFT.map(ac =>
        lf.getAircraftCalendar(ac.oid, now - 90 * 86400000, now + 14 * 86400000)
          .then(d => ({ tail: ac.tail, legs: d.legs || [] }))
      )
    );

    // Fetch all QB invoices YTD
    const invoices = await getAllInvoicesYTD();

    // Build QB lookup: tripId → invoice lines
    const invoiceByTrip = {};
    for (const inv of invoices) {
      const customer = inv.CustomerRef?.name || '';
      const tripMatch = customer.match(/Trip\s+(\d+)/i);
      if (!tripMatch) continue;
      const tripId = tripMatch[1];
      if (!invoiceByTrip[tripId]) invoiceByTrip[tripId] = { revenue: 0, lines: [] };
      for (const line of inv.Line || []) {
        const amt = line.Amount || 0;
        if (line.DetailType === 'SalesItemLineDetail' && amt > 0) {
          invoiceByTrip[tripId].revenue += amt;
          invoiceByTrip[tripId].lines.push({
            description: line.Description,
            amount: amt,
            class: line.SalesItemLineDetail?.ClassRef?.name
          });
        }
      }
    }
    

    // Build per-leg result
    const legResults = [];
    for (const { tail, legs } of calendarResults) {
      // Deduplicate legs by tripId (one invoice per trip, multiple legs)
      const seenTrips = new Set();
      for (const leg of legs) {
        const tripId = String(leg.dispatch?._tripId || '');
        const quoteId = String(leg.dispatch?._quoteId || '');
        const dep = leg.departure?.airport;
        const arr = leg.arrival?.airport;
        const depTime = leg.departure?.time;
        const arrTime = leg.arrival?.time;
        const client = leg.dispatch?.client?.company?.name || leg.dispatch?.client?.customer?.company?.[0]?.name || 'Unknown';
        const flightMins = leg._calc?.minutes || 0;
        const pax = leg.passengerCount || 0;
        const status = leg.status;

        // Only include completed legs (status 3)
        if (status !== 3) continue;

        const qbData = invoiceByTrip[tripId] || null;
        const alreadySeen = seenTrips.has(tripId);
        seenTrips.add(tripId);

        legResults.push({
          tail,
          tripId,
          quoteId,
          dep,
          arr,
          depTime,
          arrTime,
          flightMins,
          pax,
          client,
          // Show revenue only on first leg of trip to avoid double counting
          revenue: !alreadySeen && qbData ? Math.round(qbData.revenue) : 0,
          hasInvoice: !!qbData,
          tripRevenue: qbData ? Math.round(qbData.revenue) : 0
        });
      }
    }

    // Sort by departure time descending
    legResults.sort((a, b) => (b.depTime || 0) - (a.depTime || 0));

    res.json({
      legs: legResults,
      totalLegs: legResults.length,
      totalRevenue: legResults.reduce((s, l) => s + l.revenue, 0)
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;