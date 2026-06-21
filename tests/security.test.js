const assert = require('node:assert/strict');
const test = require('node:test');
const { ControlReplayGuard } = require('../dist/shared/security');

test('ControlReplayGuard accepts fresh unique messages', () => {
  const guard = new ControlReplayGuard(1000);
  assert.equal(guard.validate({ id: 'a', fromId: 'device-1', timestamp: 1000 }, 1000), true);
  assert.equal(guard.validate({ id: 'b', fromId: 'device-1', timestamp: 1001 }, 1001), true);
});

test('ControlReplayGuard rejects duplicate message ids from same sender', () => {
  const guard = new ControlReplayGuard(1000);
  guard.validate({ id: 'a', fromId: 'device-1', timestamp: 1000 }, 1000);
  assert.throws(() => guard.validate({ id: 'a', fromId: 'device-1', timestamp: 1000 }, 1000), /重复/);
});

test('ControlReplayGuard rejects stale timestamps', () => {
  const guard = new ControlReplayGuard(1000);
  assert.throws(() => guard.validate({ id: 'a', fromId: 'device-1', timestamp: 1 }, 3000), /过期/);
});
