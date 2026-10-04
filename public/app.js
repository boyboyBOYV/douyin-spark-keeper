const API = '';
let friends = [];
let config = { message: '🔥', selectedFriends: [], blacklist: [] };
let isRunning = false, logPollTimer = null;
const $ = (id) => document.getElementById(id);
const friendsList = $('friendsList'), emptyState = $('emptyState'), friendCount = $('friendCount'), selectedInfo = $('selectedInfo');
const searchInput = $('searchInput'), messageInput = $('messageInput'), statusBadge = $('statusBadge'), statusText = $('statusText');
const logBox = $('logBox'), overlay = $('overlay'), overlayText = $('overlayText'), runBtn = $('runBtn'), stopBtn = $('stopBtn');
const scheduleEmpty = $('scheduleEmpty'), scheduleInfo = $('scheduleInfo'), scheduleState = $('scheduleState'), scheduleTime = $('scheduleTime'), scheduleNext = $('scheduleNext');
const newScheduleTime = $('newScheduleTime'), editScheduleTime = $('editScheduleTime');

async function init() { await loadConfig(); await loadFriends(); await loadSchedule(); bindEvents(); updateUI(); }
async function loadConfig() { try { const res = await fetch(`${API}/api/config`); config = await res.json(); messageInput.value = config.message || '🔥'; } catch (e) { console.error(e); } }
async function loadFriends() { try { const res = await fetch(`${API}/api/friends`); friends = await res.json(); friends.forEach((f) => { f.selected = config.selectedFriends.includes(f.key); }); } catch (e) { friends = []; } renderFriends(); }

function renderFriends(filter = '') {
  const filtered = filter ? friends.filter((f) => f.name.toLowerCase().includes(filter.toLowerCase())) : friends;
  if (filtered.length === 0) {
    friendsList.innerHTML = friends.length === 0 ? '' : '<div class="empty-state"><div class="empty-icon">🔍</div><p>没有匹配的好友</p></div>';
    if (friends.length === 0) { friendsList.appendChild(emptyState); emptyState.style.display = 'block'; }
    return;
  }
  emptyState.style.display = 'none';
  friendsList.innerHTML = filtered.map((f) => `
    <div class="friend-card ${f.selected ? 'selected' : ''}" data-key="${f.key}">
      <div class="friend-checkbox"></div>
      ${f.avatarFull ? `<img class="friend-avatar" src="${f.avatarFull}" alt="${f.name}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">` : ''}
      <div class="friend-avatar-placeholder" style="${f.avatarFull ? 'display:none' : ''}">${f.name.charAt(0)}</div>
      <div class="friend-info">
        <div class="friend-name">${escapeHtml(f.name)}</div>
        <div class="friend-meta">${f.streak ? `<span class="streak-badge ${f.sentToday ? 'sent' : 'unsent'}">🔥 ${f.streak}天</span>` : `<span class="streak-badge no-streak">无火花</span>`}</div>
      </div>
    </div>`).join('');
  friendsList.querySelectorAll('.friend-card').forEach((card) => {
    card.addEventListener('click', () => {
      const f = friends.find((x) => x.key === card.dataset.key);
      if (f) { f.selected = !f.selected; card.classList.toggle('selected'); updateSelectedCount(); }
    });
  });
}
function updateSelectedCount() { selectedInfo.textContent = `${friends.filter((f) => f.selected).length} / ${friends.length} 人`; }
function updateUI() { friendCount.textContent = `${friends.length} 人`; updateSelectedCount(); }

function bindEvents() {
  searchInput.addEventListener('input', (e) => renderFriends(e.target.value));
  $('selectAllBtn').addEventListener('click', () => { const f = searchInput.value; const t = f ? friends.filter((x) => x.name.toLowerCase().includes(f.toLowerCase())) : friends; const all = t.every((x) => x.selected); t.forEach((x) => { x.selected = !all; }); $('selectAllBtn').textContent = all ? '全选' : '取消全选'; renderFriends(f); updateSelectedCount(); });
  $('invertBtn').addEventListener('click', () => { friends.forEach((f) => { f.selected = !f.selected; }); renderFriends(searchInput.value); updateSelectedCount(); });
  $('refreshBtn').addEventListener('click', refreshFriends);
  $('saveBtn').addEventListener('click', saveConfig);
  runBtn.addEventListener('click', runSpark);
  stopBtn.addEventListener('click', stopSpark);
  $('clearLogBtn').addEventListener('click', () => { logBox.innerHTML = '<div class="log-empty">暂无日志</div>'; });
  $('createScheduleBtn').addEventListener('click', createSchedule);
  $('saveScheduleBtn').addEventListener('click', saveSchedule);
  $('toggleScheduleBtn').addEventListener('click', toggleSchedule);
  $('deleteScheduleBtn').addEventListener('click', deleteSchedule);
}

async function refreshFriends() {
  if (isRunning) return;
  showOverlay('正在从抖音读取好友列表...'); setStatus('running', '读取中');
  try { const res = await fetch(`${API}/api/friends/refresh`, { method: 'POST' }); if (res.ok) { await loadFriends(); addLog('info', `好友列表已刷新，共 ${friends.length} 人`); } else addLog('error', '刷新失败'); }
  catch (e) { addLog('error', `刷新失败: ${e.message}`); }
  finally { hideOverlay(); setStatus('ready', '就绪'); }
}

async function saveConfig() {
  const selectedFriends = friends.filter((f) => f.selected).map((f) => f.key);
  const newConfig = { message: messageInput.value || '🔥', selectedFriends, blacklist: config.blacklist || [] };
  try { const res = await fetch(`${API}/api/config`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newConfig) }); if (res.ok) { config = newConfig; addLog('success', `设置已保存：发送「${newConfig.message}」，选中 ${selectedFriends.length} 位好友`); } else addLog('error', '保存失败'); }
  catch (e) { addLog('error', `保存失败: ${e.message}`); }
}

