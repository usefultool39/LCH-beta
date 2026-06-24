const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { cleanSharedPath, resolveInsideRoot } = require('../dist/shared/shared-paths');

test('cleanSharedPath normalizes separators', () => {
  assert.equal(cleanSharedPath('\\Downloads//demo.txt'), 'Downloads/demo.txt');
  assert.equal(cleanSharedPath('C:\\Users\\demo'), 'C:/Users/demo');
});

test('resolveInsideRoot keeps paths inside the root', () => {
  const root = path.join(os.tmpdir(), 'lch-root');
  const resolved = resolveInsideRoot(root, ['nested', 'file.txt']);
  assert.equal(resolved.root, path.resolve(root));
  assert.equal(resolved.target, path.resolve(root, 'nested', 'file.txt'));
});

test('resolveInsideRoot rejects traversal outside the root', () => {
  const root = path.join(os.tmpdir(), 'lch-root');
  assert.throws(() => resolveInsideRoot(root, ['..', 'outside.txt']), /超出/);
});
