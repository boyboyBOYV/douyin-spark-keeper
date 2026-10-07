const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname);
const DATA_DIR = process.pkg ? path.dirname(process.execPath) : ROOT;
const PROFILE_DIR = path.join(DATA_DIR, '.browser-profile');
const FRIENDS_CACHE = path.join(DATA_DIR, 'friends.json');
const CHAT_URL = 'https://www.douyin.com/chat';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class SparkCore {
  constructor(options = {}) { this.show = options.show || false; this.context = null; this.page = null; this.onLog = options.onLog || ((msg) => console.log(msg)); }
  log(msg) { this.onLog(`[${new Date().toLocaleString('zh-CN', { hour12: false })}] ${msg}`); }
  async launch() {
    const launchArgs = ['--disable-blink-features=AutomationControlled'];
    if (!this.show) launchArgs.push('--window-position=-32000,-32000');
    this.context = await chromium.launchPersistentContext(PROFILE_DIR, { headless: false, viewport: { width: 1440, height: 900 }, args: launchArgs });
    this.page = this.context.pages()[0] || (await this.context.newPage());
    this.page.setDefaultTimeout(20000);
  }
  async close() { if (this.context) { await this.context.close(); this.context = null; this.page = null; } }
  async ensureLoggedIn(waitForLogin = false) {
    await this.page.goto(CHAT_URL, { waitUntil: 'domcontentloaded' });
    const maxRounds = waitForLogin ? 60 : 4;
    for (let i = 0; i < maxRounds; i++) { try { await this.page.waitForSelector('[data-e2e="conversation-item"]', { timeout: i === 0 ? 20000 : 10000 }); return true; } catch (e) { if (waitForLogin) this.log('等待扫码登录中...'); } }
    return false;
  }
  async readVisibleConversations() {
    return this.page.evaluate(() => [...document.querySelectorAll('[data-e2e="conversation-item"]')].map((el) => {
      const nameEl = el.querySelector('.conversationConversationItemtitle');
      const img = el.querySelector('img');
      const streakEl = el.querySelector('.commonStreaknormalText');
      return { name: nameEl ? nameEl.innerText.trim() : '(未知)', avatar: img ? img.src.split('~')[0] : '', avatarFull: img ? img.src : '', streak: streakEl ? streakEl.innerText.trim() : '' };
    }));
  }
  async scrollListDown() {
    const box = await this.page.locator('.conversationConversationListwrapper').boundingBox();
    if (box) { await this.page.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height / 2, 400)); await this.page.mouse.wheel(0, 800); }
    await sleep(1500);
  }
  async fetchAllFriends() {
    this.log('正在加载好友列表...');
    const loggedIn = await this.ensureLoggedIn(true);
    if (!loggedIn) { this.log('登录超时或未登录'); return []; }
    await sleep(6000);
    const allFriends = new Map(); let noChangeTimes = 0;
    for (let round = 0; round < 100; round++) {
      const convs = await this.readVisibleConversations();
      convs.forEach((c) => { const key = c.avatar || c.name; if (!allFriends.has(key)) allFriends.set(key, { ...c, key, selected: true }); });
      await this.scrollListDown();
      const after = await this.readVisibleConversations();
      let changed = false; after.forEach((c) => { const key = c.avatar || c.name; if (!allFriends.has(key)) changed = true; });
      if (!changed) { noChangeTimes++; if (noChangeTimes >= 2) break; } else { noChangeTimes = 0; }
    }
    const friends = [...allFriends.values()];
    this.log(`共读取到 ${friends.length} 位好友`);
    fs.writeFileSync(FRIENDS_CACHE, JSON.stringify(friends, null, 2), 'utf-8');
    return friends;
  }
  loadCachedFriends() { try { if (fs.existsSync(FRIENDS_CACHE)) return JSON.parse(fs.readFileSync(FRIENDS_CACHE, 'utf-8')); } catch (e) { /* 忽略 */ } return []; }
  async isInputEmpty() { return this.page.evaluate(() => { const ed = document.querySelector('[data-e2e="msg-input"] div[contenteditable="true"]'); return ed ? ed.innerText.replace(/[\u200b\s]/g, '') === '' : true; }); }
  async sendToCurrent(message) {
    await this.page.waitForSelector('[data-e2e="msg-input"] div[contenteditable="true"]', { timeout: 15000 });
    await sleep(800);
    await this.page.locator('[data-e2e="msg-input"] div[contenteditable="true"]').click();
    await sleep(300);
    await this.page.keyboard.insertText(message);
    await sleep(500);
    if (!(await this.isInputEmpty())) throw new Error('输入框未成功写入内容');
    await this.page.click('.e2e-send-msg-btn');
    for (let i = 0; i < 16; i++) { await sleep(500); if (await this.isInputEmpty()) return true; }
    throw new Error('点击发送后输入框未清空');
  }
  async clearInput() {
    await this.page.evaluate(() => { const ed = document.querySelector('[data-e2e="msg-input"] div[contenteditable="true"]'); if (ed) ed.focus(); });
    await this.page.keyboard.press('Control+a'); await this.page.keyboard.press('Delete'); await sleep(300);
  }
  async sendToFriends(friendKeys, message, blacklist = []) {
    const results = { success: [], failed: [], skipped: [] };
    const blackSet = new Set(blacklist);
    const done = new Set();
    let emptyCount = 0;
    this.log('等待会话列表加载...');
    let convs = [];
    for (let i = 0; i < 30; i++) { convs = await this.readVisibleConversations(); if (convs.length > 0) break; await sleep(1000); }
    if (convs.length === 0) { this.log('错误：会话列表加载超时（30秒），页面可能未登录或抖音结构已变化'); return results; }
    this.log(`会话列表已加载，共 ${convs.length} 个会话`);
    try { await this.page.evaluate(() => { const list = document.querySelector('.conversationConversationListwrapper'); if (list) list.scrollTop = 0; }); await sleep(1000); } catch (e) { /* 忽略 */ }
    for (let round = 0; round < 200; round++) {
      if (done.size >= friendKeys.length) { this.log('所有选中好友已处理完毕'); break; }
      convs = await this.readVisibleConversations();
      if (convs.length === 0) { emptyCount++; if (emptyCount >= 5) { this.log('错误：连续5次读取会话列表为空，停止任务'); break; } this.log(`会话列表为空（第${emptyCount}次），等待2秒重试...`); await sleep(2000); continue; }
      emptyCount = 0;
      const target = convs.find((c) => { const key = c.avatar || c.name; return friendKeys.includes(key) && !done.has(key); });
      if (!target) {
        this.log(`当前可见${convs.length}个会话，已处理${done.size}/${friendKeys.length}，继续滚动...`);
        await this.scrollListDown(); await sleep(1000);
        const after = await this.readVisibleConversations();
        const hasPending = after.some((c) => { const key = c.avatar || c.name; return friendKeys.includes(key) && !done.has(key); });
        if (!hasPending && after.length > 0 && after.length <= convs.length) {
          const missing = friendKeys.filter((k) => !done.has(k));
          if (missing.length > 0) this.log(`警告：${missing.length}个好友在会话列表中找不到（可能已删除或头像URL变化），跳过`);
          break;
        }
        continue;
      }
      const key = target.avatar || target.name; done.add(key);
      if (blackSet.has(target.name)) { this.log(`跳过（黑名单）: ${target.name}`); results.skipped.push(target.name); continue; }
      const convsNow = await this.readVisibleConversations();
      const idx = convsNow.findIndex((c) => (c.avatar || c.name) === key);
      if (idx === -1) continue;
      try { await this.page.locator('[data-e2e="conversation-item"]').nth(idx).click(); } catch (e) { this.log(`点击会话失败: ${target.name} -> ${e.message}`); }
      await sleep(2500);
      let ok = false; let lastErr = '';
      for (let attempt = 0; attempt < 2; attempt++) {
        try { await this.sendToCurrent(message); ok = true; break; }
        catch (e) { lastErr = e.message; this.log(`发送给 ${target.name} 第 ${attempt + 1} 次失败: ${lastErr}`); try { await this.clearInput(); } catch (e2) { /* 忽略 */ } await sleep(1500); }
      }
      if (ok) { this.log(`已发送: ${target.name}${target.streak ? `（火花 ${target.streak}天）` : ''}`); results.success.push(target.name); }
      else { this.log(`发送失败: ${target.name}（${lastErr}）`); results.failed.push(target.name); }
      await sleep(1500);
    }
    return results;
  }
}
module.exports = SparkCore;
