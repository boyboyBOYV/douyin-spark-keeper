// 抖音续火花 - 图形化界面服务器
// 启动本地 HTTP 服务，打开浏览器，提供 API
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const SparkCore = require('./spark-core');
const schedule = require('./schedule');

const PORT = 37890;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const CONFIG_FILE = path.join(ROOT, 'config.json');

// 运行状态
const state = {
  running: false,
  busy: false,
  results: null,
  logs: [],
  currentSpark: null,
  stopRequested: false,
};

function addLog(type, msg) {
  state.logs.push({ time: Date.now(), type, msg });
  if (state.logs.length > 500) state.logs.shift();
  console.log(`[${type}] ${msg}`);
}

// 读取配置
function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
  } catch (e) {
    return { message: '🔥', selectedFriends: [], blacklist: [] };
  }
}

// 保存配置
function writeConfig(config) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

// MIME 类型
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// 静态文件服务
function serveStatic(req, res) {
  let urlPath = req.url === '/' ? '/index.html' : req.url;
  const filePath = path.join(PUBLIC_DIR, urlPath);

  // 安全检查：防止路径遍历
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

// 解析 JSON body
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

// API 处理
async function handleAPI(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  try {
    // GET /api/friends - 获取好友列表（缓存）
    if (pathname === '/api/friends' && req.method === 'GET') {
      const spark = new SparkCore({ show: false });
      const friends = spark.loadCachedFriends();
      res.writeHead(200);
      res.end(JSON.stringify(friends));
      return;
    }

    // POST /api/friends/refresh - 刷新好友列表
    if (pathname === '/api/friends/refresh' && req.method === 'POST') {
      if (state.busy) {
        res.writeHead(409);
        res.end(JSON.stringify({ error: '浏览器正忙，请稍候' }));
        return;
      }
      state.busy = true;
      res.writeHead(200);
      res.end(JSON.stringify({ status: 'refreshing' }));

      // 异步执行
      (async () => {
        const spark = new SparkCore({
          show: false,
          onLog: (msg) => addLog('info', msg),
        });
        state.currentSpark = spark;
        try {
          await spark.launch();
          await spark.fetchAllFriends();
          addLog('success', '好友列表刷新完成');
        } catch (e) {
          addLog('error', `刷新失败: ${e.message}`);
        } finally {
          await spark.close();
          state.currentSpark = null;
          state.busy = false;
        }
      })();
      return;
    }

    // GET /api/config - 获取配置
    if (pathname === '/api/config' && req.method === 'GET') {
      res.writeHead(200);
      res.end(JSON.stringify(readConfig()));
      return;
    }

    // POST /api/config - 保存配置
    if (pathname === '/api/config' && req.method === 'POST') {
      const body = await parseBody(req);
      const config = {
        message: body.message || '🔥',
        selectedFriends: body.selectedFriends || [],
        blacklist: body.blacklist || [],
      };
      writeConfig(config);
      res.writeHead(200);
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    // POST /api/run - 启动运行
    if (pathname === '/api/run' && req.method === 'POST') {
      if (state.running || state.busy) {
        res.writeHead(409);
        res.end(JSON.stringify({ error: '正在运行中' }));
        return;
      }

      const config = readConfig();
      if (!config.selectedFriends || config.selectedFriends.length === 0) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: '未选择好友' }));
        return;
      }

      state.running = true;
      state.stopRequested = false;
      state.results = null;
      state.logs = [];
      res.writeHead(200);
      res.end(JSON.stringify({ status: 'started' }));

      // 异步执行
      (async () => {
        const spark = new SparkCore({
          show: false,
          onLog: (msg) => addLog('info', msg),
        });
        state.currentSpark = spark;
        try {
          addLog('info', `启动续火花任务：发送「${config.message}」给 ${config.selectedFriends.length} 位好友`);
          await spark.launch();
          const loggedIn = await spark.ensureLoggedIn();
          if (!loggedIn) {
            addLog('error', '未检测到登录状态，请先在 GUI 中点击"刷新好友"完成登录');
            state.results = { success: [], failed: [], skipped: [] };
          } else {
            await new Promise((r) => setTimeout(r, 6000));
            state.results = await spark.sendToFriends(
              config.selectedFriends,
              config.message,
              config.blacklist || []
            );
          }
        } catch (e) {
          addLog('error', `任务异常: ${e.message}`);
          state.results = state.results || { success: [], failed: [], skipped: [] };
        } finally {
          await spark.close();
          state.currentSpark = null;
          state.running = false;
          addLog('success', `任务结束：成功 ${state.results.success.length}，失败 ${state.results.failed.length}`);
        }
      })();
      return;
    }

    // POST /api/stop - 停止运行
    if (pathname === '/api/stop' && req.method === 'POST') {
      state.stopRequested = true;
      addLog('info', '收到停止请求');
      res.writeHead(200);
      res.end(JSON.stringify({ status: 'stopping' }));
      return;
    }

    // GET /api/status - 获取状态
    if (pathname === '/api/status' && req.method === 'GET') {
      res.writeHead(200);
      res.end(JSON.stringify({
        running: state.running,
        busy: state.busy,
        results: state.results,
        logs: state.logs.slice(-50),
      }));
      return;
    }

    // GET /api/logs - 获取日志
    if (pathname === '/api/logs' && req.method === 'GET') {
      res.writeHead(200);
      res.end(JSON.stringify(state.logs));
      return;
    }

    // GET /api/schedule - 获取定时任务状态
    if (pathname === '/api/schedule' && req.method === 'GET') {
      res.writeHead(200);
      res.end(JSON.stringify(schedule.getSchedule()));
      return;
    }

    // POST /api/schedule - 创建或更新定时任务
    if (pathname === '/api/schedule' && req.method === 'POST') {
      const body = await parseBody(req);
      const time = body.time;
      if (!time || !/^\d{2}:\d{2}$/.test(time)) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: '时间格式不正确，应为 HH:MM' }));
        return;
      }
      try {
        const result = schedule.setSchedule(time);
        if (body.enabled === false) {
          schedule.disableSchedule();
          result.enabled = false;
        }
        res.writeHead(200);
        res.end(JSON.stringify(result));
      } catch (e) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    // DELETE /api/schedule - 删除定时任务
    if (pathname === '/api/schedule' && req.method === 'DELETE') {
      const ok = schedule.deleteSchedule();
      res.writeHead(ok ? 200 : 500);
      res.end(JSON.stringify({ success: ok }));
      return;
    }

    // POST /api/schedule/enable - 启用定时任务
    if (pathname === '/api/schedule/enable' && req.method === 'POST') {
      const ok = schedule.enableSchedule();
      res.writeHead(ok ? 200 : 500);
      res.end(JSON.stringify({ success: ok, schedule: schedule.getSchedule() }));
      return;
    }

    // POST /api/schedule/disable - 禁用定时任务
    if (pathname === '/api/schedule/disable' && req.method === 'POST') {
      const ok = schedule.disableSchedule();
      res.writeHead(ok ? 200 : 500);
      res.end(JSON.stringify({ success: ok, schedule: schedule.getSchedule() }));
      return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not Found' }));
  } catch (e) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: e.message }));
  }
}

// 创建服务器
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) {
    handleAPI(req, res);
  } else {
    serveStatic(req, res);
  }
});

// 打开浏览器
function openBrowser() {
  const url = `http://localhost:${PORT}`;
  const platform = process.platform;
  let cmd;
  if (platform === 'win32') {
    cmd = `start "" "${url}"`;
  } else if (platform === 'darwin') {
    cmd = `open "${url}"`;
  } else {
    cmd = `xdg-open "${url}"`;
  }
  exec(cmd, (err) => {
    if (err) {
      console.log(`请手动在浏览器打开: ${url}`);
    }
  });
}

// 启动
server.listen(PORT, () => {
  console.log('========================================');
  console.log('  抖音续火花控制台已启动');
  console.log(`  地址: http://localhost:${PORT}`);
  console.log('  浏览器将自动打开，如未打开请手动访问');
  console.log('  按 Ctrl+C 关闭服务');
  console.log('========================================');
  setTimeout(openBrowser, 1000);
});

// 优雅关闭
process.on('SIGINT', async () => {
  console.log('\n正在关闭...');
  if (state.currentSpark) {
    await state.currentSpark.close();
  }
  server.close();
  process.exit(0);
});
