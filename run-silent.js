// 静默运行入口（定时任务用，不起 GUI）
// 读取 config.json 中的 selectedFriends，给选中的好友发消息
const fs = require('fs');
const path = require('path');
const SparkCore = require('./spark-core');

const CONFIG_FILE = path.join(__dirname, 'config.json');
const LOG_DIR = path.join(__dirname, 'logs');

fs.mkdirSync(LOG_DIR, { recursive: true });
const logPath = path.join(LOG_DIR, new Date().toISOString().slice(0, 10) + '.log');

function log(msg) {
  const line = `[${new Date().toLocaleString('zh-CN', { hour12: false })}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(logPath, line + '\n', 'utf-8'); } catch (e) { /* 忽略 */ }
}

(async () => {
  log('=== 抖音续火花定时任务开始 ===');

  let config;
  try {
    config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
  } catch (e) {
    log('配置文件读取失败，退出');
    process.exit(1);
  }

  const selectedFriends = config.selectedFriends || [];
  const message = config.message || '🔥';
  const blacklist = config.blacklist || [];

  if (selectedFriends.length === 0) {
    log('未选择任何好友，请先在 GUI 中勾选并保存设置');
    process.exit(2);
  }

  log(`发送内容: ${message} | 选中好友: ${selectedFriends.length} 人`);

  const spark = new SparkCore({
    show: false,
    onLog: (msg) => log(msg),
  });

  try {
    await spark.launch();
    const loggedIn = await spark.ensureLoggedIn();
    if (!loggedIn) {
      log('错误：未检测到登录状态，请运行 run-gui.bat 重新登录');
      process.exitCode = 2;
      return;
    }

    await new Promise((r) => setTimeout(r, 6000));
    const results = await spark.sendToFriends(selectedFriends, message, blacklist);
    log(`=== 任务结束：成功 ${results.success.length}，失败 ${results.failed.length}，跳过 ${results.skipped.length} ===`);
    if (results.failed.length) log(`失败名单: ${results.failed.join(', ')}`);
  } catch (e) {
    log(`任务异常: ${e.message}`);
    process.exitCode = 1;
  } finally {
    await spark.close();
  }
})();
