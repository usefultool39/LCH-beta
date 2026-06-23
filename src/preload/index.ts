import { contextBridge, ipcRenderer, webUtils } from 'electron';

const api = {
  getState: () => ipcRenderer.invoke('lch:get-state'),
  getRemoteSessions: () => ipcRenderer.invoke('lch:get-remote-sessions'),
  getTransfers: () => ipcRenderer.invoke('lch:get-transfers'),
  cancelTransfer: (transferId: string) => ipcRenderer.invoke('lch:cancel-transfer', transferId),
  showFile: (filePath: string) => ipcRenderer.invoke('lch:show-file', filePath),
  openPath: (filePath: string) => ipcRenderer.invoke('lch:open-path', filePath),
  getFirewallStatus: () => ipcRenderer.invoke('lch:get-firewall-status'),
  repairFirewall: (elevated?: boolean) => ipcRenderer.invoke('lch:repair-firewall', elevated),
  checkUpdates: () => ipcRenderer.invoke('lch:check-updates'),
  openLatestRelease: () => ipcRenderer.invoke('lch:open-latest-release'),
  createHome: (name: string) => ipcRenderer.invoke('lch:create-home', name),
  joinHome: (secret: string, name: string) => ipcRenderer.invoke('lch:join-home', secret, name),
  updateName: (name: string) => ipcRenderer.invoke('lch:update-name', name),
  updateDevicePreference: (peerId: string, patch: unknown) => ipcRenderer.invoke('lch:update-device-preference', peerId, patch),
  setFileSharing: (enabled: boolean) => ipcRenderer.invoke('lch:set-file-sharing', enabled),
  setAutoTrust: (enabled: boolean) => ipcRenderer.invoke('lch:set-auto-trust', enabled),
  setWebRtcConfig: (config: unknown) => ipcRenderer.invoke('lch:set-webrtc-config', config),
  connectManualPeer: (address: string) => ipcRenderer.invoke('lch:connect-manual-peer', address),
  removeManualPeer: (address: string) => ipcRenderer.invoke('lch:remove-manual-peer', address),
  refreshManualPeers: () => ipcRenderer.invoke('lch:refresh-manual-peers'),
  trustDevice: (peerId: string) => ipcRenderer.invoke('lch:trust-device', peerId),
  revokeDevice: (peerId: string) => ipcRenderer.invoke('lch:revoke-device', peerId),
  chooseSharedFolder: () => ipcRenderer.invoke('lch:choose-shared-folder'),
  clearSharedFolder: () => ipcRenderer.invoke('lch:clear-shared-folder'),
  sendText: (peerId: string, text: string, options?: unknown) => ipcRenderer.invoke('lch:send-text', peerId, text, options),
  createConversation: (data: unknown) => ipcRenderer.invoke('lch:create-conversation', data),
  sendConversationText: (conversationId: string, text: string, options?: unknown) => ipcRenderer.invoke('lch:send-conversation-text', conversationId, text, options),
  sendConversationFile: (conversationId: string, file: { name: string; size: number; base64: string }) => ipcRenderer.invoke('lch:send-conversation-file', conversationId, file),
  reactToMessage: (peerId: string, messageId: string, emoji: string, options?: unknown) => ipcRenderer.invoke('lch:react-message', peerId, messageId, emoji, options),
  reactToConversationMessage: (conversationId: string, messageId: string, emoji: string) => ipcRenderer.invoke('lch:react-conversation-message', conversationId, messageId, emoji),
  sendFile: (peerId: string, file: { name: string; size: number; base64: string }) => ipcRenderer.invoke('lch:send-file', peerId, file),
  listSharedFiles: (peerId: string, relativePath: string) => ipcRenderer.invoke('lch:list-shared-files', peerId, relativePath),
  downloadSharedFile: (peerId: string, relativePath: string) => ipcRenderer.invoke('lch:download-shared-file', peerId, relativePath),
  previewSharedFile: (peerId: string, relativePath: string) => ipcRenderer.invoke('lch:preview-shared-file', peerId, relativePath),
  uploadSharedFile: (peerId: string, relativePath: string, file: { name: string; size: number; base64: string }) => ipcRenderer.invoke('lch:upload-shared-file', peerId, relativePath, file),
  getFilePath: (file: File) => webUtils.getPathForFile(file),
  uploadSharedFileStream: (peerId: string, relativePath: string, localPath: string) => ipcRenderer.invoke('lch:upload-shared-file-stream', peerId, relativePath, localPath),
  runCommand: (peerIds: string[], command: string, cwd?: string) => ipcRenderer.invoke('lch:run-command', peerIds, command, cwd),
  openTerminal: (peerId: string, size?: { cols?: number; rows?: number }) => ipcRenderer.invoke('lch:open-terminal', peerId, size),
  terminalInput: (peerId: string, terminalId: string, input: string) => ipcRenderer.invoke('lch:terminal-input', peerId, terminalId, input),
  terminalResize: (peerId: string, terminalId: string, cols: number, rows: number) => ipcRenderer.invoke('lch:terminal-resize', peerId, terminalId, cols, rows),
  terminalClose: (peerId: string, terminalId: string) => ipcRenderer.invoke('lch:terminal-close', peerId, terminalId),
  requestScreen: (peerId: string, sessionId: string) => ipcRenderer.invoke('lch:screen-request', peerId, sessionId),
  sendScreenSignal: (peerId: string, sessionId: string, signal: unknown) => ipcRenderer.invoke('lch:screen-signal', peerId, sessionId, signal),
  stopScreen: (peerId: string, sessionId: string) => ipcRenderer.invoke('lch:screen-stop', peerId, sessionId),
  openRemote: (peerId: string) => ipcRenderer.invoke('lch:remote-open', peerId),
  openRemoteWindow: (peerId: string, mode?: string) => ipcRenderer.invoke('lch:remote-window-open', peerId, mode),
  updateRemoteSession: (sessionId: string, patch: unknown) => ipcRenderer.invoke('lch:remote-session-update', sessionId, patch),
  sendRemoteInput: (peerId: string, input: unknown) => ipcRenderer.invoke('lch:remote-input', peerId, input),
  closeRemote: (peerId: string, sessionId: string) => ipcRenderer.invoke('lch:remote-close', peerId, sessionId),
  remoteScreenshot: (peerId: string, sessionId?: string) => ipcRenderer.invoke('lch:remote-screenshot', peerId, sessionId),
  readRemoteClipboard: (peerId: string) => ipcRenderer.invoke('lch:remote-clipboard-read', peerId),
  writeRemoteClipboard: (peerId: string, text: string) => ipcRenderer.invoke('lch:remote-clipboard-write', peerId, text),
  onState: (callback: (state: unknown) => void) => {
    const handler = (_event: unknown, state: unknown) => callback(state);
    ipcRenderer.on('lch:state', handler);
    return () => ipcRenderer.removeListener('lch:state', handler);
  },
  onTerminalOutput: (callback: (event: unknown) => void) => {
    const handler = (_event: unknown, payload: unknown) => callback(payload);
    ipcRenderer.on('lch:terminal-output', handler);
    return () => ipcRenderer.removeListener('lch:terminal-output', handler);
  },
  onTerminalClosed: (callback: (event: unknown) => void) => {
    const handler = (_event: unknown, payload: unknown) => callback(payload);
    ipcRenderer.on('lch:terminal-closed', handler);
    return () => ipcRenderer.removeListener('lch:terminal-closed', handler);
  },
  onScreenRequest: (callback: (event: unknown) => void) => {
    const handler = (_event: unknown, payload: unknown) => callback(payload);
    ipcRenderer.on('lch:screen-request', handler);
    return () => ipcRenderer.removeListener('lch:screen-request', handler);
  },
  onScreenSignal: (callback: (event: unknown) => void) => {
    const handler = (_event: unknown, payload: unknown) => callback(payload);
    ipcRenderer.on('lch:screen-signal', handler);
    return () => ipcRenderer.removeListener('lch:screen-signal', handler);
  },
  onScreenStop: (callback: (event: unknown) => void) => {
    const handler = (_event: unknown, payload: unknown) => callback(payload);
    ipcRenderer.on('lch:screen-stop', handler);
    return () => ipcRenderer.removeListener('lch:screen-stop', handler);
  },
  onRemoteControl: (callback: (event: unknown) => void) => {
    const handler = (_event: unknown, payload: unknown) => callback(payload);
    ipcRenderer.on('lch:remote-control', handler);
    return () => ipcRenderer.removeListener('lch:remote-control', handler);
  },
  onRemoteSessions: (callback: (event: unknown) => void) => {
    const handler = (_event: unknown, payload: unknown) => callback(payload);
    ipcRenderer.on('lch:remote-sessions', handler);
    return () => ipcRenderer.removeListener('lch:remote-sessions', handler);
  }
};

contextBridge.exposeInMainWorld('lanControlHub', api);
