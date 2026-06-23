const assert = require('node:assert/strict');
const test = require('node:test');
const {
  CAPABILITIES,
  CAPABILITY_VERSIONS,
  CONTROL_PROTOCOL_VERSION,
  DEFAULT_WEBRTC_CONFIG,
  MIN_SUPPORTED_PROTOCOL_VERSION,
  isProtocolCompatible,
  unsupportedControlResponse
} = require('../dist/shared/protocol');

test('capability versions are declared for every advertised capability', () => {
  assert.equal(CAPABILITIES.includes('terminal.pty'), true);
  assert.equal(CAPABILITIES.includes('screen.webrtc.ice'), true);
  assert.equal(CAPABILITIES.includes('chat.markdown'), true);
  assert.equal(CAPABILITIES.includes('chat.reply'), true);
  assert.equal(CAPABILITIES.includes('chat.reactions'), true);
  for (const capability of CAPABILITIES) {
    assert.equal(CAPABILITY_VERSIONS[capability], 1);
  }
});

test('default WebRTC config preserves LAN direct connection behavior', () => {
  assert.deepEqual(DEFAULT_WEBRTC_CONFIG, {
    iceServers: [],
    iceTransportPolicy: 'all'
  });
});

test('unsupportedControlResponse includes compatibility metadata', () => {
  const response = unsupportedControlResponse('terminal.open.v9');
  assert.equal(response.ok, false);
  assert.equal(response.code, 'unsupported');
  assert.equal(response.data.type, 'terminal.open.v9');
  assert.equal(response.data.protocolVersion, CONTROL_PROTOCOL_VERSION);
  assert.equal(response.data.minSupportedProtocolVersion, MIN_SUPPORTED_PROTOCOL_VERSION);
  assert.equal(response.data.capabilities.includes('terminal'), true);
});

test('isProtocolCompatible rejects too-old or too-new peers', () => {
  assert.equal(isProtocolCompatible(), true);
  assert.equal(isProtocolCompatible(0, MIN_SUPPORTED_PROTOCOL_VERSION), false);
  assert.equal(isProtocolCompatible(CONTROL_PROTOCOL_VERSION, CONTROL_PROTOCOL_VERSION + 1), false);
});
