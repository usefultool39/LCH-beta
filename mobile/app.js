const app = document.querySelector('#app');
const storeKey = 'lch.mobile.session.v1';
const agentTargetKey = 'lch.mobile.agentTarget.v1';

const state = {
  token: localStorage.getItem(storeKey) || '',
  data: null,
  actions: [],
  agentSession: null,
  agentTargetId: localStorage.getItem(agentTargetKey) || '',
  selected: new Set(),
  tasks: [],
  tab: localStorage.getItem('lch.mobile.tab.v1') || 'home',
  agentInput: '',
  voiceText: '',
  agentVoiceListening: false,
  agentBusy: false,
  busy: false,
  error: ''
};

function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  return fetch(`/mobile-api${path}`, {
    ...options,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  }).then(async (response) => {
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) throw new Error(payload.error || `HTTP ${response.status}`);
    return payload.data;
  });
}

function code(value, prefix) {
  return `${prefix}-${String(value || '').replace(/-/g, '').slice(0, 6).toUpperCase() || '------'}`;
}

function allDevices() {
  return state.data?.devices || [];
}

function agentGatewayEnabled() {
  return Boolean(state.data?.agentGateway?.enabled);
}

function writableDevices() {
  return allDevices().filter((device) => device.isOnline && device.trusted && !device.readOnly && (agentGatewayEnabled() || device.isSelf));
}

function selectedDevices() {
  const writable = writableDevices();
  const selected = writable.filter((device) => state.selected.has(device.id));
  return selected.length ? selected : writable;
}

function selectedIds() {
  return selectedDevices().map((device) => device.id);
}

function gatewayDevice() {
  return allDevices().find((device) => device.isSelf) || state.data?.device || null;
}

function agentTargetDevices() {
  return allDevices().filter((device) => device.trusted && (device.isSelf || device.isOnline));
}

function selectedAgentDevice() {
  return agentTargetDevices().find((device) => device.id === state.agentTargetId) || gatewayDevice();
}

function syncAgentTarget() {
  const devices = agentTargetDevices();
  if (devices.some((device) => device.id === state.agentTargetId)) return;
  const available = devices.find((device) => device.agent?.cliAvailable) || devices[0] || gatewayDevice();
  state.agentTargetId = available?.id || state.data?.device?.id || '';
  if (state.agentTargetId) localStorage.setItem(agentTargetKey, state.agentTargetId);
}

function syncSelection() {
  const writable = writableDevices();
  const writableIds = new Set(writable.map((device) => device.id));
  for (const id of Array.from(state.selected)) {
    if (!writableIds.has(id)) state.selected.delete(id);
  }
  if (!state.selected.size) {
    for (const device of writable) state.selected.add(device.id);
  }
}

function setTab(tab) {
  if (tab === 'command') tab = 'agent';
  if ((tab === 'command' || tab === 'agent') && !agentGatewayEnabled()) tab = 'home';
  state.tab = tab;
  localStorage.setItem('lch.mobile.tab.v1', tab);
  render();
}

function setError(error) {
  state.error = error ? String(error.message || error) : '';
  render();
}

async function login(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  state.busy = true;
  state.error = '';
  renderLogin();
  try {
    const result = await api('/login', {
      method: 'POST',
      body: {
        secret: String(form.get('secret') || ''),
        name: String(form.get('name') || '')
      }
    });
    state.token = result.token;
    localStorage.setItem(storeKey, state.token);
    state.data = result.state;
    await loadAll();
  } catch (error) {
    state.error = error.message || String(error);
    renderLogin();
  } finally {
    state.busy = false;
  }
}

async function logout() {
  try {
    await api('/logout', { method: 'POST' });
  } catch {
    // Token may already be invalid.
  }
  state.token = '';
  state.data = null;
  state.agentSession = null;
  state.selected.clear();
  localStorage.removeItem(storeKey);
  renderLogin();
}

