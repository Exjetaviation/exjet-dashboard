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

// Parses the Expenses section of the ProfitAndLoss report into a flat
// [{ category, amount }] keyed by TOP-LEVEL Chart-of-Accounts category.
// For nested categories we use QBO's own Section.Summary total — that
// matches the report's grand total exactly and folds in any "Other"
// postings that don't surface as leaf rows. The last ColData column is
// the YTD total even when the report is monthly-summarized.
export const getExpensesByCategory = async (startDate, endDate) => {
  const report = await qbFetch('reports/ProfitAndLoss', {
    start_date: startDate,
    end_date: endDate,
  });
  const topRows = report?.Rows?.Row || [];
  const expensesSection = topRows.find(
    r => r?.group === 'Expenses'
      || r?.Header?.ColData?.[0]?.value?.toLowerCase?.().includes('expense')
  );
  if (!expensesSection) return [];

  const lastTotal = cols => parseFloat(cols?.[cols.length - 1]?.value) || 0;

  const results = [];
  for (const row of expensesSection.Rows?.Row || []) {
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
    if (category && amount !== 0) results.push({ category, amount });
  }
  return results;
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
