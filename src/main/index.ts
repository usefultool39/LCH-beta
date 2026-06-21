import { app, BrowserWindow, clipboard as electronClipboard, desktopCapturer, dialog, ipcMain, Menu, nativeTheme, screen as electronScreen, session } from 'electron';
import crypto from 'node:crypto';
import dgram from 'node:dgram';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { WebSocket, WebSocketServer } from 'ws';
import {
  APP_NAME,
  APP_VERSION,
  BlockedDevice,
  CAPABILITIES,
  COMMAND_TIMEOUT_MS,
  DEFAULT_CONTROL_PORT,
  DEFAULT_LOCAL_API_PORT,
  DEFAULT_WEB_PORT,
  DevicePreference,
  DISCOVERY_INTERVAL_MS,
  DISCOVERY_PORT,
  DiscoveryPacket,
  EncryptedEnvelope,
  FirewallStatus,
  MAX_AUDIT_EVENTS,
  MAX_CONVERSATION_EVENTS,
  MAX_FILE_BYTES,
  MAX_TASK_OUTPUT_BYTES,
  NetworkInfo,
  PEER_TIMEOUT_MS,
  PeerInfo,
  RemoteInputEvent,
  RemoteOpenResult,
  RemoteScreenshotResult,
  RemoteSessionMode,
  RemoteSessionRecord,
  RemoteSessionStatus,
  SharedFolderListing,
  TaskRecord,
  TrustedDevice,
  isDiscoveryPacket
} from '../shared/protocol';

type RuntimePeer = PeerInfo;

type AppState = {
  home: null | {
    id: string;
    name: string;
    secret: string;
    createdAt: number;
  };
  device: {
    id: string;
    name: string;
    platform: NodeJS.Platform;
    publicKey: string;
    privateKey: string;
    publicKeyHash: string;
  };
  trustedDevices: Record<string, TrustedDevice>;
  blockedDevices: Record<string, BlockedDevice>;
  devicePreferences: Record<string, DevicePreference>;
  conversations: Record<string, any[]>;
  tasks: TaskRecord[];
  auditLog: any[];
  sharedFolder: string;
  fileShareEnabled: boolean;
  autoTrustDevices: boolean;
  localApiToken: string;
};

type TerminalSession = {
  terminalId: string;
  ownerPeerId: string;
  child: ChildProcessWithoutNullStreams;
};

type RunningTask = {
  taskId: string;
  child: ChildProcessWithoutNullStreams;
  outputBytes: number;
  timeout: NodeJS.Timeout;
};

const DEFAULT_HOME_NAME = '我的局域网';
const DOWNLOAD_FOLDER_NAME = 'LanControlHub';
const HEADLESS = process.argv.includes('--headless') || process.env.LCH_HEADLESS === '1';

let mainWindow: BrowserWindow | null = null;
let state: AppState;
let discoverySocket: dgram.Socket | null = null;
let discoveryTimer: NodeJS.Timeout | null = null;
let pruneTimer: NodeJS.Timeout | null = null;
let controlWss: WebSocketServer | null = null;
let webServer: http.Server | null = null;
let localApiServer: http.Server | null = null;
let controlPort = DEFAULT_CONTROL_PORT;
let webPort = DEFAULT_WEB_PORT;
let localApiPort = DEFAULT_LOCAL_API_PORT;
let firewallRefreshRunning = false;

const peers = new Map<string, RuntimePeer>();
const runningTasks = new Map<string, RunningTask>();
const terminalSessions = new Map<string, TerminalSession>();
const remoteSessions = new Map<string, RemoteSessionRecord>();
const remoteSessionWindows = new Map<string, BrowserWindow>();
const remoteWindowClosingByMain = new Set<string>();
const localSseClients = new Set<http.ServerResponse>();
let remoteInputChain: Promise<unknown> = Promise.resolve();
let nutRuntime: Promise<any> | null = null;

process.on('uncaughtException', (error) => {
  logRuntimeError('uncaughtException', error);
});

process.on('unhandledRejection', (error) => {
  logRuntimeError('unhandledRejection', error);
});

function statePath() {
  return path.join(app.getPath('userData'), 'state.json');
}

function localApiConfigPath() {
  return path.join(app.getPath('userData'), 'local-api.json');
}

function runtimeLogPath() {
  return path.join(app.getPath('userData'), 'runtime.log');
}

function logRuntimeError(label: string, error: unknown) {
  try {
    fs.mkdirSync(path.dirname(runtimeLogPath()), { recursive: true });
    const message = error instanceof Error ? `${error.stack || error.message}` : JSON.stringify(error);
    fs.appendFileSync(runtimeLogPath(), `[${new Date().toISOString()}] ${label}\n${message}\n\n`);
  } catch {
    // Avoid recursive failures while logging crash diagnostics.
  }
}

function refreshWindowsFirewallRules() {
  if (process.platform !== 'win32') return;
  if (firewallRefreshRunning) return;
  firewallRefreshRunning = true;
  const script = [
    "$ErrorActionPreference = 'SilentlyContinue';",
    "Get-NetFirewallRule -DisplayName 'lan control hub.exe' | Where-Object { $_.Action -eq 'Block' } | Remove-NetFirewallRule;",
    "Get-NetFirewallRule -DisplayName 'Lan Control Hub TCP 46881-46911' | Remove-NetFirewallRule;",
    "Get-NetFirewallRule -DisplayName 'Lan Control Hub UDP 46880' | Remove-NetFirewallRule;",
    "New-NetFirewallRule -DisplayName 'Lan Control Hub TCP 46881-46911' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 46881-46911 -Profile Any | Out-Null;",
    "New-NetFirewallRule -DisplayName 'Lan Control Hub UDP 46880' -Direction Inbound -Action Allow -Protocol UDP -LocalPort 46880 -Profile Any | Out-Null;"
  ].join(' ');
  try {
    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      windowsHide: true,
      stdio: 'ignore'
    });
    child.on('error', (error) => {
      firewallRefreshRunning = false;
      logRuntimeError('firewall-refresh', error);
    });
    child.on('close', () => {
      firewallRefreshRunning = false;
    });
    child.unref();
  } catch (error) {
    firewallRefreshRunning = false;
    logRuntimeError('firewall-refresh', error);
  }
}

function scheduleWindowsFirewallRefresh() {
  refreshWindowsFirewallRules();
  setTimeout(refreshWindowsFirewallRules, 3000);
  setTimeout(refreshWindowsFirewallRules, 12000);
  setTimeout(refreshWindowsFirewallRules, 25000);
  setTimeout(refreshWindowsFirewallRules, 45000);
}

function runPowerShell(script: string, timeoutMs = 15000) {
  return new Promise<{ stdout: string; stderr: string; code: number | null }>((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      windowsHide: true
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('PowerShell 执行超时'));
    }, timeoutMs);
    child.stdout?.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
    child.stderr?.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code });
    });
  });
}

const FIREWALL_STATUS_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$block = @(Get-NetFirewallRule -DisplayName 'lan control hub.exe' | Where-Object { $_.Action -eq 'Block' })
$allowTcp = @(Get-NetFirewallRule -DisplayName 'Lan Control Hub TCP 46881-46911' | Where-Object { $_.Enabled -eq 'True' -and $_.Action -eq 'Allow' })
$allowUdp = @(Get-NetFirewallRule -DisplayName 'Lan Control Hub UDP 46880' | Where-Object { $_.Enabled -eq 'True' -and $_.Action -eq 'Allow' })
[pscustomobject]@{
  blockRules = $block.Count
  allowRules = ($allowTcp.Count + $allowUdp.Count)
  details = @($block | Select-Object -ExpandProperty DisplayName)
} | ConvertTo-Json -Compress
`;

const FIREWALL_REPAIR_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
Get-NetFirewallRule -DisplayName 'lan control hub.exe' | Where-Object { $_.Action -eq 'Block' } | Remove-NetFirewallRule
Get-NetFirewallRule -DisplayName 'Lan Control Hub TCP 46881-46911' | Remove-NetFirewallRule
Get-NetFirewallRule -DisplayName 'Lan Control Hub UDP 46880' | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName 'Lan Control Hub TCP 46881-46911' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 46881-46911 -Profile Any | Out-Null
New-NetFirewallRule -DisplayName 'Lan Control Hub UDP 46880' -Direction Inbound -Action Allow -Protocol UDP -LocalPort 46880 -Profile Any | Out-Null
`;

async function getFirewallStatus(): Promise<FirewallStatus> {
  if (process.platform !== 'win32') {
    return {
      platform: process.platform,
      supported: false,
      checkedAt: Date.now(),
      needsAttention: false,
      blockRules: 0,
      allowRules: 0,
      canRepair: false,
      message: '当前平台不需要 Windows 防火墙修复。'
    };
  }
  try {
    const result = await runPowerShell(FIREWALL_STATUS_SCRIPT, 45000);
    const parsed = JSON.parse(String(result.stdout || '{}'));
    const blockRules = Number(parsed.blockRules || 0);
    const allowRules = Number(parsed.allowRules || 0);
    const needsAttention = blockRules > 0 || allowRules < 2;
    return {
      platform: process.platform,
      supported: true,
      checkedAt: Date.now(),
      needsAttention,
      blockRules,
      allowRules,
      canRepair: true,
      message: needsAttention
        ? 'Windows 防火墙可能会阻止其他设备控制本机。请点击修复，或在目标电脑运行 lch firewall repair。'
        : 'Windows 防火墙规则正常。',
      details: Array.isArray(parsed.details) ? parsed.details.map(String) : []
    };
  } catch (error: any) {
    return {
      platform: process.platform,
      supported: true,
      checkedAt: Date.now(),
      needsAttention: true,
      blockRules: 0,
      allowRules: 0,
      canRepair: true,
      message: error?.message || '无法读取 Windows 防火墙状态。',
      details: []
    };
  }
}

async function repairFirewallRules(elevated = true) {
  if (process.platform !== 'win32') return getFirewallStatus();
  if (elevated) {
    const encoded = Buffer.from(FIREWALL_REPAIR_SCRIPT, 'utf16le').toString('base64');
    const outer = `Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -Wait -ArgumentList '-NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encoded}'`;
    try {
      await runPowerShell(outer, 90000);
    } catch (error) {
      logRuntimeError('firewall-repair-elevated', error);
      await runPowerShell(FIREWALL_REPAIR_SCRIPT, 20000).catch((err) => logRuntimeError('firewall-repair-fallback', err));
    }
  } else {
    await runPowerShell(FIREWALL_REPAIR_SCRIPT, 20000).catch((error) => logRuntimeError('firewall-repair', error));
  }
  refreshWindowsFirewallRules();
  return getFirewallStatus();
}