async function loadAll() {
  if (!state.token) {
    renderLogin();
    return;
  }
  try {
    const [mobileState, actions, tasks] = await Promise.all([
      api('/state'),
      api('/actions'),
      api('/tasks')
    ]);
    state.data = mobileState;
    state.actions = actions;
    state.tasks = tasks;
    syncAgentTarget();
    if (agentGatewayEnabled()) {
      state.agentSession = await api(`/agent/state?targetDeviceId=${encodeURIComponent(state.agentTargetId)}`).catch(() => null);
    } else {
      state.agentSession = null;
    }
    if (state.tab === 'command') state.tab = agentGatewayEnabled() ? 'agent' : 'home';
    if (!agentGatewayEnabled() && (state.tab === 'command' || state.tab === 'agent')) state.tab = 'home';
    syncSelection();
    render();
  } catch (error) {
    state.token = '';
    localStorage.removeItem(storeKey);
    state.error = error.message || String(error);
    renderLogin();
  }
}

async function runAction(actionId) {
  const action = state.actions.find((item) => item.id === actionId);
  const peerIds = selectedIds();
  if (!peerIds.length) {
    setError('没有可操作的在线设备');
    return;
  }
  if (action?.danger && !window.confirm(`确认执行「${action.label}」？`)) return;
  state.busy = true;
  state.error = '';
  render();
  try {
    await api('/actions/run', {
      method: 'POST',
      body: { actionId, peerIds }
    });
    state.tab = 'tasks';
    await loadAll();
  } catch (error) {
    setError(error);
  } finally {
    state.busy = false;
    render();
  }
}

async function startAgent() {
  if (!agentGatewayEnabled()) {
    setError('Agent Gateway 未开启，智能体入口已收起');
    return;
  }
  const target = selectedAgentDevice();
  if (!target?.agent?.cliAvailable) {
    setError(`${target?.displayName || target?.name || '这台设备'} 还没有配置 CLI 智能体`);
    return;
  }
  state.agentBusy = true;
  state.error = '';
  render();
  try {
    state.agentSession = await api('/agent/start', {
      method: 'POST',
      body: { targetDeviceId: state.agentTargetId }
    });
    state.tab = 'agent';
    render();
  } catch (error) {
    setError(error);
  } finally {
    state.agentBusy = false;
    render();
  }
}

async function stopAgent() {
  state.agentBusy = true;
  state.error = '';
  render();
  try {
    state.agentSession = await api('/agent/stop', {
      method: 'POST',
      body: { targetDeviceId: state.agentTargetId }
    });
  } catch (error) {
    setError(error);
  } finally {
    state.agentBusy = false;
    render();
  }
}

async function sendAgentText(text) {
  const value = String(text || '').trim();
  if (!value) {
    setError('先输入要发送给智能体的内容');
    return;
  }
  const target = selectedAgentDevice();
  if (!target?.agent?.cliAvailable) {
    setError(`${target?.displayName || target?.name || '这台设备'} 还没有配置 CLI 智能体；请先选择已配置的笔记本`);
    return;
  }
  if (!state.agentSession?.active) {
    await startAgent();
    if (!state.agentSession?.active) return;
  }
  state.agentBusy = true;
  state.error = '';
  const currentMessages = Array.isArray(state.agentSession?.messages) ? state.agentSession.messages : [];
  state.agentSession = {
    ...(state.agentSession || {}),
    active: true,
    busy: true,
    status: 'running',
    messages: [
      ...currentMessages,
      { id: `local-user-${Date.now()}`, role: 'user', text: value, createdAt: Date.now() },
      { id: `local-assistant-${Date.now()}`, role: 'assistant', text: '正在处理...', createdAt: Date.now(), pending: true }
    ]
  };
  render();
  try {
    state.agentSession = await api('/agent/input', {
      method: 'POST',
      body: { text: value, targetDeviceId: state.agentTargetId }
    });
    state.agentInput = '';
  } catch (error) {
    setError(error);
  } finally {
    state.agentBusy = false;
    render();
  }
}

async function sendAgentInput(event) {
  event?.preventDefault();
  const value = state.agentInput || document.querySelector('#agentInput')?.value || '';
  await sendAgentText(value);
}

function toggleDevice(id, checked) {
  if (checked) state.selected.add(id);
  else state.selected.delete(id);
  render();
}

function selectAllDevices() {
  state.selected.clear();
  for (const device of writableDevices()) state.selected.add(device.id);
  render();
}

function clearDevices() {
  state.selected.clear();
  render();
}

