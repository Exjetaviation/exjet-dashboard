import OAuthClient from 'intuit-oauth';
import dotenv from 'dotenv';
dotenv.config();

const getOAuthClient = () => new OAuthClient({
  clientId:     process.env.QB_CLIENT_ID,
  clientSecret: process.env.QB_CLIENT_SECRET,
  environment:  'production',
  redirectUri:  process.env.QB_REDIRECT_URI,
});

export const getAuthUrl = () => {
  const client = getOAuthClient();
  return client.authorizeUri({
    scope: [OAuthClient.scopes.Accounting, OAuthClient.scopes.OpenId],
    state: 'exjet-qb',
  });
};

export const getTokensFromCode = async (url) => {
  const client = getOAuthClient();
  const response = await client.createToken(url);
  return response.getJson();
};

const getAccessToken = async () => {
  // Get current refresh token from env or Supabase
  let refreshToken = process.env.QB_REFRESH_TOKEN;
  
  const client = getOAuthClient();
  client.setToken({ refresh_token: refreshToken });
  const response = await client.refreshUsingToken(refreshToken);
  const tokens = response.getJson();
  
  // If we got a new refresh token, save it to Supabase
  if (tokens.refresh_token && tokens.refresh_token !== refreshToken) {
    process.env.QB_REFRESH_TOKEN = tokens.refresh_token;
    try {
      const { supabase } = await import('./supabase.js');
      await supabase.from('app_config').upsert({ key: 'QB_REFRESH_TOKEN', value: tokens.refresh_token });
    } catch (e) {
      console.log('Could not save refresh token:', e.message);
    }
  }
  
  return tokens.access_token;
};