function base64url(buffer: Buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function sha256(value: string | Buffer) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function publicKeyHash(publicKey: string) {
  return sha256(publicKey).slice(0, 16);
}

function homeIdFromSecret(secret: string) {
  return sha256(`lch-home:${secret.trim()}`).slice(0, 24);
}

function deriveHomeKey(secret: string) {
  return crypto.createHash('sha256').update(`lch-aes:${secret.trim()}`).digest();
}

function createDeviceIdentity() {
  const keys = crypto.generateKeyPairSync('ed25519');
  const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  return {
    id: crypto.randomUUID(),
    name: os.hostname(),
    platform: process.platform,
    publicKey,
    privateKey: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKeyHash: publicKeyHash(publicKey)
  };
}

function createDefaultState(): AppState {
  return {
    home: null,
    device: createDeviceIdentity(),
    trustedDevices: {},
    blockedDevices: {},
    devicePreferences: {},
    conversations: {},
    tasks: [],
    auditLog: [],
    sharedFolder: '',
    fileShareEnabled: true,
    autoTrustDevices: true,
    localApiToken: base64url(crypto.randomBytes(32))
  };
}

function normalizeTaskRecords(tasks: TaskRecord[] = []) {
  return tasks.map((task) => {
    const hasTerminalSignal = task.endedAt
      || task.exitCode !== undefined
      || task.signal !== undefined;
    if ((task.status === 'running' || task.status === 'pending') && hasTerminalSignal) {
      return {
        ...task,
        status: task.exitCode === 0 ? 'completed' as const : 'failed' as const
      };
    }
    return task;
  });
}

function loadState(): AppState {
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath(), 'utf8')) as Partial<AppState>;
    if (parsed.device?.id && parsed.device?.privateKey) {
      const publicKey = parsed.device.publicKey || '';
      return {
        home: parsed.home || null,
        device: {
          id: parsed.device.id,
          name: parsed.device.name || os.hostname(),
          platform: parsed.device.platform || process.platform,
          publicKey,
          privateKey: parsed.device.privateKey,
          publicKeyHash: parsed.device.publicKeyHash || publicKeyHash(publicKey)
        },
        trustedDevices: parsed.trustedDevices || {},
        blockedDevices: (parsed as any).blockedDevices || {},
        devicePreferences: (parsed as any).devicePreferences || {},
        conversations: parsed.conversations || {},
        tasks: normalizeTaskRecords(parsed.tasks || []),
        auditLog: parsed.auditLog || [],
        sharedFolder: parsed.sharedFolder || '',
        fileShareEnabled: (parsed as any).fileShareEnabled !== false,
        autoTrustDevices: (parsed as any).autoTrustDevices !== false,
        localApiToken: parsed.localApiToken || base64url(crypto.randomBytes(32))
      };
    }
  } catch {
    // First launch or corrupted state.
  }
  return createDefaultState();
}

function saveState() {
  fs.mkdirSync(path.dirname(statePath()), { recursive: true });
  fs.writeFileSync(statePath(), `${JSON.stringify(state, null, 2)}\n`);
  writeLocalApiConfig();
}

function writeLocalApiConfig() {
  if (!state?.localApiToken) return;
  fs.mkdirSync(path.dirname(localApiConfigPath()), { recursive: true });
  fs.writeFileSync(localApiConfigPath(), `${JSON.stringify({
    app: APP_NAME,
    port: localApiPort,
    token: state.localApiToken,
    updatedAt: Date.now()
  }, null, 2)}\n`);
}

function localAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry && entry.family === 'IPv4' && !entry.internal))
    .map((entry) => entry.address);
}

function networkInfo(): NetworkInfo {
  return {
    discoveryPort: DISCOVERY_PORT,
    controlPort,
    webPort,
    localApiPort,
    addresses: localAddresses()
  };
}

function isBlockedDevice(deviceId: string, publicKeyHashValue?: string) {
  const blocked = state.blockedDevices[deviceId];
  if (!blocked) return false;
  return !blocked.publicKeyHash || !publicKeyHashValue || blocked.publicKeyHash === publicKeyHashValue;
}

function isPeerTrusted(peer: Pick<PeerInfo, 'id' | 'publicKey' | 'publicKeyHash'>) {
  const trusted = state.trustedDevices[peer.id];
  return Boolean(trusted && trusted.publicKey === peer.publicKey && !isBlockedDevice(peer.id, peer.publicKeyHash));
}

function serializePeers() {
  const now = Date.now();
  return [...peers.values()]
    .map((peer) => {
      const preference = state.devicePreferences[peer.id] || {};
      const age = now - peer.lastSeen;
      const isOnline = age < PEER_TIMEOUT_MS;
      const trusted = isPeerTrusted(peer);
      return {
        ...peer,
        trusted,
        isOnline,
        uiStatus: !trusted
          ? 'permission-needed' as const
          : isOnline ? (age > PEER_TIMEOUT_MS * 0.65 ? 'stale' as const : 'online' as const) : 'offline' as const,
        alias: preference.alias,
        room: preference.room,
        favorite: Boolean(preference.favorite),
        readOnly: Boolean(preference.readOnly),
        lastControlledAt: preference.lastControlledAt,
        displayName: preference.alias || peer.name
      };
    })
    .sort((a, b) => Number(b.favorite) - Number(a.favorite)
      || (b.lastControlledAt || 0) - (a.lastControlledAt || 0)
      || (a.room || '').localeCompare(b.room || '')
      || (a.displayName || a.name).localeCompare(b.displayName || b.name));
}

function peerDisplayName(peerId: string, fallback = '') {
  if (peerId === state.device.id) return state.device.name;
  const preference = state.devicePreferences[peerId] || {};
  const peer = peers.get(peerId);
  const trusted = state.trustedDevices[peerId];
  return preference.alias || peer?.name || trusted?.name || fallback || peerId;
}

function serializeRemoteSessions() {
  return [...remoteSessions.values()]
    .sort((a, b) => Number(!b.endedAt) - Number(!a.endedAt) || b.updatedAt - a.updatedAt)
    .slice(0, 80);
}

function emitRemoteSessions() {
  const sessions = serializeRemoteSessions();
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('lch:remote-sessions', sessions);
  }
  sendLocalSse('remote-sessions', sessions);
}

function trimRemoteSessions() {
  const closed = [...remoteSessions.values()]
    .filter((sessionItem) => sessionItem.endedAt)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  for (const sessionItem of closed.slice(50)) {
    remoteSessions.delete(sessionItem.sessionId);
  }
}

function upsertRemoteSession(
  sessionId: string,
  patch: Partial<RemoteSessionRecord> & Pick<RemoteSessionRecord, 'peerId'>
) {
  const now = Date.now();
  const existing = remoteSessions.get(sessionId);
  const next: RemoteSessionRecord = {
    sessionId,
    peerId: patch.peerId,
    peerName: patch.peerName || existing?.peerName || peerDisplayName(patch.peerId),
    mode: patch.mode || existing?.mode || 'view',
    direction: patch.direction || existing?.direction || 'outgoing',
    status: patch.status || existing?.status || 'opening',
    startedAt: existing?.startedAt || patch.startedAt || now,
    updatedAt: now,
    endedAt: patch.endedAt ?? existing?.endedAt,
    width: patch.width ?? existing?.width,
    height: patch.height ?? existing?.height,
    windowId: patch.windowId ?? existing?.windowId,
    error: patch.error ?? existing?.error
  };
  if (next.status !== 'closed' && next.status !== 'failed') {
    delete next.endedAt;
  } else if (!next.endedAt) {
    next.endedAt = now;
  }
  remoteSessions.set(sessionId, next);
  trimRemoteSessions();
  emitRemoteSessions();
  emitState();
  return next;
}

function appStateView() {
  return {
    home: state.home,
    device: {
      id: state.device.id,
      name: state.device.name,
      platform: state.device.platform,
      publicKey: state.device.publicKey,
      publicKeyHash: state.device.publicKeyHash,
      controlPort,
      webPort
    },
    peers: serializePeers(),
    trustedDevices: state.trustedDevices,
    blockedDevices: state.blockedDevices,
    devicePreferences: state.devicePreferences,
    conversations: state.conversations,
    tasks: state.tasks.slice(0, 200),
    remoteSessions: serializeRemoteSessions(),
    auditLog: state.auditLog.slice(-200),
    sharedFolder: state.sharedFolder,
    fileShareEnabled: state.fileShareEnabled,
    autoTrustDevices: state.autoTrustDevices,
    networkInfo: networkInfo()
  };
}

function emitState() {
  const next = appStateView();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('lch:state', next);
  }
  sendLocalSse('state', next);
}

function broadcastRenderer(channel: string, payload: unknown) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

function sendLocalSse(event: string, data: unknown) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of localSseClients) {
    client.write(payload);
  }
}

function addAudit(action: string, detail: string, actorDeviceId = state.device.id, targetDeviceId = state.device.id) {
  const actor = actorDeviceId === state.device.id ? state.device : state.trustedDevices[actorDeviceId];
  const target = targetDeviceId === state.device.id ? state.device : state.trustedDevices[targetDeviceId];
  state.auditLog.push({
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    actorDeviceId,
    actorName: actor?.name || actorDeviceId,
    targetDeviceId,
    targetName: target?.name || targetDeviceId,
    action,
    detail
  });
  if (state.auditLog.length > MAX_AUDIT_EVENTS) {
    state.auditLog.splice(0, state.auditLog.length - MAX_AUDIT_EVENTS);
  }
  saveState();
}

function updateDevicePreference(peerId: string, patch: Partial<DevicePreference>) {
  const id = String(peerId || '').trim();
  if (!id) throw new Error('缺少设备 ID');
  const current = state.devicePreferences[id] || {};
  const next: DevicePreference = {
    ...current,
    ...patch,
    alias: patch.alias !== undefined ? String(patch.alias || '').trim().slice(0, 40) : current.alias,
    room: patch.room !== undefined ? String(patch.room || '').trim().slice(0, 28) : current.room,
    notes: patch.notes !== undefined ? String(patch.notes || '').trim().slice(0, 160) : current.notes,
    favorite: patch.favorite !== undefined ? Boolean(patch.favorite) : Boolean(current.favorite),
    readOnly: patch.readOnly !== undefined ? Boolean(patch.readOnly) : Boolean(current.readOnly)
  };
  if (!next.alias) delete next.alias;
  if (!next.room) delete next.room;
  if (!next.notes) delete next.notes;
  state.devicePreferences[id] = next;
  addAudit('device.preference', `更新设备偏好 ${id}`, state.device.id, id);
  saveState();
  emitState();
  return appStateView();
}

