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

function runPS(scriptContent) {
  const tmpFile = path.join(os.tmpdir(), `spark-schedule-${Date.now()}.ps1`);
  try {
    const bom = Buffer.from([0xEF, 0xBB, 0xBF]);
    const content = Buffer.concat([bom, Buffer.from(scriptContent, 'utf-8')]);
    fs.writeFileSync(tmpFile, content);
    const result = execSync(`powershell -ExecutionPolicy Bypass -File "${tmpFile}"`, { encoding: 'utf-8', timeout: 20000, stdio: ['pipe', 'pipe', 'pipe'] });
    return result.trim();
  } catch (e) { return null; }
  finally { try { fs.unlinkSync(tmpFile); } catch (e) { /* 忽略 */ } }
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
  const output = runPS(script);
  if (!output) return { exists: false, enabled: false, time: null, nextRun: null };
  try { return JSON.parse(output); } catch (e) { return { exists: false, enabled: false, time: null, nextRun: null }; }
}

function setSchedule(time) {
  if (!/^\d{2}:\d{2}$/.test(time)) throw new Error('时间格式不正确');
  const script = `
$ErrorActionPreference = 'Stop'
$action = New-ScheduledTaskAction -Execute '${EXEC_PATH}' -Argument '${EXEC_ARGS}' -WorkingDirectory '${WORK_DIR}'
$trigger = New-ScheduledTaskTrigger -Daily -At '${time}'
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -RestartCount 2 -RestartInterval (New-TimeSpan -Minutes 5)
Register-ScheduledTask -TaskName '${TASK_NAME}' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description '每天${time}自动续火花' -Force | Out-Null
Write-Output 'OK'
`;
  if (runPS(script) === 'OK') return getSchedule();
  throw new Error('创建定时任务失败');
}

function deleteSchedule() { return runPS(`$ErrorActionPreference = 'SilentlyContinue'\nUnregister-ScheduledTask -TaskName '${TASK_NAME}' -Confirm:$false\nWrite-Output 'OK'`) === 'OK'; }
function enableSchedule() { return runPS(`$ErrorActionPreference = 'SilentlyContinue'\nEnable-ScheduledTask -TaskName '${TASK_NAME}' | Out-Null\nWrite-Output 'OK'`) === 'OK'; }
function disableSchedule() { return runPS(`$ErrorActionPreference = 'SilentlyContinue'\nDisable-ScheduledTask -TaskName '${TASK_NAME}' | Out-Null\nWrite-Output 'OK'`) === 'OK'; }

module.exports = { getSchedule, setSchedule, deleteSchedule, enableSchedule, disableSchedule, TASK_NAME };
