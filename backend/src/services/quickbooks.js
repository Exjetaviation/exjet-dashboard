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

const getClient = () => {
  const client = getOAuthClient();
  client.setToken({
    refresh_token: process.env.QB_REFRESH_TOKEN,
    access_token:  '',
  });
  return client;
};

const query = async (sql) => {
  const client = getClient();
  await client.refresh();
  const token = client.getToken();
  const realmId = process.env.QB_REALM_ID;
  const res = await fetch(
    `https://quickbooks.api.intuit.com/v3/company/${realmId}/query?query=${encodeURIComponent(sql)}&minorversion=65`,
    {
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        Accept: 'application/json',
      },
    }
  );
  if (!res.ok) throw new Error(`QB query failed: ${res.status} ${await res.text()}`);
  return res.json();
};

const report = async (name, params = {}) => {
  const client = getClient();
  await client.refresh();
  const token = client.getToken();
  const realmId = process.env.QB_REALM_ID;
  const qs = new URLSearchParams({ minorversion: '65', ...params }).toString();
  const res = await fetch(
    `https://quickbooks.api.intuit.com/v3/company/${realmId}/reports/${name}?${qs}`,
    {
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        Accept: 'application/json',
      },
    }
  );
  if (!res.ok) throw new Error(`QB report failed: ${res.status} ${await res.text()}`);
  return res.json();
};

export const getProfitAndLoss = async (startDate, endDate) => {
  return report('ProfitAndLoss', {
    start_date: startDate,
    end_date:   endDate,
    summarize_column_by: 'Month',
  });
};

export const getOutstandingInvoices = async () => {
  const data = await query(
    `SELECT * FROM Invoice WHERE Balance > '0' ORDERBY DueDate ASC MAXRESULTS 50`
  );
  return data.QueryResponse?.Invoice || [];
};

export const getRevenueByCustomer = async (startDate, endDate) => {
  return report('CustomerSales', { start_date: startDate, end_date: endDate });
};

export const getExpensesByCategory = async (startDate, endDate) => {
  return report('ExpensesByVendor', { start_date: startDate, end_date: endDate });
};

export const getAccountBalances = async () => {
  const data = await query(`SELECT * FROM Account WHERE AccountType = 'Bank' MAXRESULTS 20`);
  return data.QueryResponse?.Account || [];
};