const qbFetch = async (path, params = {}, _retried = false) => {
  const token = await getAccessToken();
  const realmId = process.env.QB_REALM_ID;
  const qs = new URLSearchParams({ minorversion: '65', ...params }).toString();
  const url = `https://quickbooks.api.intuit.com/v3/company/${realmId}/${path}?${qs}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  // On 401, the access token was rejected (token revoked, refresh-chain skew,
  // or a transient QBO auth blip). Refresh once via getAccessToken — which
  // already persists any new refresh_token to Supabase — and retry the call.
  if (res.status === 401 && !_retried) {
    return qbFetch(path, params, true);
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`QB API error ${res.status}: ${text}`);
  }
  return res.json();
};

export const getProfitAndLoss = async (startDate, endDate) => {
  return qbFetch('reports/ProfitAndLoss', {
    start_date: startDate,
    end_date: endDate,
    summarize_column_by: 'Month',
  });
};

export const getOutstandingInvoices = async () => {
  const data = await qbFetch('query', {
    query: `SELECT * FROM Invoice WHERE Balance > '0' ORDERBY DueDate ASC MAXRESULTS 50`,
  });
  return data.QueryResponse?.Invoice || [];
};

export const getRevenueByCustomer = async (startDate, endDate) => {
  return qbFetch('reports/CustomerSales', { start_date: startDate, end_date: endDate });
};

export const getExpensesByVendor = async (startDate, endDate) => {
  return qbFetch('reports/VendorExpenses', { start_date: startDate, end_date: endDate });
};

// Parses a top-level P&L section ('Expenses' or 'COGS') into a flat
// [{ category, amount }] keyed by TOP-LEVEL Chart-of-Accounts category.
// For nested categories we use QBO's own Section.Summary total — that
// matches the report's grand totals exactly and folds in any "Other"
// postings that don't surface as leaf rows. The last ColData column is
// the YTD total even when the report is monthly-summarized.
const parseSectionTotals = (report, groupCode) => {
  if (!report || report.error) return [];
  const section = (report?.Rows?.Row || []).find(r => r?.group === groupCode);
  if (!section) return [];
  const lastTotal = cols => parseFloat(cols?.[cols.length - 1]?.value) || 0;
  const out = [];
  for (const row of section.Rows?.Row || []) {
    let category, amount;
    if (row?.type === 'Section') {
      category = row.Header?.ColData?.[0]?.value || 'Uncategorized';
      amount = lastTotal(row.Summary?.ColData);
    } else if (row?.type === 'Data' && Array.isArray(row.ColData)) {
      category = row.ColData[0]?.value || 'Uncategorized';
      amount = lastTotal(row.ColData);
    } else {
      continue;
    }
    if (category && amount !== 0) out.push({ category, amount });
  }
  return out;
};
// Operating-overhead categories (Maintenance, Hangar rent, etc.)
export const parseExpensesByCategory = (report) => parseSectionTotals(report, 'Expenses');
// Per-flight direct costs (Fuel, Crew Fees, Landing & Ramp, Catering, ...)
export const parseCOGSByCategory     = (report) => parseSectionTotals(report, 'COGS');

export const getExpensesByCategory = async (startDate, endDate) => {
  return parseExpensesByCategory(await getProfitAndLoss(startDate, endDate));
};

export const getAccountBalances = async () => {
  const data = await qbFetch('query', {
    query: `SELECT * FROM Account WHERE AccountType = 'Bank' MAXRESULTS 20`,
  });
  return data.QueryResponse?.Account || [];
};

export const getClassList = async () => {
  const data = await qbFetch('query', {
    query: `SELECT * FROM Class MAXRESULTS 20`,
  });
  return data.QueryResponse?.Class || [];
};

export const getTransactionsByClass = async (startDate, endDate, className) => {
  const [txList, revList] = await Promise.all([
    qbFetch('reports/TransactionList', {
      start_date: startDate,
      end_date: endDate,
      columns: 'tx_date,txn_type,credit_amt,debit_amt,account_name,klass_name',
      filter_class: className,
    }),
    qbFetch('reports/CustomerSales', {
      start_date: startDate,
      end_date: endDate,
      filter_class: className,
    }),
  ]);
  return { txList, revList };
};
export const getInvoicesByClass = async (startDate, endDate) => {
  const data = await qbFetch('query', {
    query: `SELECT * FROM Invoice WHERE TxnDate >= '${startDate}' AND TxnDate <= '${endDate}' MAXRESULTS 200`,
  });
  return data.QueryResponse?.Invoice || [];
};
export const getGeneralLedger = async (startDate, endDate, className) => {
  return qbFetch('reports/GeneralLedger', {
    start_date: startDate,
    end_date: endDate,
    filter_class: className,
  });
};

export const getInvoicesByDateRange = async (startDate, endDate) => {
  const allInvoices = [];
  let startPos = 1;
  const batchSize = 100;
  while (true) {
    const data = await qbFetch('query', {
      query: `SELECT * FROM Invoice WHERE TxnDate >= '${startDate}' AND TxnDate <= '${endDate}' STARTPOSITION ${startPos} MAXRESULTS ${batchSize}`
    });
    const batch = data.QueryResponse?.Invoice || [];
    allInvoices.push(...batch);
    if (batch.length < batchSize) break;
    startPos += batchSize;
  }
  return { QueryResponse: { Invoice: allInvoices } };
};

export const getAllInvoicesYTD = async () => {
  const now = new Date();
  const startDate = `${now.getFullYear()}-01-01`;
  const endDate = now.toISOString().split('T')[0];
  return getInvoicesByDateRange(startDate, endDate).then(d => d.QueryResponse?.Invoice || []);
};

// ===== A/R aging — who owes us, bucketed by how late =====
export const getAgedReceivables = async (asOfDate) => {
  return qbFetch('reports/AgedReceivables', { report_date: asOfDate });
};
export const getAgedReceivableDetail = async (asOfDate) => {
  return qbFetch('reports/AgedReceivableDetail', { report_date: asOfDate });
};

// ===== A/P aging — what we owe vendors, bucketed by how late =====
export const getAgedPayables = async (asOfDate) => {
  return qbFetch('reports/AgedPayables', { report_date: asOfDate });
};

// ===== Balance sheet — assets / liabilities / equity at a point in time =====
export const getBalanceSheetSummary = async (asOfDate) => {
  return qbFetch('reports/BalanceSheetSummary', { end_date: asOfDate });
};

// ===== Cash flow — operating / investing / financing per month =====
export const getCashFlow = async (startDate, endDate) => {
  return qbFetch('reports/CashFlow', {
    start_date: startDate,
    end_date: endDate,
    summarize_column_by: 'Month',
  });
};

// ===== P&L detail — every transaction behind each account total =====
export const getProfitAndLossDetail = async (startDate, endDate) => {
  return qbFetch('reports/ProfitAndLossDetail', {
    start_date: startDate,
    end_date: endDate,
  });
};

// ===== P&L summarized BY CLASS — gives a per-class column for Income, COGS,
// Expenses, GrossProfit, NetIncome. This is the authoritative per-aircraft
// view because it includes every transaction QBO tagged to a class (bills,
// invoices, purchases, journal entries, deposits — not just bills). =====
export const getProfitAndLossByClass = async (startDate, endDate) => {
  return qbFetch('reports/ProfitAndLoss', {
    start_date: startDate,
    end_date: endDate,
    summarize_column_by: 'Class',
  });
};

// ===== Projects (each trip is a Project / sub-customer in QBO) =====
// Projects are modeled as Customer rows with IsProject=true and a ParentRef
// pointing at the customer who booked the trip.
export const getProjects = async () => {
  const all = [];
  let startPos = 1;
  const batchSize = 100;
  while (true) {
    const data = await qbFetch('query', {
      query: `SELECT * FROM Customer WHERE IsProject = true STARTPOSITION ${startPos} MAXRESULTS ${batchSize}`,
    });
    const batch = data.QueryResponse?.Customer || [];
    all.push(...batch);
    if (batch.length < batchSize) break;
    startPos += batchSize;
  }
  return all;
};

// ProfitAndLoss summarized by Customer — one column per customer (and per
// project, since projects are sub-customers). Used to derive per-trip P&L.
export const getProfitAndLossByCustomer = async (startDate, endDate) => {
  return qbFetch('reports/ProfitAndLoss', {
    start_date: startDate,
    end_date: endDate,
    summarize_column_by: 'Customers',
  });
};

// Try QBO's named Project Profitability report. Not in every plan tier; if
// the API rejects it we fall back to deriving per-project totals from
// getProfitAndLossByCustomer + getProjects. Caller should use .catch.
export const getProjectProfitability = async (startDate, endDate) => {
  return qbFetch('reports/ProjectProfitability', {
    start_date: startDate,
    end_date: endDate,
  });
};

// ===== Bills (vendor-side AP documents) — paginated, mirrors invoice query =====
export const getBillsByDateRange = async (startDate, endDate) => {
  const allBills = [];
  let startPos = 1;
  const batchSize = 100;
  while (true) {
    const data = await qbFetch('query', {
      query: `SELECT * FROM Bill WHERE TxnDate >= '${startDate}' AND TxnDate <= '${endDate}' STARTPOSITION ${startPos} MAXRESULTS ${batchSize}`,
    });
    const batch = data.QueryResponse?.Bill || [];
    allBills.push(...batch);
    if (batch.length < batchSize) break;
    startPos += batchSize;
  }
  return allBills;
};
export const getAllBillsYTD = async () => {
  const now = new Date();
  return getBillsByDateRange(`${now.getFullYear()}-01-01`, now.toISOString().split('T')[0]);
};

// ===== Pure parsers (no I/O). The /summary route applies them to the raw
//       responses fetched in parallel above. =====

// Aging report (A/R or A/P — identical shape). Standard QBO columns:
// ['', 'Current', '1 - 30', '31 - 60', '61 - 90', '91 and over', 'Total'].
// Each customer/vendor is either a Data row (single open invoice/bill) or a
// Section with Header + Summary (multiple). The grand total is a final
// Section with group='GrandTotal' and no Header.
export const parseAgingReport = (report) => {
  if (!report || report.error) return null;

  const BUCKET_KEYS = ['current', 'b1to30', 'b31to60', 'b61to90', 'b91plus', 'total'];
  // Map ColData index → bucket key. Index 0 is the label column, indices 1..N are amounts.
  const entryFrom = (name, cells) => {
    const e = { name };
    BUCKET_KEYS.forEach((k, i) => {
      e[k] = parseFloat(cells?.[i + 1]?.value) || 0;
    });
    return e;
  };

  const rows = [];
  let totals = null;
  for (const r of (report.Rows?.Row || [])) {
    if (r?.type === 'Section') {
      const summary = r.Summary?.ColData || [];
      const isGrand = r.group === 'GrandTotal'
        || (!r.Header && (summary[0]?.value || '').toUpperCase() === 'TOTAL');
      if (isGrand) {
        totals = entryFrom('TOTAL', summary);
      } else {
        const name = r.Header?.ColData?.[0]?.value || '?';
        rows.push(entryFrom(name, summary));
      }
    } else if (Array.isArray(r?.ColData)) {
      rows.push(entryFrom(r.ColData[0]?.value || '?', r.ColData));
    }
  }
  return { asOf: report?.Header?.EndPeriod || report?.Header?.ReportDate, rows, totals };
};

// BalanceSheetSummary — single total column. Returns a flat object with the
// well-known buckets + computed working capital. Walks the tree by group code
// for section totals and by the leaf account name for direct Data rows.
export const parseBalanceSheet = (report) => {
  if (!report || report.error) return null;
  const lastVal = cd => parseFloat(cd?.[cd.length - 1]?.value) || 0;
  const map = {};

  const walk = (rows) => {
    for (const r of rows || []) {
      if (r?.type === 'Section') {
        if (r.group) map[r.group] = lastVal(r.Summary?.ColData);
        walk(r.Rows?.Row || []);
      } else if (Array.isArray(r?.ColData)) {
        const label = r.ColData[0]?.value;
        if (label) map[label] = lastVal(r.ColData);
      }
    }
  };
  walk(report?.Rows?.Row || []);

  const totalAssets    = map.TotalAssets || 0;
  const currentAssets  = map.CurrentAssets || 0;
  const currentLiab    = map.CurrentLiabilities || 0;
  const totalLiab      = map.Liabilities || 0;
  const equity         = map['Equity'] || map.TotalEquity || (totalAssets - totalLiab);

  return {
    asOf: report?.Header?.EndPeriod,
    cash:                map['Bank Accounts'] || 0,
    ar:                  map['Accounts Receivable'] || 0,
    otherCurrentAssets:  map['Other Current Assets'] || 0,
    ap:                  map['Accounts Payable'] || 0,
    creditCards:         map['Credit Cards'] || 0,
    otherCurrentLiab:    map['Other Current Liabilities'] || 0,
    longTermLiab:        map['Long-Term Liabilities'] || 0,
    totalAssets, currentAssets, currentLiab, totalLiab, equity,
    workingCapital:      currentAssets - currentLiab,
  };
};

// CashFlow (monthly-summarized). Returns one array per top-level section,
// aligned to the columns array. Last column is the YTD total — caller can
// .slice(0,-1) for monthly values and read the last element for the total.
export const parseCashFlow = (report) => {
  if (!report || report.error) return null;
  const cols = (report?.Columns?.Column || []).slice(1).map(c => c.ColTitle);

  const seriesFor = (group) => {
    const sec = (report?.Rows?.Row || []).find(r => r?.group === group);
    if (!sec) return null;
    return (sec.Summary?.ColData || []).slice(1).map(c => parseFloat(c?.value) || 0);
  };

  return {
    columns:   cols,
    operating: seriesFor('OperatingActivities'),
    investing: seriesFor('InvestingActivities'),
    financing: seriesFor('FinancingActivities'),
    netChange: seriesFor('CashIncrease'),
  };
};

// Aggregates bill line items by their ClassRef (aircraft tag — N69FP, N408JS,
// etc.). Each bill line is AccountBasedExpenseLineDetail with a ClassRef.name;
// untagged lines (no class) bucket as 'Untagged'. Returns { tail: amount }.
export const parseExpensesByAircraft = (bills) => {
  if (!Array.isArray(bills)) return {};
  const totals = {};
  for (const bill of bills) {
    for (const line of bill.Line || []) {
      const detail = line.AccountBasedExpenseLineDetail;
      if (!detail) continue;
      const tail = detail.ClassRef?.name || 'Untagged';
      totals[tail] = (totals[tail] || 0) + (line.Amount || 0);
    }
  }
  return totals;
};

// ProfitAndLoss summarized by Class → { classes: [{className, income, cogs,
// grossProfit, expenses, netIncome}] }. Each class is a column in the report;
// the last column is the grand Total which we drop. Untagged transactions
// usually appear as a "Not Specified" column — caller can decide how to bucket.
export const parseProfitAndLossByClass = (report) => {
  if (!report || report.error) return null;
  const cols = report?.Columns?.Column || [];
  // cols[0] is the label column; cols[1..N-1] are per-class; cols[N] is the
  // grand "Total" column (skip it — it's just the sum across classes).
  const classNames = cols.slice(1, -1).map(c => c.ColTitle);

  const sectionValues = (groupCode) => {
    const sec = (report?.Rows?.Row || []).find(r => r?.group === groupCode);
    if (!sec) return classNames.map(() => 0);
    const cd = sec.Summary?.ColData || [];
    return cd.slice(1, -1).map(c => parseFloat(c?.value) || 0);
  };

  const income      = sectionValues('Income');
  const cogs        = sectionValues('COGS');
  const grossProfit = sectionValues('GrossProfit');
  const expenses    = sectionValues('Expenses');
  const netIncome   = sectionValues('NetIncome');

  return {
    classes: classNames.map((name, i) => ({
      className:   name,
      income:      income[i]      || 0,
      cogs:        cogs[i]        || 0,
      grossProfit: grossProfit[i] || 0,
      expenses:    expenses[i]    || 0,
      netIncome:   netIncome[i]   || 0,
    })),
  };
};

// ProfitAndLossDetail → { categoryName: [{date,type,num,name,klass,memo,amount}] }
// keyed by the TOP-LEVEL category under either COGS or Expenses, so a click
// on any line in the page's expense/COGS lists can drill into its transactions.
// Unlike the regular P&L, the Detail report has NO `group` field on sections,
// nests everything under an "Ordinary Income/Expenses" wrapper, and contains
// both Cost-of-Goods-Sold AND Expenses sections — so we search by header name
// recursively. Standard columns: Date, Transaction Type, Num, Name, Class,
// Memo, Split, Amount, Balance.
export const parsePLDetailByCategory = (report) => {
  if (!report || report.error) return {};

  const findSection = (rows, headerName) => {
    for (const r of rows || []) {
      if (r?.type !== 'Section') continue;
      if (r.Header?.ColData?.[0]?.value === headerName) return r;
      const inner = findSection(r.Rows?.Row || [], headerName);
      if (inner) return inner;
    }
    return null;
  };

  const collect = (rows, bucket) => {
    for (const r of rows || []) {
      if (r?.type === 'Section') {
        collect(r.Rows?.Row || [], bucket);
      } else if (Array.isArray(r?.ColData)) {
        const cd = r.ColData;
        // Skip subtotal / running-balance helper rows — real transactions
        // always carry both a Date and a Transaction Type.
        if (!cd[0]?.value || !cd[1]?.value) continue;
        bucket.push({
          date:   cd[0]?.value || '',
          type:   cd[1]?.value || '',
          num:    cd[2]?.value || '',
          name:   cd[3]?.value || '',
          klass:  cd[4]?.value || '',
          memo:   cd[5]?.value || '',
          amount: parseFloat(cd[7]?.value) || 0,
        });
      }
    }
  };

  const out = {};
  for (const sectionName of ['Cost of Goods Sold', 'Expenses']) {
    const section = findSection(report?.Rows?.Row || [], sectionName);
    if (!section) continue;
    for (const child of section.Rows?.Row || []) {
      let category = null;
      if (child?.type === 'Section') category = child.Header?.ColData?.[0]?.value;
      else if (Array.isArray(child?.ColData)) category = child.ColData[0]?.value;
      if (!category) continue;
      const txns = [];
      if (child.Rows?.Row) collect(child.Rows.Row, txns);
      if (txns.length) out[category] = txns;
    }
  }
  return out;
};
