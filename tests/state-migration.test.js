const assert = require('node:assert/strict');
const test = require('node:test');
const { STATE_SCHEMA_VERSION } = require('../dist/shared/protocol');
const { migrateState, normalizeManualPeerAddresses } = require('../dist/shared/state-migration');

function defaultState() {
  return {
    stateVersion: STATE_SCHEMA_VERSION,
    home: null,
    device: {
      id: 'default-device',
      name: 'Default',
      platform: 'win32',
      publicKey: 'default-public-key',
      privateKey: 'default-private-key',
      publicKeyHash: 'default-hash'
    },
    trustedDevices: {},
    blockedDevices: {},
    devicePreferences: {},
    conversations: {},
    tasks: [],
    auditLog: [],
    sharedFolder: '',
    fileShareEnabled: true,
    autoTrustDevices: false,
    localApiToken: 'default-token',
    manualPeerAddresses: [],
    transfers: []
  };
}

test('migrateState upgrades legacy persisted state without losing usable data', () => {
  const migrated = migrateState({
    stateVersion: 1,
    home: { id: 'home-1', name: 'Home', secret: 'secret', createdAt: 100 },
    device: {
      id: 'device-1',
      name: 'Desk',
      platform: 'win32',
      publicKey: 'public-key',
      privateKey: 'private-key'
    },
    conversations: {
      'peer-1': [{
        direction: 'outgoing',
        type: 'text',
        text: 'hello',
        createdAt: 200,
        reactions: { ok: ['peer-1'] }
      }]
    },
    tasks: [{
      id: 'task-1',
      peerId: 'peer-1',
      peerName: 'Peer',
      command: 'hostname',
      status: 'running',
      exitCode: 0,
      output: 'desk',
      errorOutput: '',
      startedAt: 300,
      endedAt: 400,
      origin: 'local'
    }],
    manualPeerAddresses: ['100.64.1.2', { address: '100.64.1.3:46890', status: 'online' }],
    transfers: [{ id: 'transfer-1', peerId: 'peer-1', peerName: 'Peer', name: 'demo.txt', size: 5 }],
    fileShareEnabled: false
  }, defaultState(), {
    publicKeyHash: () => 'computed-hash'
  });

  assert.equal(migrated.stateVersion, STATE_SCHEMA_VERSION);
  assert.equal(migrated.device.id, 'device-1');
  assert.equal(migrated.device.publicKeyHash, 'computed-hash');
  assert.equal(migrated.fileShareEnabled, false);
  assert.equal(migrated.conversations['peer-1'][0].peerId, 'peer-1');
  assert.deepEqual(migrated.conversations['peer-1'][0].reactions, { ok: ['peer-1'] });
  assert.equal(migrated.tasks[0].status, 'completed');
  assert.equal(migrated.manualPeerAddresses[0].label, '100.64.1.2:46882');
  assert.equal(migrated.manualPeerAddresses[1].status, 'online');
  assert.equal(migrated.transfers[0].status, 'failed');
});

test('migrateState falls back to defaults when device identity is missing', () => {
  const defaults = defaultState();
  assert.equal(migrateState({}, defaults), defaults);
});

test('normalizeManualPeerAddresses removes invalid and duplicate addresses', () => {
  assert.deepEqual(
    normalizeManualPeerAddresses(['100.64.1.2', '100.64.1.2:46882', 'https://example.com']),
    [{
      address: '100.64.1.2:46882',
      host: '100.64.1.2',
      port: 46882,
      label: '100.64.1.2:46882',
      status: 'unknown',
      lastCheckedAt: undefined,
      lastSeenAt: undefined,
      lastError: undefined,
      peerId: undefined,
      peerName: undefined
    }]
  );
});