async function selectAgentTarget(deviceId) {
  state.agentTargetId = String(deviceId || '');
  localStorage.setItem(agentTargetKey, state.agentTargetId);
  state.agentInput = '';
  state.error = '';
  render();
  if (agentGatewayEnabled()) {
    state.agentSession = await api(`/agent/state?targetDeviceId=${encodeURIComponent(state.agentTargetId)}`).catch(() => null);
  }
  render();
}

function renderLogin() {
  app.className = 'appShell loginShell';
  app.innerHTML = `
    <section class="loginPanel">
      <div class="brandBlock">
        <span class="brandMark">LCH</span>
        <div>
          <h1>手机控制台</h1>
          <p>连接 ${escapeHtml(location.hostname || 'Lan Control Hub')} 的移动网关</p>
        </div>
      </div>
      ${state.error ? `<p class="errorText">${escapeHtml(state.error)}</p>` : ''}
      <form class="formGrid" id="loginForm">
        <label>
          <span>手机名称</span>
          <input name="name" autocomplete="nickname" placeholder="例如 iPhone / 我的手机" />
        </label>
        <label>
          <span>房间密钥</span>
          <input name="secret" type="password" autocomplete="current-password" required placeholder="电脑设置页里的房间密钥" />
        </label>
        <button type="submit" ${state.busy ? 'disabled' : ''}>${state.busy ? '正在登录' : '登录控制台'}</button>
      </form>
      <p class="helperText">名称只是手机显示名；房间密钥和三台电脑加入房间用的是同一个密钥。</p>
    </section>
  `;
  document.querySelector('#loginForm')?.addEventListener('submit', login);
}

function render() {
  if (!state.data) {
    renderLogin();
    return;
  }
  app.className = 'appShell';
  const devices = allDevices();
  const onlineCount = devices.filter((device) => device.isOnline).length;
  const selectedCount = selectedDevices().length;
  app.innerHTML = `
    <header class="appHeader">
      <div>
        <h1>${escapeHtml(state.data.home.name || 'Lan Control Hub')}</h1>
        <p>${escapeHtml(state.data.device.name)} · ${escapeHtml(state.data.appVersion)}</p>
      </div>
      <div class="headerActions">
        <button class="ghostButton" id="refreshButton">刷新</button>
        <button class="ghostButton" id="logoutButton">退出</button>
      </div>
    </header>

    <main class="contentArea">
      ${state.error ? `<p class="errorBanner">${escapeHtml(state.error)}</p>` : ''}
      ${renderTabContent(onlineCount, selectedCount)}
    </main>

    <nav class="bottomNav" aria-label="移动端导航">
      ${renderNavButton('home', '总览')}
      ${agentGatewayEnabled() ? renderNavButton('agent', '控制') : ''}
      ${renderNavButton('devices', '设备')}
      ${renderNavButton('tasks', '任务')}
    </nav>
  `;
  bindEvents();
}

function renderNavButton(tab, label) {
  return `<button class="${state.tab === tab ? 'active' : ''}" data-tab="${tab}">${label}</button>`;
}

function renderTabContent(onlineCount, selectedCount) {
  if (state.tab === 'devices') return renderDevices();
  if (state.tab === 'agent') return agentGatewayEnabled() ? renderAgent() : renderHome(onlineCount, selectedCount);
  if (state.tab === 'command') return agentGatewayEnabled() ? renderAgent() : renderHome(onlineCount, selectedCount);
  if (state.tab === 'tasks') return renderTasks();
  return renderHome(onlineCount, selectedCount);
}

