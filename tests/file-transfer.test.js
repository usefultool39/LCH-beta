const assert = require('node:assert/strict');
const test = require('node:test');
const { decodeFilePayload } = require('../dist/shared/file-transfer');

test('decodeFilePayload validates declared and decoded size', () => {
  const payload = { name: '../hello.txt', size: 5, base64: Buffer.from('hello').toString('base64') };
  const result = decodeFilePayload(payload, 10);
  assert.equal(result.name, 'hello.txt');
  assert.equal(result.buffer.toString('utf8'), 'hello');
  assert.equal(result.size, 5);
});

test('decodeFilePayload rejects size spoofing', () => {
  const payload = { name: 'hello.txt', size: 1, base64: Buffer.from('hello').toString('base64') };
  assert.throws(() => decodeFilePayload(payload, 10), /大小校验/);
});

test('decodeFilePayload rejects decoded content above max bytes', () => {
  const payload = { name: 'hello.txt', size: 5, base64: Buffer.from('hello').toString('base64') };
  assert.throws(() => decodeFilePayload(payload, 4), /无效或过大/);
});
