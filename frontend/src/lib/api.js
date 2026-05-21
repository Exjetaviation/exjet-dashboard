import { supabase } from './supabase';

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// Use this for EVERY backend call. It attaches the login token automatically.
export async function apiFetch(endpoint, options = {}) {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;

  const res = await fetch(`${BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });

  if (res.status === 401) {
    // Token missing or expired — send the user back to the login screen.
    console.log('REDIRECT FROM apiFetch 401', { endpoint, hadToken: !!token });
    await supabase.auth.signOut();
    window.location.href = '/login';
    throw new Error('Session expired. Please log in again.');
  }
  return res;
}