function renderHome(onlineCount, selectedCount) {
  const gateway = gatewayDevice();
  const gatewayStatus = agentGatewayEnabled()
    ? '高级模式：控制页可选择 CLI 可用设备进行聊天式控制。'
    : '基础模式：快捷动作只作用于网关本机，命令入口已收起。';
  return `
    <section class="summaryPanel">
      <div class="summaryGrid">
        <div>
          <strong>${onlineCount}/${allDevices().length}</strong>
          <span>在线设备</span>
        </div>
        <div>
          <strong>${selectedCount}</strong>
          <span>当前目标</span>
        </div>
        <div>
          <strong>${escapeHtml(state.data.home.code || code(state.data.home.id, 'ROOM'))}</strong>
          <span>房间代码</span>
        </div>
      </div>
      <p>网关：${escapeHtml(gateway?.displayName || gateway?.name || state.data.device.name)}。手机通过这台电脑操作同一房间里的可信设备。</p>
      <p>${escapeHtml(gatewayStatus)}</p>
    </section>

    <section class="panelBlock">
      <div class="panelTitle">
        <div>
          <h2>快捷动作</h2>
          <p>适合不用输入命令的常用操作</p>
        </div>
      </div>
      <div class="actionGrid">
        ${state.actions.map(renderAction).join('')}
      </div>
    </section>

    ${agentGatewayEnabled() ? `<section class="panelBlock">
      <div class="panelTitle">
        <div>
          <h2>语音控制</h2>
          <p>${escapeHtml(state.voiceText || '说出你想让电脑做的事')}</p>
        </div>
      </div>
      <div class="voiceControls">
        <button id="voiceButton" class="primaryWide" ${state.agentVoiceListening ? 'disabled' : ''}>${state.agentVoiceListening ? '正在听' : '开始语音'}</button>
        <button id="clearVoiceButton" class="secondary">清空</button>
      </div>
      <p class="helperText">如果浏览器不支持语音识别，点“控制”里的输入框，用手机键盘自带麦克风也可以。</p>
    </section>` : ''}
  `;
}

function renderDevices() {
  return `
    <section class="panelBlock">
      <div class="panelTitle">
        <div>
          <h2>选择目标设备</h2>
          <p>${agentGatewayEnabled() ? '未选择时默认使用全部在线可信设备' : '基础模式只允许手机操作网关本机；跨设备执行需要在桌面端开启 Agent Gateway'}</p>
        </div>
      </div>
      <div class="toolbarLine">
        <button class="secondary" id="selectAllButton">全选</button>
        <button class="secondary" id="clearDevicesButton">清空</button>
      </div>
      <div class="deviceList">
        ${allDevices().map(renderDevice).join('')}
      </div>
    </section>
  `;
}

function renderAgent() {
  if (!agentGatewayEnabled()) {
    return `
      <section class="panelBlock">
        <div class="panelTitle">
          <div>
            <h2>Claude Code / MiniMax-M3</h2>
            <p>Agent Gateway 未开启，手机智能体入口已收起。</p>
          </div>
        </div>
      </section>
    `;
  }
  const session = state.agentSession || {};
  const active = Boolean(session.active);
  const busy = Boolean(session.busy || state.agentBusy);
  const statusClass = busy || active ? 'ok' : session.status === 'failed' ? 'warn' : '';
  const statusText = busy ? '处理中' : active ? '已连接' : '未连接';
  const target = selectedAgentDevice();
  const targetName = target?.displayName || target?.name || session.targetName || state.data.device.name;
  const targetAvailable = Boolean(target?.agent?.cliAvailable);
  const messages = targetAvailable ? agentMessages(session) : [{
    id: 'agent-unavailable',
    role: 'assistant',
    text: `${targetName} 当前还没有配置 CLI 智能体。你可以先选择已配置的笔记本进行对话；以后这台设备装好 Claude Code / MiniMax-M3 后再开放。`,
    createdAt: Date.now()
  }];
  return `
    <section class="panelBlock controlPanel">
      <div class="controlTop">
        <div>
          <h2>控制终端</h2>
          <p>${escapeHtml(session.model || state.data?.agentGateway?.agent?.model || 'MiniMax-M3')} · 当前设备：${escapeHtml(targetName)}</p>
        </div>
        <div class="controlStatus">
          <span class="statusPill ${statusClass}">${statusText}</span>
          <button type="button" id="startAgentButton" class="secondary" ${!targetAvailable || active || busy ? 'disabled' : ''}>连接</button>
          <button type="button" id="stopAgentButton" class="secondary" ${!active || busy ? 'disabled' : ''}>停止</button>
        </div>
      </div>

      <div class="agentTargetList">
        ${agentTargetDevices().map(renderAgentTarget).join('')}
      </div>

      <div class="chatWindow" aria-live="polite">
        ${messages.map(renderAgentMessage).join('')}
      </div>

      <form id="agentForm" class="chatComposer">
        <label>
          <span>输入控制指令</span>
          <textarea id="agentInput" rows="2" placeholder="例如：你好，帮我看看这个项目现在运行到哪了">${escapeHtml(state.agentInput)}</textarea>
        </label>
        <div class="composerActions">
          <button type="button" id="agentVoiceButton" class="secondary" ${!targetAvailable || state.agentVoiceListening || busy ? 'disabled' : ''}>${state.agentVoiceListening ? '正在听' : '语音'}</button>
          <button type="submit" class="primaryWide" ${!targetAvailable || busy ? 'disabled' : ''}>${busy ? '等待' : '发送'}</button>
        </div>
      </form>
      <p class="helperText">${targetAvailable ? '输入内容会发送给所选设备上的 Claude Code / MiniMax-M3。语音不可用时，可以点输入框使用手机键盘自带麦克风。' : '这台设备还没有配置 CLI 智能体；请选择已配置的笔记本，或先在目标设备上配置 Claude Code / MiniMax-M3。'}</p>
    </section>
  `;
}

