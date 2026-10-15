// Windows 定时任务管理模块
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const TASK_NAME = 'DouyinSparkDaily';
const SCRIPT_DIR = __dirname;
const IS_PKG = !!process.pkg;
const EXEC_PATH = IS_PKG ? process.execPath : path.join(SCRIPT_DIR, 'run-silent.bat');
const EXEC_ARGS = IS_PKG ? '--silent' : '';
const WORK_DIR = IS_PKG ? path.dirname(process.execPath) : SCRIPT_DIR;

// 把 execSync 可能返回的 string 或 Buffer 统一转成文本
function toText(v) {
  if (v == null) return '';
  return (typeof v === 'string' ? v : Buffer.from(v).toString('utf-8')).trim();
}

// 执行 PowerShell 脚本，返回 { ok, output, error }
// 旧版这里失败时直接 return null，导致 GUI 只能显示"创建失败"却看不到原因
function runPS(scriptContent) {
  const tmpFile = path.join(os.tmpdir(), `spark-schedule-${Date.now()}.ps1`);
  try {
    const bom = Buffer.from([0xEF, 0xBB, 0xBF]);
    // 强制 PowerShell 用 UTF-8 输出，否则中文报错经管道会变乱码
    const header = 'try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}\n';
    const content = Buffer.concat([bom, Buffer.from(header + scriptContent, 'utf-8')]);
    fs.writeFileSync(tmpFile, content);
    const result = execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${tmpFile}"`, { encoding: 'utf-8', timeout: 20000, stdio: ['pipe', 'pipe', 'pipe'] });
    return { ok: true, output: toText(result), error: '' };
  } catch (e) {
    const detail = [toText(e.stderr), toText(e.stdout)].filter(Boolean).join(' | ');
    const raw = detail || e.message || String(e);
    // 最常见的失败原因就是没提权，直接翻译成人话
    const error = /拒绝访问|Access is denied|denied|0x80070005/i.test(raw)
      ? `权限不足：请右键以管理员身份运行本程序后再试（原始错误：${raw}）`
      : raw;
    return { ok: false, output: '', error };
  } finally {
    try { fs.unlinkSync(tmpFile); } catch (e) { /* 忽略 */ }
  }
}

function getSchedule() {
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
$task = Get-ScheduledTask -TaskName '${TASK_NAME}'
if (-not $task) { Write-Output '{"exists":false}'; exit }
$time = $null
if ($task.Triggers -and $task.Triggers.Count -gt 0) {
  $tb = $task.Triggers[0].StartBoundary
  if ($tb -match 'T(\\d{2}:\\d{2})') { $time = $Matches[1] }
}
$info = Get-ScheduledTaskInfo -TaskName '${TASK_NAME}'
$nextRun = if ($info.NextRunTime) { $info.NextRunTime.ToString('yyyy-MM-dd HH:mm:ss') } else { $null }
Write-Output (@{ exists = $true; enabled = ($task.State -eq 'Ready'); time = $time; nextRun = $nextRun } | ConvertTo-Json -Compress)
`;
  const r = runPS(script);
  if (!r.ok) return { exists: false, enabled: false, time: null, nextRun: null, error: r.error };
  try {
    return JSON.parse(r.output);
  } catch (e) {
    return { exists: false, enabled: false, time: null, nextRun: null, error: `无法解析查询结果: ${r.output.slice(0, 200)}` };
  }
}

function setSchedule(time) {
  // 必须校验 24 小时制的真实范围：只匹配 ^\d{2}:\d{2}$ 的话 25:99 也会通过
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('时间格式不正确，应为 HH:MM（24小时制，如 22:30）');

  // 源码模式下 EXEC_ARGS 为空字符串，不能传 -Argument ''，否则 PowerShell 直接报参数为空错误
  const argPart = EXEC_ARGS ? ` -Argument '${EXEC_ARGS}'` : '';
  const script = `
$ErrorActionPreference = 'Stop'
$action = New-ScheduledTaskAction -Execute '${EXEC_PATH}'${argPart} -WorkingDirectory '${WORK_DIR}'
$trigger = New-ScheduledTaskTrigger -Daily -At '${time}'
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -RestartCount 2 -RestartInterval (New-TimeSpan -Minutes 5)
Register-ScheduledTask -TaskName '${TASK_NAME}' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description '每天${time}自动续火花' -Force | Out-Null
Write-Output 'OK'
`;
  const r = runPS(script);
  if (r.ok && r.output === 'OK') return getSchedule();
  throw new Error(`创建定时任务失败：${r.ok ? r.output : r.error}`);
}

// 删除定时任务
function deleteSchedule() {
  const r = runPS(`$ErrorActionPreference = 'Stop'\nUnregister-ScheduledTask -TaskName '${TASK_NAME}' -Confirm:$false\nWrite-Output 'OK'`);
  return r.ok && r.output === 'OK';
}

// 启用定时任务
function enableSchedule() {
  const r = runPS(`$ErrorActionPreference = 'Stop'\nEnable-ScheduledTask -TaskName '${TASK_NAME}' | Out-Null\nWrite-Output 'OK'`);
  return r.ok && r.output === 'OK';
}

// 禁用定时任务
function disableSchedule() {
  const r = runPS(`$ErrorActionPreference = 'Stop'\nDisable-ScheduledTask -TaskName '${TASK_NAME}' | Out-Null\nWrite-Output 'OK'`);
  return r.ok && r.output === 'OK';
}

module.exports = { getSchedule, setSchedule, deleteSchedule, enableSchedule, disableSchedule, TASK_NAME };
