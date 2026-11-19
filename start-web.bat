@echo off
setlocal DisableDelayedExpansion
pushd "%~dp0" || exit /b 1

set "action=start"
if /i "%~1"=="--stop" set "action=stop"

if "%action%"=="start" if not exist "dist\index.html" (
    echo Web files are missing. Extract the whole ZIP, or run pnpm build in the source project.
    pause
    popd
    exit /b 1
)

set "node_exe=%CD%\runtime\node.exe"
if not exist "%node_exe%" (
    where node.exe >nul 2>&1
    if errorlevel 1 (
        echo Node.js was not found. Extract the full Windows Web ZIP, including its runtime folder.
        pause
        popd
        exit /b 1
    )
    set "node_exe=node.exe"
)

"%node_exe%" "proxy\windows-launcher.mjs" %action%
set "exit_code=%ERRORLEVEL%"
if not "%exit_code%"=="0" pause
popd
exit /b %exit_code%
