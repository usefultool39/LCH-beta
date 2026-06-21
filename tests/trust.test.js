const assert = require('node:assert/strict');
const test = require('node:test');
const {
  blockedDeviceFromTrust,
  isDeviceBlocked,
  isDeviceTrusted,
  trustedDeviceFromPeer
} = require('../dist/shared/trust');

const peer = {
  id: 'peer-1',
  name: 'Desk',
  platform: 'win32',
  publicKey: 'public-key',
  publicKeyHash: 'hash-1'
};

test('trustedDeviceFromPeer creates a trusted record used by isDeviceTrusted', () => {
  const trusted = { [peer.id]: trustedDeviceFromPeer(peer, 123) };
  assert.equal(isDeviceTrusted(trusted, {}, peer), true);
  assert.equal(trusted[peer.id].trustedAt, 123);
});

test('blocked device overrides trusted state', () => {
  const trusted = { [peer.id]: trustedDeviceFromPeer(peer, 123) };
  const blocked = { [peer.id]: blockedDeviceFromTrust(peer.id, peer, trusted[peer.id], 456) };
  assert.equal(isDeviceBlocked(blocked, peer.id, peer.publicKeyHash), true);
  assert.equal(isDeviceTrusted(trusted, blocked, peer), false);
});
