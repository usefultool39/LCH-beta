import { contextBridge, ipcRenderer } from 'electron';

const api = {
  getState: () => ipcRenderer.invoke('lch:get-state'),
  getRemoteSessions: () => ipcRenderer.invoke('lch:get-remote-sessions'),
  getFirewallStatus: () => ipcRenderer.invoke('lch:get-firewall-status'),
  repairFirewall: (elevated?: boolean) => ipcRenderer.invoke('lch:repair-firewall', elevated),
  createHome: (name: string) => ipcRenderer.invoke('lch:create-home', name),
  joinHome: (secret: string, name: string) => ipcRenderer.invoke('lch:join-home', secret, name),
  updateName: (name: string) => ipcRenderer.invoke('lch:update-name', name),
  updateDevicePreference: (peerId: string, patch: unknown) => ipcRenderer.invoke('lch:update-device-preference', peerId, patch),
  setFileSharing: (enabled: boolean) => ipcRenderer.invoke('lch:set-file-sharing', enabled),
  setAutoTrust: (enabled: boolean) => ipcRenderer.invoke('lch:set-auto-trust', enabled),
  trustDevice: (peerId: string) => ipcRenderer.invoke('lch:trust-device', peerId),
  revokeDevice: (peerId: string) => ipcRenderer.invoke('lch:revoke-device', peerId),
  chooseSharedFolder: () => ipcRenderer.invoke('lch:choose-shared-folder'),
  clearSharedFolder: () => ipcRenderer.invoke('lch:clear-shared-folder'),
  sendText: (peerId: string, text: string) => ipcRenderer.invoke('lch:send-text', peerId, text),
  sendFile: (peerId: string, file: { name: string; size: number; base64: string }) => ipcRenderer.invoke('lch:send-file', peerId, file),
  listSharedFiles: (peerId: string, relativePath: string) => ipcRenderer.invoke('lch:list-shared-files', peerId, relativePath),
  downloadSharedFile: (peerId: string, relativePath: string) => ipcRenderer.invoke('lch:download-shared-file', peerId, relativePath),
  uploadSharedFile: (peerId: string, relativePath: string, file: { name: string; size: number; base64: string }) => ipcRenderer.invoke('lch:upload-shared-file', peerId, relativePath, file),
  runCommand: (peerIds: string[], command: string, cwd?: string) => ipcRenderer.invoke('lch:run-command', peerIds, command, cwd),
  openTerminal: (peerId: string) => ipcRenderer.invoke('lch:open-terminal', peerId),
  terminalInput: (peerId: string, terminalId: string, input: string) => ipcRenderer.invoke('lch:terminal-input', peerId, terminalId, input),
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