function renderAgentTarget(device) {
  const active = device.id === state.agentTargetId;
  const onlineClass = device.isOnline ? 'ok' : 'warn';
  const available = Boolean(device.agent?.cliAvailable);
  return `
    <button type="button" class="agentTarget ${active ? 'active' : ''}" data-agent-target="${escapeAttr(device.id)}">
      <strong>${escapeHtml(device.displayName || device.name)}</strong>
      <span class="statusPill ${onlineClass}">${device.isOnline ? '在线' : '离线'}</span>
      <small>${escapeHtml(device.code || code(device.id, device.isSelf ? 'THIS' : 'PC'))} · ${available ? 'CLI 可用' : 'CLI 未配置'}</small>
    </button>
  `;
}

function agentMessages(session) {
  if (Array.isArray(session.messages) && session.messages.length) return session.messages;
  if (session.output) {
    return [{ id: 'legacy-output', role: 'assistant', text: session.output, createdAt: session.updatedAt || Date.now() }];
  }
  return [{
    id: 'agent-empty',
    role: 'assistant',
    text: '这里是手机控制终端。点“连接”或直接发送一句话，我会通过 Claude Code / MiniMax-M3 帮你操作这台电脑。',
    createdAt: Date.now()
  }];
}

function renderAgentMessage(message) {
  const role = message.role === 'user' ? 'user' : message.role === 'error' ? 'error' : 'assistant';
  const label = message.role === 'user' ? '你' : message.role === 'error' ? '错误' : '智能体';
  return `
    <article class="chatBubble ${role} ${message.pending ? 'pending' : ''}">
      <span>${label}</span>
      <p>${escapeHtml(message.text || '')}</p>
    </article>
  `;
}

function renderTasks() {
  return `
    <section class="panelBlock">
      <div class="panelTitle">
        <div>
          <h2>最近任务</h2>
          <p>显示手机、桌面端和 CLI 触发的最近命令</p>
        </div>
        <button class="secondary" id="refreshTasksButton">刷新</button>
      </div>
      <div class="taskList">
        ${state.tasks.length ? state.tasks.map(renderTask).join('') : '<p class="emptyText">还没有任务</p>'}
      </div>
    </section>
  `;
}

function renderDevice(device) {
  const disabled = !device.isOnline || !device.trusted || device.readOnly;
  const checked = state.selected.has(device.id) && !disabled;
  const agentLabel = device.agent?.cliAvailable ? 'CLI 可用' : 'CLI 未配置';
  return `
    <label class="deviceRow ${disabled ? 'disabled' : ''}">
      <input type="checkbox" data-device="${escapeAttr(device.id)}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''} />
      <div class="deviceBody">
        <div class="deviceName">
          <strong>${escapeHtml(device.displayName || device.name)}</strong>
          <span class="statusPill ${device.isOnline ? 'ok' : 'warn'}">${device.isOnline ? '在线' : '离线'}</span>
        </div>
        <p>${escapeHtml(device.code || code(device.id, device.isSelf ? 'THIS' : 'PC'))} · ${escapeHtml(device.address || '本机')}</p>
        <p>版本 ${escapeHtml(device.appVersion || 'unknown')} · ${device.trusted ? '已信任' : '待信任'}${device.readOnly ? ' · 只读' : ''} · ${agentLabel}</p>
      </div>
    </label>
  `;
}

