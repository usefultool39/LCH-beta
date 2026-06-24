#!/usr/bin/env node
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');
const { spawnSync } = require('node:child_process');

const MAX_FILE_BYTES = 100 * 1024 * 1024;

function configPath() {
  if (process.env.LCH_LOCAL_API_CONFIG) return process.env.LCH_LOCAL_API_CONFIG;
  const names = ['lan-control-hub', 'Lan Control Hub', 'Electron'];
  const base = (() => {
    if (process.platform === 'win32') {
      return process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    }
    if (process.platform === 'darwin') {
      return path.join(os.homedir(), 'Library', 'Application Support');
    }
    return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  })();
  const candidates = names
    .map((name) => path.join(base, name, 'local-api.json'))
    .filter((file) => fs.existsSync(file))
    .map((file) => ({ file, mtimeMs: fs.statSync(file).mtimeMs }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  if (candidates[0]) return candidates[0].file;
  if (process.platform === 'win32') {
    return path.join(base, names[0], 'local-api.json');
  }
  if (process.platform === 'darwin') {
    return path.join(base, names[0], 'local-api.json');
  }
  return path.join(base, names[0], 'local-api.json');
}

function loadConfig() {
  const file = configPath();
  if (!fs.existsSync(file)) {
    throw new Error(`Local API config not found. Start Lan Control Hub first: ${file}`);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

async function request(method, pathname, body) {
  const cfg = loadConfig();
  const res = await fetch(`http://127.0.0.1:${cfg.port}${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const json = await res.json();
  if (!res.ok || !json.ok) throw new Error(json.error || `Request failed: ${res.status}`);
  return json.data;
}

function connectEvents(onEvent) {
  const cfg = loadConfig();
  const req = http.request({
    host: '127.0.0.1',
    port: cfg.port,
    path: '/api/events',
    method: 'GET',
    headers: { Authorization: `Bearer ${cfg.token}` }
  });
  req.on('response', (res) => {
    res.setEncoding('utf8');
    let eventName = 'message';
    let dataLines = [];
    res.on('data', (chunk) => {
      for (const line of chunk.split(/\r?\n/)) {
        if (!line) {
          if (dataLines.length) {
            try {
              onEvent(eventName, JSON.parse(dataLines.join('\n')));
            } catch {
              // Ignore malformed event payloads.
            }
          }
          eventName = 'message';
          dataLines = [];
          continue;
        }
        if (line.startsWith('event:')) eventName = line.slice(6).trim();
        if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
      }
    });
  });
  req.on('error', () => {});
  req.end();
  return () => req.destroy();
}

function printTable(rows) {
  for (const row of rows) {
    console.log(Object.entries(row).map(([key, value]) => `${key}=${value}`).join('  '));
  }
}

let jsonOutput = false;

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

function usage() {
  console.log([
    'Usage:',
    '  lch setup create [name]',
    '  lch setup join <homeSecret> [name]',
    '  lch devices [--json]',
    '  lch run --all "cmd"',
    '  lch run --device <name|ip|alias|id-prefix> "cmd" [--timeout-ms 600000]',
    '  lch tasks [--json]',
    '  lch terminal <name|ip|alias|id-prefix>',
    '  lch remote <name|ip|alias|id-prefix> [--json]',
    '  lch remote open --device <name|ip|alias|id-prefix> [--window] [--json]',
    '  lch remote close --device <name|ip|alias|id-prefix> --session <sessionId>',
    '  lch remote sessions [--json]',
    '  lch observe --device <name|ip|alias|id-prefix> [--out screen.png] [--json]',
    '  lch windows --device <name|ip|alias|id-prefix> [--json]',
    '  lch screenshot --device <name|ip|alias|id-prefix> [--out file.png] [--json]',
    '  lch click --device <name|ip|alias|id-prefix> --x 0.5 --y 0.5 [--button left]',
    '  lch type --device <name|ip|alias|id-prefix> "text"',
    '  lch hotkey --device <name|ip|alias|id-prefix> ctrl+s',
    '  lch clipboard --device <name|ip|alias|id-prefix> read',
    '  lch clipboard --device <name|ip|alias|id-prefix> write "text"',
    '  lch file list --device <name|ip|alias|id-prefix> [remotePath]',
    '  lch file get --device <name|ip|alias|id-prefix> <remotePath> [--out localPath]',
    '  lch file put --device <name|ip|alias|id-prefix> <localPath> [remoteDirectory]',
    '  lch file send --device <name|ip|alias|id-prefix> <localPath>',
    '  lch file access [status|on|off]',
    '  lch transfer list [--json]',
    '  lch transfer cancel <transferId>',
    '  lch peer add <tailscale-ip[:port]>',
    '  lch peer list [--json]',
    '  lch peer remove <tailscale-ip[:port]>',
    '  lch chat send --device <name|ip|alias|id-prefix> "message"',
    '  lch device set --device <name|ip|id-prefix> [--alias name] [--room room] [--favorite true|false] [--read-only true|false]',
    '  lch firewall status [--json]',
    '  lch firewall repair [--no-elevate] [--json]',
    '  lch startup install --app <path-to-app> [--headless]',
    '  lch startup remove',
    '',
    'Device can be a full id, id prefix, device name, alias, IP, or IP:port.'
  ].join('\n'));
}

function takeOption(args, name) {
  const index = args.indexOf(name);
  if (index < 0) return '';
  const value = args[index + 1] || '';
  args.splice(index, 2);
  return value;
}

function takeFlag(args, name) {
  const index = args.indexOf(name);
  if (index < 0) return false;
  args.splice(index, 1);
  return true;
}

function normalizeRef(value) {
  return String(value || '').trim().toLowerCase();
}

function deviceAliasList(device) {
  return [
    device.id,
    device.id.slice(0, 8),
    device.alias,
    device.name,
    device.room,
    device.address,
    `${device.address}:${device.controlPort}`
  ].filter(Boolean);
}

function deviceSummary(device) {
  return {
    id: device.id,
    alias: deviceAliasList(device).slice(1).join(','),
    name: device.name,
    display: device.displayName || device.alias || device.name,
    room: device.room || '',
    favorite: Boolean(device.favorite),
    status: device.uiStatus || (device.isOnline ? 'online' : 'offline'),
    platform: device.platform,
    online: device.isOnline,
    address: `${device.address}:${device.controlPort}`,
    capabilities: (device.capabilities || []).join(',')
  };
}

function matchDevice(device, ref) {
  const needle = normalizeRef(ref);
  if (!needle) return false;
  if (normalizeRef(device.id) === needle) return true;
  if (normalizeRef(device.id).startsWith(needle)) return true;
  if (normalizeRef(device.alias) === needle) return true;
  if (normalizeRef(device.displayName) === needle) return true;
  if (normalizeRef(device.name) === needle) return true;
  if (normalizeRef(device.address) === needle) return true;
  if (normalizeRef(`${device.address}:${device.controlPort}`) === needle) return true;
  return false;
}

async function resolveDeviceRef(ref) {
  const devices = await request('GET', '/api/devices');
  const matches = devices.filter((device) => matchDevice(device, ref));
  if (matches.length === 1) return matches[0];
  if (!matches.length) {
    const known = devices.map((device) => `- ${device.name} (${device.address}, ${device.id.slice(0, 8)}, ${device.isOnline ? 'online' : 'offline'})`).join('\n');
    throw new Error(`Device not found: ${ref}\nKnown devices:\n${known || '- none'}`);
  }
  const detail = matches.map((device) => `- ${device.name} (${device.address}, ${device.id})`).join('\n');
  throw new Error(`Device reference is ambiguous: ${ref}\n${detail}`);
}

async function deviceFromArgs(args, options = {}) {
  const ref = takeOption(args, '--device') || takeOption(args, '-d') || (options.positional ? args.shift() : '');
  if (!ref) throw new Error('Missing --device <name|ip|id-prefix>');
  return (await resolveDeviceRef(ref)).id;
}

function parsePointInput(args) {
  const xValue = Number(takeOption(args, '--x'));
  const yValue = Number(takeOption(args, '--y'));
  if (!Number.isFinite(xValue) || !Number.isFinite(yValue)) throw new Error('Missing numeric --x and --y');
  if (xValue >= 0 && xValue <= 1 && yValue >= 0 && yValue <= 1) {
    return { normalizedX: xValue, normalizedY: yValue };
  }
  return { x: xValue, y: yValue };
}

function splitHotkey(value) {
  return String(value || '')
    .split(/[+,]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseBoolean(value) {
  if (value === '') return true;
  const text = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on', 'y'].includes(text)) return true;
  if (['0', 'false', 'no', 'off', 'n'].includes(text)) return false;
  throw new Error(`Invalid boolean value: ${value}`);
}

function quoteCommand(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTerminalStatus(status) {
  return ['completed', 'failed', 'cancelled'].includes(String(status || ''));
}

function isTaskFinished(task) {
  return isTerminalStatus(task?.status)
    || task?.endedAt
    || task?.exitCode !== undefined
    || task?.signal !== undefined;
}

function normalizeTaskForDisplay(task) {
  if (!task || isTerminalStatus(task.status) || !isTaskFinished(task)) return task;
  return {
    ...task,
    status: task.exitCode === 0 ? 'completed' : 'failed'
  };
}

async function waitForTasks(taskIds, waitMs) {
  const pending = new Set(taskIds);
  const started = Date.now();
  let latest = [];
  while (pending.size && Date.now() - started < waitMs) {
    latest = await request('GET', '/api/tasks').catch(() => []);
    for (const task of latest) {
      if (pending.has(task.id) && isTaskFinished(task)) pending.delete(task.id);
    }
    if (!pending.size) break;
    await sleep(450);
  }
  latest = await request('GET', '/api/tasks').catch(() => []);
  const tracked = latest.filter((task) => taskIds.includes(task.id));
  if (pending.size) throw new Error(`Timed out waiting for task(s): ${Array.from(pending).join(', ')}`);
  return tracked;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function macLaunchAgentPath() {
  return path.join(os.homedir(), 'Library', 'LaunchAgents', 'local.lan-control-hub.plist');
}

function macExecutablePath(appPath) {
  if (appPath.endsWith('.app')) return path.join(appPath, 'Contents', 'MacOS', 'Lan Control Hub');
  return appPath;
}

function configureStartup(args) {
  const action = args.shift();
  if (process.platform === 'win32') {
    const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
    const name = 'Lan Control Hub';
    if (action === 'remove') {
      spawnSync('reg', ['delete', key, '/v', name, '/f'], { stdio: 'ignore' });
      console.log('Startup removed');
      return;
    }
    if (action === 'install') {
      const appPath = takeOption(args, '--app');
      if (!appPath) throw new Error('Missing --app <path-to-app>');
      const headless = args.includes('--headless');
      const command = `${quoteCommand(appPath)}${headless ? ' --headless' : ''}`;
      const result = spawnSync('reg', ['add', key, '/v', name, '/t', 'REG_SZ', '/d', command, '/f'], { encoding: 'utf8' });
      if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'Failed to configure startup');
      console.log(command);
      return;
    }
  }
  if (process.platform === 'darwin') {
    const plistPath = macLaunchAgentPath();
    if (action === 'remove') {
      spawnSync('launchctl', ['bootout', `gui/${process.getuid()}`, plistPath], { stdio: 'ignore' });
      fs.rmSync(plistPath, { force: true });
      console.log('Startup removed');
      return;
    }
    if (action === 'install') {
      const appPath = takeOption(args, '--app');
      if (!appPath) throw new Error('Missing --app <path-to-app>');
      const headless = args.includes('--headless');
      const executable = macExecutablePath(appPath);
      const programArgs = [executable, ...(headless ? ['--headless'] : [])]
        .map((item) => `    <string>${escapeXml(item)}</string>`)
        .join('\n');
      const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>local.lan-control-hub</string>
  <key>ProgramArguments</key>
  <array>
${programArgs}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <false/>
  <key>StandardOutPath</key>
  <string>${escapeXml(path.join(os.homedir(), 'Library', 'Logs', 'Lan Control Hub.log'))}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(path.join(os.homedir(), 'Library', 'Logs', 'Lan Control Hub.err.log'))}</string>
</dict>
</plist>
`;
      fs.mkdirSync(path.dirname(plistPath), { recursive: true });
      fs.writeFileSync(plistPath, plist, 'utf8');
      spawnSync('launchctl', ['bootout', `gui/${process.getuid()}`, plistPath], { stdio: 'ignore' });
      spawnSync('launchctl', ['bootstrap', `gui/${process.getuid()}`, plistPath], { stdio: 'ignore' });
      console.log(plistPath);
      return;
    }
  }
  throw new Error('Usage: lch startup install --app <path-to-app> [--headless] | lch startup remove');
}

async function runCommand(args) {
  const all = args.includes('--all');
  if (all) args.splice(args.indexOf('--all'), 1);
  const peerId = all ? '' : await deviceFromArgs(args);
  const waitMs = Number(takeOption(args, '--timeout-ms') || takeOption(args, '--wait-ms') || 10 * 60 * 1000 + 5000);
  const command = args.join(' ').trim();
  if (!command) throw new Error('Missing command');

  const beforeTasks = await request('GET', '/api/tasks').catch(() => []);
  const beforeIds = new Set(beforeTasks.map((task) => task.id));
  let ready = false;
  const early = [];
  const pending = new Set();
  const printedStdout = new Map();
  const printedStderr = new Map();
  let finish;
  const done = new Promise((resolve) => { finish = resolve; });
  const closeEvents = connectEvents((event, data) => {
    if (!ready) {
      early.push([event, data]);
      return;
    }
    handle(event, data);
  });

  function handle(event, data) {
    const requestId = data?.requestId;
    if (!requestId || !pending.has(requestId)) return;
    if (event === 'task-output') {
      const chunk = String(data.chunk || '');
      const target = data.stream === 'stderr' ? printedStderr : printedStdout;
      target.set(requestId, `${target.get(requestId) || ''}${chunk}`);
      if (!jsonOutput) {
        if (data.stream === 'stderr') process.stderr.write(chunk);
        else process.stdout.write(chunk);
      }
    }
    if (event === 'task-complete') {
      if (!jsonOutput && data.exitCode !== 0 && data.exitCode !== null && data.exitCode !== undefined) {
        process.stderr.write(`\n[${requestId}] exit=${data.exitCode}\n`);
      }
      pending.delete(requestId);
      if (!pending.size) finish();
    }
  }

  const result = await request('POST', '/api/run', {
    all,
    peerIds: peerId ? [peerId] : [],
    command
  });
  let taskIds = result.taskIds || (result.taskId ? [result.taskId] : []);
  if (!taskIds.length) {
    await sleep(350);
    const nextTasks = await request('GET', '/api/tasks').catch(() => []);
    taskIds = nextTasks
      .filter((task) => !beforeIds.has(task.id) && task.command === command && (all || task.peerId === peerId))
      .map((task) => task.id);
  }
  for (const id of taskIds) pending.add(id);
  ready = true;
  for (const [event, data] of early) handle(event, data);

  const started = Date.now();
  while (pending.size && Date.now() - started < waitMs) {
    const tasks = await request('GET', '/api/tasks').catch(() => []);
    for (const task of tasks) {
      if (!pending.has(task.id) || !isTaskFinished(task)) continue;
      pending.delete(task.id);
    }
    if (!pending.size) break;
    await Promise.race([done, sleep(500)]);
  }
  closeEvents();
  const finalTasks = await request('GET', '/api/tasks').catch(() => []);
  const trackedTasks = finalTasks.filter((task) => taskIds.includes(task.id));
  if (jsonOutput) {
    printJson(trackedTasks.map(normalizeTaskForDisplay));
  } else {
    for (const task of trackedTasks.map(normalizeTaskForDisplay)) {
      if (!isTaskFinished(task)) continue;
      const stdout = String(task.output || '');
      const stderr = String(task.errorOutput || '');
      const oldStdout = printedStdout.get(task.id) || '';
      const oldStderr = printedStderr.get(task.id) || '';
      if (stdout && stdout !== oldStdout) {
        process.stdout.write(stdout.startsWith(oldStdout) ? stdout.slice(oldStdout.length) : stdout);
      }
      if (stderr && stderr !== oldStderr) {
        process.stderr.write(stderr.startsWith(oldStderr) ? stderr.slice(oldStderr.length) : stderr);
      }
      if (task.exitCode !== 0 && task.exitCode !== null && task.exitCode !== undefined) {
        process.stderr.write(`\n[${task.id}] exit=${task.exitCode}\n`);
      }
    }
  }
  if (pending.size) {
    throw new Error(`Timed out waiting for task(s): ${Array.from(pending).join(', ')}`);
  }
}

async function terminal(peerId) {
  if (!peerId) throw new Error('Missing device id');
  peerId = await resolveDeviceRef(peerId).then((device) => device.id);
  let session;
  let rl;
  let rawMode = false;
  let closing = false;
  let onData;
  let onResize;
  function cleanup() {
    closeEvents();
    if (rl) rl.close();
    if (rawMode && process.stdin.isTTY) process.stdin.setRawMode(false);
    if (onData) process.stdin.off('data', onData);
    if (onResize) process.stdout.off('resize', onResize);
  }
  async function closeTerminal() {
    if (closing) return;
    closing = true;
    if (session) await request('POST', '/api/terminal/close', { peerId, terminalId: session.terminalId }).catch(() => {});
    cleanup();
    process.exit(0);
  }
  const closeEvents = connectEvents((event, data) => {
    if (!session || data?.terminalId !== session.terminalId) return;
    if (event === 'terminal-output') process.stdout.write(String(data.chunk || ''));
    if (event === 'terminal-closed') {
      cleanup();
      process.exit(0);
    }
  });
  const size = process.stdout.isTTY
    ? { cols: process.stdout.columns || 100, rows: process.stdout.rows || 30 }
    : {};
  session = await request('POST', '/api/terminal/open', { peerId, ...size });
  console.error(`Opened terminal ${session.terminalId} (${session.backend || 'spawn'}). ${session.backend === 'pty' ? 'Ctrl+] to close.' : 'Ctrl+C to close.'}`);
  if (session.backend === 'pty' && process.stdin.isTTY) {
    rawMode = true;
    process.stdin.setRawMode(true);
    process.stdin.resume();
    onResize = () => request('POST', '/api/terminal/resize', {
      peerId,
      terminalId: session.terminalId,
      cols: process.stdout.columns || 100,
      rows: process.stdout.rows || 30
    }).catch(() => {});
    onData = (chunk) => {
      if (chunk.length === 1 && chunk[0] === 0x1d) {
        closeTerminal();
        return;
      }
      request('POST', '/api/terminal/input', {
        peerId,
        terminalId: session.terminalId,
        input: chunk.toString('utf8')
      }).catch((error) => process.stderr.write(`\n${error.message || error}\n`));
    };
    process.stdout.on('resize', onResize);
    process.stdin.on('data', onData);
    onResize();
  } else {
    rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });
    rl.on('line', async (line) => {
      await request('POST', '/api/terminal/input', {
        peerId,
        terminalId: session.terminalId,
        input: `${line}\n`
      });
    });
  }
  process.on('SIGINT', closeTerminal);
}

async function observe(args) {
  const peerId = await deviceFromArgs(args);
  const out = takeOption(args, '--out') || path.join(process.cwd(), `lch-observe-${Date.now()}.png`);
  const result = await request('POST', '/api/observe', { peerId });
  fs.writeFileSync(out, Buffer.from(result.base64, 'base64'));
  const summary = { peerId, out, width: result.width, height: result.height, capturedAt: result.capturedAt };
  jsonOutput ? printJson(summary) : console.log(out);
}

async function windowsCommand(args) {
  const device = await resolveDeviceRef(takeOption(args, '--device') || takeOption(args, '-d') || args.shift());
  const waitMs = Number(takeOption(args, '--timeout-ms') || 30000);
  const command = device.platform === 'darwin'
    ? "osascript -e 'tell application \"System Events\" to get the name of every process whose background only is false'"
    : "[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new(); $OutputEncoding=[Console]::OutputEncoding; Get-Process | Where-Object { $_.MainWindowTitle } | Select-Object Id,ProcessName,MainWindowTitle | ConvertTo-Json -Compress";
  const result = await request('POST', '/api/run', {
    all: false,
    peerIds: [device.id],
    command
  });
  const tasks = await waitForTasks(result.taskIds || [], waitMs);
  const output = tasks.map((task) => task.output || task.errorOutput).join('\n').trim();
  if (jsonOutput) {
    try {
      printJson(JSON.parse(output || '[]'));
    } catch {
      printJson({ peerId: device.id, output, tasks });
    }
  } else {
    console.log(output || 'No visible windows returned');
  }
}

async function fileCommand(args) {
  const action = args.shift();
  if (!['list', 'get', 'put', 'send', 'access'].includes(action)) {
    throw new Error('Usage: lch file list|get|put|send --device <id> ... | lch file access [status|on|off]');
  }
  if (action === 'access') {
    const mode = String(args.shift() || 'status').toLowerCase();
    if (mode === 'status') {
      const status = await request('GET', '/api/files/access');
      jsonOutput ? printJson(status) : printTable([status]);
      return;
    }
    if (!['on', 'off', 'true', 'false', '1', '0'].includes(mode)) {
      throw new Error('Usage: lch file access [status|on|off]');
    }
    const enabled = ['on', 'true', '1'].includes(mode);
    const status = await request('POST', '/api/files/access', { fullDiskAccessEnabled: enabled });
    jsonOutput ? printJson(status) : printTable([status]);
    return;
  }
  const peerId = await deviceFromArgs(args);
  if (action === 'list') {
    const relativePath = args.join(' ');
    const listing = await request('POST', '/api/files/list', { peerId, relativePath });
    if (jsonOutput) {
      printJson(listing);
    } else {
      printTable((listing.entries || []).map((entry) => ({
        type: entry.type,
        name: entry.name,
        size: entry.size,
        path: entry.relativePath
      })));
    }
    return;
  }
  if (action === 'get') {
    const relativePath = args.shift();
    if (!relativePath) throw new Error('Missing remote path');
    const out = takeOption(args, '--out');
    const downloaded = await request('POST', '/api/files/download', { peerId, relativePath });
    let filePath = downloaded.filePath;
    if (out) {
      fs.renameSync(downloaded.filePath, out);
      filePath = out;
    }
    jsonOutput ? printJson({ peerId, filePath, name: downloaded.name, size: downloaded.size }) : console.log(filePath);
    return;
  }
  if (action === 'put') {
    const localPath = args.shift();
    if (!localPath || !fs.existsSync(localPath)) throw new Error('Missing existing local file path');
    const relativePath = args.join(' ');
    const stat = fs.statSync(localPath);
    if (!stat.isFile()) throw new Error('Local path is not a file');
    const result = await request('POST', '/api/files/put-stream', {
      peerId,
      relativePath,
      localPath: path.resolve(localPath)
    });
    jsonOutput ? printJson({ peerId, ...result }) : console.log(result.relativePath || result.transferId);
    return;
  }
  const localPath = args.shift();
  if (!localPath || !fs.existsSync(localPath)) throw new Error('Missing existing local file path');
  const stat = fs.statSync(localPath);
  if (!stat.isFile()) throw new Error('Local path is not a file');
  if (stat.size > MAX_FILE_BYTES) throw new Error('File is too large; current single-file limit is 100 MB');
  await request('POST', '/api/files/send', {
    peerId,
    name: path.basename(localPath),
    size: stat.size,
    base64: fs.readFileSync(localPath).toString('base64')
  });
  if (jsonOutput) printJson({ peerId, sent: localPath, size: stat.size });
}

async function transferCommand(args) {
  const action = args.shift() || 'list';
  if (action === 'list') {
    const transfers = await request('GET', '/api/transfers');
    if (jsonOutput) {
      printJson(transfers);
    } else {
      printTable(transfers.map((item) => ({
        id: item.id,
        direction: item.direction,
        peer: item.peerName,
        status: item.status,
        progress: item.size ? `${item.transferredBytes || 0}/${item.size}` : '',
        name: item.name
      })));
    }
    return;
  }
  if (action === 'cancel') {
    const transferId = args.shift();
    if (!transferId) throw new Error('Missing transfer id');
    const result = await request('POST', '/api/transfers/cancel', { transferId });
    jsonOutput ? printJson(result) : console.log(`Cancelled ${result.id}`);
    return;
  }
  throw new Error('Usage: lch transfer list|cancel <transferId>');
}

async function peerCommand(args) {
  const action = args.shift() || 'list';
  if (action === 'list') {
    const peers = await request('GET', '/api/peers/manual');
    if (jsonOutput) {
      printJson(peers);
    } else {
      printTable(peers.map((item) => ({
        address: item.address,
        status: item.status,
        peer: item.peerName || '',
        error: item.lastError || ''
      })));
    }
    return;
  }
  if (action === 'add') {
    const address = args.shift();
    if (!address) throw new Error('Missing peer address');
    const state = await request('POST', '/api/peers/manual/add', { address });
    jsonOutput ? printJson(state.manualPeerAddresses) : console.log(`Added ${address}`);
    return;
  }
  if (action === 'remove') {
    const address = args.shift();
    if (!address) throw new Error('Missing peer address');
    const state = await request('POST', '/api/peers/manual/remove', { address });
    jsonOutput ? printJson(state.manualPeerAddresses) : console.log(`Removed ${address}`);
    return;
  }
  throw new Error('Usage: lch peer add|list|remove');
}

async function chatCommand(args) {
  const action = args.shift();
  if (action !== 'send') throw new Error('Usage: lch chat send --device <id> "message"');
  const peerId = await deviceFromArgs(args);
  const text = args.join(' ').trim();
  if (!text) throw new Error('Missing message');
  await request('POST', '/api/chat/send', { peerId, text });
  if (jsonOutput) printJson({ peerId, sent: true, text });
}

async function deviceCommand(args) {
  const action = args.shift();
  if (action !== 'set') throw new Error('Usage: lch device set --device <id> [--alias name] [--room room] [--favorite true|false] [--read-only true|false]');
  const peerId = await deviceFromArgs(args);
  const patch = {};
  const alias = takeOption(args, '--alias');
  const room = takeOption(args, '--room');
  const favorite = takeOption(args, '--favorite');
  const readOnly = takeOption(args, '--read-only');
  if (alias) patch.alias = alias;
  if (room) patch.room = room;
  if (favorite !== '') patch.favorite = parseBoolean(favorite);
  if (readOnly !== '') patch.readOnly = parseBoolean(readOnly);
  const state = await request('POST', '/api/devices/preference', { peerId, preference: patch });
  jsonOutput ? printJson(state.peers.find((peer) => peer.id === peerId) || state) : console.log(`Updated ${peerId}`);
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const args = [...rest];
  jsonOutput = takeFlag(args, '--json');
  if (!cmd || cmd === 'help' || cmd === '--help') {
    usage();
    return;
  }

  if (cmd === 'setup') {
    const action = args.shift();
    if (action === 'create') {
      const state = await request('POST', '/api/setup/create', { name: args.join(' ') || '我的局域网' });
      console.log(state.home.secret);
      return;
    }
    if (action === 'join') {
      const secret = args.shift();
      if (!secret) throw new Error('Missing home secret');
      const state = await request('POST', '/api/setup/join', { secret, name: args.join(' ') || '我的局域网' });
      console.log(`Joined ${state.home.name}: ${state.home.id}`);
      return;
    }
    throw new Error('Usage: lch setup create [name] | lch setup join <homeSecret> [name]');
  }

  if (cmd === 'devices') {
    const devices = await request('GET', '/api/devices');
    const rows = devices.map(deviceSummary);
    jsonOutput ? printJson(rows) : printTable(rows);
    return;
  }

  if (cmd === 'tasks') {
    const tasks = await request('GET', '/api/tasks');
    const rows = tasks.map(normalizeTaskForDisplay).map((task) => ({
      id: task.id,
      peer: task.peerName,
      status: task.status,
      exit: task.exitCode ?? '',
      command: JSON.stringify(task.command)
    }));
    jsonOutput ? printJson(rows) : printTable(rows);
    return;
  }

  if (cmd === 'run') return runCommand(args);
  if (cmd === 'terminal') return terminal(args[0]);
  if (cmd === 'startup') return configureStartup(args);
  if (cmd === 'observe') return observe(args);
  if (cmd === 'windows') return windowsCommand(args);
  if (cmd === 'file') return fileCommand(args);
  if (cmd === 'transfer') return transferCommand(args);
  if (cmd === 'peer') return peerCommand(args);
  if (cmd === 'chat') return chatCommand(args);
  if (cmd === 'device') return deviceCommand(args);
  if (cmd === 'firewall') {
    const action = args.shift() || 'status';
    if (action === 'status') {
      const status = await request('GET', '/api/firewall/status');
      jsonOutput ? printJson(status) : printTable([{
        platform: status.platform,
        ok: !status.needsAttention,
        blockRules: status.blockRules,
        allowRules: status.allowRules,
        message: status.message
      }]);
      return;
    }
    if (action === 'repair') {
      const noElevate = takeFlag(args, '--no-elevate');
      const status = await request('POST', '/api/firewall/repair', { elevated: !noElevate });
      jsonOutput ? printJson(status) : printTable([{
        platform: status.platform,
        ok: !status.needsAttention,
        blockRules: status.blockRules,
        allowRules: status.allowRules,
        message: status.message
      }]);
      return;
    }
    throw new Error('Usage: lch firewall status|repair');
  }

  if (cmd === 'remote') {
    const action = args[0] && ['open', 'close', 'sessions'].includes(args[0]) ? args.shift() : 'open';
    if (action === 'sessions') {
      const sessions = await request('GET', '/api/remote/sessions');
      const rows = sessions.map((item) => ({
        session: item.sessionId,
        peer: item.peerName,
        mode: item.mode,
        direction: item.direction,
        status: item.status,
        updated: item.updatedAt ? new Date(item.updatedAt).toISOString() : ''
      }));
      jsonOutput ? printJson(sessions) : printTable(rows);
      return;
    }
    const peerId = await deviceFromArgs(args, { positional: Boolean(args[0] && !args[0].startsWith('-')) });
    if (action === 'close') {
      const sessionId = takeOption(args, '--session');
      if (!sessionId) throw new Error('Missing --session <sessionId>');
      await request('POST', '/api/remote/close', { peerId, sessionId });
      if (jsonOutput) printJson({ peerId, sessionId, closed: true });
      return;
    }
    const openWindow = takeFlag(args, '--window');
    const result = await request('POST', '/api/remote/open', { peerId, window: openWindow });
    jsonOutput ? printJson({ peerId, ...result }) : printJson(result);
    return;
  }

  if (cmd === 'screenshot') {
    const peerId = await deviceFromArgs(args);
    const out = takeOption(args, '--out') || path.join(process.cwd(), `lch-screenshot-${Date.now()}.png`);
    const result = await request('POST', '/api/remote/screenshot', { peerId });
    fs.writeFileSync(out, Buffer.from(result.base64, 'base64'));
    jsonOutput ? printJson({ peerId, out, width: result.width, height: result.height, capturedAt: result.capturedAt }) : console.log(out);
    return;
  }

  if (cmd === 'click') {
    const peerId = await deviceFromArgs(args);
    const point = parsePointInput(args);
    const button = takeOption(args, '--button') || 'left';
    await request('POST', '/api/remote/input', {
      peerId,
      input: { kind: 'pointer', action: 'click', button, ...point }
    });
    return;
  }

  if (cmd === 'type') {
    const peerId = await deviceFromArgs(args);
    const text = args.join(' ');
    await request('POST', '/api/remote/input', {
      peerId,
      input: { kind: 'keyboard', action: 'type', text }
    });
    return;
  }

  if (cmd === 'hotkey') {
    const peerId = await deviceFromArgs(args);
    const keys = splitHotkey(args.join('+'));
    await request('POST', '/api/remote/input', {
      peerId,
      input: { kind: 'keyboard', action: 'hotkey', keys }
    });
    return;
  }

  if (cmd === 'clipboard') {
    const peerId = await deviceFromArgs(args);
    const action = args.shift();
    if (action === 'read') {
      const result = await request('POST', '/api/clipboard', { peerId, action: 'read' });
      console.log(result.text || '');
      return;
    }
    if (action === 'write') {
      await request('POST', '/api/clipboard', { peerId, action: 'write', text: args.join(' ') });
      return;
    }
    throw new Error('Usage: lch clipboard --device <id> read|write "text"');
  }

  throw new Error(`Unknown command: ${cmd}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}

module.exports = {
  matchDevice,
  normalizeRef,
  parseBoolean,
  parsePointInput,
  splitHotkey,
  takeFlag,
  takeOption
};
