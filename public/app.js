// 前端逻辑
const API = '';

// 状态
let friends = [];
let config = { message: '🔥', selectedFriends: [], blacklist: [] };
let isRunning = false;
let logPollTimer = null;

// DOM 元素
const $ = (id) => document.getElementById(id);
const friendsList = $('friendsList');
const emptyState = $('emptyState');
const friendCount = $('friendCount');
const selectedInfo = $('selectedInfo');
const searchInput = $('searchInput');
const messageInput = $('messageInput');
const statusBadge = $('statusBadge');
const statusText = $('statusText');
const logBox = $('logBox');
const overlay = $('overlay');
const overlayText = $('overlayText');
const runBtn = $('runBtn');
const stopBtn = $('stopBtn');

// 初始化
async function init() {
  await loadConfig();
  await loadFriends();
  bindEvents();
  updateUI();
}

// 加载配置
async function loadConfig() {
  try {
    const res = await fetch(`${API}/api/config`);
    config = await res.json();
    messageInput.value = config.message || '🔥';
  } catch (e) {
    console.error('加载配置失败', e);
  }
}

// 加载好友列表
async function loadFriends() {
  try {
    const res = await fetch(`${API}/api/friends`);
    friends = await res.json();
    // 应用选中状态
    friends.forEach((f) => {
      f.selected = config.selectedFriends.includes(f.key);
    });
  } catch (e) {
    console.error('加载好友失败', e);
    friends = [];
  }
  renderFriends();
}

// 渲染好友列表
function renderFriends(filter = '') {
  const filtered = filter
    ? friends.filter((f) => f.name.toLowerCase().includes(filter.toLowerCase()))
    : friends;

  if (filtered.length === 0) {
    friendsList.innerHTML = '';
    if (friends.length === 0) {
      friendsList.appendChild(emptyState);
      emptyState.style.display = 'block';
    } else {
      friendsList.innerHTML = '<div class="empty-state"><div class="empty-icon">🔍</div><p>没有匹配的好友</p></div>';
    }
    return;
  }

  emptyState.style.display = 'none';
  friendsList.innerHTML = filtered.map((f) => `
    <div class="friend-card ${f.selected ? 'selected' : ''}" data-key="${f.key}">
      <div class="friend-checkbox"></div>
      ${f.avatarFull
        ? `<img class="friend-avatar" src="${f.avatarFull}" alt="${f.name}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
        : ''}
      <div class="friend-avatar-placeholder" style="${f.avatarFull ? 'display:none' : ''}">${f.name.charAt(0)}</div>
      <div class="friend-info">
        <div class="friend-name">${escapeHtml(f.name)}</div>
        <div class="friend-meta">
          ${f.streak
            ? `<span class="streak-badge">🔥 ${f.streak}天</span>`
            : `<span class="streak-badge no-streak">无火花</span>`}
        </div>
      </div>
    </div>
  `).join('');

  // 绑定点击事件
  friendsList.querySelectorAll('.friend-card').forEach((card) => {
    card.addEventListener('click', () => {
      const key = card.dataset.key;
      const friend = friends.find((f) => f.key === key);
      if (friend) {
        friend.selected = !friend.selected;
        card.classList.toggle('selected');
        updateSelectedCount();
      }
    });
  });
}

// 更新选中数量
function updateSelectedCount() {
  const selected = friends.filter((f) => f.selected).length;
  selectedInfo.textContent = `${selected} / ${friends.length} 人`;
}

// 更新 UI
function updateUI() {
  friendCount.textContent = `${friends.length} 人`;
  updateSelectedCount();
}

// 绑定事件
function bindEvents() {
  // 搜索
  searchInput.addEventListener('input', (e) => {
    renderFriends(e.target.value);
  });

  // 全选
  $('selectAllBtn').addEventListener('click', () => {
    const filter = searchInput.value;
    const target = filter
      ? friends.filter((f) => f.name.toLowerCase().includes(filter.toLowerCase()))
      : friends;
    const allSelected = target.every((f) => f.selected);
    target.forEach((f) => { f.selected = !allSelected; });
    $('selectAllBtn').textContent = allSelected ? '全选' : '取消全选';
    renderFriends(filter);
    updateSelectedCount();
  });

  // 反选
  $('invertBtn').addEventListener('click', () => {
    friends.forEach((f) => { f.selected = !f.selected; });
    renderFriends(searchInput.value);
    updateSelectedCount();
  });

  // 刷新好友
  $('refreshBtn').addEventListener('click', refreshFriends);

  // 保存设置
  $('saveBtn').addEventListener('click', saveConfig);

  // 立即运行
  runBtn.addEventListener('click', runSpark);

  // 停止
  stopBtn.addEventListener('click', stopSpark);

  // 清空日志
  $('clearLogBtn').addEventListener('click', () => {
    logBox.innerHTML = '<div class="log-empty">暂无日志</div>';
  });
}

// 刷新好友列表
async function refreshFriends() {
  if (isRunning) return;
  showOverlay('正在从抖音读取好友列表...');
  setStatus('running', '读取中');
  try {
    const res = await fetch(`${API}/api/friends/refresh`, { method: 'POST' });
    if (res.ok) {
      await loadFriends();
      addLog('info', `好友列表已刷新，共 ${friends.length} 人`);
    } else {
      addLog('error', '刷新好友列表失败');
    }
  } catch (e) {
    addLog('error', `刷新失败: ${e.message}`);
  } finally {
    hideOverlay();
    setStatus('ready', '就绪');
  }
}

// 保存配置
async function saveConfig() {
  const selectedFriends = friends.filter((f) => f.selected).map((f) => f.key);
  const newConfig = {
    message: messageInput.value || '🔥',
    selectedFriends,
    blacklist: config.blacklist || [],
  };
  try {
    const res = await fetch(`${API}/api/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newConfig),
    });
    if (res.ok) {
      config = newConfig;
      addLog('success', `设置已保存：发送内容「${newConfig.message}」，选中 ${selectedFriends.length} 位好友`);
    } else {
      addLog('error', '保存失败');
    }
  } catch (e) {
    addLog('error', `保存失败: ${e.message}`);
  }
}