function setFileSharing(enabled: boolean) {
  state.fileShareEnabled = Boolean(enabled);
  addAudit('files.share', state.fileShareEnabled ? '开启文件库共享' : '关闭文件库共享');
  saveState();
  emitState();
  return appStateView();
}

function setAutoTrustDevices(enabled: boolean) {
  state.autoTrustDevices = Boolean(enabled);
  addAudit('device.autoTrust', state.autoTrustDevices ? '开启自动信任新设备' : '关闭自动信任新设备');
  saveState();
  emitState();
  return appStateView();
}

function trustDevice(peerId: string) {
  const id = String(peerId || '').trim();
  const peer = peers.get(id);
  if (!peer) throw new Error('设备不在线');
  delete state.blockedDevices[id];
  state.trustedDevices[id] = {
    id,
    name: peer.name,
    platform: peer.platform,
    publicKey: peer.publicKey,
    publicKeyHash: peer.publicKeyHash || publicKeyHash(peer.publicKey),
    trustedAt: Date.now()
  };
  addAudit('device.trust', `信任设备 ${peer.name}`, state.device.id, id);
  saveState();
  emitState();
  return appStateView();
}

function revokeTrustedDevice(peerId: string) {
  const id = String(peerId || '').trim();
  if (!id || id === state.device.id) throw new Error('不能撤销本机信任');
  const trusted = state.trustedDevices[id];
  const peer = peers.get(id);
  const publicKeyHashValue = peer?.publicKeyHash || trusted?.publicKeyHash;
  delete state.trustedDevices[id];
  state.blockedDevices[id] = {
    id,
    name: peer?.name || trusted?.name || id,
    publicKeyHash: publicKeyHashValue,
    blockedAt: Date.now()
  };
  addAudit('device.revoke', `撤销设备信任 ${state.blockedDevices[id].name}`, state.device.id, id);
  saveState();
  emitState();
  return appStateView();
}

function isPeerReadOnly(peerId: string) {
  return Boolean(state.devicePreferences[String(peerId || '')]?.readOnly);
}

function assertPeerWritable(peerId: string) {
  if (isPeerReadOnly(peerId)) throw new Error('该设备已设置为只读模式');
}

function markDeviceOpened(peerId: string, mode: 'open' | 'control' = 'open') {
  const id = String(peerId || '').trim();
  if (!id) return;
  const current = state.devicePreferences[id] || {};
  state.devicePreferences[id] = {
    ...current,
    lastOpenedAt: Date.now(),
    lastControlledAt: mode === 'control' ? Date.now() : current.lastControlledAt
  };
  saveState();
  emitState();
}

function addConversationEvent(peerId: string, event: any) {
  if (!state.conversations[peerId]) state.conversations[peerId] = [];
  state.conversations[peerId].push({
    id: crypto.randomUUID(),
    peerId,
    createdAt: Date.now(),
    ...event
  });
  if (state.conversations[peerId].length > MAX_CONVERSATION_EVENTS) {
    state.conversations[peerId].splice(0, state.conversations[peerId].length - MAX_CONVERSATION_EVENTS);
  }
  saveState();
  emitState();
}

function ensureHome() {
  if (!state.home) throw new Error('请先创建或加入家庭控制网络');
  return state.home;
}

function createHome(name = DEFAULT_HOME_NAME) {
  const secret = base64url(crypto.randomBytes(32));
  state.home = {
    id: homeIdFromSecret(secret),
    name: String(name || DEFAULT_HOME_NAME).trim().slice(0, 40) || DEFAULT_HOME_NAME,
    secret,
    createdAt: Date.now()
  };
  trustSelf();
  saveState();
  broadcastPresence();
  emitState();
  return appStateView();
}

function joinHome(secret: string, name = DEFAULT_HOME_NAME) {
  const cleanSecret = String(secret || '').trim();
  if (cleanSecret.length < 16) throw new Error('家庭密钥太短或无效');
  state.home = {
    id: homeIdFromSecret(cleanSecret),
    name: String(name || DEFAULT_HOME_NAME).trim().slice(0, 40) || DEFAULT_HOME_NAME,
    secret: cleanSecret,
    createdAt: Date.now()
  };
  trustSelf();
  peers.clear();
  saveState();
  broadcastPresence();
  emitState();
  return appStateView();
}

function trustSelf() {
  state.trustedDevices[state.device.id] = {
    id: state.device.id,
    name: state.device.name,
    platform: state.device.platform,
    publicKey: state.device.publicKey,
    publicKeyHash: state.device.publicKeyHash,
    trustedAt: Date.now()
  };
}

function signPayload(payload: unknown) {
  return crypto.sign(
    null,
    Buffer.from(JSON.stringify(payload)),
    crypto.createPrivateKey(state.device.privateKey)
  ).toString('base64');
}

function verifyPayload(payload: unknown, signature: string, publicKey: string) {
  try {
    return crypto.verify(
      null,
      Buffer.from(JSON.stringify(payload)),
      crypto.createPublicKey(publicKey),
      Buffer.from(signature, 'base64')
    );
  } catch {
    return false;
  }
}

function createEnvelope(type: string, data: unknown): EncryptedEnvelope {
  const home = ensureHome();
  const payload = {
    id: crypto.randomUUID(),
    fromId: state.device.id,
    fromName: state.device.name,
    type,
    data,
    timestamp: Date.now()
  };
  const signed = {
    payload,
    publicKey: state.device.publicKey,
    signature: signPayload(payload)
  };
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveHomeKey(home.secret), nonce);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(signed), 'utf8'),
    cipher.final()
  ]);
  return {
    kind: 'lch-control',
    version: 1,
    fromId: state.device.id,
    nonce: nonce.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64')
  };
}

function decryptEnvelope(envelope: EncryptedEnvelope) {
  const home = ensureHome();
  if (envelope.kind !== 'lch-control' || envelope.version !== 1) throw new Error('控制消息格式无效');
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    deriveHomeKey(home.secret),
    Buffer.from(envelope.nonce, 'base64')
  );
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  const raw = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
    decipher.final()
  ]).toString('utf8');
  const signed = JSON.parse(raw);
  const payload = signed.payload;
  if (!payload?.fromId || !payload?.type || !signed.publicKey || !signed.signature) {
    throw new Error('控制消息缺少签名字段');
  }
  if (!verifyPayload(payload, signed.signature, signed.publicKey)) {
    throw new Error('控制消息签名无效');
  }
  const trusted = state.trustedDevices[payload.fromId];
  const senderKeyHash = publicKeyHash(signed.publicKey);
  if (isBlockedDevice(payload.fromId, senderKeyHash)) {
    throw new Error('设备未被信任');
  }
  if (trusted && trusted.publicKey !== signed.publicKey) {
    throw new Error('设备身份密钥已变化');
  }
  if (!trusted && state.autoTrustDevices) {
    state.trustedDevices[payload.fromId] = {
      id: payload.fromId,
      name: payload.fromName,
      platform: 'unknown',
      publicKey: signed.publicKey,
      publicKeyHash: senderKeyHash,
      trustedAt: Date.now()
    };
    saveState();
  } else if (!trusted) {
    throw new Error('设备未被信任');
  }
  return payload as { id: string; fromId: string; fromName: string; type: string; data: any; timestamp: number };
}

function ipv4ToNumber(address: string) {
  return address.split('.').reduce((total, part) => ((total << 8) + Number(part)) >>> 0, 0);
}

function numberToIpv4(value: number) {
  return [24, 16, 8, 0].map((shift) => (value >>> shift) & 255).join('.');
}

function broadcastAddresses() {
  const addresses = new Set(['255.255.255.255']);
  const interfaces = os.networkInterfaces();
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries || []) {
      if (entry.family !== 'IPv4' || entry.internal || !entry.address || !entry.netmask) continue;
      const network = ipv4ToNumber(entry.address) & ipv4ToNumber(entry.netmask);
      const broadcast = network | (~ipv4ToNumber(entry.netmask) >>> 0);
      addresses.add(numberToIpv4(broadcast >>> 0));
    }
  }
  return [...addresses];
}

function localAnnouncement(): DiscoveryPacket | null {
  if (!state.home) return null;
  return {
    kind: 'lch-discovery',
    version: 1,
    homeId: state.home.id,
    appVersion: APP_VERSION,
    device: {
      id: state.device.id,
      name: state.device.name,
      platform: state.device.platform,
      publicKey: state.device.publicKey,
      publicKeyHash: state.device.publicKeyHash
    },
    controlPort,
    webPort,
    capabilities: [...CAPABILITIES],
    timestamp: Date.now()
  };
}

function rememberPeer(packet: DiscoveryPacket, address: string) {
  if (!state.home || packet.homeId !== state.home.id || packet.device.id === state.device.id) return false;
  const trusted = state.trustedDevices[packet.device.id];
  const identityMismatch = Boolean(trusted && trusted.publicKey !== packet.device.publicKey);
  const blocked = isBlockedDevice(packet.device.id, packet.device.publicKeyHash);
  if (!trusted && !identityMismatch && !blocked && state.autoTrustDevices) {
    state.trustedDevices[packet.device.id] = {
      id: packet.device.id,
      name: packet.device.name,
      platform: packet.device.platform,
      publicKey: packet.device.publicKey,
      publicKeyHash: packet.device.publicKeyHash || publicKeyHash(packet.device.publicKey),
      trustedAt: Date.now()
    };
    saveState();
  }

  peers.set(packet.device.id, {
    ...packet.device,
    publicKeyHash: packet.device.publicKeyHash || publicKeyHash(packet.device.publicKey),
    address,
    controlPort: packet.controlPort,
    webPort: packet.webPort,
    capabilities: packet.capabilities,
    appVersion: packet.appVersion,
    lastSeen: Date.now(),
    trusted: !identityMismatch && !blocked && Boolean(state.trustedDevices[packet.device.id]),
    isOnline: true,
    identityMismatch
  });
  return true;
}

function broadcastPresence() {
  if (!discoverySocket || !state.home) return;
  const packet = Buffer.from(JSON.stringify(localAnnouncement()));
  for (const address of broadcastAddresses()) {
    discoverySocket.send(packet, 0, packet.length, DISCOVERY_PORT, address);
  }
}

function startDiscovery() {
  discoverySocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  discoverySocket.on('message', (message, remote) => {
    try {
      const packet = JSON.parse(message.toString('utf8'));
      if (isDiscoveryPacket(packet) && rememberPeer(packet, remote.address)) emitState();
    } catch {
      // Ignore unrelated UDP traffic.
    }
  });
  discoverySocket.bind(DISCOVERY_PORT, () => {
    discoverySocket?.setBroadcast(true);
    broadcastPresence();
    discoveryTimer = setInterval(broadcastPresence, DISCOVERY_INTERVAL_MS);
  });
  pruneTimer = setInterval(() => {
    const now = Date.now();
    let changed = false;
    for (const [id, peer] of peers) {
      if (now - peer.lastSeen > PEER_TIMEOUT_MS) {
        peers.delete(id);
        changed = true;
      }
    }
    if (changed) emitState();
  }, 5000);
}

