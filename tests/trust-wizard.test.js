const assert = require('node:assert/strict');
const test = require('node:test');
const { shouldAutoOpenTrustWizard } = require('../dist/shared/trust-wizard');

test('shouldAutoOpenTrustWizard is false when promptedAt is missing or zero', () => {
  assert.equal(shouldAutoOpenTrustWizard({ promptedAt: 0, lastSeen: 0, peers: [{ trusted: false }] }), false);
  assert.equal(shouldAutoOpenTrustWizard({ promptedAt: 0, lastSeen: 100, peers: [{ trusted: false }] }), false);
});

test('shouldAutoOpenTrustWizard is false when promptedAt has already been seen', () => {
  // Renderer already acknowledged this bump; do not re-fire.
  assert.equal(shouldAutoOpenTrustWizard({ promptedAt: 1000, lastSeen: 1000, peers: [{ trusted: false }] }), false);
  assert.equal(shouldAutoOpenTrustWizard({ promptedAt: 999, lastSeen: 1000, peers: [{ trusted: false }] }), false);
});

test('shouldAutoOpenTrustWizard fires on a new bump with pending peers', () => {
  assert.equal(
    shouldAutoOpenTrustWizard({
      promptedAt: 2000,
      lastSeen: 1000,
      peers: [{ trusted: false }, { trusted: false }]
    }),
    true
  );
});

test('shouldAutoOpenTrustWizard skips when every peer is already trusted', () => {
  // Brand-new room where everyone we know is already trusted (e.g.
  // user toggled auto-trust before the wizard could fire).
  assert.equal(
    shouldAutoOpenTrustWizard({
      promptedAt: 2000,
      lastSeen: 1000,
      peers: [{ trusted: true }, { trusted: true }]
    }),
    false
  );
});

test('shouldAutoOpenTrustWizard skips when peer list is empty', () => {
  // Just-created home, nothing to trust yet.
  assert.equal(
    shouldAutoOpenTrustWizard({
      promptedAt: 2000,
      lastSeen: 0,
      peers: []
    }),
    false
  );
});

test('shouldAutoOpenTrustWizard treats nullish peers list as empty', () => {
  assert.equal(
    shouldAutoOpenTrustWizard({
      promptedAt: 2000,
      lastSeen: 0,
      peers: undefined
    }),
    false
  );
});