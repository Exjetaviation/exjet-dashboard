import { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';

export default function RequireAuth({ children }) {
  const [session, setSession] = useState(undefined); // undefined = still checking
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setChecked(true);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      if (!active) return;
      setSession(s);
      setChecked(true);
    });

    return () => { active = false; sub.subscription.unsubscribe(); };
  }, []);

  if (!checked) return null;                          // wait until we actually know
  if (!session) {
    return <Navigate to="/login" replace />;
  }
  return children;
}