const app = document.querySelector('#app');
const storeKey = 'lch.mobile.session.v1';
const state = {
  token: localStorage.getItem(storeKey) || '',
  data: null,
  actions: [],
  selected: new Set(),
  tasks: [],
  voiceText: '',
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

function onlineDevices() {
  return (state.data?.devices || []).filter((device) => device.isOnline && device.trusted && !device.readOnly);
}

function selectedIds() {
  const online = onlineDevices();
  const selected = online.filter((device) => state.selected.has(device.id)).map((device) => device.id);
  return selected.length ? selected : online.map((device) => device.id);
}

function setError(error) {
  state.error = error ? String(error.message || error) : '';
  render();
}

async function login(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  state.busy = true;
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
    for (const device of onlineDevices()) {
      if (!state.selected.size) state.selected.add(device.id);
    }
    render();
  } catch (error) {
    state.token = '';
    localStorage.removeItem(storeKey);
    state.error = error.message || String(error);
    renderLogin();
  }
}

async function runAction(actionId) {
  const peerIds = selectedIds();
  if (!peerIds.length) {
    setError('没有可操作的在线设备');
    return;
  }
  state.busy = true;
  state.error = '';
  render();
  try {
    await api('/actions/run', {
      method: 'POST',
      body: { actionId, peerIds }
    });
    await loadAll();
  } catch (error) {
    setError(error);
  } finally {
    state.busy = false;
    render();
  }
}

function toggleDevice(id, checked) {
  if (checked) state.selected.add(id);
  else state.selected.delete(id);
  render();
}

function renderLogin() {
  app.innerHTML = `
    <section class="loginPanel">
      <div>
        <h1>手机控制台</h1>
        <p>连接 ${location.hostname || 'Lan Control Hub'} 的移动网关</p>
      </div>
      ${state.error ? `<p class="errorText">${escapeHtml(state.error)}</p>` : ''}
      <form class="formGrid" id="loginForm">
        <input name="name" autocomplete="nickname" placeholder="手机名称，例如 iPhone" />
        <input name="secret" type="password" autocomplete="current-password" required placeholder="房间密钥" />
        <button type="submit" ${state.busy ? 'disabled' : ''}>${state.busy ? '正在登录' : '登录'}</button>
      </form>
    </section>
  `;
  document.querySelector('#loginForm')?.addEventListener('submit', login);
}

function render() {
  if (!state.data) {
    renderLogin();
    return;
  }
  const devices = state.data.devices || [];
  const onlineCount = devices.filter((device) => device.isOnline).length;
  app.innerHTML = `
    <section class="topPanel">
      <div class="topLine">
        <div>
          <h1>${escapeHtml(state.data.home.name || 'Lan Control Hub')}</h1>
          <div class="roomMeta">
            <span class="pill">${escapeHtml(code(state.data.home.id, 'ROOM'))}</span>
            <span class="pill ok">${onlineCount}/${devices.length} 在线</span>
            <span class="pill">网关 ${escapeHtml(code(state.data.device.id, 'PC'))}</span>
          </div>
        </div>
        <button class="secondary" id="logoutButton">退出</button>
      </div>
      <div class="statusLine">
        <span>Web ${state.data.network.webPort}</span>
        <span>版本 ${escapeHtml(state.data.appVersion)}</span>
      </div>
      ${state.error ? `<p class="errorText">${escapeHtml(state.error)}</p>` : ''}
    </section>

    <div class="sectionTitle">
      <h2>设备</h2>
      <button class="secondary" id="refreshButton">刷新</button>
    </div>
    <section class="deviceList">
      ${devices.map(renderDevice).join('')}
    </section>

    <section class="actionPanel">
      <div>
        <h2>快捷动作</h2>
        <p>未选择设备时默认操作全部在线可信设备</p>
      </div>
      <div class="actionGrid">
        ${state.actions.map(renderAction).join('')}
      </div>
    </section>

    <section class="voicePanel">
      <div>
        <h2>语音</h2>
        <p>${escapeHtml(state.voiceText || '按住说话后，识别结果会匹配到一个快捷动作')}</p>
      </div>
      <div class="voiceControls">
        <button id="voiceButton" class="secondary">语音识别</button>
        <button id="clearVoiceButton" class="secondary">清空</button>
      </div>
    </section>

    <section class="taskPanel">
      <div class="sectionTitle">
        <h2>最近任务</h2>
        <button class="secondary" id="refreshTasksButton">刷新</button>
      </div>
      <div class="taskList">
        ${state.tasks.length ? state.tasks.map(renderTask).join('') : '<p>还没有任务</p>'}
      </div>
    </section>
  `;

  document.querySelector('#logoutButton')?.addEventListener('click', logout);
  document.querySelector('#refreshButton')?.addEventListener('click', loadAll);
  document.querySelector('#refreshTasksButton')?.addEventListener('click', loadAll);
  document.querySelectorAll('[data-device]').forEach((input) => {
    input.addEventListener('change', (event) => toggleDevice(event.currentTarget.dataset.device, event.currentTarget.checked));
  });
  document.querySelectorAll('[data-action]').forEach((button) => {
    button.addEventListener('click', () => runAction(button.dataset.action));
  });
  document.querySelector('#voiceButton')?.addEventListener('click', startVoice);
  document.querySelector('#clearVoiceButton')?.addEventListener('click', () => {
    state.voiceText = '';
    render();
  });
}