function getTrustedPeer(peerId: string) {
  const peer = peers.get(peerId);
  if (!peer) throw new Error('设备不在线');
  if (!isPeerTrusted(peer)) throw new Error('设备未被信任');
  return peer;
}

function sendControl<T = unknown>(peerId: string, type: string, data: unknown, timeoutMs = 15000): Promise<T> {
  const peer = getTrustedPeer(peerId);
  const envelope = createEnvelope(type, data);
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${peer.address}:${peer.controlPort}`);
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error('远程设备响应超时：如果设备显示在线但无法控制，通常是目标电脑的 Windows 防火墙阻止了入站控制。请在目标电脑打开 Lan Control Hub 设置里的“修复防火墙”，或运行 lch firewall repair。'));
    }, timeoutMs);
    ws.on('open', () => ws.send(JSON.stringify(envelope)));
    ws.on('message', (raw) => {
      try {
        clearTimeout(timer);
        const payload = decryptEnvelope(JSON.parse(raw.toString()) as EncryptedEnvelope);
        if (payload.type !== 'response') throw new Error('响应类型无效');
        const body = payload.data as { ok: boolean; data?: T; error?: string };
        ws.close();
        if (!body.ok) reject(new Error(body.error || '远程请求失败'));
        else resolve(body.data as T);
      } catch (err) {
        reject(err);
      }
    });
    ws.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function handleControlMessage(payload: { fromId: string; fromName: string; type: string; data: any }) {
  switch (payload.type) {
    case 'chat.send':
      addConversationEvent(payload.fromId, {
        direction: 'incoming',
        type: 'text',
        text: String(payload.data?.text || ''),
        senderName: payload.fromName
      });
      addAudit('chat.receive', '收到聊天消息', payload.fromId, state.device.id);
      return { ok: true, data: appStateView() };

    case 'file.send':
      assertPeerWritable(payload.fromId);
      return receiveFile(payload.fromId, payload.fromName, payload.data);

    case 'file.listShared':
      return { ok: true, data: listSharedFolder(payload.data?.relativePath || '') };

    case 'file.downloadShared':
      return { ok: true, data: readSharedFile(payload.data?.relativePath || '') };

    case 'file.uploadShared':
      assertPeerWritable(payload.fromId);
      return { ok: true, data: uploadSharedFile(payload.fromId, payload.fromName, payload.data) };

    case 'task.run':
      assertPeerWritable(payload.fromId);
      return { ok: true, data: startLocalTask(payload.fromId, payload.fromName, payload.data) };

    case 'task.cancel':
      return { ok: true, data: cancelLocalTask(payload.data?.remoteTaskId) };

    case 'task.output':
      handleRemoteTaskOutput(payload.fromId, payload.data);
      return { ok: true, data: true };

    case 'task.complete':
      handleRemoteTaskComplete(payload.fromId, payload.data);
      return { ok: true, data: true };

    case 'terminal.open':
      assertPeerWritable(payload.fromId);
      return { ok: true, data: openLocalTerminal(payload.fromId, payload.fromName, payload.data) };

    case 'terminal.input':
      assertPeerWritable(payload.fromId);
      return { ok: true, data: writeLocalTerminal(payload.data?.terminalId, payload.data?.input) };

    case 'terminal.close':
      return { ok: true, data: closeLocalTerminal(payload.data?.terminalId) };

    case 'terminal.output':
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('lch:terminal-output', { peerId: payload.fromId, ...payload.data });
      sendLocalSse('terminal-output', { peerId: payload.fromId, ...payload.data });
      return { ok: true, data: true };

    case 'terminal.closed':
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('lch:terminal-closed', { peerId: payload.fromId, ...payload.data });
      sendLocalSse('terminal-closed', { peerId: payload.fromId, ...payload.data });
      return { ok: true, data: true };

    case 'screen.request':
      scheduleWindowsFirewallRefresh();
      broadcastRenderer('lch:screen-request', {
        peerId: payload.fromId,
        peerName: payload.fromName,
        sessionId: payload.data?.sessionId
      });
      addAudit('screen.request', '请求查看屏幕', payload.fromId, state.device.id);
      return { ok: true, data: true };

    case 'screen.signal':
      broadcastRenderer('lch:screen-signal', {
        peerId: payload.fromId,
        peerName: payload.fromName,
        sessionId: payload.data?.sessionId,
        signal: payload.data?.signal
      });
      return { ok: true, data: true };

    case 'screen.stop':
      broadcastRenderer('lch:screen-stop', {
        peerId: payload.fromId,
        sessionId: payload.data?.sessionId
      });
      return { ok: true, data: true };

    case 'remote.open':
      assertPeerWritable(payload.fromId);
      scheduleWindowsFirewallRefresh();
      return { ok: true, data: openLocalRemoteSession(payload.fromId, payload.fromName, payload.data) };

    case 'remote.close':
      return { ok: true, data: closeLocalRemoteSession(payload.fromId, payload.data) };

    case 'remote.input':
    case 'remote.pointer':
    case 'remote.keyboard':
      assertPeerWritable(payload.fromId);
      return { ok: true, data: await queueRemoteInput(payload.data as RemoteInputEvent) };

    case 'remote.hotkey':
      assertPeerWritable(payload.fromId);
      return { ok: true, data: await queueRemoteInput({ kind: 'keyboard', action: 'hotkey', keys: payload.data?.keys || [] }) };

    case 'remote.clipboard.read':
      return { ok: true, data: { text: electronClipboard.readText() } };

    case 'remote.clipboard.write':
      assertPeerWritable(payload.fromId);
      electronClipboard.writeText(String(payload.data?.text || ''));
      return { ok: true, data: true };

    case 'remote.screenshot.request':
      return { ok: true, data: await captureLocalScreenshot() };

    default:
      return { ok: false, error: `未知控制消息：${payload.type}` };
  }
}

function startControlServer() {
  return new Promise<void>((resolve, reject) => {
    function listen(port: number) {
      const server = new WebSocketServer({ host: '0.0.0.0', port });
      server.on('connection', (ws) => {
        ws.once('message', async (raw) => {
          let response: { ok: boolean; data?: unknown; error?: string } = { ok: false, error: '未知错误' };
          try {
            const payload = decryptEnvelope(JSON.parse(raw.toString()) as EncryptedEnvelope);
            response = await handleControlMessage(payload);
          } catch (err: any) {
            response = { ok: false, error: err?.message || String(err) };
          }
          try {
            ws.send(JSON.stringify(createEnvelope('response', response)));
          } catch {
            // Client may already be gone.
          } finally {
            setTimeout(() => ws.close(), 50);
          }
        });
      });
      server.once('error', (err: any) => {
        if (err.code === 'EADDRINUSE' && port < DEFAULT_CONTROL_PORT + 30) {
          listen(port + 1);
          return;
        }
        reject(err);
      });
      server.once('listening', () => {
        controlPort = port;
        controlWss = server;
        resolve();
      });
    }
    listen(controlPort);
  });
}

function defaultShellCommand(command: string) {
  if (process.platform === 'win32') {
    return { file: 'powershell.exe', args: ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command] };
  }
  const shell = process.env.SHELL || '/bin/zsh';
  return { file: shell, args: ['-lc', command] };
}

function defaultInteractiveShell() {
  if (process.platform === 'win32') return { file: 'powershell.exe', args: ['-NoLogo', '-NoProfile'] };
  return { file: process.env.SHELL || '/bin/zsh', args: ['-l'] };
}

function appendTaskOutput(task: TaskRecord, stream: 'stdout' | 'stderr' | 'system', chunk: string) {
  const current = stream === 'stderr' ? task.errorOutput : task.output;
  const next = `${current}${chunk}`;
  const capped = next.length > MAX_TASK_OUTPUT_BYTES ? next.slice(-MAX_TASK_OUTPUT_BYTES) : next;
  if (stream === 'stderr') task.errorOutput = capped;
  else task.output = capped;
}

function startLocalTask(originPeerId: string, originName: string, data: any) {
  const command = String(data?.command || '').trim();
  if (!command) throw new Error('命令不能为空');
  const taskId = crypto.randomUUID();
  const cwd = data?.cwd ? String(data.cwd) : os.homedir();
  const shell = defaultShellCommand(command);
  const child = spawn(shell.file, shell.args, { cwd, windowsHide: true });
  const task: TaskRecord = {
    id: taskId,
    requestId: data?.requestId,
    peerId: originPeerId,
    peerName: originName,
    command,
    cwd,
    status: 'running',
    output: '',
    errorOutput: '',
    startedAt: Date.now(),
    origin: 'local'
  };
  state.tasks.unshift(task);
  const timeout = setTimeout(() => {
    task.status = 'cancelled';
    child.kill();
  }, COMMAND_TIMEOUT_MS);
  runningTasks.set(taskId, { taskId, child, outputBytes: 0, timeout });

  function forward(stream: 'stdout' | 'stderr', chunk: Buffer) {
    const text = chunk.toString('utf8');
    appendTaskOutput(task, stream, text);
    sendControl(originPeerId, 'task.output', {
      requestId: data?.requestId,
      remoteTaskId: taskId,
      stream,
      chunk: text
    }).catch(() => {});
    emitState();
  }

  child.stdout.on('data', (chunk) => forward('stdout', chunk));
  child.stderr.on('data', (chunk) => forward('stderr', chunk));
  child.on('error', (err) => {
    clearTimeout(timeout);
    runningTasks.delete(taskId);
    task.status = 'failed';
    task.errorOutput = err?.message || String(err);
    task.endedAt = Date.now();
    logRuntimeError('task.child.error', err);
    saveState();
    emitState();
    sendControl(originPeerId, 'task.complete', {
      requestId: data?.requestId,
      remoteTaskId: taskId,
      exitCode: null,
      signal: null,
      status: task.status
    }).catch(() => {});
  });
  child.on('close', (code, signal) => {
    clearTimeout(timeout);
    runningTasks.delete(taskId);
    if (task.status !== 'cancelled') task.status = code === 0 ? 'completed' : 'failed';
    task.exitCode = code;
    task.signal = signal;
    task.endedAt = Date.now();
    saveState();
    emitState();
    sendControl(originPeerId, 'task.complete', {
      requestId: data?.requestId,
      remoteTaskId: taskId,
      exitCode: code,
      signal,
      status: task.status
    }).catch(() => {});
  });

  addAudit('task.run', command, originPeerId, state.device.id);
  saveState();
  emitState();
  return { remoteTaskId: taskId };
}

function cancelLocalTask(remoteTaskId: string) {
  const running = runningTasks.get(String(remoteTaskId || ''));
  if (!running) return false;
  running.child.kill();
  runningTasks.delete(running.taskId);
  return true;
}

function handleRemoteTaskOutput(peerId: string, data: any) {
  const task = state.tasks.find((item) => item.id === data?.requestId || item.remoteTaskId === data?.remoteTaskId);
  if (!task) return;
  if (!['completed', 'failed', 'cancelled'].includes(task.status)) task.status = 'running';
  if (data.stream === 'stderr') appendTaskOutput(task, 'stderr', String(data.chunk || ''));
  else appendTaskOutput(task, 'stdout', String(data.chunk || ''));
  saveState();
  emitState();
  sendLocalSse('task-output', { peerId, ...data });
}

function handleRemoteTaskComplete(peerId: string, data: any) {
  const task = state.tasks.find((item) => item.id === data?.requestId || item.remoteTaskId === data?.remoteTaskId);
  if (!task) return;
  task.status = data.status && data.status !== 'running'
    ? data.status
    : data.exitCode === 0 ? 'completed' : 'failed';
  task.exitCode = data.exitCode;
  task.signal = data.signal;
  task.endedAt = Date.now();
  saveState();
  emitState();
  sendLocalSse('task-complete', { peerId, ...data });
}

async function runRemoteCommand(peerIds: string[], command: string, cwd?: string) {
  const cleanCommand = String(command || '').trim();
  if (!cleanCommand) throw new Error('命令不能为空');
  const targetIds = peerIds.length
    ? peerIds
    : serializePeers().filter((peer) => peer.isOnline && peer.trusted && !peer.readOnly).map((peer) => peer.id);
  if (!targetIds.length) throw new Error('没有可用的目标设备');
  const taskIds: string[] = [];
  for (const peerId of targetIds) {
    assertPeerWritable(peerId);
    const peer = getTrustedPeer(peerId);
    const localTaskId = crypto.randomUUID();
    const task: TaskRecord = {
      id: localTaskId,
      peerId,
      peerName: peer.name,
      command: cleanCommand,
      cwd,
      status: 'pending',
      output: '',
      errorOutput: '',
      startedAt: Date.now(),
      origin: 'remote'
    };
    state.tasks.unshift(task);
    taskIds.push(localTaskId);
    saveState();
    emitState();
    try {
      const result = await sendControl<{ remoteTaskId: string }>(peerId, 'task.run', {
        requestId: localTaskId,
        command: cleanCommand,
        cwd
      });
      task.remoteTaskId = result.remoteTaskId;
      task.status = 'running';
    } catch (err: any) {
      task.status = 'failed';
      task.errorOutput = err?.message || String(err);
      task.endedAt = Date.now();
    }
    saveState();
    emitState();
  }
  return { taskIds };
}

function openLocalTerminal(originPeerId: string, originName: string, data: any) {
  const terminalId = crypto.randomUUID();
  const shell = defaultInteractiveShell();
  const child = spawn(shell.file, shell.args, { cwd: os.homedir(), windowsHide: true });
  terminalSessions.set(terminalId, { terminalId, ownerPeerId: originPeerId, child });
  const sendOutput = (stream: 'stdout' | 'stderr', chunk: Buffer) => {
    sendControl(originPeerId, 'terminal.output', {
      sessionId: data?.sessionId,
      terminalId,
      stream,
      chunk: chunk.toString('utf8')
    }).catch(() => {});
  };
  child.stdout.on('data', (chunk) => sendOutput('stdout', chunk));
  child.stderr.on('data', (chunk) => sendOutput('stderr', chunk));
  child.on('error', (err) => {
    terminalSessions.delete(terminalId);
    logRuntimeError('terminal.child.error', err);
    sendControl(originPeerId, 'terminal.output', {
      sessionId: data?.sessionId,
      terminalId,
      stream: 'stderr',
      chunk: err?.message || String(err)
    }).catch(() => {});
    sendControl(originPeerId, 'terminal.closed', {
      sessionId: data?.sessionId,
      terminalId,
      code: null,
      signal: null
    }).catch(() => {});
  });
  child.on('close', (code, signal) => {
    terminalSessions.delete(terminalId);
    sendControl(originPeerId, 'terminal.closed', {
      sessionId: data?.sessionId,
      terminalId,
      code,
      signal
    }).catch(() => {});
  });
  addAudit('terminal.open', `打开交互终端 ${terminalId}`, originPeerId, state.device.id);
  return { terminalId, shell: shell.file };
}

function writeLocalTerminal(terminalId: string, input: string) {
  const session = terminalSessions.get(String(terminalId || ''));
  if (!session) throw new Error('终端会话不存在');
  session.child.stdin.write(String(input || ''));
  return true;
}

function closeLocalTerminal(terminalId: string) {
  const session = terminalSessions.get(String(terminalId || ''));
  if (!session) return false;
  session.child.kill();
  terminalSessions.delete(terminalId);
  return true;
}

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

async function getNutRuntime() {
  if (!nutRuntime) {
    nutRuntime = Promise.all([
      import('@nut-tree-fork/nut-js'),
      import('@nut-tree-fork/shared')
    ]).then(([nut, shared]) => {
      nut.mouse.config.autoDelayMs = 0;
      nut.mouse.config.mouseSpeed = 9000;
      nut.keyboard.config.autoDelayMs = 0;
      return { ...nut, ...shared };
    });
  }
  return nutRuntime;
}

function screenBounds() {
  return electronScreen.getPrimaryDisplay().bounds;
}

async function inputScreenBounds() {
  try {
    const { screen } = await getNutRuntime();
    const width = Number(await screen.width());
    const height = Number(await screen.height());
    if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
      return { x: 0, y: 0, width, height };
    }
  } catch (error) {
    logRuntimeError('input-screen-bounds', error);
  }
  const bounds = screenBounds();
  return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
}

async function pointFromRemoteInput(input: Extract<RemoteInputEvent, { kind: 'pointer' }>) {
  const { Point } = await getNutRuntime();
  const bounds = await inputScreenBounds();
  const x = typeof input.x === 'number'
    ? input.x
    : bounds.x + clamp(Number(input.normalizedX ?? 0)) * bounds.width;
  const y = typeof input.y === 'number'
    ? input.y
    : bounds.y + clamp(Number(input.normalizedY ?? 0)) * bounds.height;
  return new Point(
    Math.round(Math.min(bounds.x + bounds.width - 1, Math.max(bounds.x, x))),
    Math.round(Math.min(bounds.y + bounds.height - 1, Math.max(bounds.y, y)))
  );
}

function buttonFromName(name: unknown, Button: any) {
  const value = String(name || 'left').toLowerCase();
  if (value === 'right') return Button.RIGHT;
  if (value === 'middle') return Button.MIDDLE;
  return Button.LEFT;
}

function keyFromName(name: unknown, Key: any) {
  const raw = String(name || '').trim();
  const clean = raw.toLowerCase().replace(/\s+/g, '').replace(/^arrow/, '');
  if (!clean) throw new Error('缺少按键');
  if (/^[a-z]$/.test(clean)) return Key[clean.toUpperCase()];
  if (/^[0-9]$/.test(clean)) return Key[`Num${clean}`];
  if (/^f([1-9]|1[0-9]|2[0-4])$/.test(clean)) return Key[clean.toUpperCase()];
  const aliases: Record<string, any> = {
    ctrl: Key.LeftControl,
    control: Key.LeftControl,
    shift: Key.LeftShift,
    alt: Key.LeftAlt,
    option: Key.LeftAlt,
    cmd: Key.LeftCmd,
    command: Key.LeftCmd,
    meta: process.platform === 'darwin' ? Key.LeftCmd : Key.LeftWin,
    win: Key.LeftWin,
    windows: Key.LeftWin,
    super: Key.LeftSuper,
    enter: Key.Return,
    return: Key.Return,
    escape: Key.Escape,
    esc: Key.Escape,
    tab: Key.Tab,
    space: Key.Space,
    backspace: Key.Backspace,
    delete: Key.Delete,
    del: Key.Delete,
    insert: Key.Insert,
    home: Key.Home,
    end: Key.End,
    pageup: Key.PageUp,
    pagedown: Key.PageDown,
    left: Key.Left,
    right: Key.Right,
    up: Key.Up,
    down: Key.Down,
    minus: Key.Minus,
    equal: Key.Equal,
    comma: Key.Comma,
    period: Key.Period,
    slash: Key.Slash,
    backslash: Key.Backslash,
    semicolon: Key.Semicolon,
    quote: Key.Quote,
    grave: Key.Grave
  };
  const key = aliases[clean];
  if (typeof key !== 'number') throw new Error(`暂不支持按键：${raw}`);
  return key;
}

async function applyPointerInput(input: RemoteInputEvent) {
  if (input.kind !== 'pointer') return true;
  const { mouse, Button } = await getNutRuntime();
  const button = buttonFromName(input.button, Button);
  const hasPosition = typeof input.x === 'number'
    || typeof input.y === 'number'
    || typeof input.normalizedX === 'number'
    || typeof input.normalizedY === 'number';
  if (hasPosition && input.action !== 'scroll') {
    await mouse.setPosition(await pointFromRemoteInput(input));
  }
  if (input.action === 'move') return true;
  if (input.action === 'down') return mouse.pressButton(button).then(() => true);
  if (input.action === 'up') return mouse.releaseButton(button).then(() => true);
  if (input.action === 'doubleClick') return mouse.doubleClick(button).then(() => true);
  if (input.action === 'scroll') {
    const deltaY = Number(input.deltaY || 0);
    const deltaX = Number(input.deltaX || 0);
    const amountY = Math.max(1, Math.min(10, Math.ceil(Math.abs(deltaY) / 80)));
    const amountX = Math.max(1, Math.min(10, Math.ceil(Math.abs(deltaX) / 80)));
    if (Math.abs(deltaY) >= Math.abs(deltaX)) {
      if (deltaY > 0) await mouse.scrollDown(amountY);
      if (deltaY < 0) await mouse.scrollUp(amountY);
    } else {
      if (deltaX > 0) await mouse.scrollRight(amountX);
      if (deltaX < 0) await mouse.scrollLeft(amountX);
    }
    return true;
  }
  return mouse.click(button).then(() => true);
}

async function applyKeyboardInput(input: RemoteInputEvent) {
  if (input.kind !== 'keyboard') return true;
  const { keyboard, Key } = await getNutRuntime();
  if (input.action === 'type') {
    const text = String(input.text || '');
    if (text) await keyboard.type(text);
    return true;
  }
  const keys = (Array.isArray(input.keys) && input.keys.length ? input.keys : [input.key])
    .filter(Boolean)
    .map((key) => keyFromName(key, Key));
  if (!keys.length) throw new Error('缺少按键');
  if (input.action === 'press') return keyboard.pressKey(...keys).then(() => true);
  if (input.action === 'release') return keyboard.releaseKey(...keys.reverse()).then(() => true);
  await keyboard.pressKey(...keys);
  await keyboard.releaseKey(...[...keys].reverse());
  return true;
}

function queueRemoteInput(input: RemoteInputEvent) {
  const next = remoteInputChain.then(async () => {
    if (input.kind === 'pointer') return applyPointerInput(input);
    return applyKeyboardInput(input);
  });
  remoteInputChain = next.catch(() => {});
  return next;
}

function openLocalRemoteSession(originPeerId: string, originName: string, data: any): RemoteOpenResult {
  const bounds = screenBounds();
  const sessionId = String(data?.sessionId || crypto.randomUUID());
  upsertRemoteSession(sessionId, {
    peerId: originPeerId,
    peerName: originName,
    mode: 'control',
    direction: 'incoming',
    status: 'streaming',
    width: bounds.width,
    height: bounds.height
  });
  addAudit('remote.open', `打开远程控制 ${sessionId}`, originPeerId, state.device.id);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('lch:remote-control', {
      peerId: originPeerId,
      peerName: originName,
      sessionId,
      active: true
    });
  }
  return {
    sessionId,
    platform: process.platform,
    width: bounds.width,
    height: bounds.height,
    permissions: {
      input: true,
      screen: true,
      clipboard: true
    }
  };
}

function closeLocalRemoteSession(originPeerId: string, data: any) {
  if (data?.sessionId) {
    upsertRemoteSession(String(data.sessionId), {
      peerId: originPeerId,
      mode: 'control',
      direction: 'incoming',
      status: 'closed'
    });
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('lch:remote-control', {
      peerId: originPeerId,
      sessionId: data?.sessionId,
      active: false
    });
    mainWindow.webContents.send('lch:screen-stop', {
      peerId: originPeerId,
      sessionId: data?.sessionId
    });
  }
  addAudit('remote.close', `关闭远程控制 ${data?.sessionId || ''}`, originPeerId, state.device.id);
  return true;
}

async function captureLocalScreenshot(): Promise<RemoteScreenshotResult> {
  const display = electronScreen.getPrimaryDisplay();
  const { width, height } = display.size;
  const maxWidth = Math.min(1920, width);
  const maxHeight = Math.max(1, Math.round(maxWidth * height / Math.max(1, width)));
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: maxWidth, height: Math.min(1200, maxHeight) }
  });
  const source = sources.find((item) => item.display_id === String(display.id)) || sources[0];
  if (!source || source.thumbnail.isEmpty()) {
    throw new Error('无法捕获屏幕截图。Windows 请确认 App 是在已登录的真实桌面中打开，不是仅通过 SSH/服务/headless 启动；macOS 请检查屏幕录制权限。');
  }
  const size = source.thumbnail.getSize();
  return {
    width: size.width,
    height: size.height,
    mime: 'image/png',
    base64: source.thumbnail.toPNG().toString('base64'),
    capturedAt: Date.now()
  };
}

function configureDisplayMediaHandler() {
  const defaultSession = session.defaultSession as any;
  if (typeof defaultSession.setDisplayMediaRequestHandler !== 'function') return;

  defaultSession.setDisplayMediaRequestHandler((_request: unknown, callback: (sources: { video?: unknown }) => void) => {
    desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1, height: 1 }
    }).then((sources) => {
      callback({ video: sources[0] });
    }).catch((err) => {
      logRuntimeError('displayMediaRequestHandler', err);
      callback({});
    });
  });
}

async function openRemoteControl(peerId: string) {
  assertPeerWritable(peerId);
  markDeviceOpened(peerId, 'control');
  const sessionId = crypto.randomUUID();
  upsertRemoteSession(sessionId, {
    peerId,
    mode: 'control',
    direction: 'outgoing',
    status: 'opening'
  });
  try {
    const result = await sendControl<RemoteOpenResult>(peerId, 'remote.open', { sessionId });
    upsertRemoteSession(sessionId, {
      peerId,
      mode: 'control',
      direction: 'outgoing',
      status: 'opening',
      width: result.width,
      height: result.height
    });
    return { ...result, sessionId };
  } catch (err: any) {
    upsertRemoteSession(sessionId, {
      peerId,
      mode: 'control',
      direction: 'outgoing',
      status: 'failed',
      error: err?.message || String(err)
    });
    throw err;
  }
}

function latestRemoteSession(peerId: string) {
  return serializeRemoteSessions().find((item) => item.peerId === peerId && !item.endedAt);
}

async function closeRemoteControl(peerId: string, sessionId?: string) {
  const targetSessionId = sessionId || latestRemoteSession(peerId)?.sessionId || '';
  if (targetSessionId) {
    upsertRemoteSession(targetSessionId, {
      peerId,
      mode: 'control',
      direction: 'outgoing',
      status: 'closed'
    });
  }
  if (targetSessionId) {
    const win = remoteSessionWindows.get(targetSessionId);
    remoteSessionWindows.delete(targetSessionId);
    if (win && !win.isDestroyed()) {
      remoteWindowClosingByMain.add(targetSessionId);
      win.close();
    }
  }
  await sendControl(peerId, 'remote.close', { sessionId: targetSessionId });
  if (targetSessionId) await sendControl(peerId, 'screen.stop', { sessionId: targetSessionId }).catch(() => {});
  return true;
}

async function sendRemoteInput(peerId: string, input: RemoteInputEvent) {
  assertPeerWritable(peerId);
  const type = input.kind === 'pointer' ? 'remote.pointer' : 'remote.keyboard';
  return sendControl(peerId, type, input, 8000);
}

async function remoteScreenshot(peerId: string, sessionId?: string) {
  const result = await sendControl<RemoteScreenshotResult>(peerId, 'remote.screenshot.request', {}, 20000);
  const targetSessionId = sessionId || latestRemoteSession(peerId)?.sessionId;
  if (targetSessionId) {
    upsertRemoteSession(targetSessionId, {
      peerId,
      mode: remoteSessions.get(targetSessionId)?.mode || 'view',
      direction: remoteSessions.get(targetSessionId)?.direction || 'outgoing',
      status: 'snapshot',
      width: result.width,
      height: result.height
    });
  }
  return { ...result, peerId };
}

async function remoteClipboard(peerId: string, action: string, text?: string) {
  if (action === 'write') {
    assertPeerWritable(peerId);
    return sendControl(peerId, 'remote.clipboard.write', { text: String(text || '') });
  }
  return sendControl(peerId, 'remote.clipboard.read', {});
}

function uniqueDownloadPath(fileName: string) {
  const folder = path.join(app.getPath('downloads'), DOWNLOAD_FOLDER_NAME);
  fs.mkdirSync(folder, { recursive: true });
  return path.join(folder, `${Date.now()}-${path.basename(String(fileName || 'received-file'))}`);
}

function receiveFile(peerId: string, peerName: string, file: any) {
  const name = path.basename(String(file?.name || 'received-file'));
  const base64 = String(file?.base64 || '');
  const size = Number(file?.size || 0);
  if (!name || !base64 || size > MAX_FILE_BYTES) throw new Error('文件无效或过大');
  const buffer = Buffer.from(base64, 'base64');
  const filePath = uniqueDownloadPath(name);
  fs.writeFileSync(filePath, buffer);
  addConversationEvent(peerId, {
    direction: 'incoming',
    type: 'file',
    name,
    size: buffer.length,
    path: filePath,
    senderName: peerName
  });
  addAudit('file.receive', name, peerId, state.device.id);
  return { ok: true, data: { filePath } };
}

type ShareRoot = {
  id: string;
  name: string;
  path: string;
  writable: boolean;
};

const DEFAULT_SHARE_ROOTS: Array<{ id: string; name: string; appPath: Parameters<typeof app.getPath>[0] }> = [
  { id: 'Desktop', name: '桌面', appPath: 'desktop' },
  { id: 'Downloads', name: '下载', appPath: 'downloads' },
  { id: 'Documents', name: '文档', appPath: 'documents' },
  { id: 'Pictures', name: '图片', appPath: 'pictures' },
  { id: 'Videos', name: '视频', appPath: 'videos' },
  { id: 'Music', name: '音乐', appPath: 'music' }
];

function existingShareRoots() {
  if (!state.fileShareEnabled) return [];
  const seen = new Set<string>();
  const roots: ShareRoot[] = [];
  function addRoot(root: ShareRoot) {
    const resolved = path.resolve(root.path);
    if (seen.has(resolved)) return;
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) return;
    seen.add(resolved);
    roots.push({ ...root, path: resolved });
  }
  for (const item of DEFAULT_SHARE_ROOTS) {
    try {
      addRoot({
        id: item.id,
        name: item.name,
        path: app.getPath(item.appPath),
        writable: true
      });
    } catch {
      // Some platforms may not expose every special folder.
    }
  }
  if (state.sharedFolder) {
    addRoot({
      id: 'Shared',
      name: `自选共享：${path.basename(state.sharedFolder) || '共享目录'}`,
      path: state.sharedFolder,
      writable: true
    });
  }
  return roots;
}

function cleanSharedPath(relativePath = '') {
  return String(relativePath || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .join('/');
}

function displaySharedPath(root: ShareRoot, relative = '') {
  return relative ? `${root.name}/${relative}` : root.name;
}

function resolveSharedPath(relativePath = '') {
  const cleanRelative = cleanSharedPath(relativePath);
  if (!cleanRelative) throw new Error('请先进入一个文件库目录');
  const [rootId, ...parts] = cleanRelative.split('/');
  const root = existingShareRoots().find((item) => item.id === rootId);
  if (!root) throw new Error('共享目录不可用或未授权');
  const target = path.resolve(root.path, ...parts);
  const escaped = path.relative(root.path, target);
  if (escaped.startsWith('..') || path.isAbsolute(escaped)) throw new Error('路径超出共享目录范围');
  const relative = parts.join('/');
  const currentPath = [root.id, ...parts].join('/');
  return { root, target, relative, currentPath };
}

function listSharedFolder(relativePath = ''): SharedFolderListing {
  if (!state.fileShareEnabled) throw new Error('对方已关闭文件库共享');
  const cleanRelative = cleanSharedPath(relativePath);
  if (!cleanRelative) {
    const entries = existingShareRoots()
      .map((root) => ({
        name: root.name,
        relativePath: root.id,
        type: 'directory' as const,
        size: 0,
        modifiedAt: fs.statSync(root.path).mtimeMs,
        writable: root.writable
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return {
      currentPath: '',
      displayPath: '文件库',
      writable: false,
      entries
    };
  }

  const { root, target, relative, currentPath } = resolveSharedPath(cleanRelative);
  const stat = fs.statSync(target);
  if (!stat.isDirectory()) throw new Error('目标不是文件夹');
  const entries = fs.readdirSync(target, { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith('.'))
    .map((entry) => {
      const itemPath = path.join(target, entry.name);
      const itemStat = fs.statSync(itemPath);
      const itemRelative = [root.id, relative, entry.name].filter(Boolean).join('/');
      return {
        name: entry.name,
        relativePath: itemRelative,
        type: entry.isDirectory() ? 'directory' as const : 'file' as const,
        size: entry.isDirectory() ? 0 : itemStat.size,
        modifiedAt: itemStat.mtimeMs,
        writable: root.writable
      };
    })
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  return {
    currentPath,
    displayPath: displaySharedPath(root, relative),
    rootName: root.name,
    writable: root.writable,
    entries
  };
}

function readSharedFile(relativePath = '') {
  const { target, currentPath } = resolveSharedPath(relativePath);
  const stat = fs.statSync(target);
  if (!stat.isFile()) throw new Error('目标不是文件');
  if (stat.size > MAX_FILE_BYTES) throw new Error('文件过大');
  return {
    name: path.basename(target),
    relativePath: currentPath,
    size: stat.size,
    base64: fs.readFileSync(target).toString('base64')
  };
}

function uniqueFilePathInDirectory(directory: string, fileName: string) {
  const parsed = path.parse(path.basename(fileName || 'received-file'));
  let candidate = path.join(directory, `${parsed.name}${parsed.ext}`);
  let index = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(directory, `${parsed.name}-${index}${parsed.ext}`);
    index += 1;
  }
  return candidate;
}

function uploadSharedFile(peerId: string, peerName: string, data: any) {
  const { target, currentPath } = resolveSharedPath(data?.relativePath || '');
  const stat = fs.statSync(target);
  if (!stat.isDirectory()) throw new Error('只能上传到文件夹');
  const name = path.basename(String(data?.file?.name || 'received-file'));
  const base64 = String(data?.file?.base64 || '');
  const size = Number(data?.file?.size || 0);
  if (!name || !base64 || size > MAX_FILE_BYTES) throw new Error('文件无效或过大');
  const buffer = Buffer.from(base64, 'base64');
  const filePath = uniqueFilePathInDirectory(target, name);
  fs.writeFileSync(filePath, buffer);
  addAudit('file.uploadShared', `${peerName} 上传 ${name}`, peerId, state.device.id);
  return {
    name: path.basename(filePath),
    relativePath: [currentPath, path.basename(filePath)].filter(Boolean).join('/'),
    size: buffer.length,
    path: filePath
  };
}

function startWebServer() {
  return new Promise<void>((resolve, reject) => {
    function listen(port: number) {
      const server = http.createServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(`${APP_NAME} running on ${os.hostname()}\n`);
      });
      server.once('error', (err: any) => {
        if (err.code === 'EADDRINUSE' && port < DEFAULT_WEB_PORT + 30) {
          listen(port + 1);
          return;
        }
        reject(err);
      });
      server.once('listening', () => {
        webPort = port;
        webServer = server;
        resolve();
      });
      server.listen(port, '0.0.0.0');
    }
    listen(webPort);
  });
}

function readJsonBody(req: http.IncomingMessage) {
  return new Promise<any>((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk.toString('utf8');
      if (raw.length > 50 * 1024 * 1024) req.destroy(new Error('Body too large'));
    });
    req.on('end', () => {
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function handleLocalApi(pathname: string, method: string, body: any) {
  if (method === 'POST' && pathname === '/api/setup/create') return createHome(body.name);
  if (method === 'POST' && pathname === '/api/setup/join') return joinHome(body.secret, body.name);
  if (method === 'GET' && pathname === '/api/state') return appStateView();
  if (method === 'GET' && pathname === '/api/firewall/status') return getFirewallStatus();
  if (method === 'POST' && pathname === '/api/firewall/repair') return repairFirewallRules(body.elevated !== false);
  if (method === 'GET' && pathname === '/api/devices') return serializePeers();
  if (method === 'POST' && pathname === '/api/devices/preference') return updateDevicePreference(body.peerId, body.preference || body.patch || {});
  if (method === 'POST' && pathname === '/api/devices/trust') return trustDevice(body.peerId);
  if (method === 'POST' && pathname === '/api/devices/revoke') return revokeTrustedDevice(body.peerId);
  if (method === 'POST' && pathname === '/api/settings/file-sharing') return setFileSharing(body.enabled !== false);
  if (method === 'POST' && pathname === '/api/settings/auto-trust') return setAutoTrustDevices(body.enabled !== false);
  if (method === 'GET' && pathname === '/api/tasks') return state.tasks.slice(0, 200);
  if (method === 'POST' && pathname === '/api/run') {
    const peerIds = body.all ? [] : (Array.isArray(body.peerIds) ? body.peerIds : []);
    return runRemoteCommand(peerIds, body.command, body.cwd);
  }
  if (method === 'POST' && pathname === '/api/terminal/open') {
    return openRemoteTerminal(body.peerId);
  }
  if (method === 'POST' && pathname === '/api/terminal/input') {
    assertPeerWritable(body.peerId);
    await sendControl(body.peerId, 'terminal.input', {
      terminalId: body.terminalId,
      input: body.input
    });
    return true;
  }
  if (method === 'POST' && pathname === '/api/terminal/close') {
    await sendControl(body.peerId, 'terminal.close', { terminalId: body.terminalId });
    return true;
  }
  if (method === 'POST' && pathname === '/api/remote/open') {
    if (body.window || body.openWindow) return openRemoteControlWindow(body.peerId, body.mode || 'control');
    return openRemoteControl(body.peerId);
  }
  if (method === 'POST' && pathname === '/api/remote/close') {
    return closeRemoteControl(body.peerId, body.sessionId);
  }
  if (method === 'GET' && pathname === '/api/remote/sessions') {
    return serializeRemoteSessions();
  }
  if (method === 'POST' && pathname === '/api/remote/input') {
    return sendRemoteInput(body.peerId, body.input);
  }
  if (method === 'POST' && pathname === '/api/remote/screenshot') {
    return remoteScreenshot(body.peerId, body.sessionId);
  }
  if (method === 'POST' && pathname === '/api/observe') {
    return remoteScreenshot(body.peerId, body.sessionId);
  }
  if (method === 'POST' && pathname === '/api/clipboard') {
    return remoteClipboard(body.peerId, body.action, body.text);
  }
  if (method === 'POST' && pathname === '/api/chat/send') {
    const text = String(body.text || '').trim();
    if (!text) throw new Error('消息不能为空');
    await sendControl(body.peerId, 'chat.send', { text });
    addConversationEvent(body.peerId, {
      direction: 'outgoing',
      type: 'text',
      text,
      senderName: state.device.name
    });
    return true;
  }
  if (method === 'POST' && pathname === '/api/files/list') {
    return sendControl(body.peerId, 'file.listShared', { relativePath: body.relativePath || '' });
  }
  if (method === 'POST' && pathname === '/api/files/get') {
    return sendControl(body.peerId, 'file.downloadShared', { relativePath: body.relativePath || '' }, 60000);
  }
  if (method === 'POST' && pathname === '/api/files/send') {
    assertPeerWritable(body.peerId);
    if (!body.name || !body.base64) throw new Error('文件无效');
    if (Number(body.size || 0) > MAX_FILE_BYTES) throw new Error('文件过大');
    await sendControl(body.peerId, 'file.send', {
      name: path.basename(String(body.name)),
      size: Number(body.size || 0),
      base64: String(body.base64)
    }, 60000);
    addConversationEvent(body.peerId, {
      direction: 'outgoing',
      type: 'file',
      name: path.basename(String(body.name)),
      size: Number(body.size || 0),
      senderName: state.device.name
    });
    return true;
  }
  if (method === 'POST' && pathname === '/api/files/put') {
    assertPeerWritable(body.peerId);
    if (!body.name || !body.base64) throw new Error('文件无效');
    if (Number(body.size || 0) > MAX_FILE_BYTES) throw new Error('文件过大');
    return sendControl(body.peerId, 'file.uploadShared', {
      relativePath: body.relativePath || '',
      file: {
        name: path.basename(String(body.name)),
        size: Number(body.size || 0),
        base64: String(body.base64)
      }
    }, 60000);
  }
  throw new Error('Unknown Local API route');
}

function startLocalApiServer() {
  return new Promise<void>((resolve, reject) => {
    function listen(port: number) {
      const server = http.createServer(async (req, res) => {
        try {
          if (req.url?.startsWith('/api/events')) {
            if (!authorizeLocal(req)) throw new Error('Unauthorized');
            res.writeHead(200, {
              'Content-Type': 'text/event-stream; charset=utf-8',
              'Cache-Control': 'no-cache',
              Connection: 'keep-alive'
            });
            localSseClients.add(res);
            res.write(`event: state\ndata: ${JSON.stringify(appStateView())}\n\n`);
            req.on('close', () => localSseClients.delete(res));
            return;
          }
          if (!authorizeLocal(req)) {
            sendJson(res, 401, { ok: false, error: 'Unauthorized' });
            return;
          }
          const url = new URL(req.url || '/', `http://127.0.0.1:${port}`);
          const body = req.method === 'GET' ? {} : await readJsonBody(req);
          const data = await handleLocalApi(url.pathname, req.method || 'GET', body);
          sendJson(res, 200, { ok: true, data });
        } catch (err: any) {
          sendJson(res, 400, { ok: false, error: err?.message || String(err) });
        }
      });
      server.once('error', (err: any) => {
        if (err.code === 'EADDRINUSE' && port < DEFAULT_LOCAL_API_PORT + 30) {
          listen(port + 1);
          return;
        }
        reject(err);
      });
      server.once('listening', () => {
        localApiPort = port;
        localApiServer = server;
        writeLocalApiConfig();
        resolve();
      });
      server.listen(port, '127.0.0.1');
    }
    listen(localApiPort);
  });
}

