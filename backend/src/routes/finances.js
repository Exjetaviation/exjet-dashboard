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
  } catch (err) { res.status(500).json({ error: err.message }); }
});
  const legs = legsRes?.legs || [];
  const rateCards = rateCardsRes.data || [];
  const completedLegs = legs.filter(l => l.status === 3 && l.departure?.time >= startOfYear && l._calc?._minutes > 0);
  const byAircraft = {};
  completedLegs.forEach(leg => {
    const tail = leg.dispatch?.aircraft?.tailNumber;
    if (!tail) return;
    if (!byAircraft[tail]) byAircraft[tail] = { tail, legs: [] };
    byAircraft[tail].legs.push(leg);
  });
router.get('/summary', async (req, res) => {
  try {
    const now = new Date();
    const startOfYear = `${now.getFullYear()}-01-01`;
    const today = now.toISOString().split('T')[0];
    const lastYearStart = `${now.getFullYear() - 1}-01-01`;
    const lastYearEnd = `${now.getFullYear() - 1}-12-31`;
    const [plThis, plLast, invoices, customers, expenses, accounts] = await Promise.allSettled([
      getProfitAndLoss(startOfYear, today),
      getProfitAndLoss(lastYearStart, lastYearEnd),
      getOutstandingInvoices(),
      getRevenueByCustomer(startOfYear, today),
      getExpensesByVendor(startOfYear, today),
      getAccountBalances(),
    ]);
    res.json({
      profitAndLoss:   plThis.status    === 'fulfilled' ? plThis.value    : { error: plThis.reason?.message },
      profitAndLossLY: plLast.status    === 'fulfilled' ? plLast.value    : { error: plLast.reason?.message },
      invoices:        invoices.status  === 'fulfilled' ? invoices.value  : [],
      customers:       customers.status === 'fulfilled' ? customers.value : { error: customers.reason?.message },
      expenses:        expenses.status  === 'fulfilled' ? expenses.value  : { error: expenses.reason?.message },
      accounts:        accounts.status  === 'fulfilled' ? accounts.value  : [],
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/by-aircraft-debug', async (req, res) => {
  try {
    const invoices = await getAllInvoicesYTD();
    res.json({ fetched: invoices.length, invoices: invoices.map(i => ({ doc: i.DocNumber, date: i.TxnDate, total: i.TotalAmt, balance: i.Balance, customer: i.CustomerRef?.name, class: i.Line?.[0]?.SalesItemLineDetail?.ClassRef?.name })) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/by-aircraft', async (req, res) => {
  try {
    const invoices = await getAllInvoicesYTD();
    const totals = { 'N69FP': { revenue: 0, invoiceCount: 0 }, 'N408JS': { revenue: 0, invoiceCount: 0 } };
    for (const inv of invoices) {
      for (const line of inv.Line || []) {
        const classRef = line.SalesItemLineDetail?.ClassRef?.name;
        if (classRef && totals[classRef]) {
          totals[classRef].revenue += line.Amount || 0;
          totals[classRef].invoiceCount += 1;
        }
      }
    }
    res.json(Object.entries(totals).map(([tail, d]) => ({ tail, revenue: Math.round(d.revenue), invoiceCount: d.invoiceCount })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/raw-invoices', async (req, res) => {
  try {
    const invoices = await getAllInvoicesYTD();
    res.json(invoices);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/by-legs', async (req, res) => {
  try {
    const AIRCRAFT = [
      { oid: '673d145b2c00002200f03411', tail: 'N69FP' },
      { oid: '69a0fae31c00002a00611199', tail: 'N408JS' }
    ];
    const now = Date.now();
    const calendarResults = await Promise.all(
      AIRCRAFT.map(ac => lf.getAircraftCalendar(ac.oid, now - 90 * 86400000, now + 14 * 86400000).then(d => ({ tail: ac.tail, legs: d.legs || [] })))
    );
    const invoices = await getAllInvoicesYTD();
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
          invoiceByTrip[tripId].lines.push({ description: line.Description, amount: amt, class: line.SalesItemLineDetail?.ClassRef?.name });
        }
      }
    }
    const legResults = [];
    for (const { tail, legs } of calendarResults) {
      const seenTrips = new Set();
      for (const leg of legs) {
        if (leg.status !== 3) continue;
        const tripId = String(leg.dispatch?._tripId || '');
        const quoteId = String(leg.dispatch?._quoteId || '');
        const qbData = invoiceByTrip[tripId] || null;
        const alreadySeen = seenTrips.has(tripId);
        seenTrips.add(tripId);
        legResults.push({
          tail, tripId, quoteId,
          dep: leg.departure?.airport, arr: leg.arrival?.airport,
          depTime: leg.departure?.time, arrTime: leg.arrival?.time,
          flightMins: leg._calc?.minutes || 0,
          pax: leg.passengerCount || 0,
          client: leg.dispatch?.client?.company?.name || leg.dispatch?.client?.customer?.company?.[0]?.name || 'Unknown',
          revenue: !alreadySeen && qbData ? Math.round(qbData.revenue) : 0,
          hasInvoice: !!qbData,
          tripRevenue: qbData ? Math.round(qbData.revenue) : 0
        });
      }
    }
    legResults.sort((a, b) => (b.depTime || 0) - (a.depTime || 0));
    res.json({ legs: legResults, totalLegs: legResults.length, totalRevenue: legResults.reduce((s, l) => s + l.revenue, 0) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