async function runSpark() {
  if (isRunning) return;
  const selectedFriends = friends.filter((f) => f.selected);
  if (selectedFriends.length === 0) { alert('请先选择好友'); return; }
  await saveConfig();
  isRunning = true; runBtn.style.display = 'none'; stopBtn.style.display = 'block'; setStatus('running', '运行中');
  showOverlay(`正在给 ${selectedFriends.length} 位好友发送消息...`); logBox.innerHTML = '';
  addLog('info', `开始运行：给 ${selectedFriends.length} 位好友发送「${messageInput.value}」`);
  try { const res = await fetch(`${API}/api/run`, { method: 'POST' }); if (!res.ok) throw new Error('启动失败'); }
  catch (e) { addLog('error', `启动失败: ${e.message}`); isRunning = false; runBtn.style.display = 'block'; stopBtn.style.display = 'none'; setStatus('ready', '就绪'); hideOverlay(); return; }
  logPollTimer = setInterval(pollStatus, 1500);
}
async function stopSpark() { try { await fetch(`${API}/api/stop`, { method: 'POST' }); addLog('info', '正在停止...'); } catch (e) { /* 忽略 */ } }

async function pollStatus() {
  try {
    const res = await fetch(`${API}/api/status`); const status = await res.json();
    if (status.logs && status.logs.length > 0) {
      const le = logBox.querySelector('.log-empty'); if (le) le.remove();
      status.logs.forEach((line) => { if (!logBox.dataset.lastLog || line.time > logBox.dataset.lastLog) { addLog(line.type || 'info', line.msg); logBox.dataset.lastLog = line.time; } });
    }
    if (!status.running) {
      clearInterval(logPollTimer); isRunning = false; runBtn.style.display = 'block'; stopBtn.style.display = 'none'; hideOverlay(); setStatus('ready', '就绪');
      if (status.results) { addLog('success', `运行完成：成功 ${status.results.success.length}，失败 ${status.results.failed.length}，跳过 ${status.results.skipped.length}`); if (status.results.failed.length > 0) addLog('error', `失败名单: ${status.results.failed.join(', ')}`); }
    }
  } catch (e) { console.error(e); }
}

function addLog(type, msg) { const le = logBox.querySelector('.log-empty'); if (le) le.remove(); const line = document.createElement('div'); line.className = `log-line ${type}`; line.textContent = msg; logBox.appendChild(line); logBox.scrollTop = logBox.scrollHeight; }
function setStatus(type, text) { statusBadge.className = `status-badge ${type}`; statusText.textContent = text; }
function showOverlay(text) { overlayText.textContent = text; overlay.style.display = 'flex'; }
function hideOverlay() { overlay.style.display = 'none'; }
function escapeHtml(str) { const div = document.createElement('div'); div.textContent = str; return div.innerHTML; }

async function loadSchedule() { try { const res = await fetch(`${API}/api/schedule`); renderSchedule(await res.json()); } catch (e) { console.error(e); } }
function renderSchedule(data) {
  if (!data.exists) { scheduleEmpty.style.display = 'block'; scheduleInfo.style.display = 'none'; return; }
  scheduleEmpty.style.display = 'none'; scheduleInfo.style.display = 'block';
  scheduleTime.textContent = data.time || '-'; editScheduleTime.value = data.time || '22:30'; scheduleNext.textContent = data.nextRun || '-';
  if (data.enabled) { scheduleState.textContent = '已启用'; scheduleState.className = 'schedule-state schedule-state-on'; $('toggleScheduleBtn').textContent = '禁用'; }
  else { scheduleState.textContent = '已禁用'; scheduleState.className = 'schedule-state schedule-state-off'; $('toggleScheduleBtn').textContent = '启用'; }
}
async function createSchedule() {
  const time = newScheduleTime.value; if (!time) { alert('请选择时间'); return; }
  try { const res = await fetch(`${API}/api/schedule`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ time }) }); if (res.ok) { renderSchedule(await res.json()); addLog('success', `定时任务已创建：每天 ${time}`); } else { const e = await res.json(); alert(`创建失败：${e.error}`); } } catch (e) { alert(`创建失败：${e.message}`); }
}
async function saveSchedule() {
  const time = editScheduleTime.value; if (!time) { alert('请选择时间'); return; }
  try { const res = await fetch(`${API}/api/schedule`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ time }) }); if (res.ok) { renderSchedule(await res.json()); addLog('success', `定时任务已更新：每天 ${time}`); } else { const e = await res.json(); alert(`保存失败：${e.error}`); } } catch (e) { alert(`保存失败：${e.message}`); }
}
async function toggleSchedule() {
  const on = scheduleState.textContent === '已启用';
  try { const res = await fetch(`${API}/api/schedule/${on ? 'disable' : 'enable'}`, { method: 'POST' }); if (res.ok) { const d = await res.json(); renderSchedule(d.schedule); addLog('info', `定时任务已${on ? '禁用' : '启用'}`); } } catch (e) { alert(`操作失败：${e.message}`); }
}
async function deleteSchedule() {
  if (!confirm('确定删除定时任务？')) return;
  try { const res = await fetch(`${API}/api/schedule`, { method: 'DELETE' }); if (res.ok) { scheduleEmpty.style.display = 'block'; scheduleInfo.style.display = 'none'; addLog('info', '定时任务已删除'); } } catch (e) { alert(`删除失败：${e.message}`); }
}
init();
