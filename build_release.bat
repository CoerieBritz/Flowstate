@echo off
setlocal EnableDelayedExpansion

echo ============================================================
echo  FlowState - Full Release Build
echo  Produces: dashboard\src-tauri\target\release\bundle\
echo ============================================================
echo.

cd /d "%~dp0"

:: ── Pre-flight checks ────────────────────────────────────────────────────────

cargo --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Rust/Cargo not found.
    echo Install from https://rustup.rs/ then re-run this script.
    pause
    exit /b 1
)

node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Node.js not found.
    echo Install LTS from https://nodejs.org/ then re-run this script.
    pause
    exit /b 1
)

python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Python not found.
    echo Install Python 3.10+ from https://python.org/ then re-run this script.
    pause
    exit /b 1
)

:: ── Check icons exist ────────────────────────────────────────────────────────
if not exist "dashboard\src-tauri\icons\icon.ico" (
    echo WARNING: icons not found at dashboard\src-tauri\icons\
    echo Run the following to generate them from a PNG source image:
    echo   cd dashboard ^&^& npx tauri icon path\to\your-logo.png
    echo Then re-run this script.
    echo.
    pause
    exit /b 1
)

:: ── STEP 1: Build Python backend with PyInstaller ───────────────────────────
echo [STEP 1/3] Building Python backend with PyInstaller...
echo.
call build_backend.bat
if %errorlevel% neq 0 (
    echo ERROR: Backend build failed.
    pause
    exit /b 1
)

:: ── STEP 2: Install npm deps ─────────────────────────────────────────────────
echo [STEP 2/3] Installing npm dependencies...
cd dashboard
call npm install
if %errorlevel% neq 0 (
    echo ERROR: npm install failed.
    cd ..
    pause
    exit /b 1
)

:: ── STEP 3: Tauri release build ──────────────────────────────────────────────
echo.
echo [STEP 3/3] Running Tauri release build ^(first run compiles Rust; ~5-15 min^)...
echo.
call npx tauri build
if %errorlevel% neq 0 (
    echo ERROR: Tauri build failed. Check output above.
    cd ..
    pause
    exit /b 1
)

cd ..

echo.
echo ============================================================
echo  RELEASE BUILD COMPLETE
echo ============================================================
echo.
echo Installers:
echo   NSIS .exe  -^>  dashboard\src-tauri\target\release\bundle\nsis\
echo   MSI        -^>  dashboard\src-tauri\target\release\bundle\msi\
echo.
pause
