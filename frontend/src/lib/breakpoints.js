// Single source of truth for responsive cutoffs.
// phone: < 768 | tablet: 768–1023 (iPad portrait) | desktop: >= 1024 (unchanged)
export const BREAKPOINTS = { phoneMax: 767, tabletMax: 1023 };

export function breakpointFor(width) {
  if (width <= BREAKPOINTS.phoneMax) return 'phone';
  if (width <= BREAKPOINTS.tabletMax) return 'tablet';
  return 'desktop';
}
