// Windows 定时任务管理模块
// 封装任务计划程序的增删改查
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const TASK_NAME = 'DouyinSparkDaily';
const SCRIPT_DIR = __dirname;

// 执行 PowerShell 脚本（写入临时文件执行，避免命令行转义问题）
function runPS(scriptContent) {
  const tmpFile = path.join(os.tmpdir(), `spark-schedule-${Date.now()}.ps1`);
  try {
    // 写 UTF-8 BOM（PowerShell 5.1 需要 BOM 才能正确识别 UTF-8）
    const bom = Buffer.from([0xEF, 0xBB, 0xBF]);
    const content = Buffer.concat([bom, Buffer.from(scriptContent, 'utf-8')]);
    fs.writeFileSync(tmpFile, content);
    const result = execSync(`powershell -ExecutionPolicy Bypass -File "${tmpFile}"`, {
      encoding: 'utf-8',
      timeout: 20000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return result.trim();
  } catch (e) {
    return null;
  } finally {
    try { fs.unlinkSync(tmpFile); } catch (e) { /* 忽略 */ }
  }
}

// 查询定时任务状态
function getSchedule() {
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
$task = Get-ScheduledTask -TaskName '${TASK_NAME}'
if (-not $task) {
  Write-Output '{"exists":false}'
  exit
}
$time = $null
if ($task.Triggers -and $task.Triggers.Count -gt 0) {
  $tb = $task.Triggers[0].StartBoundary
  if ($tb -match 'T(\\d{2}:\\d{2})') { $time = $Matches[1] }
}
$info = Get-ScheduledTaskInfo -TaskName '${TASK_NAME}'
$nextRun = if ($info.NextRunTime) { $info.NextRunTime.ToString('yyyy-MM-dd HH:mm:ss') } else { $null }
$result = @{
  exists = $true
  enabled = ($task.State -eq 'Ready')
  time = $time
  nextRun = $nextRun
}
Write-Output ($result | ConvertTo-Json -Compress)
`;

  const output = runPS(script);
  if (!output) return { exists: false, enabled: false, time: null, nextRun: null };
  
  try {
    return JSON.parse(output);
  } catch (e) {
    return { exists: false, enabled: false, time: null, nextRun: null };
  }
}

// 创建或更新定时任务
function setSchedule(time) {
  if (!/^\d{2}:\d{2}$/.test(time)) {
    throw new Error('时间格式不正确，应为 HH:MM');
  }

  const batPath = path.join(SCRIPT_DIR, 'run-silent.bat');
  
  const script = `
$ErrorActionPreference = 'Stop'
$action = New-ScheduledTaskAction -Execute '${batPath}' -WorkingDirectory '${SCRIPT_DIR}'
$trigger = New-ScheduledTaskTrigger -Daily -At '${time}'
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -RestartCount 2 -RestartInterval (New-TimeSpan -Minutes 5)
Register-ScheduledTask -TaskName '${TASK_NAME}' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description '每天${time}自动给抖音好友发消息续火花' -Force | Out-Null
Write-Output 'OK'
`;

  const result = runPS(script);
  if (result === 'OK') {
    return getSchedule();
  }
  throw new Error('创建定时任务失败，请以管理员身份运行或检查权限');
}

// 删除定时任务
function deleteSchedule() {
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
Unregister-ScheduledTask -TaskName '${TASK_NAME}' -Confirm:$false
Write-Output 'OK'
`;
  return runPS(script) === 'OK';
}

// 启用定时任务
function enableSchedule() {
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
Enable-ScheduledTask -TaskName '${TASK_NAME}' | Out-Null
Write-Output 'OK'
`;
  return runPS(script) === 'OK';
}

// 禁用定时任务
function disableSchedule() {
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
Disable-ScheduledTask -TaskName '${TASK_NAME}' | Out-Null
Write-Output 'OK'
`;
  return runPS(script) === 'OK';
}

module.exports = {
  getSchedule,
  setSchedule,
  deleteSchedule,
  enableSchedule,
  disableSchedule,
  TASK_NAME,
};
