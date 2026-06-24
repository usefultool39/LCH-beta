const app = document.querySelector('#app');
const storeKey = 'lch.mobile.session.v1';

const state = {
  token: localStorage.getItem(storeKey) || '',
  data: null,
  actions: [],
  commandPresets: [],
  agentSession: null,
  selected: new Set(),
  tasks: [],
  tab: localStorage.getItem('lch.mobile.tab.v1') || 'home',
  commandText: '',
  agentInput: '',
  commandMode: 'selected',
  cwd: '',
  voiceText: '',
  voiceListening: false,
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
    const [mobileState, actions, commandPresets, tasks] = await Promise.all([
      api('/state'),
      api('/actions'),
      api('/commands/presets'),
      api('/tasks')
    ]);
    state.data = mobileState;
    state.actions = actions;
    state.commandPresets = commandPresets || mobileState.commandPresets || [];
    state.tasks = tasks;
    if (agentGatewayEnabled()) {
      state.agentSession = await api('/agent/state').catch(() => null);
    } else {
      state.agentSession = null;
    }
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

async function runCommand(event) {
  event?.preventDefault();
  if (!agentGatewayEnabled()) {
    setError('Agent Gateway 未开启，手机端命令入口已收起');
    return;
  }
  const command = String(state.commandText || document.querySelector('#commandText')?.value || '').trim();
  if (!command) {
    setError('先输入要执行的命令');
    return;
  }
  const target = targetText(state.commandMode);
  if (!window.confirm(`确认在「${target}」执行这条命令？\n\n${command.slice(0, 300)}`)) return;
  state.busy = true;
  state.error = '';
  render();
  try {
    await api('/commands/run', {
      method: 'POST',
      body: {
        command,
        mode: state.commandMode,
        peerIds: selectedIds(),
        cwd: state.cwd,
        confirm: true
      }
    });
    state.commandText = command;
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
  state.agentBusy = true;
  state.error = '';
  render();
  try {
    state.agentSession = await api('/agent/start', { method: 'POST' });
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
    state.agentSession = await api('/agent/stop', { method: 'POST' });
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
  if (!state.agentSession?.active) {
    await startAgent();
    if (!state.agentSession?.active) return;
  }
  state.agentBusy = true;
  state.error = '';
  render();
  try {
    state.agentSession = await api('/agent/input', {
      method: 'POST',
      body: { text: value }
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

function applyPreset(id) {
  if (!agentGatewayEnabled()) return;
  const preset = state.commandPresets.find((item) => item.id === id);
  if (!preset) return;
  state.commandText = preset.command;
  state.commandMode = preset.mode || 'selected';
  state.tab = 'command';
  render();
  document.querySelector('#commandText')?.focus();
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
      ${renderNavButton('devices', '设备')}
      ${agentGatewayEnabled() ? renderNavButton('agent', '智能体') : ''}
      ${agentGatewayEnabled() ? renderNavButton('command', '命令') : ''}
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
  if (state.tab === 'command') return agentGatewayEnabled() ? renderCommand() : renderHome(onlineCount, selectedCount);
  if (state.tab === 'tasks') return renderTasks();
  return renderHome(onlineCount, selectedCount);
}

function renderHome(onlineCount, selectedCount) {
  const gateway = gatewayDevice();
  const gatewayStatus = agentGatewayEnabled()
    ? `当前目标：${targetText(state.commandMode)}`
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
          <h2>语音入口</h2>
          <p>${escapeHtml(state.voiceText || '说“查看网络”“锁屏”“运行 hostname”等')}</p>
        </div>
      </div>
      <div class="voiceControls">
        <button id="voiceButton" class="primaryWide" ${state.voiceListening ? 'disabled' : ''}>${state.voiceListening ? '正在听' : '开始语音'}</button>
        <button id="clearVoiceButton" class="secondary">清空</button>
      </div>
      <p class="helperText">如果浏览器不支持语音识别，点“命令”里的输入框，用手机键盘自带麦克风也可以。</p>
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
  const statusClass = active ? 'ok' : session.status === 'failed' ? 'warn' : '';
  const output = session.output || '还没有输出。点“启动”后会打开这台电脑上的 Claude Code，并固定使用 MiniMax-M3。';
  return `
    <section class="panelBlock agentPanel">
      <div class="panelTitle">
        <div>
          <h2>${escapeHtml(session.title || state.data?.agentGateway?.agent?.title || 'Claude Code / MiniMax-M3')}</h2>
          <p>模型：${escapeHtml(session.model || state.data?.agentGateway?.agent?.model || 'MiniMax-M3')} · 目标：${escapeHtml(state.data.device.name)}</p>
        </div>
        <span class="statusPill ${statusClass}">${escapeHtml(session.status || 'closed')}</span>
      </div>

      <div class="agentControls">
        <button id="startAgentButton" class="primaryWide" ${active || state.agentBusy ? 'disabled' : ''}>${active ? '已启动' : '启动'}</button>
        <button id="stopAgentButton" class="secondary" ${!active || state.agentBusy ? 'disabled' : ''}>停止</button>
        <button id="refreshAgentButton" class="secondary">刷新</button>
      </div>

      <pre class="agentOutput">${escapeHtml(output)}</pre>

      <form id="agentForm" class="agentForm">
        <label>
          <span>发送给智能体</span>
          <textarea id="agentInput" rows="4" placeholder="例如：帮我看一下桌面项目的状态">${escapeHtml(state.agentInput)}</textarea>
        </label>
        <div class="voiceControls">
          <button type="button" id="agentVoiceButton" class="secondary" ${state.agentVoiceListening || state.agentBusy ? 'disabled' : ''}>${state.agentVoiceListening ? '正在听' : '语音输入'}</button>
          <button type="submit" class="primaryWide" ${state.agentBusy ? 'disabled' : ''}>${state.agentBusy ? '发送中' : '发送'}</button>
        </div>
      </form>
      <p class="helperText">这条路径只连接网关电脑上的 Claude Code。Claude Code 已按 MiniMax-M3 启动；更高风险的任意命令仍留在“命令”页。</p>
    </section>
  `;
}

function renderCommand() {
  if (!agentGatewayEnabled()) {
    return `
      <section class="panelBlock">
        <div class="panelTitle">
          <div>
            <h2>命令和智能体</h2>
            <p>Agent Gateway 未开启，手机端命令入口已收起。</p>
          </div>
        </div>
        <p class="helperText">需要在桌面端设置 / 系统 / 高级工具中手动开启。</p>
      </section>
    `;
  }
  return `
    <section class="panelBlock commandPanel">
      <div class="panelTitle">
        <div>
          <h2>命令和智能体</h2>
          <p>手机输入命令，由网关电脑执行，或通过 LCH 转发到其它设备</p>
        </div>
      </div>

      <div class="modeSwitch" role="group" aria-label="命令目标">
        ${renderModeButton('gateway', '网关本机')}
        ${renderModeButton('selected', '选中设备')}
        ${renderModeButton('all', '全部在线')}
      </div>

      <form id="commandForm" class="commandForm">
        <label>
          <span>命令</span>
          <textarea id="commandText" rows="5" placeholder="例如：hostname">${escapeHtml(state.commandText)}</textarea>
        </label>
        <label>
          <span>工作目录，可不填</span>
          <input id="cwdInput" value="${escapeAttr(state.cwd)}" placeholder="默认使用用户目录" />
        </label>
        <div class="voiceControls">
          <button type="button" id="voiceButton" class="secondary">${state.voiceListening ? '正在听' : '语音填入'}</button>
          <button type="submit" class="primaryWide" ${state.busy ? 'disabled' : ''}>${state.busy ? '执行中' : '执行命令'}</button>
        </div>
      </form>
      <p class="helperText">执行前会再次确认。不要在手机端粘贴不可信脚本；高风险操作建议先在电脑端确认。</p>
    </section>

    <section class="panelBlock">
      <div class="panelTitle">
        <div>
          <h2>常用预设</h2>
          <p>点一下填入命令框，确认后再执行</p>
        </div>
      </div>
      <div class="presetList">
        ${state.commandPresets.map(renderPreset).join('')}
      </div>
    </section>
  `;
}

function renderModeButton(mode, label) {
  return `<button type="button" class="${state.commandMode === mode ? 'active' : ''}" data-mode="${mode}">${label}</button>`;
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
  return `
    <label class="deviceRow ${disabled ? 'disabled' : ''}">
      <input type="checkbox" data-device="${escapeAttr(device.id)}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''} />
      <div class="deviceBody">
        <div class="deviceName">
          <strong>${escapeHtml(device.displayName || device.name)}</strong>
          <span class="statusPill ${device.isOnline ? 'ok' : 'warn'}">${device.isOnline ? '在线' : '离线'}</span>
        </div>
        <p>${escapeHtml(device.code || code(device.id, device.isSelf ? 'THIS' : 'PC'))} · ${escapeHtml(device.address || '本机')}</p>
        <p>版本 ${escapeHtml(device.appVersion || 'unknown')} · ${device.trusted ? '已信任' : '待信任'}${device.readOnly ? ' · 只读' : ''}</p>
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

function renderPreset(preset) {
  return `
    <button class="presetButton" data-preset="${escapeAttr(preset.id)}">
      <strong>${escapeHtml(preset.label)}</strong>
      <span>${escapeHtml(preset.description || preset.command)}</span>
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
  document.querySelector('#commandForm')?.addEventListener('submit', runCommand);
  document.querySelector('#agentForm')?.addEventListener('submit', sendAgentInput);
  document.querySelector('#startAgentButton')?.addEventListener('click', startAgent);
  document.querySelector('#stopAgentButton')?.addEventListener('click', stopAgent);
  document.querySelector('#refreshAgentButton')?.addEventListener('click', loadAll);
  document.querySelector('#commandText')?.addEventListener('input', (event) => {
    state.commandText = event.currentTarget.value;
  });
  document.querySelector('#agentInput')?.addEventListener('input', (event) => {
    state.agentInput = event.currentTarget.value;
  });
  document.querySelector('#cwdInput')?.addEventListener('input', (event) => {
    state.cwd = event.currentTarget.value;
  });
  document.querySelector('#voiceButton')?.addEventListener('click', startVoice);
  document.querySelector('#agentVoiceButton')?.addEventListener('click', startAgentVoice);
  document.querySelector('#clearVoiceButton')?.addEventListener('click', () => {
    state.voiceText = '';
    render();
  });
  document.querySelectorAll('[data-tab]').forEach((button) => {
    button.addEventListener('click', () => setTab(button.dataset.tab));
  });
  document.querySelectorAll('[data-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      state.commandMode = button.dataset.mode;
      render();
    });
  });
  document.querySelectorAll('[data-device]').forEach((input) => {
    input.addEventListener('change', (event) => toggleDevice(event.currentTarget.dataset.device, event.currentTarget.checked));
  });
  document.querySelectorAll('[data-action]').forEach((button) => {
    button.addEventListener('click', () => runAction(button.dataset.action));
  });
  document.querySelectorAll('[data-preset]').forEach((button) => {
    button.addEventListener('click', () => applyPreset(button.dataset.preset));
  });
}

function startVoice() {
  if (!agentGatewayEnabled()) {
    setError('Agent Gateway 未开启，语音命令入口已收起');
    return;
  }
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) {
    state.voiceText = '当前浏览器不支持 Web Speech。可以打开命令页，用手机键盘麦克风输入。';
    state.tab = 'command';
    render();
    return;
  }
  const recognition = new Recognition();
  recognition.lang = 'zh-CN';
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  state.voiceListening = true;
  state.voiceText = '正在听...';
  render();
  recognition.onresult = (event) => {
    const text = event.results?.[0]?.[0]?.transcript || '';
    state.voiceListening = false;
    handleVoiceText(text);
  };
  recognition.onerror = (event) => {
    state.voiceListening = false;
    state.voiceText = `语音识别失败：${event.error || 'unknown'}`;
    render();
  };
  recognition.onend = () => {
    state.voiceListening = false;
    render();
  };
  recognition.start();
}

function startAgentVoice() {
  if (!agentGatewayEnabled()) {
    setError('Agent Gateway 未开启，智能体语音入口已收起');
    return;
  }
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) {
    state.agentInput = state.agentInput || '';
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
    state.tab = 'agent';
    render();
    if (text && window.confirm(`发送给 Claude Code？\n\n${text}`)) sendAgentText(text);
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

function handleVoiceText(text) {
  const action = matchVoiceAction(text);
  if (action) {
    state.voiceText = `识别：${text}。匹配到快捷动作「${action.label}」。`;
    render();
    if (window.confirm(`执行「${action.label}」？`)) runAction(action.id);
    return;
  }
  state.commandMode = inferVoiceMode(text);
  state.commandText = voiceToCommand(text);
  state.voiceText = `识别：${text}。已填入命令框。`;
  state.tab = 'command';
  render();
}

function matchVoiceAction(text) {
  const value = String(text || '').toLowerCase();
  if (value.includes('锁') || value.includes('锁屏')) return state.actions.find((action) => action.id === 'lock-screen');
  if (value.includes('下载')) return state.actions.find((action) => action.id === 'open-downloads');
  if (value.includes('网络') || value.includes('ip')) return state.actions.find((action) => action.id === 'network-info');
  if (value.includes('测试') || value.includes('在线')) return state.actions.find((action) => action.id === 'connection-test');
  return null;
}

function inferVoiceMode(text) {
  const value = String(text || '').toLowerCase();
  if (value.includes('网关') || value.includes('本机') || value.includes('这台电脑')) return 'gateway';
  if (value.includes('全部') || value.includes('所有') || value.includes('每台') || value.includes('三台')) return 'all';
  return 'selected';
}

function voiceToCommand(text) {
  let value = String(text || '').trim();
  value = value.replace(/[，。；：！]/g, ' ');
  value = value.replace(/^(帮我|请|麻烦)?(在)?(网关|本机|这台电脑|全部设备|所有设备|选中设备)?(上)?(执行|运行|输入|命令)\s*/i, '');
  if (value.includes('主机名')) return 'hostname';
  if (value.includes('当前用户')) return 'whoami';
  if (value.includes('查看网关 CLI') || value.includes('查看网关 cli')) {
    return 'codex --version; claude --version; opencode --version; gemini --version';
  }
  return value || 'hostname';
}

function targetText(mode) {
  if (mode === 'gateway') return gatewayDevice()?.displayName || gatewayDevice()?.name || '网关本机';
  if (mode === 'all') return `全部在线可信设备（${writableDevices().length} 台）`;
  return `选中设备（${selectedDevices().length} 台）`;
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
