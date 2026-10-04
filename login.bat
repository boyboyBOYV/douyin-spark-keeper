@echo off
cd /d "%~dp0"
echo 正在打开抖音登录窗口，请扫码登录...
"C:\Program Files\nodejs\node.exe" send-spark.js --login
echo.
echo 登录流程已结束，可关闭本窗口
pause
