import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal as XTerm } from '@xterm/xterm';
import {
  Camera,
  CheckCircle2,
  Circle,
  Clipboard,
  Copy,
  Download,
  File as FileIcon,
  FileDown,
  Folder,
  FolderOpen,
  HardDrive,
  Home,
  Keyboard,
  KeyRound,
  Laptop,
  LayoutGrid,
  MessageSquare,
  MonitorPlay,
  MousePointer2,
  Eye,
  EyeOff,
  Play,
  Plus,
  Power,
  RefreshCw,
  Reply,
  ScreenShare,
  Search,
  Send,
  Settings,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  Star,
  TerminalSquare,
  Trash2,
  Upload,
  Image as ImageIcon,
  Film,
  Music2,
  FileText
} from 'lucide-react';
import { APP_VERSION, CHAT_REACTION_EMOJIS, DEFAULT_WEBRTC_CONFIG, MAX_FILE_BYTES } from '../shared/protocol';
import type { AppStateView, DevicePreference, FirewallStatus, PeerInfo, RemoteInputEvent, RemoteOpenResult, RemoteSessionRecord, SharedFileToken, SharedFolderListing, TaskRecord, TerminalOutputEvent, TransferRecord, WebRtcConfig, WebRtcIceTransportPolicy } from '../shared/protocol';
import '@xterm/xterm/css/xterm.css';
import './styles.css';

const api = window.lanControlHub;

type View = 'dashboard' | 'chat' | 'files' | 'transfers' | 'tasks' | 'settings';
type TerminalTab = {
  peerId: string;
  peerName: string;
  sessionId: string;
  terminalId: string;
  shell: string;
  backend: 'pty' | 'spawn';
  cols: number;
  rows: number;
  output: string;
};

type ScreenSession = {
  peerId: string;
  peerName: string;
  sessionId: string;
  stream?: MediaStream;
  snapshot?: string;
  snapshotAt?: number;
  snapshotBusy?: boolean;
  sharing?: boolean;
  mode: 'view' | 'control';
  remoteInfo?: RemoteOpenResult;
  status?: string;
};

type RemoteNotice = {
  peerId: string;
  peerName?: string;
  sessionId: string;
  active: boolean;
};

type UpdateInfo = Awaited<ReturnType<typeof api.checkUpdates>>;
type IceServerDraft = {
  id: string;
  urls: string;
  username: string;
  credential: string;
};

function toRtcConfiguration(config: WebRtcConfig = DEFAULT_WEBRTC_CONFIG): RTCConfiguration {
  return {
    iceServers: (config.iceServers || []).map((server) => ({
      urls: server.urls,
      ...(server.username ? { username: server.username } : {}),
      ...(server.credential ? { credential: server.credential } : {})
    })),
    iceTransportPolicy: config.iceTransportPolicy || 'all'
  };
}

function draftId() {
  return crypto.randomUUID();
}

function webRtcDraftsFromConfig(config: WebRtcConfig = DEFAULT_WEBRTC_CONFIG): IceServerDraft[] {
  const drafts = (config.iceServers || []).map((server) => ({
    id: draftId(),
    urls: server.urls.join(', '),
    username: server.username || '',
    credential: server.credential || ''
  }));
  return drafts.length ? drafts : [{ id: draftId(), urls: '', username: '', credential: '' }];
}

function webRtcConfigFromDrafts(iceTransportPolicy: WebRtcIceTransportPolicy, drafts: IceServerDraft[]): WebRtcConfig {
  return {
    iceTransportPolicy,
    iceServers: drafts
      .map((draft) => ({
        urls: draft.urls.split(/[\s,]+/).map((url) => url.trim()).filter(Boolean),
        username: draft.username.trim(),
        credential: draft.credential.trim()
      }))
      .filter((server) => server.urls.length)
      .map((server) => ({
        urls: server.urls,
        ...(server.username ? { username: server.username } : {}),
        ...(server.credential ? { credential: server.credential } : {})
      }))
  };
}

function formatBytes(size = 0) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  return `${(size / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatTime(value?: number) {
  if (!value) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(new Date(value));
}

function formatRelativeTime(value?: number) {
  if (!value) return '从未';
  const seconds = Math.max(1, Math.round((Date.now() - value) / 1000));
  if (seconds < 60) return `${seconds} 秒前`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.round(hours / 24)} 天前`;
}

