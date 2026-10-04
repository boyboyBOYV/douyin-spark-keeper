// 抖音私信自动续火花
// 用法：
//   node send-spark.js              静默运行（窗口在屏幕外，定时任务用）
//   node send-spark.js --show       可见窗口运行（调试/观看用）
//   node send-spark.js --login      可见窗口，用于扫码登录或重新登录
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PROFILE_DIR = path.join(ROOT, '.browser-profile');
const LOG_DIR = path.join(ROOT, 'logs');
const CHAT_URL = 'https://www.douyin.com/chat';
const MAX_ROUNDS = 200;

const argv = process.argv.slice(2);
const SHOW = argv.includes('--show') || argv.includes('--login');
const LOGIN_MODE = argv.includes('--login');

// 读取配置
let config = { message: '🔥', blacklist: [] };
try {
  config = Object.assign(config, JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf-8')));
} catch (e) {
  console.log('配置文件读取失败，使用默认配置：🔥');
}
const MESSAGE = config.message || '🔥';
const BLACKLIST = new Set(config.blacklist || []);

fs.mkdirSync(LOG_DIR, { recursive: true });
const logPath = path.join(LOG_DIR, new Date().toISOString().slice(0, 10) + '.log');
function log(msg) {
  const line = `[${new Date().toLocaleString('zh-CN', { hour12: false })}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(logPath, line + '\n', 'utf-8'); } catch (e) { /* 忽略日志写入失败 */ }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function readConversations(page) {
  return page.evaluate(() => {
    return [...document.querySelectorAll('[data-e2e="conversation-item"]')].map((el) => {
      const nameEl = el.querySelector('.conversationConversationItemtitle');
      const img = el.querySelector('img');
      const streakEl = el.querySelector('.commonStreaknormalText');
      return {
        name: nameEl ? nameEl.innerText.trim() : '(未知)',
        avatar: img ? img.src.split('~')[0] : '',
        streak: streakEl ? streakEl.innerText.trim() : '',
      };
    });
  });
}

async function isInputEmpty(page) {
  return page.evaluate(() => {
    const ed = document.querySelector('[data-e2e="msg-input"] div[contenteditable="true"]');
    return ed ? ed.innerText.replace(/[​\s]/g, '') === '' : true;
  });
}

async function sendToCurrent(page) {
  // 等待输入区
  await page.waitForSelector('[data-e2e="msg-input"] div[contenteditable="true"]', { timeout: 15000 });
  await sleep(800);

  const editor = page.locator('[data-e2e="msg-input"] div[contenteditable="true"]');
  await editor.click();
  await sleep(300);
  await page.keyboard.insertText(MESSAGE);
  await sleep(500);

  // 确认内容已进入输入框
  const hasContent = !(await isInputEmpty(page));
  if (!hasContent) throw new Error('输入框未成功写入内容');

  // 点击红色发送按钮
  await page.click('.e2e-send-msg-btn');

  // 等待输入框清空 = 发送成功
  for (let i = 0; i < 16; i++) {
    await sleep(500);
    if (await isInputEmpty(page)) return true;
  }
  throw new Error('点击发送后输入框未清空');
}

async function clearInput(page) {
  await page.evaluate(() => {
    const ed = document.querySelector('[data-e2e="msg-input"] div[contenteditable="true"]');
    if (ed) ed.focus();
  });
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Delete');
  await sleep(300);
}

async function scrollListDown(page) {
  const box = await page.locator('.conversationConversationListwrapper').boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height / 2, 400));
    await page.mouse.wheel(0, 800);
  }
  await sleep(1500);
}

(async () => {
  log('=== 抖音续火花任务开始 ===');
  log(`发送内容: ${MESSAGE} | 窗口模式: ${SHOW ? '可见' : '静默'}`);

  const launchArgs = ['--disable-blink-features=AutomationControlled'];
  if (!SHOW) launchArgs.push('--window-position=-32000,-32000');

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: { width: 1440, height: 900 },
    args: launchArgs,
  });
  const page = context.pages()[0] || (await context.newPage());
  page.setDefaultTimeout(20000);

  const results = { success: [], failed: [], skipped: [] };
  try {
    await page.goto(CHAT_URL, { waitUntil: 'domcontentloaded' });

    // 等待会话列表（登录态检测）
    let listReady = false;
    const waitRounds = LOGIN_MODE ? 60 : 4;
    for (let i = 0; i < waitRounds; i++) {
      try {
        await page.waitForSelector('[data-e2e="conversation-item"]', { timeout: i === 0 ? 20000 : 10000 });
        listReady = true;
        break;
      } catch (e) {
        log(LOGIN_MODE ? `等待扫码登录中... (${i * 10}s)` : '会话列表未出现，可能登录已失效');
      }
    }

    if (!listReady) {
      log('错误：未检测到登录会话。请运行 login.bat（或 node send-spark.js --login）重新扫码登录');
      process.exitCode = 2;
      return;
    }

    log('登录状态正常，加载会话列表...');
    await sleep(6000);

    const done = new Set();
    let noChangeTimes = 0;
    let prevKeys = new Set();

    for (let round = 0; round < MAX_ROUNDS; round++) {
      const convs = await readConversations(page);
      const target = convs.find((c) => {
        const key = c.avatar || c.name;
        return !done.has(key);
      });

      if (!target) {
        // 当前可见会话都已处理，尝试滚动加载更多
        log('当前可见会话均已处理，尝试向下滚动加载...');
        await scrollListDown(page);
        const after = await readConversations(page);
        const afterKeys = new Set(after.map((c) => c.avatar || c.name));
        let changed = false;
        afterKeys.forEach((k) => { if (!prevKeys.has(k)) changed = true; });
        if (!changed) {
          noChangeTimes++;
          if (noChangeTimes >= 2) {
            log('列表已滚动到底，无更多会话');
            break;
          }
        } else {
          noChangeTimes = 0;
        }
        prevKeys = afterKeys;
        continue;
      }

      const key = target.avatar || target.name;
      prevKeys.add(key);

      if (BLACKLIST.has(target.name)) {
        log(`跳过（黑名单）: ${target.name}`);
        results.skipped.push(target.name);
        done.add(key);
        continue;
      }

      // 点击该会话（重新定位元素，按名称+索引匹配）
      const convsNow = await readConversations(page);
      const idx = convsNow.findIndex((c) => (c.avatar || c.name) === key);
      if (idx === -1) {
        done.add(key);
        continue;
      }
      try {
        await page.locator('[data-e2e="conversation-item"]').nth(idx).click();
      } catch (e) {
        log(`点击会话失败: ${target.name} -> ${e.message}`);
      }
      await sleep(2500);

      let ok = false;
      let lastErr = '';
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          await sendToCurrent(page);
          ok = true;
          break;
        } catch (e) {
          lastErr = e.message;
          log(`发送给 ${target.name} 第 ${attempt + 1} 次尝试失败: ${lastErr}`);
          try { await clearInput(page); } catch (e2) { /* 忽略 */ }
          await sleep(1500);
        }
      }

      if (ok) {
        const tag = target.streak ? `（火花 ${target.streak}天）` : '';
        log(`已发送: ${target.name} ${tag}`);
        results.success.push(target.name);
      } else {
        log(`发送失败: ${target.name}（${lastErr}）`);
        results.failed.push(target.name);
      }
      done.add(key);
      await sleep(1500);
    }
  } catch (e) {
    log(`任务异常: ${e.message}`);
    process.exitCode = 1;
  } finally {
    log(`=== 任务结束：成功 ${results.success.length}，失败 ${results.failed.length}，跳过 ${results.skipped.length} ===`);
    if (results.failed.length) log(`失败名单: ${results.failed.join(', ')}`);
    await sleep(1000);
    await context.close();
  }
})().catch((e) => {
  log(`致命错误: ${e.message}`);
  process.exit(1);
});
