const assert = require('node:assert/strict');
const test = require('node:test');
const {
  artifactNames,
  normalizeTag,
  releaseNotes,
  validateReadme,
  validateVersions
} = require('../scripts/release-info');

test('release metadata is internally consistent', () => {
  assert.equal(validateVersions(), '0.5.1');
  assert.equal(validateReadme(), true);
});

test('artifact names match the public release contract', () => {
  assert.deepEqual(artifactNames('0.5.1'), [
    'Lan-Control-Hub-0.5.1-win-x64-portable.exe',
    'Lan-Control-Hub-0.5.1-win-x64-setup.exe',
    'Lan-Control-Hub-0.5.1-mac-x64.zip',
    'Lan-Control-Hub-0.5.1-mac-arm64.zip'
  ]);
});

test('release notes are read from the changelog', () => {
  assert.equal(normalizeTag('refs/tags/v0.5.1'), '0.5.1');
  assert.match(releaseNotes(process.cwd(), 'v0.5.1'), /Downloads/);
});
