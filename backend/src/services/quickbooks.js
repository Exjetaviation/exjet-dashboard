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

const qbFetch = async (path, params = {}) => {
  const token = await getAccessToken();
  const realmId = process.env.QB_REALM_ID;
  const qs = new URLSearchParams({ minorversion: '65', ...params }).toString();
  const url = `https://quickbooks.api.intuit.com/v3/company/${realmId}/${path}?${qs}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
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
export const getInvoicesByDateRange = async (startDate, endDate) => {
  return qbFetch('query', {
    query: `SELECT * FROM Invoice WHERE TxnDate >= '${startDate}' AND TxnDate <= '${endDate}' MAXRESULTS 1000`
  });
};
};