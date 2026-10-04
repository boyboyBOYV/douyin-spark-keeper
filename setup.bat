@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 抖音续火花工具 - 一键配置

echo ========================================
echo   抖音续火花工具 - 一键配置
echo   （新电脑 / 移动目录后运行此脚本）
echo ========================================
echo.

:: ========== 1. 检查 Node.js ==========
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [1/5] 未检测到 Node.js，正在自动安装...
    echo       （可能弹出管理员权限确认，请点"是"）
    winget install OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
    if %errorlevel% neq 0 (
        echo.
        echo 自动安装失败，请手动到 https://nodejs.org 下载安装 LTS 版后重试
        pause
        exit /b 1
    )
    set "PATH=%PATH%;C:\Program Files\nodejs"
    echo       Node.js 安装完成
) else (
    echo [1/5] Node.js 已就绪
)

:: ========== 2. 检查依赖 ==========
if not exist "node_modules\playwright" (
    echo [2/5] 正在安装依赖包...
    call npm install --registry=https://registry.npmmirror.com
    if %errorlevel% neq 0 (
        echo 依赖安装失败，请检查网络后重试
        pause
        exit /b 1
    )
) else (
    echo [2/5] 依赖包已就绪
)

:: ========== 3. 检查 Chromium 浏览器 ==========
echo [3/5] 检查浏览器运行环境...
set "PLAYWRIGHT_DOWNLOAD_HOST=https://cdn.npmmirror.com/binaries/playwright"
call npx playwright install chromium
if %errorlevel% neq 0 (
    echo 浏览器安装失败，请检查网络后重试
    pause
    exit /b 1
)

:: ========== 4. 打开图形界面（登录 + 选择好友） ==========
echo.
echo [4/5] 即将打开图形化控制台
echo       请在浏览器中：
echo       1. 点击"刷新好友"，用手机抖音扫码登录
echo       2. 勾选要续火花的好友
echo       3. 设置发送内容，点击"保存设置"
echo       4. 关闭浏览器和控制台窗口，回到这里继续
echo.
pause
start "" run-gui.bat
echo.
echo 控制台已打开，请完成上述操作后关闭控制台窗口
echo 完成后按任意键继续...
pause >nul

:: ========== 5. 创建定时任务 ==========
echo.
echo [5/5] 正在创建每天 22:30 的定时任务...
powershell -ExecutionPolicy Bypass -File "%~dp0register-task.ps1"
if %errorlevel% neq 0 (
    echo 定时任务创建失败，请手动以管理员身份运行本脚本
    pause
    exit /b 1
)

echo.
echo ========================================
echo   配置完成！
echo   每天 22:30 自动给选中的好友续火花
echo   关机错过后开机会自动补跑
echo ========================================
echo.
echo 常用操作：
echo   管理好友 / 改发送内容 → 双击 run-gui.bat
echo   登录失效 → 在 GUI 中点击"刷新好友"重新扫码
echo   立即运行一次 → 在 GUI 中点击"立即运行一次"
echo.
pause
