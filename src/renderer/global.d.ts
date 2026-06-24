import type { AppStateView, DevicePreference, FirewallStatus, LanRoomInfo, RemoteInputEvent, RemoteOpenResult, RemoteScreenshotResult, RemoteSessionRecord, ScreenSignalEvent, SharedFileToken, TerminalOpenResult, TerminalOutputEvent, TransferRecord, WebRtcConfig } from '../shared/protocol';

declare global {
  interface Window {
    lanControlHub: {
      getState: () => Promise<AppStateView>;
      getRemoteSessions: () => Promise<RemoteSessionRecord[]>;
      getTransfers: () => Promise<TransferRecord[]>;
      cancelTransfer: (transferId: string) => Promise<TransferRecord>;
      showFile: (filePath: string) => Promise<boolean>;
      openPath: (filePath: string) => Promise<string>;
      getFirewallStatus: () => Promise<FirewallStatus>;
      repairFirewall: (elevated?: boolean) => Promise<FirewallStatus>;
      checkUpdates: () => Promise<{ currentVersion: string; latestVersion: string; tag: string; updateAvailable: boolean; url: string; publishedAt?: string; assets: Array<{ name: string; size: number; url: string }> }>;
      openLatestRelease: () => Promise<void>;
      createHome: (name: string) => Promise<AppStateView>;
      joinHome: (secret: string, name: string, expectedHomeId?: string) => Promise<AppStateView>;
      leaveHome: () => Promise<AppStateView>;
      scanRooms: () => Promise<LanRoomInfo[]>;
      updateName: (name: string) => Promise<AppStateView>;
      updateDevicePreference: (peerId: string, patch: Partial<DevicePreference>) => Promise<AppStateView>;
      setFileSharing: (enabled: boolean) => Promise<AppStateView>;
      setFullDiskAccess: (enabled: boolean) => Promise<AppStateView>;
      setAutoTrust: (enabled: boolean) => Promise<AppStateView>;
      setAgentGateway: (enabled: boolean) => Promise<AppStateView>;
      setWebRtcConfig: (config: WebRtcConfig) => Promise<AppStateView>;
      connectManualPeer: (address: string) => Promise<AppStateView>;
      removeManualPeer: (address: string) => Promise<AppStateView>;
      refreshManualPeers: () => Promise<AppStateView>;
      trustDevice: (peerId: string) => Promise<AppStateView>;
      revokeDevice: (peerId: string) => Promise<AppStateView>;
      chooseSharedFolder: () => Promise<AppStateView>;
      clearSharedFolder: () => Promise<AppStateView>;
      sendText: (peerId: string, text: string, options?: { conversationId?: string; replyTo?: AppStateView['conversations'][string][number]['replyTo'] }) => Promise<AppStateView>;
      createConversation: (data: { id?: string; title?: string; memberIds: string[]; kind?: 'direct' | 'group' }) => Promise<AppStateView>;
      updateConversation: (data: { id: string; title?: string; memberIds?: string[] }) => Promise<AppStateView>;
      sendConversationText: (conversationId: string, text: string, options?: { replyTo?: AppStateView['conversations'][string][number]['replyTo'] }) => Promise<AppStateView>;
      sendConversationFile: (conversationId: string, file: { name: string; size: number; base64: string }) => Promise<AppStateView>;
      reactToMessage: (peerId: string, messageId: string, emoji: string, options?: { conversationId?: string }) => Promise<{ applied: boolean; state: AppStateView }>;
      reactToConversationMessage: (conversationId: string, messageId: string, emoji: string) => Promise<{ applied: boolean; state: AppStateView }>;
      sendFile: (peerId: string, file: { name: string; size: number; base64: string }) => Promise<AppStateView>;
      listSharedFiles: (peerId: string, relativePath: string) => Promise<unknown>;
      downloadSharedFile: (peerId: string, relativePath: string) => Promise<{ filePath: string; name: string; size: number }>;
      previewSharedFile: (peerId: string, relativePath: string) => Promise<SharedFileToken & { url: string }>;
      uploadSharedFile: (peerId: string, relativePath: string, file: { name: string; size: number; base64: string }) => Promise<unknown>;
      getFilePath: (file: File) => string;
      uploadSharedFileStream: (peerId: string, relativePath: string, localPath: string) => Promise<unknown>;
      runCommand: (peerIds: string[], command: string, cwd?: string) => Promise<{ taskIds: string[] }>;
      openTerminal: (peerId: string, size?: { cols?: number; rows?: number }) => Promise<TerminalOpenResult>;
      terminalInput: (peerId: string, terminalId: string, input: string) => Promise<unknown>;
      terminalResize: (peerId: string, terminalId: string, cols: number, rows: number) => Promise<unknown>;
      terminalClose: (peerId: string, terminalId: string) => Promise<unknown>;
      requestScreen: (peerId: string, sessionId: string) => Promise<unknown>;
      sendScreenSignal: (peerId: string, sessionId: string, signal: unknown) => Promise<unknown>;
      stopScreen: (peerId: string, sessionId: string) => Promise<unknown>;
      openRemote: (peerId: string) => Promise<RemoteOpenResult>;
      openRemoteWindow: (peerId: string, mode?: 'view' | 'control') => Promise<RemoteOpenResult & { peerId: string; peerName: string; windowId: number; mode: 'view' | 'control' }>;
      updateRemoteSession: (sessionId: string, patch: Partial<RemoteSessionRecord>) => Promise<RemoteSessionRecord | null>;
      sendRemoteInput: (peerId: string, input: RemoteInputEvent) => Promise<unknown>;
      closeRemote: (peerId: string, sessionId: string) => Promise<unknown>;
      remoteScreenshot: (peerId: string, sessionId?: string) => Promise<RemoteScreenshotResult>;
      readRemoteClipboard: (peerId: string) => Promise<{ text: string }>;
      writeRemoteClipboard: (peerId: string, text: string) => Promise<unknown>;
      onState: (callback: (state: AppStateView) => void) => () => void;
      onTerminalOutput: (callback: (event: TerminalOutputEvent) => void) => () => void;
      onTerminalClosed: (callback: (event: { peerId: string; sessionId: string; terminalId: string }) => void) => () => void;
      onScreenRequest: (callback: (event: { peerId: string; peerName: string; sessionId: string }) => void) => () => void;
      onScreenSignal: (callback: (event: ScreenSignalEvent) => void) => () => void;
      onScreenStop: (callback: (event: { peerId: string; sessionId: string }) => void) => () => void;
      onRemoteControl: (callback: (event: { peerId: string; peerName?: string; sessionId: string; active: boolean }) => void) => () => void;
      onRemoteSessions: (callback: (event: RemoteSessionRecord[]) => void) => () => void;
    };
  }
}

export {};
