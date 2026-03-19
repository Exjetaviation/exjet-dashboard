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
