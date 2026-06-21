const assert = require('node:assert/strict');
const test = require('node:test');
const { parseBoolean, parsePointInput, splitHotkey, takeOption } = require('../scripts/lch');

test('CLI splitHotkey accepts plus and comma separators', () => {
  assert.deepEqual(splitHotkey('ctrl+shift+s'), ['ctrl', 'shift', 's']);
  assert.deepEqual(splitHotkey('ctrl, alt, delete'), ['ctrl', 'alt', 'delete']);
});

test('CLI parseBoolean handles explicit true and false values', () => {
  assert.equal(parseBoolean('yes'), true);
  assert.equal(parseBoolean('0'), false);
  assert.throws(() => parseBoolean('maybe'), /Invalid boolean/);
});

test('CLI parsePointInput distinguishes normalized and absolute coordinates', () => {
  const normalizedArgs = ['--x', '0.25', '--y', '0.75'];
  assert.deepEqual(parsePointInput(normalizedArgs), { normalizedX: 0.25, normalizedY: 0.75 });

  const absoluteArgs = ['--x', '120', '--y', '240'];
  assert.deepEqual(parsePointInput(absoluteArgs), { x: 120, y: 240 });
});

test('CLI takeOption removes consumed option and value', () => {
  const args = ['--device', 'desk', 'hostname'];
  assert.equal(takeOption(args, '--device'), 'desk');
  assert.deepEqual(args, ['hostname']);
});
