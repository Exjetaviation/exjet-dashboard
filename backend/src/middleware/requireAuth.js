import jwt from 'jsonwebtoken';

// Decode JWT header/payload WITHOUT verifying signature — diagnostics only.
function peekJwt(token) {
  try {
    const [h, p] = token.split('.');
    const header = JSON.parse(Buffer.from(h, 'base64url').toString());
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
    return { alg: header.alg, kid: header.kid, iss: payload.iss, aud: payload.aud, sub: payload.sub };
  } catch { return null; }
}

// Verifies the Supabase login token on every API request.
// If the token is missing or invalid, the request is rejected.
export function requireAuth(req, res, next) {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    // Fail closed: if auth is not configured, reject everything.
    console.error('requireAuth: JWT_SECRET not set');
    return res.status(500).json({ error: 'Server auth not configured' });
  }

  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Supabase signs access tokens with HS256 using the project JWT secret.
    const payload = jwt.verify(token, secret, { algorithms: ['HS256'] });
    req.user = {
      id: payload.sub,
      email: payload.email,
      role: payload.user_metadata?.app_role || 'crew',
    };
    next();
  } catch (e) {
    console.error('requireAuth verify failed:', e.message, '| token:', peekJwt(token));
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}