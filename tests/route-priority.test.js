const assert = require('node:assert/strict');
const test = require('node:test');
const { sortRoutesByLatency, pickPrimaryRoute } = require('../dist/shared/route-priority');

test('sortRoutesByLatency prefers online routes over offline ones', () => {
  const input = [
    { kind: 'lan', status: 'offline', latencyMs: 10 },
    { kind: 'lan', status: 'online', latencyMs: 50 }
  ];
  const sorted = sortRoutesByLatency(input);
  assert.equal(sorted[0].status, 'online');
  assert.equal(sorted[1].status, 'offline');
});

test('sortRoutesByLatency orders by latency when both are online', () => {
  const input = [
    { kind: 'lan', status: 'online', latencyMs: 80 },
    { kind: 'tailnet', status: 'online', latencyMs: 20 },
    { kind: 'manual', status: 'online', latencyMs: 50 }
  ];
  const sorted = sortRoutesByLatency(input);
  assert.deepEqual(sorted.map((r) => r.latencyMs), [20, 50, 80]);
});

test('sortRoutesByLatency keeps measured routes ahead of unmeasured', () => {
  const input = [
    { kind: 'lan', status: 'online' },
    { kind: 'tailnet', status: 'online', latencyMs: 5 }
  ];
  const sorted = sortRoutesByLatency(input);
  assert.equal(sorted[0].latencyMs, 5);
  assert.equal(typeof sorted[1].latencyMs, 'undefined');
});

test('sortRoutesByLatency falls back to kind priority when no latency info', () => {
  const input = [
    { kind: 'manual', status: 'online' },
    { kind: 'lan', status: 'online' },
    { kind: 'tailnet', status: 'online' }
  ];
  const sorted = sortRoutesByLatency(input);
  assert.deepEqual(sorted.map((r) => r.kind), ['tailnet', 'lan', 'manual']);
});

test('sortRoutesByLatency does not mutate input array', () => {
  const input = [
    { kind: 'lan', status: 'online', latencyMs: 80 },
    { kind: 'tailnet', status: 'online', latencyMs: 20 }
  ];
  const snapshot = JSON.stringify(input);
  sortRoutesByLatency(input);
  assert.equal(JSON.stringify(input), snapshot);
});

test('pickPrimaryRoute returns the best route after sorting', () => {
  const primary = pickPrimaryRoute([
    { kind: 'lan', status: 'online', latencyMs: 30 },
    { kind: 'tailnet', status: 'online', latencyMs: 5 },
    { kind: 'manual', status: 'offline', latencyMs: 100 }
  ]);
  assert.ok(primary);
  assert.equal(primary.kind, 'tailnet');
  assert.equal(primary.latencyMs, 5);
});

test('pickPrimaryRoute returns null on empty input', () => {
  assert.equal(pickPrimaryRoute([]), null);
});