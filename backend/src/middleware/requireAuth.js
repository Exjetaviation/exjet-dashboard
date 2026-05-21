import jwt from 'jsonwebtoken';

// Verifies the Supabase login token on every API request.
// If the token is missing or invalid, the request is rejected.
export function requireAuth(req, res, next) {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    // Fail closed: if auth is not configured, reject everything.
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
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}