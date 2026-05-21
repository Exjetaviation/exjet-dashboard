import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import logo from '../assets/logo.png';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) { setError(error.message); return; }
    navigate('/');
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center',
      justifyContent: 'center', background: 'var(--bg-primary)' }}>
      <form onSubmit={submit} style={{ width: '320px', display: 'flex',
        flexDirection: 'column', gap: '14px', padding: '32px',
        background: 'var(--bg-secondary)', border: '1px solid var(--border)',
        borderRadius: '14px' }}>
        <img src={logo} alt="Exjet Aviation" style={{ width: '180px',
          objectFit: 'contain', filter: 'brightness(0) invert(1)',
          margin: '0 auto 8px' }} />
        <input type="email" placeholder="Email" value={email} required
          onChange={e => setEmail(e.target.value)}
          style={{ padding: '10px 12px', borderRadius: '8px',
            border: '1px solid var(--border)', background: 'var(--bg-card)',
            color: 'var(--text-primary)', fontSize: '14px' }} />
        <input type="password" placeholder="Password" value={password} required
          onChange={e => setPassword(e.target.value)}
          style={{ padding: '10px 12px', borderRadius: '8px',
            border: '1px solid var(--border)', background: 'var(--bg-card)',
            color: 'var(--text-primary)', fontSize: '14px' }} />
        {error && <p style={{ color: 'var(--danger)', fontSize: '12px',
          margin: 0 }}>{error}</p>}
        <button type="submit" disabled={loading}
          style={{ padding: '10px', borderRadius: '8px', border: 'none',
            background: 'var(--accent)', color: '#fff', fontSize: '14px',
            cursor: loading ? 'default' : 'pointer' }}>
          {loading ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}