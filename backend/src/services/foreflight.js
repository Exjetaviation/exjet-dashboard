import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const ff = axios.create({
  baseURL: 'https://dispatch.foreflight.com',
  headers: {
    'x-api-key': process.env.FOREFLIGHT_API_KEY,
    'Content-Type': 'application/json'
  }
});

export const getAircraft = async () => {
  const res = await ff.get('/public/api/aircraft');
  return res.data;
};

export const getCrew = async () => {
  const res = await ff.get('/public/api/crew');
  return res.data;
};

export const getFlights = async () => {
  const res = await ff.get('/public/api/Flights/flights');
  return res.data;
};

export const getFlight = async (flightId) => {
  const res = await ff.get(`/public/api/Flights/${flightId}`);
  return res.data;
};
