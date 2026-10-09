// 抖音续火花核心逻辑模块
// 提供：读取好友列表、给指定好友发消息
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
  constructor(options = {}) {
    this.show = options.show || false;
    this.context = null;
    this.page = null;
    this.onLog = options.onLog || ((msg) => console.log(msg));
  }

  log(msg) {
    const line = `[${new Date().toLocaleString('zh-CN', { hour12: false })}] ${msg}`;
    this.onLog(line);
  }

  async launch() {
    const launchArgs = ['--disable-blink-features=AutomationControlled'];
    if (!this.show) launchArgs.push('--window-position=-32000,-32000');

    this.context = await chromium.launchPersistentContext(PROFILE_DIR, {
      headless: false,
      viewport: { width: 1440, height: 900 },
      args: launchArgs,
    });
    this.page = this.context.pages()[0] || (await this.context.newPage());
    this.page.setDefaultTimeout(20000);
  }

  async close() {
    if (this.context) {
      await this.context.close();
      this.context = null;
      this.page = null;
    }
  }

  // 检查是否已登录
  async ensureLoggedIn(waitForLogin = false) {
    await this.page.goto(CHAT_URL, { waitUntil: 'domcontentloaded' });
    const maxRounds = waitForLogin ? 60 : 4;
    for (let i = 0; i < maxRounds; i++) {
      try {
        await this.page.waitForSelector('[data-e2e="conversation-item"]', { timeout: i === 0 ? 20000 : 10000 });
        return true;
      } catch (e) {
        if (waitForLogin) this.log('等待扫码登录中...');
      }
    }
    return false;
  }

  // 读取当前可见的会话
  async readVisibleConversations() {
    return this.page.evaluate(() => {
      return [...document.querySelectorAll('[data-e2e="conversation-item"]')].map((el) => {
        const nameEl = el.querySelector('.conversationConversationItemtitle');
        const img = el.querySelector('img');
        const streakEl = el.querySelector('.commonStreaknormalText');
        const src = img ? img.src : '';
        // 提取头像文件名哈希（tos-cn-xxx部分），不受CDN域名变化影响
        const avatarHash = src ? src.split('/').pop().split('~')[0] : '';
        return {
          name: nameEl ? nameEl.innerText.trim() : '(未知)',
          avatar: avatarHash,
          avatarFull: src,
          streak: streakEl ? streakEl.innerText.trim() : '',
        };
      });
    });
  }

  // 滚动列表加载更多
  async scrollListDown() {
    const box = await this.page.locator('.conversationConversationListwrapper').boundingBox();
    if (box) {
      await this.page.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height / 2, 400));
      await this.page.mouse.wheel(0, 800);
    }
    await sleep(1500);
  }

  // 读取全部好友（滚动加载到底）
  async fetchAllFriends() {
    this.log('正在加载好友列表...');
    const loggedIn = await this.ensureLoggedIn(true);
    if (!loggedIn) {
      this.log('登录超时或未登录');
      return [];
    }
    await sleep(6000);

    const allFriends = new Map();
    let noChangeTimes = 0;

    for (let round = 0; round < 100; round++) {
      const convs = await this.readVisibleConversations();
      convs.forEach((c) => {
        const key = c.avatar || c.name;
        if (!allFriends.has(key)) {
          allFriends.set(key, { ...c, key, selected: true });
        }
      });

      await this.scrollListDown();
      const after = await this.readVisibleConversations();
      let changed = false;
      after.forEach((c) => {
        const key = c.avatar || c.name;
        if (!allFriends.has(key)) changed = true;
      });

      if (!changed) {
        noChangeTimes++;
        if (noChangeTimes >= 2) break;
      } else {
        noChangeTimes = 0;
      }
    }

    const friends = [...allFriends.values()];
    this.log(`共读取到 ${friends.length} 位好友`);

    // 保存缓存
    fs.writeFileSync(FRIENDS_CACHE, JSON.stringify(friends, null, 2), 'utf-8');
    return friends;
  }

  // 从缓存读取好友
  loadCachedFriends() {
    try {
      if (fs.existsSync(FRIENDS_CACHE)) {
        return JSON.parse(fs.readFileSync(FRIENDS_CACHE, 'utf-8'));
      }
    } catch (e) { /* 忽略 */ }
    return [];
  }

  // 检查输入框是否为空
  async isInputEmpty() {
    return this.page.evaluate(() => {
      const ed = document.querySelector('[data-e2e="msg-input"] div[contenteditable="true"]');
      return ed ? ed.innerText.replace(/[\u200b\s]/g, '') === '' : true;
    });
  }

  // 给当前打开的会话发消息
  async sendToCurrent(message) {
    await this.page.waitForSelector('[data-e2e="msg-input"] div[contenteditable="true"]', { timeout: 15000 });
    await sleep(800);

    const editor = this.page.locator('[data-e2e="msg-input"] div[contenteditable="true"]');
    await editor.click();
    await sleep(300);
    await this.page.keyboard.insertText(message);
    await sleep(500);

    const hasContent = !(await this.isInputEmpty());
    if (!hasContent) throw new Error('输入框未成功写入内容');

    await this.page.click('.e2e-send-msg-btn');

    for (let i = 0; i < 16; i++) {
      await sleep(500);
      if (await this.isInputEmpty()) return true;
    }
    throw new Error('点击发送后输入框未清空');
  }

  async clearInput() {
    await this.page.evaluate(() => {
      const ed = document.querySelector('[data-e2e="msg-input"] div[contenteditable="true"]');
      if (ed) ed.focus();
    });
    await this.page.keyboard.press('Control+a');
    await this.page.keyboard.press('Delete');
    await sleep(300);
  }

  // 给指定好友列表发消息
  async sendToFriends(friendKeys, message, blacklist = []) {
    const results = { success: [], failed: [], skipped: [] };
    const blackSet = new Set(blacklist);
    const done = new Set();
    let emptyCount = 0;

    // 构建 key -> name 映射（从好友缓存读取，用于名字匹配备用）
    const keyToName = {};
    // 提取头像文件名哈希（兼容完整URL和纯哈希两种格式）
    const getHash = (s) => {
      if (!s) return '';
      if (s.includes('/')) return s.split('/').pop().split('~')[0];
      return s;
    };
    try {
      if (fs.existsSync(FRIENDS_CACHE)) {
        const cached = JSON.parse(fs.readFileSync(FRIENDS_CACHE, 'utf-8'));
        cached.forEach((f) => {
          const k = f.key || f.avatar || '';
          keyToName[k] = f.name;
        });
      }
    } catch (e) { /* 忽略 */ }

    // 匹配函数：
    // 1. 用头像文件名哈希匹配（不受CDN域名变化影响）
    // 2. 兼容旧格式（完整URL）匹配
    // 3. 名字匹配备用（换头像+改名时才会用到）
    // 返回匹配到的原始 friendKey，未匹配返回 null
    const matchFriend = (c) => {
      const cHash = c.avatar || '';
      for (const fk of friendKeys) {
        if (done.has(fk)) continue;
        // 1. 直接匹配（新格式 vs 新格式）
        if (cHash && fk === cHash) return fk;
        // 2. 旧格式（完整URL）与新格式（文件名哈希）互相比对
        const fkHash = getHash(fk);
        if (cHash && fkHash && fkHash === cHash) return fk;
      }
      // 3. 名字匹配备用
      if (c.name) {
        for (const fk of friendKeys) {
          if (done.has(fk)) continue;
          const name = keyToName[fk];
          if (name && name === c.name) return fk;
        }
      }
      return null;
    };

    // 先等待会话列表加载（最多等30秒）
    this.log('等待会话列表加载...');
    let convs = [];
    for (let i = 0; i < 30; i++) {
      convs = await this.readVisibleConversations();
      if (convs.length > 0) break;
      await sleep(1000);
    }
    if (convs.length === 0) {
      this.log('错误：会话列表加载超时（30秒），页面可能未登录或抖音结构已变化');
      return results;
    }
    this.log(`会话列表已加载，共 ${convs.length} 个会话`);

    // 滚动到列表顶部
    try {
      await this.page.evaluate(() => {
        const list = document.querySelector('.conversationConversationListwrapper');
        if (list) list.scrollTop = 0;
      });
      await sleep(1000);
    } catch (e) { /* 忽略 */ }

    for (let round = 0; round < 200; round++) {
      // 用已处理数量判断是否完成
      if (done.size >= friendKeys.length) {
        this.log('所有选中好友已处理完毕');
        break;
      }

      convs = await this.readVisibleConversations();

      // 空列表重试（连续5次为空才报错）
      if (convs.length === 0) {
        emptyCount++;
        if (emptyCount >= 5) {
          this.log('错误：连续5次读取会话列表为空，停止任务');
          break;
        }
        this.log(`会话列表为空（第${emptyCount}次），等待2秒重试...`);
        await sleep(2000);
        continue;
      }
      emptyCount = 0;

      // 查找目标好友（key匹配 + 名字匹配备用）
      let target = null;
      let targetKey = null;
      for (const c of convs) {
        const matched = matchFriend(c);
        if (matched) { target = c; targetKey = matched; break; }
      }

      if (!target) {
        this.log(`当前可见${convs.length}个会话，已处理${done.size}/${friendKeys.length}，继续滚动...`);
        await this.scrollListDown();
        await sleep(1000);
        const after = await this.readVisibleConversations();
        const hasPending = after.some((c) => matchFriend(c) !== null);
        // 滚动到底且没有待处理好友时，检查是否还有找不到的好友
        if (!hasPending && after.length > 0 && after.length <= convs.length) {
          const missing = friendKeys.filter((k) => !done.has(k));
          if (missing.length > 0) {
            this.log(`警告：${missing.length}个好友在会话列表中找不到（可能已删除），跳过`);
          }
          break;
        }
        continue;
      }

      done.add(targetKey); // 存原始的 friendKey

      if (blackSet.has(target.name)) {
        this.log(`跳过（黑名单）: ${target.name}`);
        results.skipped.push(target.name);
        continue;
      }

      // 在当前列表中找到目标的索引（支持key和名字匹配）
      const convsNow = await this.readVisibleConversations();
      let idx = -1;
      for (let i = 0; i < convsNow.length; i++) {
        const matched = matchFriend(convsNow[i]);
        if (matched === targetKey) { idx = i; break; }
      }
      if (idx === -1) continue;

      try {
        await this.page.locator('[data-e2e="conversation-item"]').nth(idx).click();
      } catch (e) {
        this.log(`点击会话失败: ${target.name} -> ${e.message}`);
      }
      await sleep(2500);

      let ok = false;
      let lastErr = '';
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          await this.sendToCurrent(message);
          ok = true;
          break;
        } catch (e) {
          lastErr = e.message;
          this.log(`发送给 ${target.name} 第 ${attempt + 1} 次失败: ${lastErr}`);
          try { await this.clearInput(); } catch (e2) { /* 忽略 */ }
          await sleep(1500);
        }
      }

      if (ok) {
        const tag = target.streak ? `（火花 ${target.streak}天）` : '';
        this.log(`已发送: ${target.name} ${tag}`);
        results.success.push(target.name);
      } else {
        this.log(`发送失败: ${target.name}（${lastErr}）`);
        results.failed.push(target.name);
      }
      await sleep(1500);
    }

    return results;
  }
}

module.exports = SparkCore;
