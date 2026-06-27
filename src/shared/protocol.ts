export const APP_NAME = 'Lan Control Hub';
export const APP_VERSION = '0.16.0';
export const STATE_SCHEMA_VERSION = 6;
export const DISCOVERY_PROTOCOL_VERSION = 1;
export const CONTROL_PROTOCOL_VERSION = 1;
export const MIN_SUPPORTED_PROTOCOL_VERSION = 1;

export const DISCOVERY_PORT = 46880;
export const DEFAULT_CONTROL_PORT = 46881;
export const DEFAULT_WEB_PORT = 46882;
export const DEFAULT_LOCAL_API_PORT = 46883;

export const DISCOVERY_INTERVAL_MS = 3000;
export const PEER_TIMEOUT_MS = 20000;
export const COMMAND_TIMEOUT_MS = 10 * 60 * 1000;
export const MAX_TASK_OUTPUT_BYTES = 5 * 1024 * 1024;
export const MAX_FILE_BYTES = 100 * 1024 * 1024;
export const MAX_STREAM_FILE_BYTES = 20 * 1024 * 1024 * 1024;
export const MAX_LOCAL_API_BODY_BYTES = Math.ceil(MAX_FILE_BYTES * 4 / 3) + 1024 * 1024;
export const MAX_CONTROL_MESSAGE_BYTES = Math.ceil(MAX_LOCAL_API_BODY_BYTES * 4 / 3) + 2 * 1024 * 1024;
export const MAX_CONVERSATION_EVENTS = 1000;
export const MAX_AUDIT_EVENTS = 2000;
export const MAX_TRANSFER_RECORDS = 300;

export const CAPABILITIES = [
  'chat',
  'chat.markdown',
  'chat.reply',
  'chat.reactions',
  'chat.conversations',
  'files',
  'commands',
  'terminal',
  'terminal.pty',
  'screen.view',
  'screen.webrtc.ice',
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
export const CAPABILITY_VERSIONS: Record<Capability, number> = Object.fromEntries(
  CAPABILITIES.map((capability) => [capability, 1])
) as Record<Capability, number>;
export const CHAT_REACTION_EMOJIS = ['👍', '❤️', '😂', '🎉', '✅', '👀'] as const;
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
  notificationsMuted?: boolean;
  unreadCount?: number;
  lastControlledAt?: number;
  lastOpenedAt?: number;
  notes?: string;
}

export type ManualPeerStatus = 'unknown' | 'online' | 'offline' | 'home-mismatch' | 'invalid' | 'self';

export type WebRtcIceTransportPolicy = 'all' | 'relay';

export interface WebRtcIceServer {
  urls: string[];
  username?: string;
  credential?: string;
}

export interface WebRtcConfig {
  iceServers: WebRtcIceServer[];
  iceTransportPolicy: WebRtcIceTransportPolicy;
}

export const DEFAULT_WEBRTC_CONFIG: WebRtcConfig = {
  iceServers: [],
  iceTransportPolicy: 'all'
};

export interface ManualPeerAddress {
  address: string;
  host: string;
  port: number;
  label: string;
  status: ManualPeerStatus;
  lastCheckedAt?: number;
  lastSeenAt?: number;
  lastError?: string;
  peerId?: string;
  peerName?: string;
  /**
   * Most recent probe latency in milliseconds. Populated by
   * refreshManualPeers / connectManualPeer. Undefined means we have
   * not yet measured this entry.
   */
  latencyMs?: number;
}

export type PeerNetworkRouteKind = 'lan' | 'tailnet' | 'manual';

export interface PeerNetworkRoute {
  kind: PeerNetworkRouteKind;
  label: string;
  host: string;
  controlPort?: number;
  webPort?: number;
  status?: ManualPeerStatus | DeviceUiStatus;
  current?: boolean;
  source: 'discovery' | 'manual';
  lastSeenAt?: number;
  lastCheckedAt?: number;
  /**
   * Most recent latency observation in milliseconds for this route.
   * Routes without a measurement are sorted after measured ones.
   */
  latencyMs?: number;
  lastError?: string;
}

export interface LanRoomDevice {
  id: string;
  name: string;
  address: string;
  controlPort: number;
  webPort: number;
  appVersion?: string;
  publicKeyHash?: string;
  lastSeenAt: number;
}

export interface LanRoomInfo {
  homeId: string;
  homeName?: string;
  displayName: string;
  hostAddress: string;
  webPort: number;
  deviceCount: number;
  devices: LanRoomDevice[];
  lastSeenAt: number;
  source: 'broadcast' | 'scan' | 'manual' | 'tailnet-scan';
  isCurrent?: boolean;
  /**
   * The remote room is running in stealth mode. Stealth rooms do not
   * broadcast UDP presence; we only learn about them via point-to-point
   * scans or by manually pasting the room secret. The badge in the UI
   * should hint that joining requires entering the secret by hand.
   */
  stealth?: boolean;
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
  createdByDeviceId?: string;
  /**
   * Stealth rooms do NOT broadcast UDP presence. Point-to-point probes
   * (manual add, LAN / tailnet HTTP scans) still get a reply, but the
   * room will never appear in passive discovery. Anyone who wants to
   * join must paste the room secret manually.
   */
  stealth?: boolean;
}

