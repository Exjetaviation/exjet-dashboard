import { test } from 'node:test';
import assert from 'node:assert/strict';
import { breakpointFor, BREAKPOINTS } from './breakpoints.js';

test('phone at and below 767px', () => {
  assert.equal(breakpointFor(320), 'phone');
  assert.equal(breakpointFor(767), 'phone');
});

test('tablet from 768px to 1023px', () => {
  assert.equal(breakpointFor(768), 'tablet');
  assert.equal(breakpointFor(1023), 'tablet');
});

test('desktop at and above 1024px', () => {
  assert.equal(breakpointFor(1024), 'desktop');
  assert.equal(breakpointFor(1920), 'desktop');
});

test('exposes the cutoff constants', () => {
  assert.equal(BREAKPOINTS.phoneMax, 767);
  assert.equal(BREAKPOINTS.tabletMax, 1023);
});
