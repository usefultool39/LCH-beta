export const APP_NAME = 'Lan Control Hub';
export const APP_VERSION = '0.1.0';

export const DISCOVERY_PORT = 46880;
export const DEFAULT_CONTROL_PORT = 46881;
export const DEFAULT_WEB_PORT = 46882;
export const DEFAULT_LOCAL_API_PORT = 46883;

export const DISCOVERY_INTERVAL_MS = 3000;
export const PEER_TIMEOUT_MS = 20000;
export const COMMAND_TIMEOUT_MS = 10 * 60 * 1000;
export const MAX_TASK_OUTPUT_BYTES = 5 * 1024 * 1024;
export const MAX_FILE_BYTES = 100 * 1024 * 1024;
export const MAX_CONVERSATION_EVENTS = 1000;
export const MAX_AUDIT_EVENTS = 2000;

export const CAPABILITIES = [
  'chat',
  'files',
  'commands',
  'terminal',
  'screen.view',
  'remote.input',
  'remote.clipboard',
  'remote.screenshot',
  'remote.window',
  'remote.monitor',
  'remote.quality',
  'file.transfer',
  'device.alias',
  'device.room',
  'agent.gateway',
  'agent.observe',
  'agent.actions',
  'iot.controls'
] as const;

export type Capability = typeof CAPABILITIES[number];
export type Platform = NodeJS.Platform | 'unknown';
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
export type TaskStream = 'stdout' | 'stderr' | 'system';
export type DeviceUiStatus = 'online' | 'offline' | 'stale' | 'permission-needed' | 'connecting' | 'controlling';
export type RemoteSessionStatus = 'opening' | 'streaming' | 'snapshot' | 'reconnecting' | 'closed' | 'failed';
export type RemoteSessionMode = 'view' | 'control';
export type RemoteSessionDirection = 'incoming' | 'outgoing';

export interface DevicePreference {
  alias?: string;
  room?: string;
  favorite?: boolean;
  readOnly?: boolean;
  lastControlledAt?: number;
  lastOpenedAt?: number;
  notes?: string;
}

export interface DeviceIdentity {
  id: string;
  name: string;
  platform: Platform;
  publicKey: string;
  publicKeyHash: string;
}

export interface HomeInfo {
  id: string;
  name: string;
  secret: string;
  createdAt: number;
}

export interface DiscoveryPacket {
  kind: 'lch-discovery';
  version: 1;
  homeId: string;
  appVersion: string;
  device: DeviceIdentity;
  address?: string;
  controlPort: number;
  webPort: number;
  capabilities: Capability[];
  timestamp: number;
}

export interface PeerInfo extends DeviceIdentity {
  address: string;
  controlPort: number;
  webPort: number;
  capabilities: Capability[];
  appVersion: string;
  lastSeen: number;
  trusted: boolean;
  isOnline: boolean;
  uiStatus?: DeviceUiStatus;
  alias?: string;
  room?: string;
  favorite?: boolean;
  readOnly?: boolean;
  lastControlledAt?: number;
  displayName?: string;
  latencyMs?: number;
  identityMismatch?: boolean;
}

export interface TrustedDevice {
  id: string;
  name: string;
  platform: Platform;
  publicKey: string;
  publicKeyHash: string;
  trustedAt: number;
}

export interface BlockedDevice {
  id: string;
  name: string;
  publicKeyHash?: string;
  blockedAt: number;
}

export interface ConversationEvent {
  id: string;
  peerId: string;
  direction: 'incoming' | 'outgoing';
  type: 'text' | 'file';
  createdAt: number;
  text?: string;
  name?: string;
  size?: number;
  path?: string;
  senderName?: string;
}

export interface TaskRecord {
  id: string;
  requestId?: string;
  remoteTaskId?: string;
  peerId: string;
  peerName: string;
  command: string;
  cwd?: string;
  status: TaskStatus;
  exitCode?: number | null;
  signal?: string | null;
  output: string;
  errorOutput: string;
  startedAt: number;
  endedAt?: number;
  origin: 'local' | 'remote';
}

export interface AuditEvent {
  id: string;
  createdAt: number;
  actorDeviceId: string;
  actorName: string;
  targetDeviceId: string;
  targetName: string;
  action: string;
  detail: string;
}

