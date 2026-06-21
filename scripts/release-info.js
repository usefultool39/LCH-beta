#!/usr/bin/env node
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function repoRoot() {
  return path.resolve(__dirname, '..');
}

function packageVersion(root = repoRoot()) {
  return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
}

function appVersion(root = repoRoot()) {
  const protocol = fs.readFileSync(path.join(root, 'src', 'shared', 'protocol.ts'), 'utf8');
  const match = protocol.match(/APP_VERSION\s*=\s*['"]([^'"]+)['"]/);
  if (!match) throw new Error('APP_VERSION not found in src/shared/protocol.ts');
  return match[1];
}

function normalizeTag(tag) {
  return String(tag || '').trim().replace(/^refs\/tags\//, '').replace(/^v/, '');
}

function artifactNames(version) {
  return [
    `Lan-Control-Hub-${version}-win-x64-portable.exe`,
    `Lan-Control-Hub-${version}-win-x64-setup.exe`,
    `Lan-Control-Hub-${version}-mac-x64.zip`,
    `Lan-Control-Hub-${version}-mac-arm64.zip`
  ];
}

function validateVersions({ root = repoRoot(), tag = '' } = {}) {
  const pkg = packageVersion(root);
  const app = appVersion(root);
  if (pkg !== app) throw new Error(`Version mismatch: package.json=${pkg}, APP_VERSION=${app}`);
  if (tag && normalizeTag(tag) !== pkg) throw new Error(`Tag v${normalizeTag(tag)} does not match version ${pkg}`);
  return pkg;
}

function validateReadme(root = repoRoot()) {
  const version = validateVersions({ root });
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  const missing = [...artifactNames(version), 'SHA256SUMS.txt'].filter((name) => !readme.includes(name));
  if (missing.length) throw new Error(`README is missing release artifact reference(s): ${missing.join(', ')}`);
  return true;
}

function expectedForPlatform(version, platform) {
  const names = artifactNames(version);
  if (platform === 'windows') return names.filter((name) => name.endsWith('.exe'));
  if (platform === 'macos-x64') return names.filter((name) => name.includes('-mac-x64.'));
  if (platform === 'macos-arm64') return names.filter((name) => name.includes('-mac-arm64.'));
  return names;
}

function listReleaseFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory).filter((name) => /\.(exe|zip)$/i.test(name)).sort();
}

function validateArtifacts(directory, platform = 'all', root = repoRoot()) {
  const version = validateVersions({ root });
  const actual = new Set(listReleaseFiles(directory));
  const missing = expectedForPlatform(version, platform).filter((name) => !actual.has(name));
  if (missing.length) throw new Error(`Missing release artifact(s): ${missing.join(', ')}`);
  return true;
}

function walkFiles(directory) {
  const output = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...walkFiles(fullPath));
    else if (/\.(exe|zip)$/i.test(entry.name)) output.push(fullPath);
  }
  return output.sort();
}

function writeChecksums(inputDir, outputFile) {
  const lines = walkFiles(inputDir).map((file) => {
    const hash = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    return `${hash}  ${path.basename(file)}`;
  });
  if (!lines.length) throw new Error(`No release artifacts found in ${inputDir}`);
  fs.writeFileSync(outputFile, `${lines.join('\n')}\n`);
}

function changelogEntry(root, tag) {
  const version = normalizeTag(tag || packageVersion(root));
  const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
  const pattern = new RegExp(`^##\\s+v?${version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm');
  const match = changelog.match(pattern);
  if (!match || match.index === undefined) throw new Error(`CHANGELOG entry not found for v${version}`);
  const rest = changelog.slice(match.index + match[0].length);
  const next = rest.search(/^##\s+/m);
  return rest.slice(0, next >= 0 ? next : undefined).trim();
}

function releaseNotes(root, tag) {
  const version = normalizeTag(tag || packageVersion(root));
  const downloads = artifactNames(version).map((name) => `- ${name}`).join('\n');
  return [
    changelogEntry(root, version),
    '',
    '## Downloads',
    downloads,
    '- SHA256SUMS.txt'
  ].join('\n');
}

function argValue(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : '';
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  const root = repoRoot();
  if (command === 'validate-version') {
    validateVersions({ root, tag: argValue(args, '--tag') || process.env.RELEASE_TAG || process.env.GITHUB_REF_NAME });
    return;
  }
  if (command === 'validate-readme') {
    validateReadme(root);
    return;
  }
  if (command === 'validate-artifacts') {
    validateArtifacts(path.resolve(args[0] || 'release'), argValue(args, '--platform') || 'all', root);
    return;
  }
  if (command === 'checksums') {
    writeChecksums(path.resolve(args[0] || 'artifacts'), path.resolve(args[1] || 'SHA256SUMS.txt'));
    return;
  }
  if (command === 'release-notes') {
    process.stdout.write(`${releaseNotes(root, argValue(args, '--tag') || process.env.RELEASE_TAG || process.env.GITHUB_REF_NAME)}\n`);
    return;
  }
  if (command === 'validate' || !command) {
    validateVersions({ root, tag: argValue(args, '--tag') || process.env.RELEASE_TAG });
    validateReadme(root);
    return;
  }
  throw new Error(`Unknown release-info command: ${command}`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message || error);
    process.exit(1);
  }
}

module.exports = {
  appVersion,
  artifactNames,
  changelogEntry,
  normalizeTag,
  packageVersion,
  releaseNotes,
  validateArtifacts,
  validateReadme,
  validateVersions,
  writeChecksums
};
