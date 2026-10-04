@echo off
cd /d "%~dp0"
echo 正在打开抖音登录窗口，请扫码登录...
"C:\Program Files\nodejs\node.exe" -e "const SparkCore=require('./spark-core');(async()=>{const s=new SparkCore({show:true});await s.launch();await s.ensureLoggedIn(true);console.log('登录成功，5秒后关闭...');setTimeout(async()=>{await s.close();},5000);})();"
echo.
echo 登录完成
pause
