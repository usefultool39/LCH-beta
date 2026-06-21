import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
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
  Play,
  Power,
  RefreshCw,
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
  Upload
} from 'lucide-react';
import type { AppStateView, DevicePreference, FirewallStatus, PeerInfo, RemoteInputEvent, RemoteOpenResult, RemoteSessionRecord, SharedFolderListing, TaskRecord, TerminalOutputEvent } from '../shared/protocol';
import './styles.css';

const api = window.lanControlHub;

type View = 'dashboard' | 'chat' | 'files' | 'tasks' | 'settings';
type TerminalTab = {
  peerId: string;
  peerName: string;
  sessionId: string;
  terminalId: string;
  shell: string;
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

function readFileAsBase64(file: File) {
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
        <p>第一台电脑创建网络，其他电脑粘贴加入密钥。加入后这些电脑会互相信任，可聊天、传文件、执行命令、打开终端和远程控制。</p>
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
                  <strong>{peerLabel(peer)}</strong>
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

function ChatView({ peer, messages, onSendText, onSendFile }: {
  peer: PeerInfo | null;
  messages: any[];
  onSendText: (text: string) => void;
  onSendFile: (file: File) => void;
}) {
  const [text, setText] = useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);
  if (!peer) {
    return <section className="workspace centerHint">选择一台设备开始聊天。</section>;
  }
  return (
    <section className="chatPane">
      <header className="workspaceHeader">
        <div>
          <h1>{peer.name}</h1>
          <p>聊天和文件传输保留原有工作流</p>
        </div>
      </header>
      <div className="messages">
        {messages.length ? messages.map((message) => (
          <div className={`message ${message.direction}`} key={message.id}>
            <div className="bubble">
              {message.type === 'text' ? <p>{message.text}</p> : (
                <div className="fileBubble">
                  <strong>{message.name}</strong>
                  <small>{formatBytes(message.size)}</small>
                  {message.path ? <small>{message.path}</small> : null}
                </div>
              )}
              <time>{formatTime(message.createdAt)}</time>
            </div>
          </div>
        )) : <div className="empty">还没有消息。</div>}
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
        <textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="输入消息" />
        <button className="primary" disabled={!text.trim()} onClick={() => {
          onSendText(text);
          setText('');
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
  onDownload,
  onUpload
}: {
  state: AppStateView;
  peer: PeerInfo | null;
  onChooseFolder: () => void;
  onClearFolder: () => void;
  onSetFileSharing: (enabled: boolean) => void;
  onListRemote: (path: string) => Promise<SharedFolderListing>;
  onUpload: (path: string, file: File) => Promise<void>;
  onDownload: (path: string) => Promise<void>;
}) {
  const [listing, setListing] = useState<SharedFolderListing | null>(null);
  const [remotePath, setRemotePath] = useState('');
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);
  const canBrowse = Boolean(peer?.isOnline && peer.trusted);
  const canUpload = Boolean(canBrowse && listing?.writable && remotePath && !peer?.readOnly);

  async function load(pathValue = '') {
    if (!canBrowse) return;
    setBusy(true);
    try {
      const next = await onListRemote(pathValue);
      setListing(next);
      setRemotePath(next.currentPath || '');
    } finally {
      setBusy(false);
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
              <p>{listing?.displayPath || '文件库'}</p>
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
          {!peer ? <div className="empty">先选择一台设备。</div> : !peer.trusted ? <div className="empty">这台设备还没有被信任。</div> : !peer.isOnline ? <div className="empty">设备离线。</div> : busy ? <div className="empty">正在处理文件...</div> : listing?.entries.length ? (
            <div className="fileList">
              {listing.entries.map((entry) => (
                <button className="fileRow" key={entry.relativePath} onDoubleClick={() => entry.type === 'directory' && load(entry.relativePath)} onClick={() => entry.type === 'file' && onDownload(entry.relativePath)}>
                  <span className="fileTypeIcon">{entry.type === 'directory' ? <Folder size={17} /> : <FileIcon size={17} />}</span>
                  <strong>{entry.name}</strong>
                  <small>{entry.type === 'file' ? formatBytes(entry.size) : ''}</small>
                  <em>{entry.type === 'directory' ? '打开' : <><Download size={14} /> 下载</>}</em>
                </button>
              ))}
            </div>
          ) : <div className="empty">{remotePath ? '没有可显示的文件。' : '远端没有可用文件库。'}</div>}
          {canUpload ? <div className="dropHint">拖拽文件到这里上传到当前目录。</div> : null}
        </section>
      </div>
    </section>
  );
}

function TasksView({ tasks }: { tasks: TaskRecord[] }) {
  return (
    <section className="workspace">
      <header className="workspaceHeader">
        <div>
          <h1>任务日志</h1>
          <p>远程命令输出会按设备保存，方便智能体和人工回看。</p>
        </div>
      </header>
      <div className="taskList">
        {tasks.length ? tasks.map((task) => (
          <article className="taskItem" key={task.id}>
            <div className="taskMeta">
              <strong>{task.peerName}</strong>
              <span className={`statusPill ${task.status}`}>{task.status}</span>
              <time>{formatTime(task.startedAt)}</time>
            </div>
            <code>{task.command}</code>
            <pre>{task.output || task.errorOutput || '等待输出...'}</pre>
          </article>
        )) : <div className="empty">暂无任务。</div>}
      </div>
    </section>
  );
}

function SettingsView({
  state,
  onUpdateName,
  onSetAutoTrust,
  onTrustDevice,
  onRevokeDevice
}: {
  state: AppStateView;
  onUpdateName: (name: string) => void;
  onSetAutoTrust: (enabled: boolean) => void;
  onTrustDevice: (peerId: string) => void;
  onRevokeDevice: (peerId: string) => void;
}) {
  const [name, setName] = useState(state.device.name);
  const [copied, setCopied] = useState(false);
  const [firewall, setFirewall] = useState<FirewallStatus | null>(null);
  const [firewallBusy, setFirewallBusy] = useState(false);
  const trustedDevices = Object.values(state.trustedDevices)
    .sort((a, b) => a.name.localeCompare(b.name));
  const pendingPeers = state.peers.filter((peer) => !peer.trusted);
  useEffect(() => setName(state.device.name), [state.device.name]);
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
  return (
    <section className="workspace">
      <header className="workspaceHeader">
        <div>
          <h1>设置</h1>
          <p>{state.device.name} 已加入“{state.home?.name}”。加入密钥只在添加新电脑时使用。</p>
        </div>
      </header>
      <div className="settingsGrid">
        <section className="panel">
          <h2>本机设备名</h2>
          <div className="inlineEdit">
            <input value={name} onChange={(event) => setName(event.target.value)} />
            <button className="primary" onClick={() => onUpdateName(name)}>保存</button>
          </div>
        </section>
        <section className="panel">
          <h2>添加新设备</h2>
          <p>在新电脑上打开 App，选择“我已有加入密钥”，粘贴下面这串内容即可加入同一个家庭网络。</p>
          <p className="secretText">{state.home?.secret}</p>
          <button className="secondary" onClick={async () => {
            await navigator.clipboard.writeText(state.home?.secret || '');
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1200);
          }}><Clipboard size={16} /> {copied ? '已复制' : '复制加入密钥'}</button>
        </section>
        <section className="panel">
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
        <section className="panel">
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
        <section className="panel">
          <h2>Local API</h2>
          <p>仅本机：127.0.0.1:{state.networkInfo.localApiPort}</p>
          <p>CLI：lch devices / lch run --all "hostname" / lch screenshot --device &lt;id&gt;</p>
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
      </div>
    </section>
  );
}

function TerminalModal({ terminal, onInput, onClose }: {
  terminal: TerminalTab | null;
  onInput: (text: string) => void;
  onClose: () => void;
}) {
  const outputRef = useRef<HTMLPreElement | null>(null);
  const [input, setInput] = useState('');
  useEffect(() => {
    if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [terminal?.output]);
  useEffect(() => setInput(''), [terminal?.terminalId]);
  if (!terminal) return null;
  return (
    <div className="modalShade">
      <section className="terminalModal">
        <header>
          <div>
            <h2>{terminal.peerName} · 交互终端</h2>
            <p>{terminal.shell}</p>
          </div>
          <button className="secondary" onClick={onClose}><Power size={16} /> 关闭</button>
        </header>
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
      const pc = new RTCPeerConnection({ iceServers: [] });
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

  async function run(action: () => Promise<unknown>) {
    setError('');
    try {
      const result = await action();
      if (result && typeof result === 'object' && 'device' in result) setState(result as AppStateView);
    } catch (err: any) {
      setError(err?.message || String(err));
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
      const result = await api.openTerminal(peer.id);
      setTerminal({
        peerId: peer.id,
        peerName: peer.name,
        sessionId: result.sessionId,
        terminalId: result.terminalId,
        shell: result.shell,
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
    const pc = new RTCPeerConnection({ iceServers: [] });
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
          onSendText={(text) => selectedPeer && run(() => api.sendText(selectedPeer.id, text))}
          onSendFile={(file) => selectedPeer && run(async () => {
            const base64 = await readFileAsBase64(file);
            return api.sendFile(selectedPeer.id, { name: file.name, size: file.size, base64 });
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
          onDownload={(relativePath) => run(() => api.downloadSharedFile(selectedPeer!.id, relativePath)) as Promise<void>}
          onUpload={(relativePath, file) => run(async () => {
            const base64 = await readFileAsBase64(file);
            await api.uploadSharedFile(selectedPeer!.id, relativePath, { name: file.name, size: file.size, base64 });
          }) as Promise<void>}
        />
      ) : null}
      {view === 'tasks' ? <TasksView tasks={state.tasks} /> : null}
      {view === 'settings' ? (
        <SettingsView
          state={state}
          onUpdateName={(name) => run(() => api.updateName(name))}
          onSetAutoTrust={(enabled) => run(() => api.setAutoTrust(enabled))}
          onTrustDevice={(peerId) => run(() => api.trustDevice(peerId))}
          onRevokeDevice={(peerId) => run(() => api.revokeDevice(peerId))}
        />
      ) : null}
      {error ? <div className="toast">{error}</div> : null}
      <TerminalModal
        terminal={terminal}
        onInput={(input) => {
          if (!terminal) return;
          api.terminalInput(terminal.peerId, terminal.terminalId, input);
          setTerminal({ ...terminal, output: `${terminal.output}> ${input}` });
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
