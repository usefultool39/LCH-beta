import crypto from 'node:crypto';
import {
  DEFAULT_WEB_PORT,
  DEFAULT_WEBRTC_CONFIG,
  MAX_AUDIT_EVENTS,
  MAX_CONVERSATION_EVENTS,
  MAX_TRANSFER_RECORDS,
  STATE_SCHEMA_VERSION,
  type BlockedDevice,
  type DevicePreference,
  type HomeInfo,
  type ManualPeerAddress,
  type TaskRecord,
  type TransferRecord,
  type TrustedDevice,
  type WebRtcConfig,
  type WebRtcIceServer,
  type WebRtcIceTransportPolicy
} from './protocol';

export type PersistedDeviceIdentity = {
  id: string;
  name: string;
  platform: NodeJS.Platform;
  publicKey: string;
  privateKey: string;
  publicKeyHash: string;
};

export type PersistedAppState = {
  stateVersion: number;
  home: HomeInfo | null;
  device: PersistedDeviceIdentity;
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
  manualPeerAddresses: ManualPeerAddress[];
  transfers: TransferRecord[];
  webrtc: WebRtcConfig;
};

type MigrationOptions = {
  publicKeyHash?: (publicKey: string) => string;
  normalizeManualPeerAddresses?: (values: any[]) => ManualPeerAddress[];
};

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function defaultPublicKeyHash(publicKey: string) {
  return crypto.createHash('sha256').update(publicKey).digest('hex').slice(0, 16);
}

function cloneWebRtcConfig(config: WebRtcConfig = DEFAULT_WEBRTC_CONFIG): WebRtcConfig {
  return {
    iceServers: config.iceServers.map((server) => ({
      urls: [...server.urls],
      username: server.username,
      credential: server.credential
    })),
    iceTransportPolicy: config.iceTransportPolicy
  };
}

function normalizeIceUrls(value: unknown) {
  const rawUrls = Array.isArray(value) ? value : [value];
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const item of rawUrls) {
    for (const raw of String(item || '').split(/[\s,]+/)) {
      const url = raw.trim();
      if (!/^(stun|stuns|turn|turns):/i.test(url) || seen.has(url)) continue;
      seen.add(url);
      urls.push(url.slice(0, 500));
      if (urls.length >= 8) return urls;
    }
  }
  return urls;
}

function normalizeIceServer(value: unknown): WebRtcIceServer | null {
  if (!isRecord(value)) return null;
  const urls = normalizeIceUrls(value.urls ?? value.url);
  if (!urls.length) return null;
  const username = value.username ? String(value.username).slice(0, 200) : '';
  const credential = value.credential ? String(value.credential).slice(0, 500) : '';
  return {
    urls,
    ...(username ? { username } : {}),
    ...(credential ? { credential } : {})
  };
}

export function normalizeWebRtcConfig(value: unknown, defaults: WebRtcConfig = DEFAULT_WEBRTC_CONFIG): WebRtcConfig {
  if (!isRecord(value)) return cloneWebRtcConfig(defaults);
  const defaultPolicy: WebRtcIceTransportPolicy = defaults.iceTransportPolicy === 'relay' ? 'relay' : 'all';
  const iceTransportPolicy: WebRtcIceTransportPolicy = value.iceTransportPolicy === 'relay' ? 'relay' : defaultPolicy;
  const iceServers = (Array.isArray(value.iceServers) ? value.iceServers : [])
    .map(normalizeIceServer)
    .filter((server): server is WebRtcIceServer => Boolean(server))
    .slice(0, 20);
  return { iceServers, iceTransportPolicy };
}

function normalizeManualPeerAddress(value: any): ManualPeerAddress | null {
  const raw = typeof value === 'string' ? value : String(value?.address || value?.label || '');
  try {
    const withScheme = /^https?:\/\//i.test(raw.trim()) ? raw.trim() : `http://${raw.trim()}`;
    const parsed = new URL(withScheme);
    if (parsed.protocol !== 'http:') return null;
    const port = parsed.port ? Number(parsed.port) : DEFAULT_WEB_PORT;
    if (!Number.isSafeInteger(port) || port <= 0 || port > 65535) return null;
    const label = `${parsed.hostname}:${port}`;
    const existing = isRecord(value) ? value : {};
    return {
      address: label,
      host: parsed.hostname,
      port,
      label,
      status: ['unknown', 'online', 'offline', 'home-mismatch', 'invalid', 'self'].includes(existing.status)
        ? existing.status
        : 'unknown',
      lastCheckedAt: existing.lastCheckedAt ? Number(existing.lastCheckedAt) : undefined,
      lastSeenAt: existing.lastSeenAt ? Number(existing.lastSeenAt) : undefined,
      lastError: existing.lastError ? String(existing.lastError) : undefined,
      peerId: existing.peerId ? String(existing.peerId) : undefined,
      peerName: existing.peerName ? String(existing.peerName) : undefined
    };
  } catch {
    return null;
  }
}

export function normalizeManualPeerAddresses(values: any[] = []) {
  const seen = new Set<string>();
  const output: ManualPeerAddress[] = [];
  for (const item of values) {
    const normalized = normalizeManualPeerAddress(item);
    if (!normalized || seen.has(normalized.address)) continue;
    seen.add(normalized.address);
    output.push(normalized);
  }
  return output.slice(-100);
}

