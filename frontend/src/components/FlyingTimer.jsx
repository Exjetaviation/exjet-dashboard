// Live-ticking "time flying" label. Counts from `sinceMs` (epoch ms of takeoff).
// Renders nothing if sinceMs is null (unknown takeoff -> no guess).
// `now` is held in state and advanced only by the interval, so we never call
// Date.now() during render (react-hooks/purity) nor setState synchronously in
// the effect body (react-hooks/set-state-in-effect).
import { useEffect, useState } from 'react';
import { formatElapsed } from '../lib/formatElapsed';

export default function FlyingTimer({ sinceMs, style }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (sinceMs == null) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [sinceMs]);
  if (sinceMs == null) return null;
  return <span style={style}>{formatElapsed(now - sinceMs)} airborne</span>;
}
