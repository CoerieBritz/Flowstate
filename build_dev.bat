@echo off
setlocal EnableDelayedExpansion

:: ── FlowState - Tauri Dev Mode ─────────────────────────────────────────────
:: Starts the Tauri dev window (Vite dev server + Rust hot-reload).
:: The Python backend is spawned automatically by the Tauri app on startup.
::
:: Prerequisites:
::   - Rust/Cargo installed (https://rustup.rs/)
::   - npm install already run in dashboard/
::   - netwatch-backend-x86_64-pc-windows-msvc.exe in dashboard/src-tauri/binaries/
::     (run build_backend.bat first if not present)
::
:: For the plain dev workflow without Tauri:
::   1. Run: python netwatch_backend_win.py  (as Administrator)
::   2. Run: cd dashboard && npm run dev
:: ─────────────────────────────────────────────────────────────────────────────

cd /d "%~dp0"

if not exist "dashboard\src-tauri\binaries\netwatch-backend-x86_64-pc-windows-msvc.exe" (
    echo WARNING: Backend sidecar not found.
    echo Run build_backend.bat first to compile it.
    echo.
    pause
)

cd dashboard
npx tauri dev
