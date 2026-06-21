#!/usr/bin/env node
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

const forbiddenPathPatterns = [
  /^dist\//,
  /^release\//,
  /^node_modules\//,
  /(^|\/)state\.json$/,
  /(^|\/)local-api\.json$/,
  /\.(log|mp4)$/i,
  /^lch-(observe|screenshot)-.*\.png$/i
];

const secretPatterns = [
  { name: 'GitHub token', pattern: /(?:gho|ghp|ghs|ghu|ghr)_[A-Za-z0-9_]{20,}/ },
  { name: 'GitHub fine-grained token', pattern: /github_pat_[A-Za-z0-9_]{50,}/ },
  { name: 'OpenAI-style API key', pattern: /sk-[A-Za-z0-9_-]{32,}/ },
  { name: 'Private key block', pattern: /-----BEGIN (?:RSA |EC |OPENSSH |)?PRIVATE KEY-----/ },
  { name: 'Persisted local API token', pattern: /"token"\s*:\s*"[A-Za-z0-9_-]{20,}"/ },
  { name: 'Persisted device private key', pattern: /"privateKey"\s*:\s*"-----BEGIN/ }
];

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });
}

function trackedFiles() {
  return git(['ls-files', '-z']).split('\0').filter(Boolean).map((file) => file.replace(/\\/g, '/'));
}

function scanTrackedFiles() {
  const findings = [];
  for (const file of trackedFiles()) {
    if (forbiddenPathPatterns.some((pattern) => pattern.test(file))) {
      findings.push(`${file}: forbidden tracked public-release file`);
      continue;
    }
    const fullPath = path.join(ROOT, file);
    if (!fs.existsSync(fullPath) || fs.statSync(fullPath).size > 2 * 1024 * 1024) continue;
    const text = fs.readFileSync(fullPath, 'utf8');
    for (const item of secretPatterns) {
      if (item.pattern.test(text)) findings.push(`${file}: ${item.name}`);
    }
  }
  return findings;
}

function scanHistory() {
  const revs = git(['rev-list', '--all']).trim().split(/\s+/).filter(Boolean);
  if (!revs.length) return [];
  const findings = [];
  const skippedExtensions = /\.(ico|png|jpg|jpeg|gif|webp|zip|exe|asar|dll|dylib|so)$/i;
  for (const rev of revs) {
    const files = git(['ls-tree', '-r', '--name-only', '-z', rev]).split('\0').filter(Boolean);
    for (const file of files) {
      const normalized = file.replace(/\\/g, '/');
      if (skippedExtensions.test(normalized)) continue;
      const spec = `${rev}:${file}`;
      const size = Number(git(['cat-file', '-s', spec]).trim());
      if (!Number.isFinite(size) || size > 2 * 1024 * 1024) continue;
      const text = git(['show', spec]);
      for (const item of secretPatterns) {
        if (item.pattern.test(text)) findings.push(`history ${rev.slice(0, 7)}:${normalized}: ${item.name}`);
      }
    }
  }
  return findings;
}

function main() {
  const findings = [...scanTrackedFiles(), ...scanHistory()];
  if (findings.length) {
    console.error('Public-release scan failed:');
    for (const finding of findings) console.error(`- ${finding}`);
    process.exit(1);
  }
  console.log('Public-release scan passed: no tracked secrets or release artifacts found.');
}

if (require.main === module) main();