export interface DiscoveryPacket {
  kind: 'lch-discovery';
  version: 1;
  protocolVersion?: number;
  minSupportedProtocolVersion?: number;
  homeId: string;
  homeName?: string;
  appVersion: string;
  device: DeviceIdentity;
  address?: string;
  controlPort: number;
  webPort: number;
  capabilities: Capability[];
  capabilityVersions?: Partial<Record<Capability, number>>;
  timestamp: number;
  /**
   * When true, the originating room is in stealth mode. Stealth rooms
   * do not broadcast UDP presence; only point-to-point probes get a
   * reply. The UI uses this flag to remind the user that joining
   * requires the room secret.
   */
  homeStealth?: boolean;
}

export interface PeerInfo extends DeviceIdentity {
  address: string;
  controlPort: number;
  webPort: number;
  capabilities: Capability[];
  protocolVersion?: number;
  minSupportedProtocolVersion?: number;
  capabilityVersions?: Partial<Record<Capability, number>>;
  appVersion: string;
  lastSeen: number;
  trusted: boolean;
  isOnline: boolean;
  uiStatus?: DeviceUiStatus;
  alias?: string;
  room?: string;
  favorite?: boolean;
  readOnly?: boolean;
  notificationsMuted?: boolean;
  unreadCount?: number;
  lastControlledAt?: number;
  displayName?: string;
  primaryRoute?: PeerNetworkRoute;
  networkRoutes?: PeerNetworkRoute[];
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
  conversationId?: string;
  peerId: string;
  direction: 'incoming' | 'outgoing';
  type: 'text' | 'file';
  createdAt: number;
  text?: string;
  name?: string;
  size?: number;
  path?: string;
  senderName?: string;
  markdown?: boolean;
  replyTo?: {
    id: string;
    type: 'text' | 'file';
    senderName?: string;
    text?: string;
    name?: string;
    createdAt?: number;
  };
  reactions?: Record<string, string[]>;
  editedAt?: number;
  deletedAt?: number;
}

export type ConversationKind = 'direct' | 'group';

export interface ConversationRecord {
  id: string;
  kind: ConversationKind;
  title?: string;
  memberIds: string[];
  createdAt: number;
  updatedAt: number;
  lastMessageAt?: number;
  createdByDeviceId?: string;
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
  // Network-type breakdown for the SetupScreen and Settings UI.
  // 'activeNetwork' reports what kind of network the user is most likely on
  // right now: 'tailnet' if Tailscale is up, 'lan' if only the local network
  // is reachable, 'both' if both are up, 'none' if nothing is reachable.
  lanAddresses: string[];
  tailnetAddresses: string[];
  activeNetwork: 'lan' | 'tailnet' | 'both' | 'none';
}

export interface AutoLaunchInfo {
  enabled: boolean;
  available: boolean;
  reason?: string;
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

export type TransferDirection = 'download' | 'upload';
export type TransferStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface TransferRecord {
  id: string;
  direction: TransferDirection;
  peerId: string;
  peerName: string;
  name: string;
  relativePath?: string;
  targetPath?: string;
  localPath?: string;
  size: number;
  transferredBytes: number;
  status: TransferStatus;
  startedAt: number;
  updatedAt: number;
  endedAt?: number;
  speedBytesPerSecond?: number;
  sha256?: string;
  error?: string;
}

export interface AppStateView {
  stateVersion: number;
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
  conversationRecords: Record<string, ConversationRecord>;
  tasks: TaskRecord[];
  remoteSessions: RemoteSessionRecord[];
  auditLog: AuditEvent[];
  sharedFolder: string;
  fileShareEnabled: boolean;
  fullDiskAccessEnabled: boolean;
  autoTrustDevices: boolean;
  agentGatewayEnabled: boolean;
  manualPeerAddresses: ManualPeerAddress[];
  nearbyRooms: LanRoomInfo[];
transfers: TransferRecord[];
  networkInfo: NetworkInfo;
  webrtc: WebRtcConfig;
  autoLaunch: AutoLaunchInfo;
  /**
   * Transient (in-memory only). Set to Date.now() right after
   * createHome / joinHome resolves, so the renderer can decide to
   * pop the post-join trust wizard without having to compare wall
   * clocks against `home.createdAt`. Not persisted.
   */
  postJoinTrustPromptedAt?: number;
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
  code?: 'unsupported' | 'error';
}

export function unsupportedControlResponse(type: string): ControlResponse<{
  type: string;
  appVersion: string;
  protocolVersion: number;
  minSupportedProtocolVersion: number;
  capabilities: Capability[];
}> {
  return {
    ok: false,
    code: 'unsupported',
    error: `Unsupported control message: ${type || 'unknown'}`,
    data: {
      type: type || 'unknown',
      appVersion: APP_VERSION,
      protocolVersion: CONTROL_PROTOCOL_VERSION,
      minSupportedProtocolVersion: MIN_SUPPORTED_PROTOCOL_VERSION,
      capabilities: [...CAPABILITIES]
    }
  };
}

export function isProtocolCompatible(protocolVersion = DISCOVERY_PROTOCOL_VERSION, minSupportedProtocolVersion = MIN_SUPPORTED_PROTOCOL_VERSION) {
  return protocolVersion >= MIN_SUPPORTED_PROTOCOL_VERSION
    && CONTROL_PROTOCOL_VERSION >= minSupportedProtocolVersion;
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

export interface SharedFileToken {
  token: string;
  name: string;
  relativePath: string;
  size: number;
  mime: string;
  expiresAt: number;
}

export interface TerminalOutputEvent {
  peerId: string;
  sessionId: string;
  terminalId: string;
  stream: TaskStream;
  chunk: string;
}

export type TerminalBackend = 'pty' | 'spawn';

export interface TerminalOpenResult {
  sessionId: string;
  terminalId: string;
  shell: string;
  backend: TerminalBackend;
  cols?: number;
  rows?: number;
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