export interface NetworkInfo {
  discoveryPort: number;
  controlPort: number;
  webPort: number;
  localApiPort: number;
  addresses: string[];
}

export interface FirewallStatus {
  platform: Platform;
  supported: boolean;
  checkedAt: number;
  needsAttention: boolean;
  blockRules: number;
  allowRules: number;
  canRepair: boolean;
  message: string;
  details?: string[];
}

export interface RemoteSessionRecord {
  sessionId: string;
  peerId: string;
  peerName: string;
  mode: RemoteSessionMode;
  direction: RemoteSessionDirection;
  status: RemoteSessionStatus;
  startedAt: number;
  updatedAt: number;
  endedAt?: number;
  width?: number;
  height?: number;
  windowId?: number;
  error?: string;
}

export interface AppStateView {
  home: HomeInfo | null;
  device: DeviceIdentity & {
    controlPort: number;
    webPort: number;
  };
  peers: PeerInfo[];
  trustedDevices: Record<string, TrustedDevice>;
  blockedDevices: Record<string, BlockedDevice>;
  devicePreferences: Record<string, DevicePreference>;
  conversations: Record<string, ConversationEvent[]>;
  tasks: TaskRecord[];
  remoteSessions: RemoteSessionRecord[];
  auditLog: AuditEvent[];
  sharedFolder: string;
  fileShareEnabled: boolean;
  autoTrustDevices: boolean;
  networkInfo: NetworkInfo;
}

export interface ControlPayload<T = unknown> {
  id: string;
  fromId: string;
  fromName: string;
  type: string;
  data: T;
  timestamp: number;
}

export interface SignedControlMessage<T = unknown> {
  payload: ControlPayload<T>;
  publicKey: string;
  signature: string;
}

export interface EncryptedEnvelope {
  kind: 'lch-control';
  version: 1;
  fromId: string;
  nonce: string;
  tag: string;
  ciphertext: string;
}

export interface ControlResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

export interface SharedFolderListing {
  currentPath: string;
  displayPath?: string;
  rootName?: string;
  writable?: boolean;
  entries: Array<{
    name: string;
    relativePath: string;
    type: 'directory' | 'file';
    size: number;
    modifiedAt: number;
    writable?: boolean;
  }>;
}

export interface TerminalOutputEvent {
  peerId: string;
  sessionId: string;
  terminalId: string;
  stream: TaskStream;
  chunk: string;
}

export interface ScreenSignalEvent {
  peerId: string;
  peerName: string;
  sessionId: string;
  signal: {
    kind: 'offer' | 'answer' | 'candidate';
    sdp?: string;
    candidate?: RTCIceCandidateInit;
  };
}

export type RemoteMouseButton = 'left' | 'middle' | 'right';

export type RemotePointerInput = {
  kind: 'pointer';
  action: 'move' | 'down' | 'up' | 'click' | 'doubleClick' | 'scroll';
  normalizedX?: number;
  normalizedY?: number;
  x?: number;
  y?: number;
  button?: RemoteMouseButton;
  deltaX?: number;
  deltaY?: number;
};

export type RemoteKeyboardInput = {
  kind: 'keyboard';
  action: 'type' | 'hotkey' | 'press' | 'release';
  text?: string;
  key?: string;
  keys?: string[];
};

export type RemoteInputEvent = RemotePointerInput | RemoteKeyboardInput;

export interface RemoteOpenResult {
  sessionId: string;
  platform: Platform;
  width: number;
  height: number;
  permissions: {
    input: boolean;
    screen: boolean;
    clipboard: boolean;
  };
}

export interface RemoteScreenshotResult {
  peerId?: string;
  width: number;
  height: number;
  mime: 'image/png';
  base64: string;
  capturedAt: number;
}

export function isDiscoveryPacket(value: unknown): value is DiscoveryPacket {
  const item = value as Partial<DiscoveryPacket>;
  return item?.kind === 'lch-discovery'
    && item.version === 1
    && typeof item.homeId === 'string'
    && typeof item.controlPort === 'number'
    && typeof item.webPort === 'number'
    && typeof item.device?.id === 'string'
    && typeof item.device?.publicKey === 'string';
}