function authorizeLocal(req: http.IncomingMessage) {
  const expected = `Bearer ${state.localApiToken}`;
  return req.headers.authorization === expected;
}

async function openRemoteTerminal(peerId: string) {
  assertPeerWritable(peerId);
  markDeviceOpened(peerId, 'open');
  const sessionId = crypto.randomUUID();
  const result = await sendControl<{ terminalId: string; shell: string }>(peerId, 'terminal.open', { sessionId });
  return { sessionId, ...result };
}

function loadRendererWindow(win: BrowserWindow, query: Record<string, string> = {}) {
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) {
    const url = new URL(devUrl);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    win.loadURL(url.toString());
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'), { query });
  }
}

async function openRemoteControlWindow(peerId: string, modeValue: RemoteSessionMode = 'control') {
  const mode: RemoteSessionMode = modeValue === 'view' ? 'view' : 'control';
  const peerName = peerDisplayName(peerId);
  let sessionId: string = crypto.randomUUID();
  let remoteInfo: RemoteOpenResult | undefined;

  if (mode === 'control') {
    remoteInfo = await openRemoteControl(peerId);
    sessionId = remoteInfo.sessionId;
  } else {
    markDeviceOpened(peerId, 'open');
    upsertRemoteSession(sessionId, {
      peerId,
      peerName,
      mode,
      direction: 'outgoing',
      status: 'opening'
    });
  }

  const existingCount = remoteSessionWindows.size;
  const primary = electronScreen.getPrimaryDisplay().workArea;
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 860,
    minHeight: 580,
    x: primary.x + 28 + existingCount * 24,
    y: primary.y + 28 + existingCount * 24,
    title: `${peerName} - ${mode === 'control' ? '远程控制' : '实时看屏'}`,
    icon: path.join(__dirname, '../../build/icon.png'),
    autoHideMenuBar: true,
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.setMenuBarVisibility(false);
  remoteSessionWindows.set(sessionId, win);
  upsertRemoteSession(sessionId, {
    peerId,
    peerName,
    mode,
    direction: 'outgoing',
    status: 'opening',
    width: remoteInfo?.width,
    height: remoteInfo?.height,
    windowId: win.id
  });

  win.on('closed', () => {
    remoteSessionWindows.delete(sessionId);
    const commandedClose = remoteWindowClosingByMain.delete(sessionId);
    upsertRemoteSession(sessionId, {
      peerId,
      peerName,
      mode,
      direction: 'outgoing',
      status: 'closed'
    });
    if (!commandedClose) {
      if (mode === 'control') sendControl(peerId, 'remote.close', { sessionId }).catch(() => {});
      sendControl(peerId, 'screen.stop', { sessionId }).catch(() => {});
    }
  });

  loadRendererWindow(win, {
    window: 'remote',
    peerId,
    peerName,
    sessionId,
    mode
  });

  return {
    peerId,
    peerName,
    sessionId,
    mode,
    windowId: win.id,
    ...(remoteInfo || {})
  };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 820,
    minWidth: 1040,
    minHeight: 640,
    title: APP_NAME,
    icon: path.join(__dirname, '../../build/icon.png'),
    autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0f172a' : '#f5f7fb',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.setMenuBarVisibility(false);
  loadRendererWindow(mainWindow);
  mainWindow.webContents.on('did-finish-load', emitState);
}