function renderDevice(device) {
  const disabled = !device.isOnline || !device.trusted || device.readOnly;
  const checked = state.selected.has(device.id) && !disabled;
  return `
    <label class="deviceRow">
      <input type="checkbox" data-device="${escapeAttr(device.id)}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''} />
      <div>
        <div class="deviceName">
          <strong>${escapeHtml(device.displayName || device.name)}</strong>
          <span class="pill ${device.isOnline ? 'ok' : 'warn'}">${device.isOnline ? '在线' : '离线'}</span>
        </div>
        <div class="deviceMeta">
          <span>${escapeHtml(code(device.id, device.isSelf ? 'THIS' : 'PC'))} · ${escapeHtml(device.address || '本机')}</span>
          <span>版本 ${escapeHtml(device.appVersion || 'unknown')} · ${device.trusted ? '已信任' : '待信任'}${device.readOnly ? ' · 只读' : ''}</span>
        </div>
      </div>
    </label>
  `;
}

function renderAction(action) {
  return `<button class="${action.danger ? 'danger' : ''}" data-action="${escapeAttr(action.id)}" ${state.busy ? 'disabled' : ''}>${escapeHtml(action.label)}</button>`;
}

function renderTask(task) {
  const output = [task.output, task.errorOutput].filter(Boolean).join('\n').slice(-2600);
  return `
    <article class="taskItem">
      <header>
        <strong>${escapeHtml(task.peerName || task.peerId || '任务')}</strong>
        <span class="pill ${task.status === 'completed' ? 'ok' : task.status === 'failed' ? 'warn' : ''}">${escapeHtml(task.status)}</span>
      </header>
      ${output ? `<pre>${escapeHtml(output)}</pre>` : ''}
    </article>
  `;
}

function startVoice() {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) {
    state.voiceText = '当前浏览器不支持 Web Speech，可以先用快捷动作';
    render();
    return;
  }
  const recognition = new Recognition();
  recognition.lang = 'zh-CN';
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  recognition.onresult = (event) => {
    const text = event.results?.[0]?.[0]?.transcript || '';
    state.voiceText = text;
    const action = matchVoiceAction(text);
    render();
    if (action && window.confirm(`执行「${action.label}」？`)) runAction(action.id);
  };
  recognition.onerror = (event) => {
    state.voiceText = `语音识别失败：${event.error || 'unknown'}`;
    render();
  };
  recognition.start();
}

function matchVoiceAction(text) {
  const value = String(text || '').toLowerCase();
  if (value.includes('锁') || value.includes('锁屏')) return state.actions.find((action) => action.id === 'lock-screen');
  if (value.includes('下载')) return state.actions.find((action) => action.id === 'open-downloads');
  if (value.includes('网络') || value.includes('ip')) return state.actions.find((action) => action.id === 'network-info');
  if (value.includes('测试') || value.includes('在线') || value.includes('主机')) return state.actions.find((action) => action.id === 'connection-test');
  return null;
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
}, 5000);

loadAll();
