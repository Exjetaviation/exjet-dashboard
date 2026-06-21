// Shared Leaflet basemap config. With a Stadia API key we use the Toner basemap
// recolored to black land + blue water (see .bluewater-map in index.css). Without
// one — Stadia 401s off localhost — we fall back to CARTO's keyless dark basemap so
// the map always works (it just shows gray water until a key is set).
const KEY = import.meta.env.VITE_STADIA_API_KEY;

export const BASEMAP_URL = KEY
  ? `https://tiles.stadiamaps.com/tiles/stamen_toner_background/{z}/{x}/{y}{r}.png?api_key=${KEY}`
  : 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';

export const BASEMAP_OPTS = KEY
  ? { maxZoom: 20, attribution: '© Stadia Maps © Stamen © OpenMapTiles © OpenStreetMap' }
  : { maxZoom: 19, subdomains: 'abcd', attribution: '© OpenStreetMap © CARTO' };

// Class that enables the black-land/blue-water recolor filter — only when we're on
// the Toner basemap (the filter would garble CARTO's dark tiles).
export const BASEMAP_CLASS = KEY ? 'bluewater-map' : '';