export function normalizeTransferRecords(records: any[] = []) {
  return records
    .filter((record) => record?.id && record?.peerId && record?.name)
    .map((record) => ({
      id: String(record.id),
      direction: record.direction === 'upload' ? 'upload' as const : 'download' as const,
      peerId: String(record.peerId),
      peerName: String(record.peerName || record.peerId),
      name: String(record.name),
      relativePath: record.relativePath ? String(record.relativePath) : undefined,
      targetPath: record.targetPath ? String(record.targetPath) : undefined,
      localPath: record.localPath ? String(record.localPath) : undefined,
      size: Number(record.size || 0),
      transferredBytes: Number(record.transferredBytes || 0),
      status: ['queued', 'running', 'completed', 'failed', 'cancelled'].includes(record.status) ? record.status : 'failed',
      startedAt: Number(record.startedAt || Date.now()),
      updatedAt: Number(record.updatedAt || Date.now()),
      endedAt: record.endedAt ? Number(record.endedAt) : undefined,
      speedBytesPerSecond: record.speedBytesPerSecond ? Number(record.speedBytesPerSecond) : undefined,
      sha256: record.sha256 ? String(record.sha256) : undefined,
      error: record.error ? String(record.error) : undefined
    }))
    .slice(0, MAX_TRANSFER_RECORDS);
}

export function normalizeTaskRecords(tasks: TaskRecord[] = []) {
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

function normalizeConversationReply(value: unknown) {
  if (!isRecord(value) || !value.id) return undefined;
  const type = value.type === 'file' ? 'file' as const : 'text' as const;
  return {
    id: String(value.id),
    type,
    senderName: value.senderName ? String(value.senderName).slice(0, 80) : undefined,
    text: value.text ? String(value.text).slice(0, 240) : undefined,
    name: value.name ? String(value.name).slice(0, 180) : undefined,
    createdAt: value.createdAt ? Number(value.createdAt) : undefined
  };
}

function normalizeConversationReactions(value: unknown) {
  if (!isRecord(value)) return undefined;
  const output: Record<string, string[]> = {};
  for (const [emoji, actors] of Object.entries(value)) {
    if (!Array.isArray(actors) || !emoji.trim()) continue;
    const uniqueActors = Array.from(new Set(actors.map((actor) => String(actor || '').trim()).filter(Boolean))).slice(0, 200);
    if (uniqueActors.length) output[emoji.slice(0, 16)] = uniqueActors;
  }
  return Object.keys(output).length ? output : undefined;
}

export function normalizeConversations(conversations: unknown) {
  if (!isRecord(conversations)) return {};
  const output: Record<string, any[]> = {};
  for (const [peerId, events] of Object.entries(conversations)) {
    if (!Array.isArray(events)) continue;
    output[peerId] = events
      .filter((event) => isRecord(event))
      .map((event, index) => {
        const createdAt = Number(event.createdAt || Date.now());
        return {
          ...event,
          id: String(event.id || `${peerId}:${createdAt}:${index}`),
          peerId: String(event.peerId || peerId),
          direction: event.direction === 'outgoing' ? 'outgoing' : 'incoming',
          type: event.type === 'file' ? 'file' : 'text',
          createdAt,
          markdown: event.markdown === true ? true : undefined,
          replyTo: normalizeConversationReply(event.replyTo),
          reactions: normalizeConversationReactions(event.reactions),
          editedAt: event.editedAt ? Number(event.editedAt) : undefined,
          deletedAt: event.deletedAt ? Number(event.deletedAt) : undefined
        };
      })
      .slice(-MAX_CONVERSATION_EVENTS);
  }
  return output;
}

export function migrateState(raw: unknown, defaults: PersistedAppState, options: MigrationOptions = {}): PersistedAppState {
  const parsed = isRecord(raw) ? raw : {};
  const device = isRecord(parsed.device) ? parsed.device : {};
  if (!device.id || !device.privateKey) return defaults;

  const publicKey = String(device.publicKey || '');
  const publicKeyHash = options.publicKeyHash || defaultPublicKeyHash;
  const manualPeerNormalizer = options.normalizeManualPeerAddresses || normalizeManualPeerAddresses;

  return {
    ...defaults,
    home: isRecord(parsed.home) ? parsed.home as HomeInfo : null,
    stateVersion: STATE_SCHEMA_VERSION,
    device: {
      id: String(device.id),
      name: String(device.name || defaults.device.name),
      platform: (device.platform || defaults.device.platform) as NodeJS.Platform,
      publicKey,
      privateKey: String(device.privateKey),
      publicKeyHash: String(device.publicKeyHash || publicKeyHash(publicKey))
    },
    trustedDevices: isRecord(parsed.trustedDevices) ? parsed.trustedDevices as Record<string, TrustedDevice> : {},
    blockedDevices: isRecord(parsed.blockedDevices) ? parsed.blockedDevices as Record<string, BlockedDevice> : {},
    devicePreferences: isRecord(parsed.devicePreferences) ? parsed.devicePreferences as Record<string, DevicePreference> : {},
    conversations: normalizeConversations(parsed.conversations),
    tasks: normalizeTaskRecords(Array.isArray(parsed.tasks) ? parsed.tasks : []),
    auditLog: Array.isArray(parsed.auditLog) ? parsed.auditLog.slice(-MAX_AUDIT_EVENTS) : [],
    sharedFolder: parsed.sharedFolder ? String(parsed.sharedFolder) : '',
    fileShareEnabled: parsed.fileShareEnabled !== false,
    autoTrustDevices: Boolean(parsed.autoTrustDevices),
    localApiToken: parsed.localApiToken ? String(parsed.localApiToken) : defaults.localApiToken,
    manualPeerAddresses: manualPeerNormalizer(Array.isArray(parsed.manualPeerAddresses) ? parsed.manualPeerAddresses : []),
    transfers: normalizeTransferRecords(Array.isArray(parsed.transfers) ? parsed.transfers : []),
    webrtc: normalizeWebRtcConfig(parsed.webrtc, defaults.webrtc)
  };
}