// 运行续火花
async function runSpark() {
  if (isRunning) return;
  const selectedFriends = friends.filter((f) => f.selected);
  if (selectedFriends.length === 0) {
    alert('请先选择要续火花的好友');
    return;
  }

  // 先保存配置
  await saveConfig();

  isRunning = true;
  runBtn.style.display = 'none';
  stopBtn.style.display = 'block';
  setStatus('running', '运行中');
  showOverlay(`正在给 ${selectedFriends.length} 位好友发送消息...`);
  logBox.innerHTML = '';
  addLog('info', `开始运行：给 ${selectedFriends.length} 位好友发送「${messageInput.value}」`);

  try {
    const res = await fetch(`${API}/api/run`, { method: 'POST' });
    if (!res.ok) throw new Error('启动失败');
  } catch (e) {
    addLog('error', `启动失败: ${e.message}`);
    isRunning = false;
    runBtn.style.display = 'block';
    stopBtn.style.display = 'none';
    setStatus('ready', '就绪');
    hideOverlay();
    return;
  }

  // 轮询状态
  logPollTimer = setInterval(pollStatus, 1500);
}

// 停止运行
async function stopSpark() {
  try {
    await fetch(`${API}/api/stop`, { method: 'POST' });
    addLog('info', '正在停止...');
  } catch (e) { /* 忽略 */ }
}

// 轮询状态
async function pollStatus() {
  try {
    const res = await fetch(`${API}/api/status`);
    const status = await res.json();

    // 更新日志
    if (status.logs && status.logs.length > 0) {
      const logEmpty = logBox.querySelector('.log-empty');
      if (logEmpty) logEmpty.remove();
      status.logs.forEach((line) => {
        if (!logBox.dataset.lastLog || line.time > logBox.dataset.lastLog) {
          addLog(line.type || 'info', line.msg);
          logBox.dataset.lastLog = line.time;
        }
      });
    }

    if (!status.running) {
      clearInterval(logPollTimer);
      isRunning = false;
      runBtn.style.display = 'block';
      stopBtn.style.display = 'none';
      hideOverlay();
      setStatus('ready', '就绪');
      if (status.results) {
        addLog('success', `运行完成：成功 ${status.results.success.length}，失败 ${status.results.failed.length}，跳过 ${status.results.skipped.length}`);
        if (status.results.failed.length > 0) {
          addLog('error', `失败名单: ${status.results.failed.join(', ')}`);
        }
      }
    }
  } catch (e) {
    console.error('轮询失败', e);
  }
}

// 添加日志
function addLog(type, msg) {
  const logEmpty = logBox.querySelector('.log-empty');
  if (logEmpty) logEmpty.remove();
  const line = document.createElement('div');
  line.className = `log-line ${type}`;
  line.textContent = msg;
  logBox.appendChild(line);
  logBox.scrollTop = logBox.scrollHeight;
}

// 设置状态
function setStatus(type, text) {
  statusBadge.className = `status-badge ${type}`;
  statusText.textContent = text;
}

// 遮罩
function showOverlay(text) {
  overlayText.textContent = text;
  overlay.style.display = 'flex';
}

function hideOverlay() {
  overlay.style.display = 'none';
}

// HTML 转义
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// 启动
init();
