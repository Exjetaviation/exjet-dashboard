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

export const getAircraft = async () => (await ff.get('/public/api/aircraft')).data;
export const getCrew = async () => (await ff.get('/public/api/crew')).data;
export const getFlights = async () => (await ff.get('/public/api/Flights/flights')).data;
export const getFlight = async (id) => (await ff.get(`/public/api/Flights/${id}`)).data;
export const getFlightBriefing = async (id) => (await ff.get(`/public/api/Flights/${id}/briefing`)).data;
export const getFlightNavlog = async (id) => (await ff.get(`/public/api/Flights/${id}/navlog`)).data;
export const getFlightWb = async (id) => (await ff.get(`/public/api/Flights/${id}/wb`)).data;
export const getFlightOverflight = async (id) => (await ff.get(`/public/api/Flights/${id}/overflight`)).data;
export const getFlightIcao = async (id) => (await ff.get(`/public/api/Flights/${id}/icao`)).data;
