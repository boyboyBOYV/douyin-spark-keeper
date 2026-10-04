const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const SparkCore = require('./spark-core');
const schedule = require('./schedule');
const PORT = 37890;
const IS_PKG = !!process.pkg;
const ROOT = __dirname;
const DATA_DIR = IS_PKG ? path.dirname(process.execPath) : ROOT;
const PUBLIC_DIR = path.join(ROOT, 'public');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const TODAY_SENT_FILE = path.join(DATA_DIR, 'today_sent.json');
function todayStr() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function readTodaySent() { try { const d = JSON.parse(fs.readFileSync(TODAY_SENT_FILE,'utf-8')); return d.date === todayStr() ? (d.friends||[]) : []; } catch(e) { return []; } }
function writeTodaySent(keys) { fs.writeFileSync(TODAY_SENT_FILE, JSON.stringify({date:todayStr(),friends:keys},null,2),'utf-8'); }
const state = { running:false, busy:false, results:null, logs:[], currentSpark:null, stopRequested:false };
function addLog(type,msg) { state.logs.push({time:Date.now(),type,msg}); if(state.logs.length>500) state.logs.shift(); console.log(`[${type}] ${msg}`); }
function readConfig() { try { return JSON.parse(fs.readFileSync(CONFIG_FILE,'utf-8')); } catch(e) { return {message:'🔥',selectedFriends:[],blacklist:[]}; } }
function writeConfig(c) { fs.writeFileSync(CONFIG_FILE, JSON.stringify(c,null,2),'utf-8'); }
const MIME = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.ico':'image/x-icon'};
function serveStatic(req,res) { let p = req.url==='/'?'/index.html':req.url; const fp = path.join(PUBLIC_DIR,p); if(!fp.startsWith(PUBLIC_DIR)){res.writeHead(403);res.end('Forbidden');return;} fs.readFile(fp,(err,data)=>{ if(err){res.writeHead(404);res.end('Not Found');return;} res.writeHead(200,{'Content-Type':MIME[path.extname(fp)]||'application/octet-stream'}); res.end(data); }); }
function parseBody(req) { return new Promise((resolve,reject)=>{ let b=''; req.on('data',c=>b+=c); req.on('end',()=>{try{resolve(b?JSON.parse(b):{})}catch(e){reject(e)}}); req.on('error',reject); }); }
async function handleAPI(req,res) {
  const url = new URL(req.url,`http://localhost:${PORT}`); const pathname = url.pathname;
  res.setHeader('Content-Type','application/json; charset=utf-8');
  try {
    if(pathname==='/api/friends'&&req.method==='GET') { const spark=new SparkCore({show:false}); const friends=spark.loadCachedFriends(); const sent=readTodaySent(); friends.forEach(f=>f.sentToday=sent.includes(f.key)); res.writeHead(200); res.end(JSON.stringify(friends)); return; }
    if(pathname==='/api/friends/refresh'&&req.method==='POST') {
      if(state.busy){res.writeHead(409);res.end(JSON.stringify({error:'浏览器正忙'}));return;}
      state.busy=true; res.writeHead(200); res.end(JSON.stringify({status:'refreshing'}));
      (async()=>{ const spark=new SparkCore({show:true,onLog:m=>addLog('info',m)}); state.currentSpark=spark; try{await spark.launch();await spark.fetchAllFriends();addLog('success','好友列表刷新完成');}catch(e){addLog('error',`刷新失败: ${e.message}`);}finally{await spark.close();state.currentSpark=null;state.busy=false;} })(); return;
    }
    if(pathname==='/api/config'&&req.method==='GET'){res.writeHead(200);res.end(JSON.stringify(readConfig()));return;}
    if(pathname==='/api/config'&&req.method==='POST'){const b=await parseBody(req);writeConfig({message:b.message||'🔥',selectedFriends:b.selectedFriends||[],blacklist:b.blacklist||[]});res.writeHead(200);res.end(JSON.stringify({status:'ok'}));return;}
    if(pathname==='/api/run'&&req.method==='POST'){
      if(state.running||state.busy){res.writeHead(409);res.end(JSON.stringify({error:'正在运行中'}));return;}
      const config=readConfig(); if(!config.selectedFriends||config.selectedFriends.length===0){res.writeHead(400);res.end(JSON.stringify({error:'未选择好友'}));return;}
      state.running=true;state.stopRequested=false;state.results=null;state.logs=[]; res.writeHead(200);res.end(JSON.stringify({status:'started'}));
      (async()=>{ const spark=new SparkCore({show:false,onLog:m=>addLog('info',m)}); state.currentSpark=spark; try{ addLog('info',`启动续火花任务：发送「${config.message}」给 ${config.selectedFriends.length} 位好友`); await spark.launch(); if(!(await spark.ensureLoggedIn())){addLog('error','未检测到登录状态');state.results={success:[],failed:[],skipped:[]};}else{await new Promise(r=>setTimeout(r,6000));state.results=await spark.sendToFriends(config.selectedFriends,config.message,config.blacklist||[]); try{const all=spark.loadCachedFriends();const nt={};all.forEach(f=>nt[f.name]=f.key);writeTodaySent([...new Set([...readTodaySent(),...state.results.success.map(n=>nt[n]).filter(k=>k)])]);}catch(e){}} }catch(e){addLog('error',`任务异常: ${e.message}`);state.results=state.results||{success:[],failed:[],skipped:[]};}finally{await spark.close();state.currentSpark=null;state.running=false;addLog('success',`任务结束：成功 ${state.results.success.length}，失败 ${state.results.failed.length}`);} })(); return;
    }
    if(pathname==='/api/stop'&&req.method==='POST'){state.stopRequested=true;addLog('info','收到停止请求');res.writeHead(200);res.end(JSON.stringify({status:'stopping'}));return;}
    if(pathname==='/api/status'&&req.method==='GET'){res.writeHead(200);res.end(JSON.stringify({running:state.running,busy:state.busy,results:state.results,logs:state.logs.slice(-50)}));return;}
    if(pathname==='/api/logs'&&req.method==='GET'){res.writeHead(200);res.end(JSON.stringify(state.logs));return;}
    if(pathname==='/api/schedule'&&req.method==='GET'){res.writeHead(200);res.end(JSON.stringify(schedule.getSchedule()));return;}
    if(pathname==='/api/schedule'&&req.method==='POST'){const b=await parseBody(req);if(!b.time||!/^\d{2}:\d{2}$/.test(b.time)){res.writeHead(400);res.end(JSON.stringify({error:'时间格式不正确'}));return;}try{const r=schedule.setSchedule(b.time);if(b.enabled===false){schedule.disableSchedule();r.enabled=false;}res.writeHead(200);res.end(JSON.stringify(r));}catch(e){res.writeHead(500);res.end(JSON.stringify({error:e.message}));}return;}
    if(pathname==='/api/schedule'&&req.method==='DELETE'){const ok=schedule.deleteSchedule();res.writeHead(ok?200:500);res.end(JSON.stringify({success:ok}));return;}
    if(pathname==='/api/schedule/enable'&&req.method==='POST'){const ok=schedule.enableSchedule();res.writeHead(ok?200:500);res.end(JSON.stringify({success:ok,schedule:schedule.getSchedule()}));return;}
    if(pathname==='/api/schedule/disable'&&req.method==='POST'){const ok=schedule.disableSchedule();res.writeHead(ok?200:500);res.end(JSON.stringify({success:ok,schedule:schedule.getSchedule()}));return;}
    res.writeHead(404);res.end(JSON.stringify({error:'Not Found'}));
  }catch(e){res.writeHead(500);res.end(JSON.stringify({error:e.message}));}
}
const server = http.createServer((req,res)=>{ if(req.url.startsWith('/api/')) handleAPI(req,res); else serveStatic(req,res); });
function openBrowser() { const u=`http://localhost:${PORT}`; exec(process.platform==='win32'?`start "" "${u}"`:process.platform==='darwin'?`open "${u}"`:`xdg-open "${u}"`,err=>{if(err)console.log(`请手动打开: ${u}`)}); }
if(process.argv.includes('--silent')) {
  const LOG_DIR=path.join(DATA_DIR,'logs'); fs.mkdirSync(LOG_DIR,{recursive:true}); const lp=path.join(LOG_DIR,new Date().toISOString().slice(0,10)+'.log');
  function sl(m){const l=`[${new Date().toLocaleString('zh-CN',{hour12:false})}] ${m}`;console.log(l);try{fs.appendFileSync(lp,l+'\n','utf-8');}catch(e){}}
  (async()=>{ sl('=== 抖音续火花定时任务开始 ==='); let config; try{config=JSON.parse(fs.readFileSync(CONFIG_FILE,'utf-8'));}catch(e){sl('配置文件读取失败');process.exit(1);} const sf=config.selectedFriends||[]; if(sf.length===0){sl('未选择任何好友');process.exit(2);} sl(`发送内容: ${config.message||'🔥'} | 选中好友: ${sf.length} 人`); const spark=new SparkCore({show:false,onLog:m=>sl(m)}); try{await spark.launch();if(!(await spark.ensureLoggedIn())){sl('错误：未检测到登录状态');process.exitCode=2;return;}await new Promise(r=>setTimeout(r,6000));const results=await spark.sendToFriends(sf,config.message||'🔥',config.blacklist||[]);sl(`=== 任务结束：成功 ${results.success.length}，失败 ${results.failed.length}，跳过 ${results.skipped.length} ===`);try{const all=spark.loadCachedFriends();const nt={};all.forEach(f=>nt[f.name]=f.key);writeTodaySent([...new Set([...readTodaySent(),...results.success.map(n=>nt[n]).filter(k=>k)])]);}catch(e){}}catch(e){sl(`任务异常: ${e.message}`);process.exitCode=1;}finally{await spark.close();} })();
} else {
  server.listen(PORT,()=>{ console.log('========================================'); console.log('  抖音续火花控制台已启动'); console.log(`  地址: http://localhost:${PORT}`); console.log('  浏览器将自动打开'); console.log('========================================'); setTimeout(openBrowser,1000); });
  process.on('SIGINT',async()=>{console.log('\n正在关闭...');if(state.currentSpark)await state.currentSpark.close();server.close();process.exit(0);});
}
