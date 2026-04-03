@echo off
setlocal EnableDelayedExpansion

:: ============================================================
::   NETWATCH - Local Network Monitor
::   Windows launcher — opens backend + Vite in separate windows
::   Usage: double-click, or run from any PowerShell / cmd
:: ============================================================

set "SCRIPT_DIR=%~dp0"
set "BACKEND=%SCRIPT_DIR%netwatch_backend_win.py"
set "DASHBOARD=%SCRIPT_DIR%dashboard"

:: ── UAC self-elevation ────────────────────────────────────────────────
:: If not already admin, relaunch this script elevated via PowerShell.
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [NETWATCH] Requesting administrator privileges...
    powershell -NoProfile -ExecutionPolicy Bypass -Command ^
        "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b 0
)

:: ── Pre-flight checks ─────────────────────────────────────────────────
where python >nul 2>&1
if %errorLevel% neq 0 (
    echo [ERROR] python not found in PATH.
    echo         Install Python 3.10+ from https://www.python.org
    pause & exit /b 1
)

where npm >nul 2>&1
if %errorLevel% neq 0 (
    echo [ERROR] npm not found in PATH.
    echo         Install Node.js LTS from https://nodejs.org
    pause & exit /b 1
)

if not exist "%BACKEND%" (
    echo [ERROR] Backend script not found:
    echo         %BACKEND%
    pause & exit /b 1
)

if not exist "%DASHBOARD%" (
    echo [ERROR] Dashboard folder not found:
    echo         %DASHBOARD%
    pause & exit /b 1
)

:: ── Install Python deps if missing ───────────────────────────────────
python -c "import psutil, websockets" >nul 2>&1
if %errorLevel% neq 0 (
    echo [INFO] Installing Python dependencies...
    python -m pip install psutil websockets
    if !errorLevel! neq 0 (
        echo [ERROR] pip install failed. Check your Python/pip setup.
        pause & exit /b 1
    )
)

:: ── Install npm deps if missing ───────────────────────────────────────
if not exist "%DASHBOARD%\node_modules" (
    echo [INFO] Installing dashboard npm dependencies...
    pushd "%DASHBOARD%"
    call npm install
    if !errorLevel! neq 0 (
        echo [ERROR] npm install failed.
        popd & pause & exit /b 1
    )
    popd
)

:: ── Banner ────────────────────────────────────────────────────────────
echo.
echo  ============================================
echo    ^^  NETWATCH - Local Network Monitor
echo  ============================================
echo    Backend  : ws://localhost:8765
echo    Dashboard: http://localhost:5173
echo  ============================================
echo.

:: ── Launch backend in a new elevated-cmd window ───────────────────────
start "NETWATCH Backend" cmd /k ^
    "title NETWATCH Backend && echo [NETWATCH] Starting backend... && python \"%BACKEND%\""

:: Give the WebSocket server time to bind
timeout /t 2 /nobreak >nul

:: ── Launch Vite dev server in a new window ────────────────────────────
start "NETWATCH Dashboard" cmd /k ^
    "title NETWATCH Dashboard && cd /d \"%DASHBOARD%\" && echo [NETWATCH] Starting Vite... && npm run dev"

:: ── Done ─────────────────────────────────────────────────────────────
echo  [OK] Backend window opened
echo  [OK] Dashboard window opened
echo.
echo  Open http://localhost:5173 in your browser once Vite finishes starting.
echo  To stop NETWATCH, close both the Backend and Dashboard windows.
echo.
pause
endlocal