function formatDuration(start?: number, end?: number) {
  if (!start) return '';
  const seconds = Math.max(0, Math.round(((end || Date.now()) - start) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}m ${rest}s`;
}

function peerLabel(peer: PeerInfo | null) {
  if (!peer) return '未选择设备';
  return peer.displayName || peer.alias || peer.name;
}

function statusText(peer: PeerInfo) {
  if (!peer.trusted) return '待信任';
  if (!peer.isOnline) return '离线';
  if (peer.uiStatus === 'stale') return '连接较旧';
  if (peer.readOnly) return '只读';
  return '在线可控';
}

function statusClass(peer: PeerInfo | null) {
  if (!peer) return 'offline';
  if (!peer.trusted) return 'permission';
  if (!peer.isOnline) return 'offline';
  if (peer.readOnly || peer.uiStatus === 'stale') return 'pending';
  return 'online';
}

function parentPath(relativePath = '') {
  const parts = String(relativePath || '').split(/[\\/]/).filter(Boolean);
  parts.pop();
  return parts.join('/');
}

type SharedFileEntry = SharedFolderListing['entries'][number];
type PreviewToken = SharedFileToken & { url: string };

function pathCrumbs(relativePath = '') {
  const parts = String(relativePath || '').split(/[\\/]/).filter(Boolean);
  const crumbs = [{ label: '文件库', path: '' }];
  let current = '';
  for (const part of parts) {
    current = [current, part].filter(Boolean).join('/');
    crumbs.push({ label: part, path: current });
  }
  return crumbs;
}

function fileExtension(name = '') {
  return name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
}

function previewKind(entry?: Pick<SharedFileEntry, 'name' | 'type'> | null, mime = '') {
  if (!entry || entry.type !== 'file') return 'none';
  const ext = fileExtension(entry.name);
  if (mime.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'avif'].includes(ext)) return 'image';
  if (mime.startsWith('video/') || ['mp4', 'm4v', 'mov', 'webm'].includes(ext)) return 'video';
  if (mime.startsWith('audio/') || ['mp3', 'm4a', 'wav', 'ogg', 'flac'].includes(ext)) return 'audio';
  if (mime.includes('pdf') || ext === 'pdf') return 'pdf';
  return 'download';
}

function fileIcon(entry: SharedFileEntry) {
  if (entry.type === 'directory') return <Folder size={17} />;
  const kind = previewKind(entry);
  if (kind === 'image') return <ImageIcon size={17} />;
  if (kind === 'video') return <Film size={17} />;
  if (kind === 'audio') return <Music2 size={17} />;
  if (kind === 'pdf') return <FileText size={17} />;
  return <FileIcon size={17} />;
}

function readFileAsBase64(file: File) {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error('文件过大，当前单文件上限为 100 MB');
  }
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      resolve(result.includes(',') ? result.split(',')[1] : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function SetupScreen({ onCreate, onJoin }: { onCreate: (name: string) => void; onJoin: (secret: string, name: string) => void }) {
  const [name, setName] = useState('我的家庭网络');
  const [secret, setSecret] = useState('');
  return (
    <main className="setup">
      <section className="setupHero">
        <div className="setupBrand"><Home size={34} /> Lan Control Hub</div>
        <h1>把家里的 Windows 和 Mac 连成一个控制网络</h1>
        <p>第一台电脑创建网络，其他电脑粘贴加入密钥。加入后需要在两台电脑上确认信任，之后即可聊天、传文件、执行命令、打开终端和远程控制。</p>
      </section>
      <section className="setupPanel">
        <div className="field">
          <label>这个网络叫什么</label>
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </div>
        <button className="primary wide" onClick={() => onCreate(name)}>
          <KeyRound size={16} /> 我是第一台，创建网络
        </button>
        <div className="divider">或</div>
        <div className="field">
          <label>我已有加入密钥</label>
          <textarea value={secret} onChange={(event) => setSecret(event.target.value)} placeholder="从已经加入的电脑复制“加入密钥”，粘贴到这里" />
        </div>
        <button className="secondary wide" disabled={!secret.trim()} onClick={() => onJoin(secret, name)}>
          加入这个家庭网络
        </button>
      </section>
    </main>
  );
}

function DeviceSidebar({
  state,
  selectedPeerIds,
  selectedPeerId,
  onTogglePeer,
  onSelectPeer,
  onUpdatePreference
}: {
  state: AppStateView;
  selectedPeerIds: string[];
  selectedPeerId: string;
  onTogglePeer: (peerId: string) => void;
  onSelectPeer: (peerId: string) => void;
  onUpdatePreference: (peerId: string, patch: Partial<DevicePreference>) => void;
}) {
  const [query, setQuery] = useState('');
  const filteredPeers = state.peers.filter((peer) => {
    const text = `${peer.name} ${peer.alias || ''} ${peer.room || ''} ${peer.address}`.toLowerCase();
    return text.includes(query.trim().toLowerCase());
  });
  const rooms = filteredPeers.reduce<Record<string, PeerInfo[]>>((acc, peer) => {
    const room = peer.room || '未分组';
    if (!acc[room]) acc[room] = [];
    acc[room].push(peer);
    return acc;
  }, {});
  const roomNames = Object.keys(rooms).sort((a, b) => (a === '未分组' ? 1 : b === '未分组' ? -1 : a.localeCompare(b)));
  return (
    <aside className="sidebar">
      <div className="localDevice">
        <div className="avatar"><Laptop size={22} /></div>
        <div>
          <strong>{state.device.name}</strong>
          <span>{state.device.platform} · {state.networkInfo.controlPort}</span>
        </div>
      </div>
      <div className="sideHeader">
        <span>在线设备</span>
        <strong>{state.peers.filter((peer) => peer.isOnline).length}</strong>
      </div>
      <label className="sideSearch">
        <Search size={15} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索设备、房间或 IP" />
      </label>
      <div className="peerList">
        {filteredPeers.length ? roomNames.map((room) => (
          <section className="peerRoom" key={room}>
            <h3>{room}<span>{rooms[room].length}</span></h3>
            {rooms[room].map((peer) => (
              <button
                className={`peerRow ${peer.id === selectedPeerId ? 'active' : ''}`}
                key={peer.id}
                type="button"
                onClick={() => onSelectPeer(peer.id)}
              >
                <span className={`onlineDot ${peer.isOnline ? 'on' : ''}`} />
                <span className="peerText">
                  <strong>{peerLabel(peer)}{peer.unreadCount ? <em className="unreadBadge">{peer.unreadCount}</em> : null}</strong>
                  <small>{peer.name} · {peer.address}</small>
                </span>
                <span
                  className="checkHit starHit"
                  onClick={(event) => {
                    event.stopPropagation();
                    onUpdatePreference(peer.id, { favorite: !peer.favorite });
                  }}
                  title="收藏设备"
                >
                  <Star size={16} fill={peer.favorite ? 'currentColor' : 'none'} />
                </span>
                <span
                  className="checkHit"
                  onClick={(event) => {
                    event.stopPropagation();
                    onTogglePeer(peer.id);
                  }}
                  title="批量命令目标"
                >
                  {selectedPeerIds.includes(peer.id) ? <CheckCircle2 size={18} /> : <Circle size={18} />}
                </span>
              </button>
            ))}
          </section>
        )) : <div className="empty">等待使用同一加入密钥的设备出现。</div>}
      </div>
    </aside>
  );
}

function Dashboard({
  state,
  selectedPeer,
  selectedPeerIds,
  remoteSessions,
  onRunCommand,
  onOpenTerminal,
  onOpenScreen,
  onOpenRemote,
  onUpdatePreference,
  onOpenChat,
  onOpenFiles,
  setView
}: {
  state: AppStateView;
  selectedPeer: PeerInfo | null;
  selectedPeerIds: string[];
  remoteSessions: RemoteSessionRecord[];
  onRunCommand: (command: string, peerIds?: string[]) => void;
  onOpenTerminal: (peer: PeerInfo) => void;
  onOpenScreen: (peer: PeerInfo) => void;
  onOpenRemote: (peer: PeerInfo) => void;
  onUpdatePreference: (peerId: string, patch: Partial<DevicePreference>) => void;
  onOpenChat: () => void;
  onOpenFiles: () => void;
  setView: (view: View) => void;
}) {
  const [command, setCommand] = useState('hostname');
  const [alias, setAlias] = useState('');
  const [room, setRoom] = useState('');
  const selectedPeers = state.peers.filter((peer) => selectedPeerIds.includes(peer.id));
  const writableSelectedPeers = selectedPeers.filter((peer) => peer.isOnline && peer.trusted && !peer.readOnly);
  const onlinePeers = state.peers.filter((peer) => peer.isOnline && peer.trusted);
  const writableOnlinePeers = onlinePeers.filter((peer) => !peer.readOnly);
  const allPeers = state.peers;
  const recentTasks = state.tasks.slice(0, 4);
  const activeRemoteSessions = remoteSessions.filter((sessionItem) => !sessionItem.endedAt).slice(0, 6);
  useEffect(() => {
    setAlias(selectedPeer?.alias || '');
    setRoom(selectedPeer?.room || '');
  }, [selectedPeer?.id, selectedPeer?.alias, selectedPeer?.room]);
  return (
    <section className="workspace">
      <header className="workspaceHeader">
        <div>
          <h1>多设备工作台</h1>
          <p>{state.home?.name} · {onlinePeers.length} 台在线 · 命令、终端、看屏和远程桌面控制集中在这里</p>
        </div>
        <div className="headerStats">
          <span>{state.peers.length} 台已发现</span>
          <span>{writableSelectedPeers.length || writableOnlinePeers.length} 个命令目标</span>
        </div>
        <button className="secondary" onClick={() => setView('settings')}><Settings size={16} /> 设置</button>
      </header>

      <div className="workbenchGrid">
        <div className="workbenchMain">
          <section className="currentDeviceHero">
            <div>
              <span className={`statusPill ${statusClass(selectedPeer)}`}>
                {selectedPeer ? statusText(selectedPeer) : '等待设备'}
              </span>
              <h2>{peerLabel(selectedPeer)}</h2>
              <p>{selectedPeer ? `${selectedPeer.name} · ${selectedPeer.address}:${selectedPeer.controlPort} · ${selectedPeer.platform}` : '把另一台 Windows/Mac 用同一个加入密钥加入后会显示在这里。'}</p>
            </div>
            <div className="heroActions">
              <button className="primary heroRemote" disabled={!selectedPeer?.isOnline || !selectedPeer?.trusted || selectedPeer?.readOnly} onClick={() => selectedPeer && onOpenRemote(selectedPeer)}>
                <MousePointer2 size={18} /> 远程控制
              </button>
              <button className="secondary" disabled={!selectedPeer?.isOnline || !selectedPeer?.trusted} onClick={() => selectedPeer && onOpenScreen(selectedPeer)}><ScreenShare size={16} /> 看屏</button>
              <button className="secondary" disabled={!selectedPeer?.isOnline || !selectedPeer?.trusted || selectedPeer?.readOnly} onClick={() => selectedPeer && onOpenTerminal(selectedPeer)}><TerminalSquare size={16} /> 终端</button>
            </div>
          </section>

          <section className="commandBand">
            <div>
              <h2>批量远程命令</h2>
              <p>目标：{writableSelectedPeers.length ? writableSelectedPeers.map((peer) => peerLabel(peer)).join('、') : '全部可写在线设备'}</p>
            </div>
            <div className="commandInput">
              <input value={command} onChange={(event) => setCommand(event.target.value)} onKeyDown={(event) => {
                if (event.key === 'Enter' && (writableSelectedPeers.length || writableOnlinePeers.length)) {
                  onRunCommand(command, writableSelectedPeers.map((peer) => peer.id));
                }
              }} />
              <button className="primary" disabled={!command.trim() || !(writableSelectedPeers.length || writableOnlinePeers.length)} onClick={() => onRunCommand(command, writableSelectedPeers.map((peer) => peer.id))}>
                <Play size={16} /> 执行
              </button>
            </div>
          </section>

          <div className="deviceGrid">
            {allPeers.length ? allPeers.map((peer) => (
              <article className={`deviceTile ${selectedPeerIds.includes(peer.id) ? 'selected' : ''}`} key={peer.id}>
                <div className="deviceTileTop">
                  <span className={`statusPill ${statusClass(peer)}`}>{statusText(peer)}</span>
                  <span>{peer.room || '未分组'}</span>
                </div>
                <h3>{peerLabel(peer)}</h3>
                <p>{peer.name} · {peer.address}:{peer.controlPort} · ID {peer.id.slice(0, 8)}</p>
                <div className="capList">
                  {peer.capabilities.filter((cap) => !cap.includes('agent') && !cap.includes('iot')).slice(0, 8).map((cap) => <span key={cap}>{cap}</span>)}
                </div>
                <div className="tileActions">
                  <button className="tilePrimary" disabled={!peer.isOnline || !peer.trusted || peer.readOnly} onClick={() => onOpenRemote(peer)}><MousePointer2 size={15} /> 远控</button>
                  <button disabled={!peer.isOnline || !peer.trusted} onClick={() => onOpenScreen(peer)}><ScreenShare size={15} /> 看屏</button>
                  <button disabled={!peer.isOnline || !peer.trusted || peer.readOnly} onClick={() => onOpenTerminal(peer)}><TerminalSquare size={15} /> 终端</button>
                </div>
              </article>
            )) : <div className="empty deviceEmpty">还没有发现其他设备。把另一台 Windows/Mac 打开 App，用同一个加入密钥加入后会显示在这里。</div>}
          </div>
        </div>

        <aside className="toolShelf">
          <section className="toolPanel">
            <h2><LayoutGrid size={17} /> 当前设备</h2>
            {selectedPeer ? (
              <>
                <div className="deviceIdentity">
                  <strong>{peerLabel(selectedPeer)}</strong>
                  <span>{selectedPeer.address}:{selectedPeer.controlPort}</span>
                </div>
                <label className="compactField">
                  <span>别名</span>
                  <input value={alias} onChange={(event) => setAlias(event.target.value)} onBlur={() => onUpdatePreference(selectedPeer.id, { alias })} placeholder={selectedPeer.name} />
                </label>
                <label className="compactField">
                  <span>房间/分组</span>
                  <input value={room} onChange={(event) => setRoom(event.target.value)} onBlur={() => onUpdatePreference(selectedPeer.id, { room })} placeholder="书房、卧室、客厅..." />
                </label>
                <div className="toggleStack">
                  <button className={selectedPeer.favorite ? 'toggleButton on' : 'toggleButton'} onClick={() => onUpdatePreference(selectedPeer.id, { favorite: !selectedPeer.favorite })}>
                    <Star size={15} fill={selectedPeer.favorite ? 'currentColor' : 'none'} /> 收藏
                  </button>
                  <button className={selectedPeer.readOnly ? 'toggleButton warn' : 'toggleButton'} onClick={() => onUpdatePreference(selectedPeer.id, { readOnly: !selectedPeer.readOnly })}>
                    {selectedPeer.readOnly ? <ShieldAlert size={15} /> : <ShieldCheck size={15} />} {selectedPeer.readOnly ? '只读模式' : '可控制'}
                  </button>
                  <button className={selectedPeer.notificationsMuted ? 'toggleButton warn' : 'toggleButton'} onClick={() => onUpdatePreference(selectedPeer.id, { notificationsMuted: !selectedPeer.notificationsMuted })}>
                    {selectedPeer.notificationsMuted ? <EyeOff size={15} /> : <Eye size={15} />} {selectedPeer.notificationsMuted ? '消息静音' : '消息提醒'}
                  </button>
                </div>
                <div className="miniStats">
                  <span>最近控制：{formatRelativeTime(selectedPeer.lastControlledAt)}</span>
                  <span>状态：{statusText(selectedPeer)}</span>
                  <span>能力：{selectedPeer.capabilities.length}</span>
                </div>
              </>
            ) : <div className="empty">选择一台设备查看快捷工具。</div>}
          </section>

          <section className="toolPanel">
            <h2><MousePointer2 size={17} /> 快捷操作</h2>
            <div className="quickToolGrid">
              <button disabled={!selectedPeer?.isOnline || !selectedPeer?.trusted || selectedPeer?.readOnly} onClick={() => selectedPeer && onOpenRemote(selectedPeer)}><MousePointer2 size={15} /> 远控</button>
              <button disabled={!selectedPeer?.isOnline || !selectedPeer?.trusted} onClick={() => selectedPeer && onOpenScreen(selectedPeer)}><ScreenShare size={15} /> 截屏/看屏</button>
              <button disabled={!selectedPeer?.isOnline || !selectedPeer?.trusted || selectedPeer?.readOnly} onClick={() => selectedPeer && onOpenTerminal(selectedPeer)}><TerminalSquare size={15} /> 终端</button>
              <button disabled={!selectedPeer} onClick={onOpenChat}><MessageSquare size={15} /> 聊天</button>
              <button disabled={!selectedPeer} onClick={onOpenFiles}><FileDown size={15} /> 文件</button>
              <button onClick={() => setView('tasks')}><TerminalSquare size={15} /> 任务</button>
            </div>
          </section>

          <section className="toolPanel">
            <h2><MonitorPlay size={17} /> 远控窗口</h2>
            <div className="remoteSessionList">
              {activeRemoteSessions.length ? activeRemoteSessions.map((sessionItem) => (
                <div className="remoteSessionItem" key={sessionItem.sessionId}>
                  <span className={`sessionDot ${sessionItem.status}`} />
                  <div>
                    <strong>{sessionItem.peerName}</strong>
                    <small>{sessionItem.mode === 'control' ? '远程控制' : '看屏'} · {sessionItem.status} · {formatRelativeTime(sessionItem.updatedAt)}</small>
                  </div>
                </div>
              )) : <div className="empty">没有活动远控窗口。</div>}
            </div>
          </section>

          <section className="toolPanel">
            <h2><TerminalSquare size={17} /> 最近任务</h2>
            <div className="miniTaskList">
              {recentTasks.length ? recentTasks.map((task) => (
                <button key={task.id} onClick={() => setView('tasks')}>
                  <span className={`statusPill ${task.status}`}>{task.status}</span>
                  <strong>{task.peerName}</strong>
                  <small>{task.command}</small>
                </button>
              )) : <div className="empty">暂无任务。</div>}
            </div>
          </section>
        </aside>
      </div>
    </section>
  );
}

function messageSearchText(message: any) {
  return [
    message.text,
    message.name,
    message.path,
    message.senderName,
    message.replyTo?.text,
    message.replyTo?.name
  ].filter(Boolean).join(' ').toLowerCase();
}

function replyRefFromMessage(message: any) {
  return {
    id: String(message.id),
    type: message.type === 'file' ? 'file' as const : 'text' as const,
    senderName: message.senderName,
    text: message.type === 'text' ? String(message.text || '').slice(0, 240) : undefined,
    name: message.type === 'file' ? String(message.name || '').slice(0, 180) : undefined,
    createdAt: message.createdAt
  };
}

function renderInlineMarkdown(text: string) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).filter(Boolean);
  return parts.map((part, index) => {
    if (part.startsWith('`') && part.endsWith('`')) return <code key={index}>{part.slice(1, -1)}</code>;
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>;
    return <React.Fragment key={index}>{part}</React.Fragment>;
  });
}

function renderMessageMarkdown(text = '') {
  const blocks: React.ReactNode[] = [];
  const pattern = /```([A-Za-z0-9_-]*)\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    if (match.index > lastIndex) {
      blocks.push(<p key={`p-${lastIndex}`}>{renderInlineMarkdown(text.slice(lastIndex, match.index))}</p>);
    }
    blocks.push(
      <pre key={`code-${match.index}`}><code>{match[2].trimEnd()}</code></pre>
    );
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < text.length || !blocks.length) {
    blocks.push(<p key={`p-${lastIndex}`}>{renderInlineMarkdown(text.slice(lastIndex))}</p>);
  }
  return <div className="messageMarkdown">{blocks}</div>;
}

