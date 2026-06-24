const assert = require('node:assert/strict');
const test = require('node:test');
const { DEFAULT_WEBRTC_CONFIG, STATE_SCHEMA_VERSION } = require('../dist/shared/protocol');
const { migrateState, normalizeConversationRecords, normalizeManualPeerAddresses, normalizeWebRtcConfig } = require('../dist/shared/state-migration');

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
    conversationRecords: {},
    tasks: [],
    auditLog: [],
    sharedFolder: '',
    fileShareEnabled: true,
    fullDiskAccessEnabled: false,
    autoTrustDevices: false,
    agentGatewayEnabled: false,
    localApiToken: 'default-token',
    manualPeerAddresses: [],
    transfers: [],
    webrtc: DEFAULT_WEBRTC_CONFIG
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
        markdown: true,
        replyTo: { id: 'source-1', type: 'text', senderName: 'Peer', text: 'source message', createdAt: 180 },
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
    fileShareEnabled: false,
    agentGatewayEnabled: true,
    fullDiskAccessEnabled: true
  }, defaultState(), {
    publicKeyHash: () => 'computed-hash'
  });

  assert.equal(migrated.stateVersion, STATE_SCHEMA_VERSION);
  assert.equal(migrated.device.id, 'device-1');
  assert.equal(migrated.device.publicKeyHash, 'computed-hash');
  assert.equal(migrated.fileShareEnabled, false);
  assert.equal(migrated.agentGatewayEnabled, true);
  assert.equal(migrated.fullDiskAccessEnabled, true);
  assert.equal(migrated.conversations['peer-1'][0].peerId, 'peer-1');
  assert.equal(migrated.conversations['peer-1'][0].conversationId, 'peer-1');
  assert.equal(migrated.conversations['peer-1'][0].markdown, true);
  assert.equal(migrated.conversations['peer-1'][0].replyTo.id, 'source-1');
  assert.equal(migrated.conversationRecords['peer-1'].kind, 'direct');
  assert.deepEqual(migrated.conversationRecords['peer-1'].memberIds, ['device-1', 'peer-1']);
  assert.equal(migrated.conversationRecords['peer-1'].lastMessageAt, 200);
  assert.deepEqual(migrated.conversations['peer-1'][0].reactions, { ok: ['peer-1'] });
  assert.equal(migrated.tasks[0].status, 'completed');
  assert.equal(migrated.manualPeerAddresses[0].label, '100.64.1.2:46882');
  assert.equal(migrated.manualPeerAddresses[1].status, 'online');
  assert.equal(migrated.transfers[0].status, 'failed');
  assert.deepEqual(migrated.webrtc, DEFAULT_WEBRTC_CONFIG);
});

test('migrateState keeps Agent Gateway closed for legacy state', () => {
  const migrated = migrateState({
    device: {
      id: 'device-1',
      name: 'Desk',
      platform: 'win32',
      publicKey: 'public-key',
      privateKey: 'private-key'
    }
  }, defaultState());

  assert.equal(migrated.agentGatewayEnabled, false);
});

test('normalizeConversationRecords preserves group metadata and fills direct metadata', () => {
  const records = normalizeConversationRecords({
    'conv:team': {
      kind: 'group',
      title: 'Team',
      memberIds: ['device-1', 'peer-1', 'peer-2'],
      createdAt: 100,
      updatedAt: 110
    }
  }, {
    'peer-3': [{ createdAt: 300 }]
  }, 'device-1');

  assert.equal(records['conv:team'].kind, 'group');
  assert.equal(records['conv:team'].title, 'Team');
  assert.deepEqual(records['conv:team'].memberIds, ['device-1', 'peer-1', 'peer-2']);
  assert.equal(records['peer-3'].kind, 'direct');
  assert.deepEqual(records['peer-3'].memberIds, ['device-1', 'peer-3']);
  assert.equal(records['peer-3'].lastMessageAt, 300);
});

test('migrateState falls back to defaults when device identity is missing', () => {
  const defaults = defaultState();
  assert.equal(migrateState({}, defaults), defaults);
});

test('migrateState keeps full disk access disabled for legacy states', () => {
  const migrated = migrateState({
    device: {
      id: 'device-1',
      name: 'Desk',
      platform: 'win32',
      publicKey: 'public-key',
      privateKey: 'private-key'
    }
  }, defaultState(), {
    publicKeyHash: () => 'computed-hash'
  });

  assert.equal(migrated.fullDiskAccessEnabled, false);
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

test('normalizeWebRtcConfig keeps valid ICE servers and drops unsafe entries', () => {
  assert.deepEqual(normalizeWebRtcConfig({
    iceTransportPolicy: 'relay',
    iceServers: [
      { urls: ['stun:stun.example.com:3478', 'https://example.com'], username: 'user', credential: 'secret' },
      { urls: 'turn:turn.example.com:3478?transport=tcp turn:turn.example.com:3478?transport=tcp' },
      { urls: 'ftp://example.com' }
    ]
  }), {
    iceTransportPolicy: 'relay',
    iceServers: [
      { urls: ['stun:stun.example.com:3478'], username: 'user', credential: 'secret' },
      { urls: ['turn:turn.example.com:3478?transport=tcp'] }
    ]
  });
});
