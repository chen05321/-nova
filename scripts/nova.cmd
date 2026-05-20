@echo off
set DIR=%~dp0
if exist "%DIR%node_runtime\node.exe" (
    set PATH=%DIR%node_runtime;%PATH%
)
node "%DIR%dist\cli\index.js" %*
