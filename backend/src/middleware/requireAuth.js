import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();
import { roleFromUser } from './role.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Decode JWT header/payload WITHOUT verifying signature — diagnostics only.
function peekJwt(token) {
  try {
    const [h, p] = token.split('.');
    const header = JSON.parse(Buffer.from(h, 'base64url').toString());
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
    return { alg: header.alg, kid: header.kid, iss: payload.iss, aud: payload.aud, sub: payload.sub };
  } catch { return null; }
}

// Verifies the Supabase login token on every API request by asking Supabase.
// Supabase signs access tokens with asymmetric keys (e.g. ES256), so we
// delegate verification to Supabase instead of verifying locally.
export async function requireAuth(req, res, next) {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) {
      console.error('requireAuth getUser failed:', error?.message || 'no user', '| token:', peekJwt(token));
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    req.user = {
      id: data.user.id,
      email: data.user.email,
      role: roleFromUser(data.user),
    };
    next();
  } catch (e) {
    console.error('requireAuth getUser threw:', e.message, '| token:', peekJwt(token));
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}
