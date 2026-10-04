@echo off
cd /d "%~dp0"
title 抖音续火花控制台
echo ========================================
echo   抖音续火花控制台启动中...
echo   浏览器将自动打开
echo   关闭此窗口即停止服务
echo ========================================
echo.
"C:\Program Files\nodejs\node.exe" app.js
pause
