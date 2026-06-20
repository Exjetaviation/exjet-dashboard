import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

let tokenCache = null;
let tokenExpiry = null;

const getToken = async () => {
  if (tokenCache && tokenExpiry && Date.now() < tokenExpiry) {
    return tokenCache;
  }

  const params = new URLSearchParams();
  params.append('grant_type', 'refresh_token');
  params.append('client_id', process.env.LEVELFLIGHT_CLIENT_ID);
  params.append('refresh_token', process.env.LEVELFLIGHT_REFRESH_TOKEN);

  const res = await axios.post(process.env.LEVELFLIGHT_TOKEN_URL, params, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  });

  tokenCache = res.data.id_token;
  tokenExpiry = Date.now() + (res.data.expires_in - 60) * 1000;
  return tokenCache;
};

const lf = async () => {
  const token = await getToken();
  return axios.create({
    baseURL: process.env.LEVELFLIGHT_BASE_URL,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  });
};

export const getAircraft = async () => {
  const client = await lf();
  const res = await client.get('/api/aircraft/all');
  return res.data;
};

export const getPilots = async (page = 1) => {
  const client = await lf();
  const res = await client.get(`/api/admin/6/${page}`);
  return res.data;
};

// Full directory rosters (include crew who have never flown a mirrored trip).
export const getPilotsList = async () => (await (await lf()).get('/api/pilots/list')).data;
export const getAttendants = async () => (await (await lf()).get('/api/attendants/list')).data;
export const getUsers = async () => (await (await lf()).get('/api/users/list')).data;

// Customer (= passenger) directory, paginated by first-letter category.
// NOTE: real path is /api/customer/list/{letter}/{page} (slashes), not the hyphenated
// form the swagger lists. 25 per page.
export const getCustomersByLetter = async (letter, page = 1) =>
  (await (await lf()).get(`/api/customer/list/${encodeURIComponent(letter)}/${page}`)).data;

const CUSTOMER_PAGE = 25;
const CUSTOMER_LETTERS = ['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')];
let _customerCache = null;
let _customerCacheAt = 0;
const CUSTOMER_TTL_MS = 60 * 60 * 1000; // 1h

// Full passenger directory across all letters, normalized + cached.
export const getAllCustomers = async () => {
  if (_customerCache && Date.now() - _customerCacheAt < CUSTOMER_TTL_MS) return _customerCache;
  const out = [];
  const seen = new Set();
  for (const letter of CUSTOMER_LETTERS) {
    for (let page = 1; page <= 12; page++) {
      let arr;
      try {
        const d = await getCustomersByLetter(letter, page);
        arr = Array.isArray(d) ? d : (d?.results || d?.customers || d?.data || d?.list || []);
      } catch { break; }
      if (!arr.length) break;
      for (const c of arr) {
        const id = c._id?.$oid || c._id;
        if (id && seen.has(id)) continue; if (id) seen.add(id);
        const name = [c.firstName, c.middleName, c.lastName].map((s) => (s || '').trim()).filter(Boolean).join(' ');
        if (!name) continue;
        const company = Array.isArray(c.company) ? (c.company[0]?.name || null) : (c.company?.name || c.company || null);
        out.push({ name, email: c.email || null, company });
      }
      if (arr.length < CUSTOMER_PAGE) break; // last page for this letter
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  _customerCache = out; _customerCacheAt = Date.now();
  return out;
};

export const getScheduledLegs = async (startTimestamp) => {
  const client = await lf();
  const res = await client.post('/api/analytics/scheduledLegs', {
    start: startTimestamp
  });
  return res.data;
};

export const getDutyTimes = async (startTimestamp) => {
  const client = await lf();
  const res = await client.post('/api/analytics/dutyTimes', {
    start: startTimestamp
  });
  return res.data;
};

export const getAircraftStatus = async (aircraftOid) => {
  const client = await lf();
  const res = await client.post('/api/widgets/aircraftStatus', {
    aircraft: aircraftOid
  });
  return res.data;
};

export const getTripLog = async (dispatchOid) => {
  const client = await lf();
  const res = await client.get(`/api/dispatch/${dispatchOid}/flightLog`);
  return res.data;
};
export const getDispatchRelease = async (dispatchOid) => {
  const client = await lf();
  const res = await client.get(`/api/dispatch/${dispatchOid}/release`);
  return res.data; // rich JSON: { operation, aircraft, releases, pax, employees, mx, components, closedEvents, company, ... }
};
export const getAircraftCalendar = async (aircraftOid, startMs, endMs) => {
  const client = await lf();
  const res = await client.post('/api/widgets/aircraftCalendar', {
    aircraft: { $oid: aircraftOid },
    start: startMs,
    end: endMs,
    includeCancelled: false
  });
  return res.data;
};
export const getPilotCalendar = async (startMs, endMs) => {
  const client = await lf();
  const res = await client.post('/api/widgets/pilotCalendar', {
    start: startMs,
    end: endMs
  });
  return res.data;
};
export const getPilotExpirableDocs = async (part = 135) => {
  const client = await lf();
  const res = await client.get('/api/dashboard/pilotExpirableDocuments', {
    params: { part }
  });
  return res.data;
};

export const getAttendantExpirableDocs = async () => {
  const client = await lf();
  const res = await client.get('/api/dashboard/attendantExpirableDocuments');
  return res.data;
};

export const getAircraftExpirableDocs = async () => {
  const client = await lf();
  const res = await client.get('/api/dashboard/aircraftExpirableDocuments');
  return res.data;
};

export const getDispatchList = async (page = 1) => {
  const client = await lf();
  const res = await client.post('/api/dispatch/list', { page });
  return res.data; // { success, message, dispatches, page }
};