import type { AppStateView, DevicePreference, FirewallStatus, RemoteInputEvent, RemoteOpenResult, RemoteScreenshotResult, RemoteSessionRecord, ScreenSignalEvent, TerminalOutputEvent } from '../shared/protocol';

declare global {
  interface Window {
    lanControlHub: {
      getState: () => Promise<AppStateView>;
      getRemoteSessions: () => Promise<RemoteSessionRecord[]>;
      getFirewallStatus: () => Promise<FirewallStatus>;
      repairFirewall: (elevated?: boolean) => Promise<FirewallStatus>;
      createHome: (name: string) => Promise<AppStateView>;
      joinHome: (secret: string, name: string) => Promise<AppStateView>;
      updateName: (name: string) => Promise<AppStateView>;
      updateDevicePreference: (peerId: string, patch: Partial<DevicePreference>) => Promise<AppStateView>;
      setFileSharing: (enabled: boolean) => Promise<AppStateView>;
      setAutoTrust: (enabled: boolean) => Promise<AppStateView>;
      trustDevice: (peerId: string) => Promise<AppStateView>;
      revokeDevice: (peerId: string) => Promise<AppStateView>;
      chooseSharedFolder: () => Promise<AppStateView>;
      clearSharedFolder: () => Promise<AppStateView>;
      sendText: (peerId: string, text: string) => Promise<AppStateView>;
      sendFile: (peerId: string, file: { name: string; size: number; base64: string }) => Promise<AppStateView>;
      listSharedFiles: (peerId: string, relativePath: string) => Promise<unknown>;
      downloadSharedFile: (peerId: string, relativePath: string) => Promise<{ filePath: string }>;
      uploadSharedFile: (peerId: string, relativePath: string, file: { name: string; size: number; base64: string }) => Promise<unknown>;
      runCommand: (peerIds: string[], command: string, cwd?: string) => Promise<{ taskIds: string[] }>;
      openTerminal: (peerId: string) => Promise<{ sessionId: string; terminalId: string; shell: string }>;
      terminalInput: (peerId: string, terminalId: string, input: string) => Promise<unknown>;
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
