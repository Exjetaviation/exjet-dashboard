// Shared navigation source for Sidebar (desktop/tablet), NavDrawer (phone),
// and BottomTabBar (phone). Icons match the existing sidebar glyphs.
export const NAV_LINKS = [
  { to: '/', label: 'Overview', icon: '◈' },
  { to: '/map', label: 'Fleet Map', icon: '🗺' },
  { to: '/calendar', label: 'Calendar', icon: '▦' },
  { to: '/flights', label: 'Flights', icon: '✈' },
  { to: '/crew', label: 'Crew', icon: '👤' },
  { to: '/aircraft', label: 'Aircraft', icon: '🛩' },
  { to: '/clients', label: 'Clients', icon: '◎' },
  { to: '/quotes', label: 'Quotes', icon: '📋' },
  { to: '/finances', label: 'Finances', icon: '💰' },
  // Hidden from the sidebar today, but reachable from the phone drawer.
  { to: '/rate-cards', label: 'Rate Cards', icon: '＄', hideFromSidebar: true },
  { to: '/maintenance', label: 'Maintenance', icon: '🔧', hideFromSidebar: true },
  { to: '/assistant', label: 'AI Assistant', icon: '✦' },
  { to: '/crew-calendar', label: 'Crew Calendar', icon: '📅' },
];

export function sidebarLinks() {
  return NAV_LINKS.filter((l) => !l.hideFromSidebar);
}

// Phone bottom tab bar destinations (a Menu button is appended by the bar).
export const BOTTOM_TABS = [
  { to: '/calendar', label: 'Calendar', icon: '📅' },
  { to: '/flights', label: 'Flights', icon: '✈' },
  { to: '/quotes', label: 'Quotes', icon: '📋' },
  { to: '/', label: 'Overview', icon: '◈' },
];

// Dashboard <-> Scheduling shell switch (mirrors TopNav's existing TABS).
export const SHELL_TABS = [
  { label: 'Dashboard', to: '/', isActive: (p) => !p.startsWith('/scheduling') },
  { label: 'Scheduling', to: '/scheduling', isActive: (p) => p.startsWith('/scheduling') },
];

export function isNavActive(to, pathname) {
  if (to === '/') return pathname === '/';
  return pathname === to || pathname.startsWith(to + '/');
}
