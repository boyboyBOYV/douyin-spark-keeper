# 创建/更新抖音续火花定时任务
# 由 setup.bat 调用，也可单独运行：powershell -ExecutionPolicy Bypass -File register-task.ps1
param(
    [string]$TaskName = "DouyinSparkDaily",
    [string]$RunTime = "22:30"
)

$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$batPath = Join-Path $dir "run-hidden.bat"

if (-not (Test-Path $batPath)) {
    Write-Host "错误：找不到 run-hidden.bat，请确认本脚本在 douyin-spark 目录内" -ForegroundColor Red
    exit 1
}

$action = New-ScheduledTaskAction -Execute $batPath -WorkingDirectory $dir
$trigger = New-ScheduledTaskTrigger -Daily -At $RunTime
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 10) `
    -RestartCount 2 `
    -RestartInterval (New-TimeSpan -Minutes 5)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description "每天$RunTime自动给抖音好友发消息续火花（关机则开机后补跑）" -Force | Out-Null

$info = Get-ScheduledTaskInfo -TaskName $TaskName
Write-Host "定时任务已就绪：每天 $($info.NextRunTime) 运行" -ForegroundColor Green
