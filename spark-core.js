// 抖音续火花核心逻辑模块
// 提供：读取好友列表、给指定好友发消息
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname);
const PROFILE_DIR = path.join(ROOT, '.browser-profile');
const FRIENDS_CACHE = path.join(ROOT, 'friends.json');
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
        return {
          name: nameEl ? nameEl.innerText.trim() : '(未知)',
          avatar: img ? img.src.split('~')[0] : '',
          avatarFull: img ? img.src : '',
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
    await this.ensureLoggedIn();
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
      return ed ? ed.innerText.replace(/[​\s]/g, '') === '' : true;
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

    for (let round = 0; round < 200; round++) {
      const convs = await this.readVisibleConversations();
      const target = convs.find((c) => {
        const key = c.avatar || c.name;
        return friendKeys.includes(key) && !done.has(key);
      });

      if (!target) {
        this.log('当前可见会话中没有待发送的好友，尝试滚动...');
        await this.scrollListDown();
        const after = await this.readVisibleConversations();
        const hasPending = after.some((c) => {
          const key = c.avatar || c.name;
          return friendKeys.includes(key) && !done.has(key);
        });
        if (!hasPending) {
          this.log('所有选中好友已处理完毕');
          break;
        }
        continue;
      }

      const key = target.avatar || target.name;
      done.add(key);

      if (blackSet.has(target.name)) {
        this.log(`跳过（黑名单）: ${target.name}`);
        results.skipped.push(target.name);
        continue;
      }

      const convsNow = await this.readVisibleConversations();
      const idx = convsNow.findIndex((c) => (c.avatar || c.name) === key);
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