function renderAction(action) {
  return `
    <button class="actionButton ${action.danger ? 'danger' : ''}" data-action="${escapeAttr(action.id)}" ${state.busy ? 'disabled' : ''}>
      <strong>${escapeHtml(action.label)}</strong>
      <span>${action.danger ? '高风险，需确认' : '点按后执行'}</span>
    </button>
  `;
}

function renderTask(task) {
  const output = [task.output, task.errorOutput].filter(Boolean).join('\n').slice(-3000);
  return `
    <article class="taskItem">
      <header>
        <div>
          <strong>${escapeHtml(task.peerName || task.peerId || '任务')}</strong>
          <p>${escapeHtml(task.command || '')}</p>
        </div>
        <span class="statusPill ${task.status === 'completed' ? 'ok' : task.status === 'failed' ? 'warn' : ''}">${escapeHtml(task.status)}</span>
      </header>
      ${output ? `<pre>${escapeHtml(output)}</pre>` : '<p class="emptyText">等待输出</p>'}
    </article>
  `;
}

function bindEvents() {
  document.querySelector('#refreshButton')?.addEventListener('click', loadAll);
  document.querySelector('#logoutButton')?.addEventListener('click', logout);
  document.querySelector('#refreshTasksButton')?.addEventListener('click', loadAll);
  document.querySelector('#selectAllButton')?.addEventListener('click', selectAllDevices);
  document.querySelector('#clearDevicesButton')?.addEventListener('click', clearDevices);
  document.querySelector('#agentForm')?.addEventListener('submit', sendAgentInput);
  document.querySelector('#startAgentButton')?.addEventListener('click', startAgent);
  document.querySelector('#stopAgentButton')?.addEventListener('click', stopAgent);
  document.querySelector('#refreshAgentButton')?.addEventListener('click', loadAll);
  document.querySelector('#agentInput')?.addEventListener('input', (event) => {
    state.agentInput = event.currentTarget.value;
  });
  document.querySelector('#voiceButton')?.addEventListener('click', startAgentVoice);
  document.querySelector('#agentVoiceButton')?.addEventListener('click', startAgentVoice);
  document.querySelector('#clearVoiceButton')?.addEventListener('click', () => {
    state.voiceText = '';
    render();
  });
  document.querySelectorAll('[data-tab]').forEach((button) => {
    button.addEventListener('click', () => setTab(button.dataset.tab));
  });
  document.querySelectorAll('[data-device]').forEach((input) => {
    input.addEventListener('change', (event) => toggleDevice(event.currentTarget.dataset.device, event.currentTarget.checked));
  });
  document.querySelectorAll('[data-agent-target]').forEach((button) => {
    button.addEventListener('click', () => selectAgentTarget(button.dataset.agentTarget));
  });
  document.querySelectorAll('[data-action]').forEach((button) => {
    button.addEventListener('click', () => runAction(button.dataset.action));
  });
}

function startAgentVoice() {
  if (!agentGatewayEnabled()) {
    setError('Agent Gateway 未开启，智能体语音入口已收起');
    return;
  }
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) {
    state.agentInput = state.agentInput || '';
    state.tab = 'agent';
    setError('当前浏览器不支持 Web Speech。可以点输入框，用手机键盘自带麦克风输入。');
    return;
  }
  const recognition = new Recognition();
  recognition.lang = 'zh-CN';
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  state.agentVoiceListening = true;
  render();
  recognition.onresult = (event) => {
    const text = event.results?.[0]?.[0]?.transcript || '';
    state.agentVoiceListening = false;
    state.agentInput = text;
    state.voiceText = text ? `识别：${text}` : '没有识别到内容';
    state.tab = 'agent';
    render();
    document.querySelector('#agentInput')?.focus();
  };
  recognition.onerror = (event) => {
    state.agentVoiceListening = false;
    setError(`语音识别失败：${event.error || 'unknown'}`);
  };
  recognition.onend = () => {
    state.agentVoiceListening = false;
    render();
  };
  recognition.start();
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

window.addEventListener('focus', loadAll);
setInterval(() => {
  if (state.token) loadAll();
}, 7000);

loadAll();