function ChatView({ peer, messages, onSendText, onSendFile, onReact }: {
  peer: PeerInfo | null;
  messages: any[];
  onSendText: (text: string, options?: { replyTo?: ReturnType<typeof replyRefFromMessage> }) => void;
  onSendFile: (file: File) => void;
  onReact: (messageId: string, emoji: string) => void;
}) {
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [replyTo, setReplyTo] = useState<any | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const filteredMessages = messages.filter((message) => !query.trim() || messageSearchText(message).includes(query.trim().toLowerCase()));
  if (!peer) {
    return <section className="workspace centerHint">选择一台设备开始聊天。</section>;
  }
  return (
    <section className="chatPane">
      <header className="workspaceHeader">
        <div>
          <h1>{peer.name}</h1>
          <p>支持搜索、回复、代码块和 reaction，旧设备会自动降级为普通文本消息</p>
        </div>
      </header>
      <div className="chatToolbar">
        <Search size={16} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索消息、文件或引用" />
      </div>
      <div className="messages">
        {filteredMessages.length ? filteredMessages.map((message) => (
          <div className={`message ${message.direction}`} key={message.id}>
            <div className="bubble">
              {message.replyTo ? (
                <button className="replyQuote" onClick={() => setQuery(message.replyTo?.text || message.replyTo?.name || '')}>
                  <strong>{message.replyTo.senderName || '引用消息'}</strong>
                  <span>{message.replyTo.type === 'file' ? message.replyTo.name : message.replyTo.text}</span>
                </button>
              ) : null}
              {message.type === 'text' ? renderMessageMarkdown(message.text || '') : (
                <div className="fileBubble">
                  <strong>{message.name}</strong>
                  <small>{formatBytes(message.size)}</small>
                  {message.path ? <small>{message.path}</small> : null}
                </div>
              )}
              {message.reactions ? (
                <div className="reactionSummary">
                  {Object.entries(message.reactions).map(([emoji, actors]) => (
                    <button key={emoji} onClick={() => onReact(message.id, emoji)}>
                      <span>{emoji}</span>
                      <small>{Array.isArray(actors) ? actors.length : 0}</small>
                    </button>
                  ))}
                </div>
              ) : null}
              <div className="messageActions">
                <button title="回复" onClick={() => setReplyTo(message)}><Reply size={13} /></button>
                {CHAT_REACTION_EMOJIS.map((emoji) => (
                  <button title={`发送 ${emoji}`} key={emoji} onClick={() => onReact(message.id, emoji)}>{emoji}</button>
                ))}
              </div>
              <time>{formatTime(message.createdAt)}</time>
            </div>
          </div>
        )) : <div className="empty">{query.trim() ? '没有匹配的消息。' : '还没有消息。'}</div>}
      </div>
      <footer className="composer">
        <input
          hidden
          ref={fileRef}
          type="file"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onSendFile(file);
            event.target.value = '';
          }}
        />
        <button className="secondary" onClick={() => fileRef.current?.click()}><Upload size={16} /> 文件</button>
        <div className="composerText">
          {replyTo ? (
            <div className="replyDraft">
              <span>回复 {replyTo.senderName || (replyTo.direction === 'outgoing' ? '我' : peer.name)}：{replyTo.type === 'file' ? replyTo.name : replyTo.text}</span>
              <button onClick={() => setReplyTo(null)}>取消</button>
            </div>
          ) : null}
          <textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="输入消息，支持 **加粗**、`代码` 和 ```代码块```" />
        </div>
        <button className="primary" disabled={!text.trim()} onClick={() => {
          onSendText(text, replyTo ? { replyTo: replyRefFromMessage(replyTo) } : undefined);
          setText('');
          setReplyTo(null);
        }}><Send size={16} /> 发送</button>
      </footer>
    </section>
  );
}

function FilesView({
  state,
  peer,
  onChooseFolder,
  onClearFolder,
  onSetFileSharing,
  onListRemote,
  onPreview,
  onDownload,
  onUpload
}: {
  state: AppStateView;
  peer: PeerInfo | null;
  onChooseFolder: () => void;
  onClearFolder: () => void;
  onSetFileSharing: (enabled: boolean) => void;
  onListRemote: (path: string) => Promise<SharedFolderListing>;
  onPreview: (path: string) => Promise<PreviewToken>;
  onUpload: (path: string, file: File) => Promise<void>;
  onDownload: (path: string) => Promise<{ filePath: string; name: string; size: number } | void>;
}) {
  const [listing, setListing] = useState<SharedFolderListing | null>(null);
  const [remotePath, setRemotePath] = useState('');
  const [selectedEntry, setSelectedEntry] = useState<SharedFileEntry | null>(null);
  const [preview, setPreview] = useState<PreviewToken | null>(null);
  const [busy, setBusy] = useState(false);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [downloadResult, setDownloadResult] = useState('');
  const [dragging, setDragging] = useState(false);
  const [pathInput, setPathInput] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [sortMode, setSortMode] = useState('name');
  const [showHidden, setShowHidden] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);
  const canBrowse = Boolean(peer?.isOnline && peer.trusted);
  const canUpload = Boolean(canBrowse && listing?.writable && !peer?.readOnly);
  const selectedKind = previewKind(selectedEntry, preview?.mime || '');
  const visibleEntries = useMemo(() => {
    const entries = [...(listing?.entries || [])].filter((entry) => {
      if (!showHidden && entry.name.startsWith('.')) return false;
      if (typeFilter === 'all') return true;
      if (typeFilter === 'folder') return entry.type === 'directory';
      if (entry.type !== 'file') return false;
      return previewKind(entry) === typeFilter;
    });
    return entries.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      if (sortMode === 'size') return b.size - a.size || a.name.localeCompare(b.name);
      if (sortMode === 'modified') return b.modifiedAt - a.modifiedAt || a.name.localeCompare(b.name);
      return a.name.localeCompare(b.name);
    });
  }, [listing?.entries, showHidden, typeFilter, sortMode]);

  async function load(pathValue = '') {
    if (!canBrowse) return;
    setBusy(true);
    try {
      const next = await onListRemote(pathValue);
      setListing(next);
      setRemotePath(next.currentPath || '');
      setPathInput(next.currentPath || '');
      setSelectedEntry(null);
      setPreview(null);
      setDownloadResult('');
    } finally {
      setBusy(false);
    }
  }

  async function selectEntry(entry: SharedFileEntry) {
    setSelectedEntry(entry);
    setPreview(null);
    setDownloadResult('');
    if (entry.type !== 'file') return;
    const kind = previewKind(entry);
    if (kind === 'download') return;
    setPreviewBusy(true);
    try {
      setPreview(await onPreview(entry.relativePath));
    } finally {
      setPreviewBusy(false);
    }
  }

  async function downloadEntry(entry = selectedEntry) {
    if (!entry || entry.type !== 'file') return;
    setDownloadBusy(true);
    setDownloadResult('');
    try {
      const result = await onDownload(entry.relativePath);
      if (result?.filePath) setDownloadResult(`已保存到 ${result.filePath}`);
    } finally {
      setDownloadBusy(false);
    }
  }

  async function uploadFiles(files: FileList | File[]) {
    const items = Array.from(files).filter((file) => file.size > 0);
    if (!items.length || !canUpload) return;
    setBusy(true);
    try {
      for (const file of items) {
        await onUpload(remotePath, file);
      }
      await load(remotePath);
    } finally {
      setDragging(false);
      setBusy(false);
    }
  }

  useEffect(() => {
    setListing(null);
    setRemotePath('');
    setSelectedEntry(null);
    setPreview(null);
    setDownloadResult('');
    if (peer?.isOnline && peer.trusted) load('');
  }, [peer?.id]);

  return (
    <section className="workspace">
      <header className="workspaceHeader">
        <div>
          <h1>文件中枢</h1>
          <p>{peer ? `${peerLabel(peer)} · ${listing?.displayPath || '文件库'}` : '选择一台设备'}</p>
        </div>
        <button className="secondary" disabled={!canBrowse || busy} onClick={() => load(remotePath)}><RefreshCw size={16} /> 刷新</button>
      </header>
      <div className="fileLayout">
        <section className="panel fileSharePanel">
          <div className="panelHeader">
            <div>
              <h2>本机文件库</h2>
              <p>{state.fileShareEnabled ? '共享中' : '已关闭'}</p>
            </div>
            <span className={`statusPill ${state.fileShareEnabled ? 'online' : 'offline'}`}>
              {state.fileShareEnabled ? '启用' : '关闭'}
            </span>
          </div>
          <div className="shareRootList">
            <div><HardDrive size={16} /><span>桌面、下载、文档、图片、视频、音乐</span></div>
            {state.sharedFolder ? <div><FolderOpen size={16} /><span>{state.sharedFolder}</span></div> : null}
          </div>
          <div className="rowActions">
            <button className="primary" onClick={() => onSetFileSharing(!state.fileShareEnabled)}>
              {state.fileShareEnabled ? <ShieldOff size={16} /> : <ShieldCheck size={16} />}
              {state.fileShareEnabled ? '关闭文件库' : '开启文件库'}
            </button>
            <button className="secondary" onClick={onChooseFolder}><FolderOpen size={16} /> 自选目录</button>
            <button className="secondary" disabled={!state.sharedFolder} onClick={onClearFolder}><Trash2 size={16} /> 移除自选</button>
          </div>
        </section>
        <section
          className={`panel remotePanel fileDropZone ${dragging ? 'dragging' : ''}`}
          onDragOver={(event) => {
            event.preventDefault();
            if (canUpload) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            uploadFiles(event.dataTransfer.files);
          }}
        >
          <div className="panelHeader">
            <div>
              <h2>{peer ? `${peerLabel(peer)} 的文件库` : '选择设备'}</h2>
              <div className="breadcrumb">
                {pathCrumbs(remotePath).map((crumb, index, items) => (
                  <React.Fragment key={crumb.path || 'root'}>
                    <button disabled={busy || index === items.length - 1} onClick={() => load(crumb.path)}>{crumb.label}</button>
                    {index < items.length - 1 ? <span>/</span> : null}
                  </React.Fragment>
                ))}
              </div>
            </div>
            <div className="rowActions">
              {remotePath ? <button className="secondary" onClick={() => load(parentPath(remotePath))}>上级</button> : null}
              <button className="secondary" disabled={!canUpload || busy} onClick={() => uploadRef.current?.click()}><Upload size={16} /> 上传</button>
              <input
                ref={uploadRef}
                hidden
                multiple
                type="file"
                onChange={(event) => {
                  if (event.currentTarget.files) uploadFiles(event.currentTarget.files);
                  event.currentTarget.value = '';
                }}
              />
            </div>
          </div>
          <div className="fileToolbar">
            <form onSubmit={(event) => {
              event.preventDefault();
              load(pathInput);
            }}>
              <input value={pathInput} onChange={(event) => setPathInput(event.target.value)} placeholder="输入远端文件库路径，例如 Downloads" />
              <button className="secondary" disabled={!canBrowse || busy}>跳转</button>
            </form>
            <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
              <option value="all">全部类型</option>
              <option value="folder">文件夹</option>
              <option value="image">图片</option>
              <option value="video">视频</option>
              <option value="audio">音频</option>
              <option value="pdf">PDF</option>
              <option value="download">其他文件</option>
            </select>
            <select value={sortMode} onChange={(event) => setSortMode(event.target.value)}>
              <option value="name">按名称</option>
              <option value="modified">按修改时间</option>
              <option value="size">按大小</option>
            </select>
            <label className="toggleLine"><input type="checkbox" checked={showHidden} onChange={(event) => setShowHidden(event.target.checked)} /> 显示隐藏项</label>
          </div>
          {!peer ? <div className="empty">先选择一台设备。</div> : !peer.trusted ? <div className="empty">这台设备还没有被信任。</div> : !peer.isOnline ? <div className="empty">设备离线。</div> : busy ? <div className="empty">正在处理文件...</div> : (
            <div className="remoteFileWorkspace">
              <div>
                {visibleEntries.length ? (
                  <div className="fileList">
                    <div className="fileListHead">
                      <span>名称</span>
                      <span>大小</span>
                      <span>修改时间</span>
                      <span>操作</span>
                    </div>
                    {visibleEntries.map((entry) => (
                      <div className={`fileRow ${selectedEntry?.relativePath === entry.relativePath ? 'selected' : ''}`} key={entry.relativePath}>
                        <button className="fileRowMain" onDoubleClick={() => entry.type === 'directory' && load(entry.relativePath)} onClick={() => entry.type === 'directory' ? load(entry.relativePath) : selectEntry(entry)}>
                          <span className="fileTypeIcon">{fileIcon(entry)}</span>
                          <strong title={entry.name}>{entry.name}</strong>
                        </button>
                        <small>{entry.type === 'file' ? formatBytes(entry.size) : ''}</small>
                        <small>{formatTime(entry.modifiedAt)}</small>
                        {entry.type === 'directory' ? (
                          <button className="linkAction" onClick={() => load(entry.relativePath)}>打开</button>
                        ) : (
                          <button className="linkAction" disabled={downloadBusy} onClick={() => downloadEntry(entry)}><Download size={14} /> 下载</button>
                        )}
                      </div>
                    ))}
                  </div>
                ) : <div className="empty">{remotePath ? '没有符合筛选条件的文件。' : '远端没有可用文件库。'}</div>}
              </div>
              <aside className="previewPane">
                <div className="previewHeader">
                  <div>
                    <h3>{selectedEntry?.name || '选择文件预览'}</h3>
                    <p>{selectedEntry?.type === 'file' ? `${formatBytes(selectedEntry.size)} · ${preview?.mime || '文件'}` : '图片、视频、音频和 PDF 可直接预览'}</p>
                  </div>
                  <button className="secondary" disabled={!selectedEntry || selectedEntry.type !== 'file' || downloadBusy} onClick={() => downloadEntry()}>
                    <Download size={15} /> {downloadBusy ? '下载中' : '下载'}
                  </button>
                </div>
                {!selectedEntry ? (
                  <div className="previewEmpty">单击一个文件查看详情，双击文件夹进入目录。</div>
                ) : selectedEntry.type === 'directory' ? (
                  <div className="previewEmpty">这是文件夹，双击或点击“打开”进入。</div>
                ) : previewBusy ? (
                  <div className="previewEmpty">正在准备在线预览...</div>
                ) : selectedKind === 'image' && preview ? (
                  <img className="filePreviewMedia" src={preview.url} alt={selectedEntry.name} />
                ) : selectedKind === 'video' && preview ? (
                  <video className="filePreviewMedia" src={preview.url} controls preload="metadata" />
                ) : selectedKind === 'audio' && preview ? (
                  <div className="audioPreview"><Music2 size={34} /><audio src={preview.url} controls /></div>
                ) : selectedKind === 'pdf' && preview ? (
                  <iframe className="pdfPreview" title={selectedEntry.name} src={preview.url} />
                ) : (
                  <div className="previewEmpty">这种文件暂不适合在线预览，可以直接下载。</div>
                )}
                {downloadResult ? <p className="downloadResult">{downloadResult}</p> : null}
              </aside>
            </div>
          )}
          {canUpload ? <div className="dropHint">拖拽文件到这里上传到当前目录。</div> : null}
        </section>
      </div>
    </section>
  );
}

