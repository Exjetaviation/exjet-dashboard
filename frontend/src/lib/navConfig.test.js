import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NAV_LINKS, sidebarLinks, BOTTOM_TABS, SHELL_TABS, isNavActive } from './navConfig.js';

test('sidebarLinks reproduces the current visible sidebar order', () => {
  assert.deepEqual(
    sidebarLinks().map((l) => l.to),
    ['/', '/map', '/calendar', '/flights', '/crew', '/aircraft', '/clients', '/quotes', '/finances', '/assistant', '/crew-calendar'],
  );
});

test('NAV_LINKS also includes the hidden rate-cards and maintenance for the drawer', () => {
  const tos = NAV_LINKS.map((l) => l.to);
  assert.ok(tos.includes('/rate-cards'));
  assert.ok(tos.includes('/maintenance'));
});

test('BOTTOM_TABS are Calendar, Flights, Quotes, Overview in order', () => {
  assert.deepEqual(BOTTOM_TABS.map((t) => t.to), ['/calendar', '/flights', '/quotes', '/']);
});

test('SHELL_TABS isActive distinguishes scheduling from dashboard', () => {
  const [dash, sched] = SHELL_TABS;
  assert.equal(dash.isActive('/calendar'), true);
  assert.equal(dash.isActive('/scheduling/quotes/3001'), false);
  assert.equal(sched.isActive('/scheduling'), true);
  assert.equal(sched.isActive('/'), false);
});

test('isNavActive: root matches only exact "/", others match prefix segments', () => {
  assert.equal(isNavActive('/', '/'), true);
  assert.equal(isNavActive('/', '/flights'), false);
  assert.equal(isNavActive('/flights', '/flights'), true);
  assert.equal(isNavActive('/flights', '/flights/abc'), true);
  assert.equal(isNavActive('/flights', '/flightsfoo'), false);
});