function registerIpc() {
  ipcMain.handle('lch:get-state', () => appStateView());
  ipcMain.handle('lch:get-remote-sessions', () => serializeRemoteSessions());
  ipcMain.handle('lch:get-firewall-status', () => getFirewallStatus());
  ipcMain.handle('lch:repair-firewall', (_event, elevated) => repairFirewallRules(elevated !== false));
  ipcMain.handle('lch:create-home', (_event, name) => createHome(name));
  ipcMain.handle('lch:join-home', (_event, secret, name) => joinHome(secret, name));
  ipcMain.handle('lch:update-name', (_event, name) => {
    const cleanName = String(name || '').trim().slice(0, 40);
    if (!cleanName) throw new Error('设备名不能为空');
    state.device.name = cleanName;
    trustSelf();
    saveState();
    broadcastPresence();
    emitState();
    return appStateView();
  });
  ipcMain.handle('lch:update-device-preference', (_event, peerId, patch) => updateDevicePreference(peerId, patch || {}));
  ipcMain.handle('lch:set-file-sharing', (_event, enabled) => setFileSharing(Boolean(enabled)));
  ipcMain.handle('lch:set-auto-trust', (_event, enabled) => setAutoTrustDevices(Boolean(enabled)));
  ipcMain.handle('lch:trust-device', (_event, peerId) => trustDevice(peerId));
  ipcMain.handle('lch:revoke-device', (_event, peerId) => revokeTrustedDevice(peerId));
  ipcMain.handle('lch:choose-shared-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: '选择共享目录',
      properties: ['openDirectory']
    });
    if (!result.canceled && result.filePaths[0]) {
      state.sharedFolder = result.filePaths[0];
      saveState();
      emitState();
    }
    return appStateView();
  });
  ipcMain.handle('lch:clear-shared-folder', () => {
    state.sharedFolder = '';
    saveState();
    emitState();
    return appStateView();
  });
  ipcMain.handle('lch:send-text', async (_event, peerId, text) => {
    const cleanText = String(text || '').trim();
    if (!cleanText) return appStateView();
    await sendControl(peerId, 'chat.send', { text: cleanText });
    addConversationEvent(peerId, {
      direction: 'outgoing',
      type: 'text',
      text: cleanText,
      senderName: state.device.name
    });
    return appStateView();
  });
  ipcMain.handle('lch:send-file', async (_event, peerId, file) => {
    assertPeerWritable(peerId);
    if (!file?.name || !file?.base64) throw new Error('文件无效');
    if (Number(file.size || 0) > MAX_FILE_BYTES) throw new Error('文件过大');
    await sendControl(peerId, 'file.send', {
      name: path.basename(String(file.name)),
      size: Number(file.size || 0),
      base64: String(file.base64)
    }, 60000);
    addConversationEvent(peerId, {
      direction: 'outgoing',
      type: 'file',
      name: path.basename(String(file.name)),
      size: Number(file.size || 0),
      senderName: state.device.name
    });
    return appStateView();
  });
  ipcMain.handle('lch:list-shared-files', (_event, peerId, relativePath) => (
    sendControl(peerId, 'file.listShared', { relativePath })
  ));
  ipcMain.handle('lch:download-shared-file', async (_event, peerId, relativePath) => {
    const remoteFile = await sendControl<any>(peerId, 'file.downloadShared', { relativePath }, 60000);
    const fileName = path.basename(String(remoteFile.name || 'download'));
    const filePath = uniqueDownloadPath(fileName);
    fs.writeFileSync(filePath, Buffer.from(String(remoteFile.base64 || ''), 'base64'));
    addConversationEvent(peerId, {
      direction: 'incoming',
      type: 'file',
      name: fileName,
      size: Number(remoteFile.size || 0),
      path: filePath,
      senderName: state.trustedDevices[peerId]?.name || '远程设备'
    });
    return { filePath };
  });
  ipcMain.handle('lch:upload-shared-file', async (_event, peerId, relativePath, file) => {
    assertPeerWritable(peerId);
    if (!file?.name || !file?.base64) throw new Error('文件无效');
    if (Number(file.size || 0) > MAX_FILE_BYTES) throw new Error('文件过大');
    return sendControl(peerId, 'file.uploadShared', {
      relativePath,
      file: {
        name: path.basename(String(file.name)),
        size: Number(file.size || 0),
        base64: String(file.base64)
      }
    }, 60000);
  });
  ipcMain.handle('lch:run-command', (_event, peerIds, command, cwd) => runRemoteCommand(peerIds || [], command, cwd));
  ipcMain.handle('lch:open-terminal', (_event, peerId) => openRemoteTerminal(peerId));
  ipcMain.handle('lch:terminal-input', (_event, peerId, terminalId, input) => sendControl(peerId, 'terminal.input', { terminalId, input }));
  ipcMain.handle('lch:terminal-close', (_event, peerId, terminalId) => sendControl(peerId, 'terminal.close', { terminalId }));
  ipcMain.handle('lch:screen-request', (_event, peerId, sessionId) => {
    markDeviceOpened(peerId, 'open');
    upsertRemoteSession(String(sessionId), {
      peerId,
      mode: remoteSessions.get(String(sessionId))?.mode || 'view',
      direction: 'outgoing',
      status: 'opening'
    });
    return sendControl(peerId, 'screen.request', { sessionId });
  });
  ipcMain.handle('lch:screen-signal', (_event, peerId, sessionId, signal) => sendControl(peerId, 'screen.signal', { sessionId, signal }));
  ipcMain.handle('lch:screen-stop', (_event, peerId, sessionId) => {
    if (sessionId) {
      upsertRemoteSession(String(sessionId), {
        peerId,
        mode: remoteSessions.get(String(sessionId))?.mode || 'view',
        direction: remoteSessions.get(String(sessionId))?.direction || 'outgoing',
        status: 'closed'
      });
    }
    return sendControl(peerId, 'screen.stop', { sessionId });
  });
  ipcMain.handle('lch:remote-open', (_event, peerId) => openRemoteControl(peerId));
  ipcMain.handle('lch:remote-window-open', (_event, peerId, mode) => openRemoteControlWindow(peerId, mode || 'control'));
  ipcMain.handle('lch:remote-session-update', (_event, sessionId, patch) => {
    const existing = remoteSessions.get(String(sessionId));
    if (!existing) return null;
    return upsertRemoteSession(String(sessionId), {
      ...patch,
      peerId: existing.peerId,
      mode: patch?.mode || existing.mode,
      direction: patch?.direction || existing.direction
    });
  });
  ipcMain.handle('lch:remote-input', (_event, peerId, input) => sendRemoteInput(peerId, input));
  ipcMain.handle('lch:remote-close', (_event, peerId, sessionId) => closeRemoteControl(peerId, sessionId));
  ipcMain.handle('lch:remote-screenshot', (_event, peerId, sessionId) => remoteScreenshot(peerId, sessionId));
  ipcMain.handle('lch:remote-clipboard-read', (_event, peerId) => remoteClipboard(peerId, 'read'));
  ipcMain.handle('lch:remote-clipboard-write', (_event, peerId, text) => remoteClipboard(peerId, 'write', text));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    configureDisplayMediaHandler();
    state = loadState();
    trustSelf();
    saveState();
    registerIpc();
    await startControlServer();
    await startWebServer();
    await startLocalApiServer();
    scheduleWindowsFirewallRefresh();
    startDiscovery();
    if (!HEADLESS) createWindow();
    app.on('activate', () => {
      if (!HEADLESS && BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  }).catch((err) => {
    dialog.showErrorBox(APP_NAME, err?.message || String(err));
    app.quit();
  });

  app.on('window-all-closed', () => {
    if (!HEADLESS && process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    if (discoveryTimer) clearInterval(discoveryTimer);
    if (pruneTimer) clearInterval(pruneTimer);
    for (const task of runningTasks.values()) task.child.kill();
    for (const session of terminalSessions.values()) session.child.kill();
    discoverySocket?.close();
    controlWss?.close();
    webServer?.close();
    localApiServer?.close();
  });
}
