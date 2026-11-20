@echo off
setlocal EnableDelayedExpansion

echo ============================================================
echo  FlowState - PyInstaller Backend Build
echo ============================================================
echo.

:: Change to project root (where this bat file lives)
cd /d "%~dp0"

echo [1/3] Checking PyInstaller...
py -m pip show pyinstaller >nul 2>&1
if %errorlevel% neq 0 (
    echo Installing PyInstaller...
    py -m pip install pyinstaller
    if %errorlevel% neq 0 (
        echo ERROR: Failed to install PyInstaller. Make sure Python ^& pip are in PATH.
        pause
        exit /b 1
    )
)
echo PyInstaller OK.

echo.
echo [2/3] Compiling flowstate-backend.exe ^(this may take 1-3 minutes^)...
echo.

:: Clean previous build artifacts
if exist "build\flowstate-backend" rmdir /s /q "build\flowstate-backend"
if exist "dist\flowstate-backend.exe" del /f "dist\flowstate-backend.exe"
if exist "flowstate-backend.spec" del /f "flowstate-backend.spec"

py -m PyInstaller ^
    --onefile ^
    --name flowstate-backend ^
    --add-data "soar;soar" ^
    --add-data "playbooks;playbooks" ^
    --hidden-import=websockets ^
    --hidden-import=websockets.legacy ^
    --hidden-import=websockets.legacy.server ^
    --hidden-import=websockets.asyncio ^
    --hidden-import=websockets.asyncio.server ^
    --hidden-import=psutil ^
    --hidden-import=yaml ^
    --hidden-import=sqlite3 ^
    --collect-all websockets ^
    --noconfirm ^
    flowstate_backend.py

if %errorlevel% neq 0 (
    echo.
    echo ERROR: PyInstaller build failed. Check output above for details.
    pause
    exit /b 1
)

echo.
echo [3/3] Copying to Tauri sidecar directory...

set "SIDECAR_DIR=dashboard\src-tauri\binaries"
if not exist "%SIDECAR_DIR%" mkdir "%SIDECAR_DIR%"

copy /y "dist\flowstate-backend.exe" "%SIDECAR_DIR%\flowstate-backend-x86_64-pc-windows-msvc.exe"
if %errorlevel% neq 0 (
    echo ERROR: Failed to copy to sidecar directory.
    pause
    exit /b 1
)

echo.
echo ============================================================
echo  Backend build complete!
echo  Output: %SIDECAR_DIR%\flowstate-backend-x86_64-pc-windows-msvc.exe
echo ============================================================
echo.
