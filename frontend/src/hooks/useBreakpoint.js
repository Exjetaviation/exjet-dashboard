import { useState, useEffect } from 'react';
import { breakpointFor } from '../lib/breakpoints';

function read() {
  const w = typeof window === 'undefined' ? 1280 : window.innerWidth;
  return { width: w, bp: breakpointFor(w) };
}

// Single source for structural responsive swaps. Re-renders on resize only
// when the breakpoint band actually changes.
export function useBreakpoint() {
  const [state, setState] = useState(read);
  useEffect(() => {
    const onResize = () => {
      setState((prev) => {
        const next = read();
        return prev.bp === next.bp && prev.width === next.width ? prev : next;
      });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return {
    width: state.width,
    isPhone: state.bp === 'phone',
    isTablet: state.bp === 'tablet',
    isDesktop: state.bp === 'desktop',
  };
}
