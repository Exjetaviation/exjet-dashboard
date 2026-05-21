import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
console.log('SUPABASE CONFIG — url present:', !!url, '| key present:', !!key, '| url value:', url);

export const supabase = createClient(url, key);