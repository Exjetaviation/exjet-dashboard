import express from 'express';
import {
  getAuthUrl, getTokensFromCode,
  getProfitAndLoss, getOutstandingInvoices,
  getRevenueByCustomer, getExpensesByVendor,
  getAccountBalances, getGeneralLedger,
  getInvoicesByDateRange, getAllInvoicesYTD,
  getAgedReceivables, getAgedReceivableDetail, getAgedPayables,
  getBalanceSheetSummary, getCashFlow, getProfitAndLossDetail,
  getAllBillsYTD,
  parseExpensesByCategory, parseCOGSByCategory, parseAgingReport,
  parseBalanceSheet, parseCashFlow, parseExpensesByAircraft,
  parsePLDetailByCategory,
} from '../services/quickbooks.js';

const router = express.Router();

// Auth
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
// Returns the raw QuickBooks ProfitAndLoss report (Jan 1 of current year → today)
// so we can inspect actual expense-category rows before wiring category grouping
// into the summary page. Temporary — remove once category grouping is verified.
router.get('/debug/expenses', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const startOfYear = `${new Date().getFullYear()}-01-01`;
    const raw = await getProfitAndLoss(startOfYear, today);
    res.json(raw);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// One-shot raw dump of the new QB report/entity endpoints we're about to wire
// into the page: A/R aging, A/P aging, balance sheet, cash flow, P&L detail,
// YTD bills. Lets us verify shapes once before writing per-feature parsers.
// Temporary — remove (and tighten the requireAuth exemption) once UI is wired.
router.get('/debug/financials', async (req, res) => {
  const now = new Date();
  const startOfYear = `${now.getFullYear()}-01-01`;
  const today = now.toISOString().split('T')[0];

  const [arAging, arAgingDetail, apAging, bsSummary, cashFlow, plDetail, bills] = await Promise.allSettled([
    getAgedReceivables(today),
    getAgedReceivableDetail(today),
    getAgedPayables(today),
    getBalanceSheetSummary(today),
    getCashFlow(startOfYear, today),
    getProfitAndLossDetail(startOfYear, today),
    getAllBillsYTD(),
  ]);

  const settle = (r, name) => r.status === 'fulfilled'
    ? r.value
    : { error: r.reason?.message || String(r.reason), source: name };

  // Bills can be a large array — truncate to count + a sample so the response
  // stays small enough to eyeball in a browser.
  const billsData = bills.status === 'fulfilled'
    ? { count: bills.value.length, sample: bills.value.slice(0, 3) }
    : { error: bills.reason?.message || String(bills.reason), source: 'Bills' };

  res.json({
    arAging:       settle(arAging, 'AgedReceivables'),
    arAgingDetail: settle(arAgingDetail, 'AgedReceivableDetail'),
    apAging:       settle(apAging, 'AgedPayables'),
    bsSummary:     settle(bsSummary, 'BalanceSheetSummary'),
    cashFlow:      settle(cashFlow, 'CashFlow'),
    plDetail:      settle(plDetail, 'ProfitAndLossDetail'),
    billsYTD:      billsData,
  });
});
// Main summary — pure QB. Fetches everything the Finances page needs in one
// parallel batch (per-call .catch via Promise.allSettled means a single QB
// failure doesn't blank out the whole page) and applies the pure parsers
// from quickbooks.js so the frontend gets app-shape data, not raw QBO XML-ish.
router.get('/summary', async (req, res) => {
  try {
    const now = new Date();
    const startOfYear = `${now.getFullYear()}-01-01`;
    const today = now.toISOString().split('T')[0];
    const lastYearStart = `${now.getFullYear() - 1}-01-01`;
    const lastYearEnd   = `${now.getFullYear() - 1}-12-31`;

    const results = await Promise.allSettled([
      getProfitAndLoss(startOfYear, today),         // 0  pl this year
      getProfitAndLoss(lastYearStart, lastYearEnd), // 1  pl last year
      getOutstandingInvoices(),                     // 2  open invoices
      getRevenueByCustomer(startOfYear, today),     // 3  revenue by customer
      getExpensesByVendor(startOfYear, today),      // 4  expenses by vendor (kept — frontend still reads)
      getAccountBalances(),                         // 5  bank accounts
      getAgedReceivables(today),                    // 6  A/R aging
      getAgedPayables(today),                       // 7  A/P aging
      getBalanceSheetSummary(today),                // 8  balance sheet
      getCashFlow(startOfYear, today),              // 9  cash flow (monthly)
      getProfitAndLossDetail(startOfYear, today),   // 10 P&L detail (for drill-down)
      getAllBillsYTD(),                             // 11 YTD vendor bills (for per-aircraft)
    ]);

    const val = (i) => results[i].status === 'fulfilled' ? results[i].value : null;
    const errOf = (i) => results[i].status === 'fulfilled'
      ? null
      : { error: results[i].reason?.message || String(results[i].reason) };

    const plThis = val(0);
    const bills  = val(11) || [];

    res.json({
      // Raw QBO responses — kept so the existing frontend keeps working
      // unchanged. Round 2b will start consuming the parsed fields below.
      profitAndLoss:   plThis    || errOf(0),
      profitAndLossLY: val(1)    || errOf(1),
      invoices:        val(2)    || [],
      customers:       val(3)    || errOf(3),
      expenses:        val(4)    || errOf(4),
      accounts:        val(5)    || [],

      // Parsed app-shape data — new in Round 2a, drives the next UI pass.
      // Operating overhead vs per-flight direct costs (Fuel, Crew, Landing,
      // Catering, etc.) are split because they live in different P&L sections
      // and Round 2b's UI shows them as separate buckets.
      expensesByCategory:  parseExpensesByCategory(plThis),
      cogsByCategory:      parseCOGSByCategory(plThis),
      arAging:             parseAgingReport(val(6)),
      apAging:             parseAgingReport(val(7)),
      balanceSheet:        parseBalanceSheet(val(8)),
      cashFlow:            parseCashFlow(val(9)),
      expensesByAircraft:  parseExpensesByAircraft(bills),
      plDetailByCategory:  parsePLDetailByCategory(val(10)),
      billsCount:          bills.length,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// All invoices YTD raw
router.get('/raw-invoices', async (req, res) => {
  try {
    const invoices = await getAllInvoicesYTD();
    res.json(invoices);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Per-aircraft from QB class tags on invoices
router.get('/by-aircraft', async (req, res) => {
  try {
    const invoices = await getAllInvoicesYTD();
    const totals = {
      'N69FP':  { revenue: 0, invoiceCount: 0 },
      'N408JS': { revenue: 0, invoiceCount: 0 },
      'Untagged': { revenue: 0, invoiceCount: 0 }
    };
    for (const inv of invoices) {
      let tagged = false;
      for (const line of inv.Line || []) {
        const classRef = line.SalesItemLineDetail?.ClassRef?.name;
        if (classRef && totals[classRef]) {
          totals[classRef].revenue += line.Amount || 0;
          totals[classRef].invoiceCount += 1;
          tagged = true;
        }
      }
      if (!tagged) {
        totals['Untagged'].revenue += inv.TotalAmt || 0;
        totals['Untagged'].invoiceCount += 1;
      }
    }
    res.json(Object.entries(totals).map(([tail, d]) => ({
      tail,
      revenue: Math.round(d.revenue),
      invoiceCount: d.invoiceCount
    })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Per-trip from QB invoices only (CustomerRef = "Trip XXXXX")
router.get('/by-trips', async (req, res) => {
  try {
    const invoices = await getAllInvoicesYTD();
    const trips = [];
    for (const inv of invoices) {
      const customer = inv.CustomerRef?.name || '';
      const tripMatch = customer.match(/Trip\s+(\d+)/i);
      const lines = (inv.Line || []).filter(l => l.DetailType === 'SalesItemLineDetail' && (l.Amount || 0) > 0);
      trips.push({
        invoiceId: inv.Id,
        docNumber: inv.DocNumber,
        date: inv.TxnDate,
        dueDate: inv.DueDate,
        customer: customer,
        tripId: tripMatch ? tripMatch[1] : null,
        total: inv.TotalAmt || 0,
        balance: inv.Balance || 0,
        paid: (inv.Balance || 0) === 0,
        aircraft: lines[0]?.SalesItemLineDetail?.ClassRef?.name || null,
        description: lines[0]?.Description || '',
        lines: lines.map(l => ({
          description: l.Description,
          amount: l.Amount,
          aircraft: l.SalesItemLineDetail?.ClassRef?.name || null,
          serviceDate: l.SalesItemLineDetail?.ServiceDate || null,
        }))
      });
    }
    trips.sort((a, b) => new Date(b.date) - new Date(a.date));
    res.json({
      trips,
      totalTrips: trips.length,
      totalRevenue: Math.round(trips.reduce((s, t) => s + t.total, 0)),
      totalOutstanding: Math.round(trips.filter(t => !t.paid).reduce((s, t) => s + t.balance, 0)),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// General ledger for a specific aircraft class
router.get('/gl/:aircraft', async (req, res) => {
  try {
    const now = new Date();
    const result = await getGeneralLedger(
      `${now.getFullYear()}-01-01`,
      now.toISOString().split('T')[0],
      req.params.aircraft
    );
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

export default router;