// backend/src/services/weather.js
// Daily forecast by airport lat/lng from Open-Meteo (free, no API key). Soft-fails to
// [] so a weather outage never breaks the itinerary. WMO weather codes -> labels.
import axios from 'axios';

const WMO = {
  0: 'Clear', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Fog', 48: 'Rime fog',
  51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle',
  56: 'Freezing drizzle', 57: 'Freezing drizzle',
  61: 'Rain', 63: 'Rain', 65: 'Heavy rain',
  66: 'Freezing rain', 67: 'Freezing rain',
  71: 'Snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains',
  80: 'Rain showers', 81: 'Rain showers', 82: 'Violent showers',
  85: 'Snow showers', 86: 'Snow showers',
  95: 'Thunderstorm', 96: 'Thunderstorm', 99: 'Thunderstorm',
};

export function weatherCodeLabel(code) {
  return (code != null && WMO[code]) ? WMO[code] : '—';
}

const _cache = new Map(); // key "lat,lng" -> { t, v }
const TTL = 60 * 60 * 1000;

export async function getDailyForecast(lat, lng, days = 4) {
  if (lat == null || lng == null) return [];
  const key = `${lat.toFixed(2)},${lng.toFixed(2)}`;
  const hit = _cache.get(key);
  if (hit && Date.now() - hit.t < TTL) return hit.v;
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}`
      + `&daily=temperature_2m_max,temperature_2m_min,weather_code`
      + `&temperature_unit=fahrenheit&forecast_days=${days}&timezone=auto`;
    const r = await axios.get(url, { timeout: 8000 });
    const d = r.data?.daily || {};
    const out = (d.time || []).map((date, i) => ({
      date,
      highF: Math.round(d.temperature_2m_max?.[i]),
      lowF: Math.round(d.temperature_2m_min?.[i]),
      condition: weatherCodeLabel(d.weather_code?.[i]),
    }));
    _cache.set(key, { t: Date.now(), v: out });
    return out;
  } catch {
    return [];
  }
}
