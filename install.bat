@echo off
echo === Nova - 一键安装 (Windows) ===
echo.

where node >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    echo ✓ 检测到 Node.js
    node -v
) else (
    echo 未检测到 Node.js，正在下载便携版...
    curl -L -o node.zip https://nodejs.org/dist/v22.14.0/node-v22.14.0-win-x64.zip
    powershell -Command "Expand-Archive node.zip -DestinationPath ."
    move node-v22.14.0-win-x64 node_runtime
    set PATH=%CD%\node_runtime;%PATH%
    echo ✓ Node.js 已安装
)

echo.
echo 安装依赖中...
call npm install --silent

echo.
echo 编译中...
call npx tsc --silent

echo.
echo === 安装完成 ===
echo 运行: nova --setup
echo 或:   node dist\cli\index.js --setup
pause