function TasksView({ tasks }: { tasks: TaskRecord[] }) {
  const [expanded, setExpanded] = useState<string | null>(tasks[0]?.id || null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [peerFilter, setPeerFilter] = useState('all');
  const peerNames = Array.from(new Set(tasks.map((task) => task.peerName))).sort();
  const filteredTasks = tasks.filter((task) => {
    const text = `${task.peerName} ${task.command} ${task.output} ${task.errorOutput}`.toLowerCase();
    return (!query.trim() || text.includes(query.trim().toLowerCase()))
      && (statusFilter === 'all' || task.status === statusFilter)
      && (peerFilter === 'all' || task.peerName === peerFilter);
  });
  function taskText(task: TaskRecord) {
    return [
      `[${task.status}] ${task.peerName}`,
      task.command,
      '',
      'stdout:',
      task.output || '',
      '',
      'stderr:',
      task.errorOutput || ''
    ].join('\n');
  }
  return (
    <section className="workspace">
      <header className="workspaceHeader">
        <div>
          <h1>任务日志</h1>
          <p>远程命令按设备保存，stdout 和 stderr 分开显示。</p>
        </div>
      </header>
      <div className="taskToolbar">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索命令、设备或输出" />
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
          <option value="all">全部状态</option>
          <option value="running">运行中</option>
          <option value="completed">成功</option>
          <option value="failed">失败</option>
          <option value="cancelled">已取消</option>
        </select>
        <select value={peerFilter} onChange={(event) => setPeerFilter(event.target.value)}>
          <option value="all">全部设备</option>
          {peerNames.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
      </div>
      <div className="taskList">
        {filteredTasks.length ? filteredTasks.map((task) => (
          <article className={`taskItem ${expanded === task.id ? 'expanded' : ''}`} key={task.id}>
            <button className="taskSummary" onClick={() => setExpanded(expanded === task.id ? null : task.id)}>
              <span className={`statusPill ${task.status}`}>{task.status}</span>
              <strong>{task.peerName}</strong>
              <span>{formatTime(task.startedAt)}</span>
              <span>{formatDuration(task.startedAt, task.endedAt)}</span>
              <span>{task.exitCode === undefined || task.exitCode === null ? '' : `exit ${task.exitCode}`}</span>
            </button>
            <code>{task.command}</code>
            {expanded === task.id ? (
              <>
              <div className="taskActions">
                <button className="secondary" onClick={() => navigator.clipboard.writeText(taskText(task))}><Copy size={14} /> 复制输出</button>
                <button className="secondary" onClick={() => {
                  const blob = new Blob([taskText(task)], { type: 'text/plain;charset=utf-8' });
                  const url = URL.createObjectURL(blob);
                  const link = document.createElement('a');
                  link.href = url;
                  link.download = `lch-task-${task.id}.log`;
                  link.click();
                  URL.revokeObjectURL(url);
                }}><Download size={14} /> 导出</button>
              </div>
              <div className="taskOutputGrid">
                <section>
                  <h3>stdout</h3>
                  <pre>{task.output || '无输出'}</pre>
                </section>
                <section>
                  <h3>stderr</h3>
                  <pre>{task.errorOutput || '无错误输出'}</pre>
                </section>
              </div>
              </>
            ) : (
              <div className="taskPreview">{(task.output || task.errorOutput || '等待输出...').slice(0, 240)}</div>
            )}
          </article>
        )) : <div className="empty">没有符合条件的任务。</div>}
      </div>
    </section>
  );
}

function TransfersView({
  transfers,
  onCancel,
  onShowFile,
  onOpenPath
}: {
  transfers: TransferRecord[];
  onCancel: (transferId: string) => void;
  onShowFile: (filePath: string) => void;
  onOpenPath: (filePath: string) => void;
}) {
  const [statusFilter, setStatusFilter] = useState('all');
  const [query, setQuery] = useState('');
  const filtered = transfers.filter((transfer) => {
    const text = `${transfer.name} ${transfer.peerName} ${transfer.relativePath || ''} ${transfer.localPath || ''} ${transfer.error || ''}`.toLowerCase();
    return (statusFilter === 'all' || transfer.status === statusFilter)
      && (!query.trim() || text.includes(query.trim().toLowerCase()));
  });
  return (
    <section className="workspace">
      <header className="workspaceHeader">
        <div>
          <h1>传输</h1>
          <p>文件库的大文件上传和下载记录，包含进度、速度、校验和失败原因。</p>
        </div>
      </header>
      <div className="taskToolbar">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索文件、设备、路径或错误" />
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
          <option value="all">全部状态</option>
          <option value="running">运行中</option>
          <option value="queued">排队中</option>
          <option value="completed">已完成</option>
          <option value="failed">失败</option>
          <option value="cancelled">已取消</option>
        </select>
      </div>
      <div className="transferList">
        {filtered.length ? filtered.map((transfer) => {
          const percent = transfer.size ? Math.min(100, Math.round((transfer.transferredBytes / transfer.size) * 100)) : 0;
          const running = transfer.status === 'running' || transfer.status === 'queued';
          return (
            <article className="transferItem" key={transfer.id}>
              <div className="transferHead">
                <span className={`statusPill ${transfer.status}`}>{transfer.status}</span>
                <strong title={transfer.name}>{transfer.name}</strong>
                <span>{transfer.direction === 'upload' ? '上传到' : '下载自'} {transfer.peerName}</span>
              </div>
              <div className="transferProgress"><span style={{ width: `${percent}%` }} /></div>
              <div className="transferMeta">
                <span>{formatBytes(transfer.transferredBytes)} / {formatBytes(transfer.size)}</span>
                <span>{transfer.speedBytesPerSecond ? `${formatBytes(transfer.speedBytesPerSecond)}/s` : ''}</span>
                <span>{formatDuration(transfer.startedAt, transfer.endedAt)}</span>
                <span>{formatTime(transfer.updatedAt)}</span>
              </div>
              {transfer.sha256 ? <code className="transferHash">SHA256 {transfer.sha256}</code> : null}
              {transfer.error ? <p className="transferError">{transfer.error}</p> : null}
              <div className="taskActions">
                {running ? <button className="secondary" onClick={() => onCancel(transfer.id)}>取消</button> : null}
                {transfer.localPath ? <button className="secondary" onClick={() => onShowFile(transfer.localPath!)}>打开所在文件夹</button> : null}
                {transfer.localPath && transfer.status === 'completed' ? <button className="secondary" onClick={() => onOpenPath(transfer.localPath!)}>打开文件</button> : null}
              </div>
            </article>
          );
        }) : <div className="empty">没有符合条件的传输记录。</div>}
      </div>
    </section>
  );
}

function SetupSteps({ current = 'copy' }: { current?: 'copy' | 'join' | 'trust' | 'ready' }) {
  const steps = [
    ['copy', '复制加入密钥'],
    ['join', '新电脑粘贴加入'],
    ['trust', '双方点击信任'],
    ['ready', '回到工作台使用']
  ] as const;
  const activeIndex = Math.max(0, steps.findIndex(([id]) => id === current));
  return (
    <div className="setupSteps">
      {steps.map(([id, label], index) => (
        <div className={index <= activeIndex ? 'done' : ''} key={id}>
          <span>{index + 1}</span>
          <strong>{label}</strong>
        </div>
      ))}
    </div>
  );
}

function SettingsView({
  state,
  onUpdateName,
  onSetAutoTrust,
  onSetWebRtcConfig,
  onConnectManualPeer,
  onRemoveManualPeer,
  onRefreshManualPeers,
  onTrustDevice,
  onRevokeDevice
}: {
  state: AppStateView;
  onUpdateName: (name: string) => void;
  onSetAutoTrust: (enabled: boolean) => void;
  onSetWebRtcConfig: (config: WebRtcConfig) => Promise<unknown> | void;
  onConnectManualPeer: (address: string) => Promise<unknown> | void;
  onRemoveManualPeer: (address: string) => Promise<unknown> | void;
  onRefreshManualPeers: () => Promise<unknown> | void;
  onTrustDevice: (peerId: string) => void;
  onRevokeDevice: (peerId: string) => void;
}) {
  const [name, setName] = useState(state.device.name);
  const [settingsTab, setSettingsTab] = useState<'network' | 'trust' | 'files' | 'system'>('network');
  const [manualAddress, setManualAddress] = useState('');
  const [manualBusy, setManualBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [secretVisible, setSecretVisible] = useState(false);
  const [firewall, setFirewall] = useState<FirewallStatus | null>(null);
  const [firewallBusy, setFirewallBusy] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [icePolicy, setIcePolicy] = useState<WebRtcIceTransportPolicy>(state.webrtc?.iceTransportPolicy || 'all');
  const [iceDrafts, setIceDrafts] = useState<IceServerDraft[]>(() => webRtcDraftsFromConfig(state.webrtc));
  const [iceBusy, setIceBusy] = useState(false);
  const [iceSaved, setIceSaved] = useState(false);
  const iceConfigSignature = JSON.stringify(state.webrtc || DEFAULT_WEBRTC_CONFIG);
  const trustedDevices = Object.values(state.trustedDevices)
    .sort((a, b) => a.name.localeCompare(b.name));
  const pendingPeers = state.peers.filter((peer) => !peer.trusted);
  useEffect(() => setName(state.device.name), [state.device.name]);
  useEffect(() => {
    setIcePolicy(state.webrtc?.iceTransportPolicy || 'all');
    setIceDrafts(webRtcDraftsFromConfig(state.webrtc));
  }, [iceConfigSignature]);
  useEffect(() => {
    api.getFirewallStatus().then(setFirewall).catch(() => {});
  }, []);
  async function repairFirewall() {
    setFirewallBusy(true);
    try {
      setFirewall(await api.repairFirewall(true));
    } finally {
      setFirewallBusy(false);
    }
  }
  async function checkUpdates() {
    setUpdateBusy(true);
    try {
      setUpdateInfo(await api.checkUpdates());
    } finally {
      setUpdateBusy(false);
    }
  }
  async function connectManualAddress() {
    const address = manualAddress.trim();
    if (!address) return;
    setManualBusy(true);
    try {
      await onConnectManualPeer(address);
      setManualAddress('');
    } finally {
      setManualBusy(false);
    }
  }
  function updateIceDraft(id: string, patch: Partial<IceServerDraft>) {
    setIceSaved(false);
    setIceDrafts((current) => current.map((draft) => draft.id === id ? { ...draft, ...patch } : draft));
  }
  function removeIceDraft(id: string) {
    setIceSaved(false);
    setIceDrafts((current) => {
      const next = current.filter((draft) => draft.id !== id);
      return next.length ? next : [{ id: draftId(), urls: '', username: '', credential: '' }];
    });
  }
  async function saveIceConfig() {
    setIceBusy(true);
    try {
      await onSetWebRtcConfig(webRtcConfigFromDrafts(icePolicy, iceDrafts));
      setIceSaved(true);
      window.setTimeout(() => setIceSaved(false), 1400);
    } finally {
      setIceBusy(false);
    }
  }
  return (
    <section className="workspace">
      <header className="workspaceHeader">
        <div>
          <h1>设置</h1>
          <p>{state.device.name} 已加入“{state.home?.name}”。加入密钥只在添加新电脑时使用。</p>
        </div>
      </header>
      <div className="settingsTabs">
        {[
          ['network', '网络'],
          ['trust', '信任'],
          ['files', '文件共享'],
          ['system', '系统']
        ].map(([id, label]) => (
          <button key={id} className={settingsTab === id ? 'active' : ''} onClick={() => setSettingsTab(id as typeof settingsTab)}>{label}</button>
        ))}
      </div>
      <div className="settingsGrid">
        {settingsTab === 'network' ? <>
        <section className="panel settingsIdentity">
          <h2>本机设备名</h2>
          <div className="inlineEdit">
            <input value={name} onChange={(event) => setName(event.target.value)} />
            <button className="primary" onClick={() => onUpdateName(name)}>保存</button>
          </div>
          <div className="settingsMeta">
            <span>设备 ID：{state.device.id.slice(0, 8)}</span>
            <span>平台：{state.device.platform}</span>
            <span>控制端口：{state.networkInfo.controlPort}</span>
          </div>
        </section>
        <section className="panel settingsJoin">
          <h2>添加新设备</h2>
          <p>在新电脑打开最新版 App，选择“我已有加入密钥”，粘贴下面这串内容。新设备出现后，两台电脑都要在这里点击“信任”。</p>
          <SetupSteps current={pendingPeers.length ? 'trust' : 'copy'} />
          <p className="secretText">{secretVisible ? state.home?.secret : '•••• •••• •••• •••• •••• ••••'}</p>
          <div className="rowActions">
            <button className="secondary" onClick={() => setSecretVisible(!secretVisible)}>
              {secretVisible ? <EyeOff size={16} /> : <Eye size={16} />} {secretVisible ? '隐藏密钥' : '显示密钥'}
            </button>
            <button className="secondary" onClick={async () => {
              await navigator.clipboard.writeText(state.home?.secret || '');
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1200);
            }}><Clipboard size={16} /> {copied ? '已复制' : '复制加入密钥'}</button>
          </div>
        </section>
        <section className="panel settingsExternal">
          <div className="panelHeader">
            <div>
              <h2>外网 / Tailscale 连接</h2>
              <p>先让两台电脑加入同一个 Tailscale、ZeroTier 或 WireGuard 网络，并使用同一个加入密钥。这里填对方虚拟 IP，例如 100.x.x.x。</p>
            </div>
            <button className="secondary" onClick={() => onRefreshManualPeers()}><RefreshCw size={16} /> 刷新</button>
          </div>
          <div className="inlineEdit">
            <input value={manualAddress} onChange={(event) => setManualAddress(event.target.value)} placeholder="100.x.x.x 或 100.x.x.x:46882" />
            <button className="primary" disabled={manualBusy || !manualAddress.trim()} onClick={connectManualAddress}>{manualBusy ? '连接中' : '连接'}</button>
          </div>
          {state.manualPeerAddresses?.length ? (
            <div className="manualPeerRows">
              {state.manualPeerAddresses.map((item) => (
                <div className="manualPeerRow" key={item.address}>
                  <div>
                    <strong>{item.peerName || item.address}</strong>
                    <span>{item.address} · {item.status}{item.lastError ? ` · ${item.lastError}` : ''}</span>
                  </div>
                  <button className="secondary" onClick={() => onRemoveManualPeer(item.address)}><Trash2 size={15} /> 删除</button>
                </div>
              ))}
            </div>
          ) : <p>还没有手动添加的远程地址。</p>}
        </section>
        <section className="panel settingsWebrtc">
          <div className="panelHeader">
            <div>
              <h2>WebRTC 连接</h2>
              <p>默认不配置 ICE 服务器，继续优先使用局域网直连。跨网或公网虚拟专网不稳定时，再添加 STUN/TURN。</p>
            </div>
            <span className={`statusPill ${state.webrtc?.iceServers.length ? 'permission' : 'online'}`}>
              {state.webrtc?.iceServers.length ? `${state.webrtc.iceServers.length} 个 ICE` : '直连'}
            </span>
          </div>
          <div className="segmentedControl" role="group" aria-label="ICE 连接策略">
            <button type="button" className={icePolicy === 'all' ? 'active' : ''} onClick={() => { setIceSaved(false); setIcePolicy('all'); }}>直连优先</button>
            <button type="button" className={icePolicy === 'relay' ? 'active' : ''} onClick={() => { setIceSaved(false); setIcePolicy('relay'); }}>仅中继</button>
          </div>
          <div className="iceServerRows">
            {iceDrafts.map((draft, index) => (
              <div className="iceServerRow" key={draft.id}>
                <input
                  aria-label={`ICE URL ${index + 1}`}
                  value={draft.urls}
                  onChange={(event) => updateIceDraft(draft.id, { urls: event.target.value })}
                  placeholder="stun:stun.example.com:3478 或 turn:turn.example.com:3478"
                />
                <input
                  aria-label={`ICE 用户名 ${index + 1}`}
                  value={draft.username}
                  onChange={(event) => updateIceDraft(draft.id, { username: event.target.value })}
                  placeholder="用户名"
                />
                <input
                  aria-label={`ICE 凭据 ${index + 1}`}
                  type="password"
                  value={draft.credential}
                  onChange={(event) => updateIceDraft(draft.id, { credential: event.target.value })}
                  placeholder="凭据"
                />
                <button className="secondary iconButton" title="删除 ICE 服务器" onClick={() => removeIceDraft(draft.id)}>
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
          <div className="rowActions">
            <button className="secondary" onClick={() => { setIceSaved(false); setIceDrafts((current) => [...current, { id: draftId(), urls: '', username: '', credential: '' }]); }}>
              <Plus size={16} /> 添加服务器
            </button>
            <button className="primary" disabled={iceBusy} onClick={saveIceConfig}>
              <ShieldCheck size={16} /> {iceBusy ? '保存中' : iceSaved ? '已保存' : '保存连接配置'}
            </button>
          </div>
          <p className="settingsHint">配置只保存在本机，不会通过设备发现广播给其他设备；保存后仅影响新发起的屏幕共享和远程控制连接。</p>
        </section>
        </> : null}
        {settingsTab === 'trust' ? <>
        <section className="panel settingsTrust">
          <div className="panelHeader">
            <div>
              <h2>设备信任</h2>
              <p>{state.autoTrustDevices ? '新设备会自动加入信任列表' : '新设备需要手动信任'}</p>
            </div>
            <button className="secondary" onClick={() => onSetAutoTrust(!state.autoTrustDevices)}>
              {state.autoTrustDevices ? <ShieldAlert size={16} /> : <ShieldCheck size={16} />}
              {state.autoTrustDevices ? '关闭自动信任' : '开启自动信任'}
            </button>
          </div>
          {pendingPeers.length ? (
            <div className="trustList">
              {pendingPeers.map((peer) => (
                <div className="trustRow" key={peer.id}>
                  <div>
                    <strong>{peerLabel(peer)}</strong>
                    <span>{peer.address} · {peer.publicKeyHash}</span>
                  </div>
                  <button className="primary" onClick={() => onTrustDevice(peer.id)}><ShieldCheck size={16} /> 信任</button>
                </div>
              ))}
            </div>
          ) : <p>没有待信任设备。</p>}
        </section>
        <section className="panel settingsTrusted">
          <h2>已信任设备</h2>
          <div className="trustList">
            {trustedDevices.map((device) => (
              <div className="trustRow" key={device.id}>
                <div>
                  <strong>{device.name}{device.id === state.device.id ? '（本机）' : ''}</strong>
                  <span>{device.platform} · {device.publicKeyHash}</span>
                </div>
                <button className="secondary" disabled={device.id === state.device.id} onClick={() => onRevokeDevice(device.id)}>
                  <ShieldOff size={16} /> 撤销
                </button>
              </div>
            ))}
          </div>
        </section>
        </> : null}
        {settingsTab === 'system' ? <>
        <section className="panel settingsUpdate">
          <div className="panelHeader">
            <div>
              <h2>版本更新</h2>
              <p>当前版本：{APP_VERSION}。通过 GitHub Releases 获取最新版。</p>
            </div>
            <span className={`statusPill ${updateInfo?.updateAvailable ? 'permission' : 'online'}`}>
              {updateInfo?.updateAvailable ? '有新版本' : '最新检查'}
            </span>
          </div>
          {updateInfo ? (
            <div className="updateBox">
              <strong>{updateInfo.updateAvailable ? `可更新到 ${updateInfo.latestVersion}` : `当前已是 ${updateInfo.latestVersion}`}</strong>
              <span>{updateInfo.assets.length} 个附件 · {updateInfo.publishedAt ? formatTime(Date.parse(updateInfo.publishedAt)) : ''}</span>
            </div>
          ) : <p>点击检查后会读取 GitHub 的 latest release。未签名应用建议下载最新版安装包或便携版手动替换。</p>}
          <div className="rowActions">
            <button className="secondary" disabled={updateBusy} onClick={checkUpdates}><RefreshCw size={16} /> {updateBusy ? '检查中' : '检查更新'}</button>
            <button className="primary" onClick={() => api.openLatestRelease()}><Download size={16} /> 打开下载页</button>
          </div>
        </section>
        <section className="panel settingsApi">
          <h2>Local API</h2>
          <p>仅本机监听：127.0.0.1:{state.networkInfo.localApiPort}</p>
          <p>常用命令：lch devices、lch run --all "hostname"、lch file get --device &lt;设备&gt; &lt;路径&gt;</p>
        </section>
        <section className="panel firewallPanel">
          <h2>Windows 防火墙</h2>
          <p>{firewall?.message || '正在检查本机防火墙状态...'}</p>
          {firewall?.supported ? (
            <div className="firewallMeta">
              <span>阻止规则：{firewall.blockRules}</span>
              <span>允许规则：{firewall.allowRules}</span>
            </div>
          ) : null}
          <div className="rowActions">
            <button className="secondary" disabled={firewallBusy} onClick={() => api.getFirewallStatus().then(setFirewall)}>
              <RefreshCw size={16} /> 刷新
            </button>
            <button className="primary" disabled={firewallBusy || !firewall?.canRepair} onClick={repairFirewall}>
              <ShieldCheck size={16} /> {firewallBusy ? '修复中' : '修复防火墙'}
            </button>
          </div>
        </section>
        </> : null}
        {settingsTab === 'files' ? (
          <section className="panel settingsFiles">
            <h2>文件共享</h2>
            <p>文件共享开关和自选目录在“文件中枢”的本机文件库面板中管理。当前状态：{state.fileShareEnabled ? '已开启' : '已关闭'}。</p>
            <p>{state.sharedFolder ? `自选目录：${state.sharedFolder}` : '未设置自选目录。'}</p>
          </section>
        ) : null}
      </div>
    </section>
  );
}

function TerminalModal({ terminal, onInput, onResize, onClose }: {
  terminal: TerminalTab | null;
  onInput: (text: string) => void;
  onResize: (cols: number, rows: number) => void;
  onClose: () => void;
}) {
  const outputRef = useRef<HTMLPreElement | null>(null);
  const terminalSurfaceRef = useRef<HTMLDivElement | null>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const lastOutputRef = useRef('');
  const lastSizeRef = useRef('');
  const onInputRef = useRef(onInput);
  const onResizeRef = useRef(onResize);
  const [input, setInput] = useState('');
  useEffect(() => {
    onInputRef.current = onInput;
  }, [onInput]);
  useEffect(() => {
    onResizeRef.current = onResize;
  }, [onResize]);
  useEffect(() => {
    if (terminal?.backend !== 'pty' && outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [terminal?.backend, terminal?.output]);
  useEffect(() => setInput(''), [terminal?.terminalId]);
  useEffect(() => {
    if (!terminal || terminal.backend !== 'pty' || !terminalSurfaceRef.current) return;
    const xterm = new XTerm({
      cursorBlink: true,
      fontFamily: 'Cascadia Mono, Consolas, Menlo, Monaco, monospace',
      fontSize: 13,
      scrollback: 5000,
      theme: {
        background: '#07110f',
        foreground: '#d9f7ef',
        cursor: '#8cebd5',
        selectionBackground: '#27564d'
      }
    });
    const fitAddon = new FitAddon();
    xterm.loadAddon(fitAddon);
    xterm.open(terminalSurfaceRef.current);
    xtermRef.current = xterm;
    lastOutputRef.current = '';
    lastSizeRef.current = '';

    const sendResize = () => {
      try {
        fitAddon.fit();
        const key = `${xterm.cols}:${xterm.rows}`;
        if (key !== lastSizeRef.current) {
          lastSizeRef.current = key;
          onResizeRef.current(xterm.cols, xterm.rows);
        }
      } catch {
        // The terminal can be measured before layout is stable.
      }
    };
    const inputDisposable = xterm.onData((data) => onInputRef.current(data));
    const resizeObserver = new ResizeObserver(sendResize);
    resizeObserver.observe(terminalSurfaceRef.current);
    window.addEventListener('resize', sendResize);
    const frame = window.requestAnimationFrame(sendResize);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', sendResize);
      resizeObserver.disconnect();
      inputDisposable.dispose();
      xterm.dispose();
      if (xtermRef.current === xterm) xtermRef.current = null;
    };
  }, [terminal?.backend, terminal?.terminalId]);
  useEffect(() => {
    if (!terminal || terminal.backend !== 'pty' || !xtermRef.current) return;
    const output = terminal.output || '';
    const previous = lastOutputRef.current;
    if (output.startsWith(previous)) {
      const chunk = output.slice(previous.length);
      if (chunk) xtermRef.current.write(chunk);
    } else {
      xtermRef.current.reset();
      if (output) xtermRef.current.write(output);
    }
    lastOutputRef.current = output;
  }, [terminal?.backend, terminal?.output]);
  if (!terminal) return null;
  const isPty = terminal.backend === 'pty';
  return (
    <div className="modalShade">
      <section className={`terminalModal ${isPty ? 'ptyTerminal' : ''}`}>
        <header>
          <div>
            <h2>{terminal.peerName} · 交互终端</h2>
            <p>{terminal.shell} · {isPty ? 'PTY / xterm' : '基础终端'}</p>
          </div>
          <button className="secondary" onClick={onClose}><Power size={16} /> 关闭</button>
        </header>
        {isPty ? (
          <div className="terminalSurface" ref={terminalSurfaceRef} />
        ) : (
          <>
            <pre ref={outputRef}>{terminal.output || '终端已打开，输入命令后按 Enter。'}</pre>
            <form onSubmit={(event) => {
              event.preventDefault();
              if (!input.trim()) return;
              onInput(`${input}\n`);
              setInput('');
            }}>
              <input value={input} onChange={(event) => setInput(event.target.value)} placeholder="输入终端命令" />
              <button className="primary" type="submit">发送</button>
            </form>
          </>
        )}
      </section>
    </div>
  );
}

function eventButtonName(button: number) {
  if (button === 2) return 'right';
  if (button === 1) return 'middle';
  return 'left';
}

function normalizeKeyboardEvent(event: React.KeyboardEvent) {
  const modifiers: string[] = [];
  if (event.ctrlKey) modifiers.push('ctrl');
  if (event.metaKey) modifiers.push('meta');
  if (event.altKey) modifiers.push('alt');
  if (event.shiftKey) modifiers.push('shift');
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (['Control', 'Meta', 'Alt', 'Shift'].includes(event.key)) return modifiers;
  return [...modifiers, key];
}

function normalizedPoint(event: React.PointerEvent | React.MouseEvent | React.WheelEvent, media: HTMLVideoElement | HTMLImageElement | null) {
  if (!media) return { normalizedX: 0, normalizedY: 0 };
  const rect = media.getBoundingClientRect();
  const mediaWidth = media instanceof HTMLVideoElement ? media.videoWidth || rect.width : media.naturalWidth || rect.width;
  const mediaHeight = media instanceof HTMLVideoElement ? media.videoHeight || rect.height : media.naturalHeight || rect.height;
  const videoRatio = mediaWidth / Math.max(1, mediaHeight);
  const boxRatio = rect.width / Math.max(1, rect.height);
  let contentWidth = rect.width;
  let contentHeight = rect.height;
  let offsetX = 0;
  let offsetY = 0;
  if (boxRatio > videoRatio) {
    contentHeight = rect.height;
    contentWidth = contentHeight * videoRatio;
    offsetX = (rect.width - contentWidth) / 2;
  } else {
    contentWidth = rect.width;
    contentHeight = contentWidth / videoRatio;
    offsetY = (rect.height - contentHeight) / 2;
  }
  return {
    normalizedX: Math.min(1, Math.max(0, (event.clientX - rect.left - offsetX) / Math.max(1, contentWidth))),
    normalizedY: Math.min(1, Math.max(0, (event.clientY - rect.top - offsetY) / Math.max(1, contentHeight)))
  };
}

function RemoteControlBanner({ notice, onStop }: { notice: RemoteNotice | null; onStop: () => void }) {
  if (!notice?.active) return null;
  return (
    <div className="remoteBanner">
      <div>
        <strong>正在被远程控制</strong>
        <span>{notice.peerName || notice.peerId} 正在访问本机屏幕和输入控制。</span>
      </div>
      <button className="danger" onClick={onStop}><Power size={16} /> 停止</button>
    </div>
  );
}

function ScreenModal({
  screen,
  standalone = false,
  onClose,
  onRemoteInput,
  onSnapshot,
  onClipboardRead,
  onClipboardWrite
}: {
  screen: ScreenSession | null;
  standalone?: boolean;
  onClose: () => void;
  onRemoteInput: (input: RemoteInputEvent) => void | Promise<void>;
  onSnapshot: () => Promise<void>;
  onClipboardRead: () => Promise<string>;
  onClipboardWrite: (text: string) => Promise<void>;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const lastMoveRef = useRef(0);
  const moveBusyRef = useRef(false);
  const pendingMoveRef = useRef<RemoteInputEvent | null>(null);
  const [captureInput, setCaptureInput] = useState(true);
  const [clipboardText, setClipboardText] = useState('');
  const [clipBusy, setClipBusy] = useState(false);
  useEffect(() => {
    if (videoRef.current && screen?.stream) {
      videoRef.current.srcObject = screen.stream;
    }
  }, [screen?.stream]);
  if (!screen) return null;
  const isControl = screen.mode === 'control';
  const title = screen.sharing ? '正在共享屏幕' : isControl ? '远程控制' : '实时看屏';
  const status = screen.status || (screen.stream ? '已连接' : screen.snapshot ? `截图模式 · ${formatTime(screen.snapshotAt)}` : '等待对方屏幕流。Windows 远端需要在真实桌面打开 App；macOS 首次使用可能需要授权屏幕录制。');
  const getMediaElement = () => videoRef.current || imageRef.current;
  function sendInput(input: RemoteInputEvent) {
    if (input.kind === 'pointer' && input.action === 'move') {
      pendingMoveRef.current = input;
      if (moveBusyRef.current) return;
      moveBusyRef.current = true;
      const flush = () => {
        const next = pendingMoveRef.current;
        pendingMoveRef.current = null;
        if (!next) {
          moveBusyRef.current = false;
          return;
        }
        Promise.resolve(onRemoteInput(next)).catch(() => {}).finally(flush);
      };
      flush();
      return;
    }
    onRemoteInput(input);
  }
  async function readClip() {
    setClipBusy(true);
    try {
      setClipboardText(await onClipboardRead());
    } finally {
      setClipBusy(false);
    }
  }
  async function writeClip() {
    setClipBusy(true);
    try {
      await onClipboardWrite(clipboardText);
    } finally {
      setClipBusy(false);
    }
  }
  const body = (
      <section className={`screenModal ${isControl ? 'controlMode' : ''} ${screen.sharing ? 'sharingMode' : ''}`}>
        <header>
          <div>
            <h2>{screen.peerName} · {title}</h2>
            <p>{status}</p>
          </div>
          <div className="modalHeaderActions">
            {!screen.sharing ? <button className="secondary" disabled={screen.snapshotBusy} onClick={onSnapshot}><Camera size={16} /> {screen.snapshotBusy ? '刷新中' : '刷新截图'}</button> : null}
            <button className="secondary" onClick={onClose}><Power size={16} /> {screen.sharing ? '停止共享' : '关闭'}</button>
          </div>
        </header>
        {screen.sharing ? (
          <div className="shareNotice">
            <ScreenShare size={42} />
            <strong>本机屏幕正在共享给 {screen.peerName}</strong>
            <span>关闭窗口或点击“停止共享”会立即断开这次看屏/远控会话。</span>
          </div>
        ) : (
          <div className="remoteBody">
            <div
              className={`remoteStage ${captureInput && isControl ? 'capturing' : ''}`}
              tabIndex={0}
              onContextMenu={(event) => event.preventDefault()}
              onKeyDown={(event) => {
                if (!isControl || !captureInput) return;
                event.preventDefault();
                if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
                sendInput({ kind: 'keyboard', action: 'type', text: event.key });
                return;
              }
              const keys = normalizeKeyboardEvent(event);
              if (keys.length) sendInput({ kind: 'keyboard', action: 'hotkey', keys });
            }}
              onPointerMove={(event) => {
                if (!isControl || !captureInput) return;
                const now = Date.now();
                if (now - lastMoveRef.current < 36) return;
                lastMoveRef.current = now;
                sendInput({ kind: 'pointer', action: 'move', ...normalizedPoint(event, getMediaElement()) });
              }}
              onPointerDown={(event) => {
                if (!isControl || !captureInput) return;
                event.preventDefault();
                (event.currentTarget as HTMLDivElement).focus();
                sendInput({
                  kind: 'pointer',
                  action: 'down',
                  button: eventButtonName(event.button),
                  ...normalizedPoint(event, getMediaElement())
                });
              }}
              onPointerUp={(event) => {
                if (!isControl || !captureInput) return;
                event.preventDefault();
                sendInput({
                  kind: 'pointer',
                  action: 'up',
                  button: eventButtonName(event.button),
                  ...normalizedPoint(event, getMediaElement())
                });
              }}
              onDoubleClick={(event) => {
                if (!isControl || !captureInput) return;
                sendInput({
                  kind: 'pointer',
                  action: 'doubleClick',
                  button: eventButtonName(event.button),
                  ...normalizedPoint(event, getMediaElement())
                });
              }}
              onWheel={(event) => {
                if (!isControl || !captureInput) return;
                event.preventDefault();
                sendInput({
                  kind: 'pointer',
                  action: 'scroll',
                  deltaX: event.deltaX,
                  deltaY: event.deltaY,
                  ...normalizedPoint(event, getMediaElement())
                });
              }}
            >
              {screen.stream ? <video ref={videoRef} autoPlay playsInline /> : screen.snapshot ? (
                <img ref={imageRef} src={screen.snapshot} alt={`${screen.peerName} screenshot`} />
              ) : (
                <div className="screenPlaceholder">
                  <Camera size={34} />
                  <strong>等待实时画面</strong>
                  <span>如果长时间没有画面，先点右上角“刷新截图”。截图模式也能配合远程点击、快捷键和剪贴板使用。</span>
                </div>
              )}
            </div>
            {isControl ? (
              <aside className="remoteTools">
                <div className="toolBlock">
                  <h3><MousePointer2 size={16} /> 输入控制</h3>
                  <label className="toggleLine">
                    <input type="checkbox" checked={captureInput} onChange={(event) => setCaptureInput(event.target.checked)} />
                    捕获鼠标和键盘
                  </label>
                  <p>把光标移到画面上即可操作远端。组合键会直接发送到远端电脑。</p>
                </div>
                <div className="toolBlock">
                  <h3><Keyboard size={16} /> 快捷键</h3>
                  <div className="quickKeys">
                    <button onClick={() => sendInput({ kind: 'keyboard', action: 'hotkey', keys: ['ctrl', 'c'] })}>Ctrl+C</button>
                    <button onClick={() => sendInput({ kind: 'keyboard', action: 'hotkey', keys: ['ctrl', 'v'] })}>Ctrl+V</button>
                    <button onClick={() => sendInput({ kind: 'keyboard', action: 'hotkey', keys: ['alt', 'tab'] })}>Alt+Tab</button>
                    <button onClick={() => sendInput({ kind: 'keyboard', action: 'hotkey', keys: ['ctrl', 's'] })}>Ctrl+S</button>
                  </div>
                </div>
                <div className="toolBlock">
                  <h3><Copy size={16} /> 远端剪贴板</h3>
                  <textarea value={clipboardText} onChange={(event) => setClipboardText(event.target.value)} placeholder="读取或写入远端文本剪贴板" />
                  <div className="rowActions">
                    <button className="secondary" disabled={clipBusy} onClick={readClip}>读取</button>
                    <button className="primary" disabled={clipBusy} onClick={writeClip}>写入</button>
                  </div>
                </div>
              </aside>
            ) : null}
          </div>
        )}
      </section>
  );
  return standalone ? <div className="remoteWindowStandalone">{body}</div> : <div className="modalShade">{body}</div>;
}

function RemoteWindowApp() {
  const params = new URLSearchParams(window.location.search);
  const peerId = params.get('peerId') || '';
  const peerName = params.get('peerName') || peerId;
  const sessionId = params.get('sessionId') || crypto.randomUUID();
  const mode = params.get('mode') === 'view' ? 'view' : 'control';
  const [screen, setScreen] = useState<ScreenSession>({
    peerId,
    peerName,
    sessionId,
    mode,
    status: '正在连接远端屏幕...'
  });
  const [error, setError] = useState('');
  const peerConnection = useRef<RTCPeerConnection | null>(null);

  useEffect(() => {
    if (!api || !peerId) return;
    let closed = false;

    function updateSession(patch: Partial<RemoteSessionRecord>) {
      api.updateRemoteSession(sessionId, patch).catch(() => {});
    }

    async function start() {
      updateSession({ status: 'opening' });
      const appState = await api.getState().catch(() => null);
      const pc = new RTCPeerConnection(toRtcConfiguration(appState?.webrtc));
      peerConnection.current = pc;
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          api.sendScreenSignal(peerId, sessionId, { kind: 'candidate', candidate: event.candidate.toJSON() }).catch(() => {});
        }
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
          setScreen((current) => ({ ...current, status: '连接中断，可刷新截图继续操作。' }));
          updateSession({ status: 'reconnecting' });
        }
      };
      pc.ontrack = (event) => {
        if (closed) return;
        setScreen((current) => ({ ...current, stream: event.streams[0], status: '已连接' }));
        updateSession({ status: 'streaming' });
      };
      try {
        await api.requestScreen(peerId, sessionId);
        const offer = await pc.createOffer({ offerToReceiveVideo: true, offerToReceiveAudio: false });
        await pc.setLocalDescription(offer);
        await api.sendScreenSignal(peerId, sessionId, { kind: 'offer', sdp: offer.sdp });
      } catch (err: any) {
        if (closed) return;
        const message = err?.message || String(err);
        setError(message);
        setScreen((current) => ({ ...current, status: message || '屏幕连接失败，可尝试刷新截图模式。' }));
        updateSession({ status: 'failed', error: message });
      }
    }

    async function handleSignal(event: any) {
      if (event.peerId !== peerId || event.sessionId !== sessionId || !event?.signal?.kind) return;
      const pc = peerConnection.current;
      if (!pc) return;
      if (event.signal.kind === 'answer') {
        await pc.setRemoteDescription({ type: 'answer', sdp: event.signal.sdp });
      }
      if (event.signal.kind === 'candidate' && event.signal.candidate) {
        await pc.addIceCandidate(event.signal.candidate);
      }
    }

    const offSignal = api.onScreenSignal((event) => handleSignal(event).catch((err) => setError(err?.message || String(err))));
    const offStop = api.onScreenStop((event) => {
      if (event.peerId === peerId && event.sessionId === sessionId) {
        setScreen((current) => ({ ...current, stream: undefined, status: '远端已停止共享。' }));
        updateSession({ status: 'closed' });
      }
    });
    start();

    return () => {
      closed = true;
      offSignal();
      offStop();
      peerConnection.current?.close();
      peerConnection.current = null;
    };
  }, [peerId, sessionId, mode]);

  async function refreshSnapshot() {
    setScreen((current) => ({ ...current, snapshotBusy: true, status: '正在获取远端截图...' }));
    try {
      const result = await api.remoteScreenshot(peerId, sessionId);
      setScreen((current) => ({
        ...current,
        snapshot: `data:${result.mime};base64,${result.base64}`,
        snapshotAt: result.capturedAt,
        snapshotBusy: false,
        status: current.stream ? '已连接' : '截图模式：可手动刷新画面，鼠标键盘输入仍会发送到远端。'
      }));
      api.updateRemoteSession(sessionId, { status: 'snapshot', width: result.width, height: result.height }).catch(() => {});
    } catch (err: any) {
      const message = err?.message || String(err);
      setError(message);
      setScreen((current) => ({ ...current, snapshotBusy: false, status: message || '截图失败' }));
      api.updateRemoteSession(sessionId, { status: 'failed', error: message }).catch(() => {});
    }
  }

  async function closeWindow() {
    if (mode === 'control') {
      await api.closeRemote(peerId, sessionId).catch(() => {});
    } else {
      await api.stopScreen(peerId, sessionId).catch(() => {});
      await api.updateRemoteSession(sessionId, { status: 'closed' }).catch(() => {});
    }
    window.close();
  }

  if (!api) return <main className="loading">请在 Electron 中运行 Lan Control Hub。</main>;
  if (!peerId) return <main className="loading">缺少远控设备。</main>;
  return (
    <main className="remoteWindowShell">
      <ScreenModal
        standalone
        screen={screen}
        onRemoteInput={(input) => {
          if (mode !== 'control') return;
          api.sendRemoteInput(peerId, input).catch((err) => setError(err?.message || String(err)));
        }}
        onSnapshot={refreshSnapshot}
        onClipboardRead={async () => {
          const result = await api.readRemoteClipboard(peerId);
          return result.text || '';
        }}
        onClipboardWrite={async (text) => {
          await api.writeRemoteClipboard(peerId, text);
        }}
        onClose={closeWindow}
      />
      {error ? <div className="toast">{error}</div> : null}
    </main>
  );
}

function App() {
  const [state, setState] = useState<AppStateView | null>(null);
  const [view, setView] = useState<View>('dashboard');
  const [selectedPeerId, setSelectedPeerId] = useState('');
  const [selectedPeerIds, setSelectedPeerIds] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [terminal, setTerminal] = useState<TerminalTab | null>(null);
  const [screen, setScreen] = useState<ScreenSession | null>(null);
  const [remoteNotice, setRemoteNotice] = useState<RemoteNotice | null>(null);
  const peerConnections = useRef(new Map<string, RTCPeerConnection>());
  const shareStreams = useRef(new Map<string, MediaStream>());

  useEffect(() => {
    if (!api) return;
    api.getState().then(setState).catch((err) => setError(err.message));
    const offState = api.onState((next) => {
      setState(next);
      if (!selectedPeerId && next.peers[0]) setSelectedPeerId(next.peers[0].id);
    });
    const offTerminal = api.onTerminalOutput((event: TerminalOutputEvent) => {
      setTerminal((current) => current && current.terminalId === event.terminalId
        ? { ...current, output: `${current.output}${event.chunk}` }
        : current);
    });
    const offScreenRequest = api.onScreenRequest((event) => {
      setScreen({ peerId: event.peerId, peerName: event.peerName, sessionId: event.sessionId, sharing: true, mode: 'view' });
    });
    const offScreenSignal = api.onScreenSignal((event) => handleScreenSignal(event));
    const offScreenStop = api.onScreenStop((event) => stopShare(event.sessionId));
    const offRemoteControl = api.onRemoteControl((event) => {
      setRemoteNotice(event.active ? event : null);
      if (!event.active) {
        setScreen((current) => current?.sessionId === event.sessionId ? null : current);
      }
    });
    return () => {
      offState();
      offTerminal();
      offScreenRequest();
      offScreenSignal();
      offScreenStop();
      offRemoteControl();
    };
  }, []);

  const selectedPeer = useMemo(() => state?.peers.find((peer) => peer.id === selectedPeerId) || state?.peers[0] || null, [state?.peers, selectedPeerId]);
  const messages = selectedPeer ? state?.conversations[selectedPeer.id] || [] : [];

  useEffect(() => {
    if (view === 'chat' && selectedPeer?.unreadCount) {
      updatePreference(selectedPeer.id, { unreadCount: 0 });
    }
  }, [view, selectedPeer?.id, selectedPeer?.unreadCount]);

  async function run(action: () => Promise<unknown>) {
    setError('');
    try {
      const result = await action();
      if (result && typeof result === 'object' && 'device' in result) setState(result as AppStateView);
      return result;
    } catch (err: any) {
      setError(err?.message || String(err));
      return undefined;
    }
  }

  function togglePeer(peerId: string) {
    setSelectedPeerIds((current) => current.includes(peerId) ? current.filter((id) => id !== peerId) : [...current, peerId]);
  }

  function updatePreference(peerId: string, patch: Partial<DevicePreference>) {
    run(() => api.updateDevicePreference(peerId, patch));
  }

  async function openTerminal(peer: PeerInfo) {
    await run(async () => {
      const result = await api.openTerminal(peer.id, { cols: 100, rows: 30 });
      setTerminal({
        peerId: peer.id,
        peerName: peer.name,
        sessionId: result.sessionId,
        terminalId: result.terminalId,
        shell: result.shell,
        backend: result.backend || 'spawn',
        cols: result.cols || 100,
        rows: result.rows || 30,
        output: ''
      });
      return null;
    });
  }

  async function requestScreen(peer: PeerInfo, mode: 'view' | 'control' = 'view') {
    let remoteInfo: RemoteOpenResult | undefined;
    const sessionId = mode === 'control'
      ? (remoteInfo = await api.openRemote(peer.id)).sessionId
      : crypto.randomUUID();
    setScreen({
      peerId: peer.id,
      peerName: peer.name,
      sessionId,
      mode,
      remoteInfo,
      status: mode === 'control' ? '正在建立远程控制和屏幕流...' : undefined
    });
    api.updateRemoteSession(sessionId, {
      peerId: peer.id,
      peerName: peerLabel(peer),
      mode,
      direction: 'outgoing',
      status: 'opening'
    }).catch(() => {});
    const pc = createPeerConnection(peer.id, sessionId, false);
    pc.ontrack = (event) => {
      setScreen((current) => current && current.sessionId === sessionId ? { ...current, stream: event.streams[0], status: '已连接' } : current);
      api.updateRemoteSession(sessionId, { status: 'streaming' }).catch(() => {});
    };
    try {
      await api.requestScreen(peer.id, sessionId);
      const offer = await pc.createOffer({ offerToReceiveVideo: true, offerToReceiveAudio: false });
      await pc.setLocalDescription(offer);
      await api.sendScreenSignal(peer.id, sessionId, { kind: 'offer', sdp: offer.sdp });
    } catch (err: any) {
      if (mode === 'control') await api.closeRemote(peer.id, sessionId).catch(() => {});
      setScreen((current) => current?.sessionId === sessionId
        ? { ...current, status: err?.message || '屏幕连接失败，可尝试刷新截图模式。' }
        : current);
      api.updateRemoteSession(sessionId, { status: 'failed', error: err?.message || String(err) }).catch(() => {});
      throw err;
    }
  }

  function createPeerConnection(peerId: string, sessionId: string, sharing: boolean) {
    const key = `${peerId}:${sessionId}:${sharing ? 'share' : 'view'}`;
    const existing = peerConnections.current.get(key);
    if (existing) return existing;
    const pc = new RTCPeerConnection(toRtcConfiguration(state?.webrtc));
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        api.sendScreenSignal(peerId, sessionId, { kind: 'candidate', candidate: event.candidate.toJSON() }).catch(() => {});
      }
    };
    peerConnections.current.set(key, pc);
    return pc;
  }

  async function handleScreenSignal(event: any) {
    if (!event?.signal?.kind) return;
    if (event.signal.kind === 'offer') {
      const pc = createPeerConnection(event.peerId, event.sessionId, true);
      try {
        let stream = shareStreams.current.get(event.sessionId);
        if (!stream) {
          stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
          shareStreams.current.set(event.sessionId, stream);
          setScreen({ peerId: event.peerId, peerName: event.peerName, sessionId: event.sessionId, sharing: true, mode: 'view', status: '正在共享本机屏幕' });
        }
        for (const track of stream.getTracks()) pc.addTrack(track, stream);
        await pc.setRemoteDescription({ type: 'offer', sdp: event.signal.sdp });
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await api.sendScreenSignal(event.peerId, event.sessionId, { kind: 'answer', sdp: answer.sdp });
      } catch (err: any) {
        setScreen({
          peerId: event.peerId,
          peerName: event.peerName,
          sessionId: event.sessionId,
          sharing: true,
          mode: 'view',
          status: err?.message || '无法共享屏幕，请确认 App 在真实桌面运行并已获得系统权限。'
        });
        await api.stopScreen(event.peerId, event.sessionId).catch(() => {});
      }
      return;
    }
    const viewKey = `${event.peerId}:${event.sessionId}:view`;
    const shareKey = `${event.peerId}:${event.sessionId}:share`;
    const pc = peerConnections.current.get(viewKey) || peerConnections.current.get(shareKey);
    if (!pc) return;
    if (event.signal.kind === 'answer') {
      await pc.setRemoteDescription({ type: 'answer', sdp: event.signal.sdp });
    }
    if (event.signal.kind === 'candidate' && event.signal.candidate) {
      await pc.addIceCandidate(event.signal.candidate);
    }
  }

  function stopShare(sessionId: string) {
    const stream = shareStreams.current.get(sessionId);
    stream?.getTracks().forEach((track) => track.stop());
    shareStreams.current.delete(sessionId);
    setScreen((current) => current?.sessionId === sessionId ? null : current);
  }

  async function refreshSnapshot() {
    if (!screen || screen.sharing) return;
    const sessionId = screen.sessionId;
    setScreen((current) => current?.sessionId === sessionId ? { ...current, snapshotBusy: true, status: '正在获取远端截图...' } : current);
    try {
      const result = await api.remoteScreenshot(screen.peerId, sessionId);
      const snapshot = `data:${result.mime};base64,${result.base64}`;
      setScreen((current) => current?.sessionId === sessionId
        ? {
            ...current,
            snapshot,
            snapshotAt: result.capturedAt,
            snapshotBusy: false,
            status: current.stream ? '已连接' : '截图模式：可手动刷新画面，鼠标键盘输入仍会发送到远端。'
          }
        : current);
    } catch (err: any) {
      setScreen((current) => current?.sessionId === sessionId ? { ...current, snapshotBusy: false, status: err?.message || '截图失败' } : current);
      setError(err?.message || String(err));
    }
  }

  if (!api) return <main className="loading">请在 Electron 中运行 Lan Control Hub。</main>;
  if (!state) return <main className="loading">正在启动 Lan Control Hub...</main>;
  if (!state.home) {
    return <SetupScreen onCreate={(name) => run(() => api.createHome(name))} onJoin={(secret, name) => run(() => api.joinHome(secret, name))} />;
  }

  return (
    <main className="appShell">
      <nav className="rail">
        <div className="brand">LCH</div>
        <button className={view === 'dashboard' ? 'active' : ''} title="控制台" onClick={() => setView('dashboard')}><MonitorPlay size={21} /></button>
        <button className={view === 'chat' ? 'active' : ''} title="聊天" onClick={() => setView('chat')}><MessageSquare size={21} /></button>
        <button className={view === 'files' ? 'active' : ''} title="文件" onClick={() => setView('files')}><FileDown size={21} /></button>
        <button className={view === 'transfers' ? 'active' : ''} title="传输" onClick={() => setView('transfers')}><Upload size={21} /></button>
        <button className={view === 'tasks' ? 'active' : ''} title="任务" onClick={() => setView('tasks')}><TerminalSquare size={21} /></button>
        <button className={view === 'settings' ? 'active' : ''} title="设置" onClick={() => setView('settings')}><Settings size={21} /></button>
      </nav>
      <DeviceSidebar
        state={state}
        selectedPeerIds={selectedPeerIds}
        selectedPeerId={selectedPeer?.id || ''}
        onTogglePeer={togglePeer}
        onSelectPeer={(peerId) => {
          setSelectedPeerId(peerId);
          if (!selectedPeerIds.includes(peerId)) setSelectedPeerIds([peerId]);
        }}
        onUpdatePreference={updatePreference}
      />
      {view === 'dashboard' ? (
        <Dashboard
          state={state}
          selectedPeer={selectedPeer}
          selectedPeerIds={selectedPeerIds}
          remoteSessions={state.remoteSessions || []}
          onRunCommand={(command, peerIds) => run(() => api.runCommand(peerIds || selectedPeerIds, command))}
          onOpenTerminal={openTerminal}
          onOpenScreen={(peer) => run(() => requestScreen(peer, 'view'))}
          onOpenRemote={(peer) => run(() => api.openRemoteWindow(peer.id, 'control'))}
          onUpdatePreference={updatePreference}
          onOpenChat={() => setView('chat')}
          onOpenFiles={() => setView('files')}
          setView={setView}
        />
      ) : null}
      {view === 'chat' ? (
        <ChatView
          peer={selectedPeer}
          messages={messages || []}
          onSendText={(text, options) => selectedPeer && run(() => api.sendText(selectedPeer.id, text, options))}
          onSendFile={(file) => selectedPeer && run(async () => {
            const base64 = await readFileAsBase64(file);
            return api.sendFile(selectedPeer.id, { name: file.name, size: file.size, base64 });
          })}
          onReact={(messageId, emoji) => selectedPeer && run(async () => {
            const result = await api.reactToMessage(selectedPeer.id, messageId, emoji);
            return result.state;
          })}
        />
      ) : null}
      {view === 'files' ? (
        <FilesView
          state={state}
          peer={selectedPeer}
          onChooseFolder={() => run(() => api.chooseSharedFolder())}
          onClearFolder={() => run(() => api.clearSharedFolder())}
          onSetFileSharing={(enabled) => run(() => api.setFileSharing(enabled))}
          onListRemote={(relativePath) => api.listSharedFiles(selectedPeer!.id, relativePath) as Promise<SharedFolderListing>}
          onPreview={(relativePath) => api.previewSharedFile(selectedPeer!.id, relativePath)}
          onDownload={(relativePath) => run(() => api.downloadSharedFile(selectedPeer!.id, relativePath)) as Promise<{ filePath: string; name: string; size: number } | void>}
          onUpload={(relativePath, file) => run(async () => {
            const localPath = api.getFilePath(file);
            if (!localPath) throw new Error('无法读取本机文件路径，请使用桌面版文件选择器重新选择文件');
            await api.uploadSharedFileStream(selectedPeer!.id, relativePath, localPath);
          }) as Promise<void>}
        />
      ) : null}
      {view === 'transfers' ? (
        <TransfersView
          transfers={state.transfers || []}
          onCancel={(transferId) => run(() => api.cancelTransfer(transferId))}
          onShowFile={(filePath) => run(() => api.showFile(filePath))}
          onOpenPath={(filePath) => run(() => api.openPath(filePath))}
        />
      ) : null}
      {view === 'tasks' ? <TasksView tasks={state.tasks} /> : null}
      {view === 'settings' ? (
        <SettingsView
          state={state}
          onUpdateName={(name) => run(() => api.updateName(name))}
          onSetAutoTrust={(enabled) => run(() => api.setAutoTrust(enabled))}
          onSetWebRtcConfig={(config) => run(() => api.setWebRtcConfig(config))}
          onConnectManualPeer={(address) => run(() => api.connectManualPeer(address))}
          onRemoveManualPeer={(address) => run(() => api.removeManualPeer(address))}
          onRefreshManualPeers={() => run(() => api.refreshManualPeers())}
          onTrustDevice={(peerId) => run(() => api.trustDevice(peerId))}
          onRevokeDevice={(peerId) => run(() => api.revokeDevice(peerId))}
        />
      ) : null}
      {error ? <div className="toast">{error}</div> : null}
      <TerminalModal
        terminal={terminal}
        onInput={(input) => {
          if (!terminal) return;
          api.terminalInput(terminal.peerId, terminal.terminalId, input).catch((err) => setError(err?.message || String(err)));
          if (terminal.backend !== 'pty') {
            setTerminal((current) => current && current.terminalId === terminal.terminalId
              ? { ...current, output: `${current.output}> ${input}` }
              : current);
          }
        }}
        onResize={(cols, rows) => {
          if (!terminal || terminal.backend !== 'pty') return;
          setTerminal((current) => current && current.terminalId === terminal.terminalId
            ? { ...current, cols, rows }
            : current);
          api.terminalResize(terminal.peerId, terminal.terminalId, cols, rows).catch((err) => setError(err?.message || String(err)));
        }}
        onClose={() => {
          if (terminal) api.terminalClose(terminal.peerId, terminal.terminalId);
          setTerminal(null);
        }}
      />
      <ScreenModal
        screen={screen}
        onRemoteInput={(input) => {
          if (!screen || screen.sharing || screen.mode !== 'control') return;
          api.sendRemoteInput(screen.peerId, input).catch((err) => setError(err?.message || String(err)));
        }}
        onSnapshot={refreshSnapshot}
        onClipboardRead={async () => {
          if (!screen) return '';
          const result = await api.readRemoteClipboard(screen.peerId);
          return result.text || '';
        }}
        onClipboardWrite={async (text) => {
          if (!screen) return;
          await api.writeRemoteClipboard(screen.peerId, text);
        }}
        onClose={() => {
          if (screen?.mode === 'control') api.closeRemote(screen.peerId, screen.sessionId).catch(() => {});
          if (screen) api.stopScreen(screen.peerId, screen.sessionId).catch(() => {});
          if (screen?.stream) screen.stream.getTracks().forEach((track) => track.stop());
          setScreen(null);
        }}
      />
      <RemoteControlBanner
        notice={remoteNotice}
        onStop={() => {
          if (!remoteNotice) return;
          api.closeRemote(remoteNotice.peerId, remoteNotice.sessionId).catch(() => {});
          api.stopScreen(remoteNotice.peerId, remoteNotice.sessionId).catch(() => {});
          setRemoteNotice(null);
        }}
      />
    </main>
  );
}

const rootParams = new URLSearchParams(window.location.search);
createRoot(document.getElementById('root')!).render(rootParams.get('window') === 'remote' ? <RemoteWindowApp /> : <App />);
