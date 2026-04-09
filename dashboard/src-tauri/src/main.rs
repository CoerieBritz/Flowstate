// Prevents a console window opening behind the app on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Mutex;
use tauri::{AppHandle, Manager, WindowEvent};
use tauri_plugin_shell::{process::CommandChild, ShellExt};

// ── State ─────────────────────────────────────────────────────────────────────

/// Holds the running backend process so we can kill it on app exit.
#[derive(Clone)]
struct BackendState(std::sync::Arc<Mutex<Option<CommandChild>>>);

// ── Backend lifecycle ─────────────────────────────────────────────────────────

fn spawn_backend(app: &AppHandle) -> Result<CommandChild, Box<dyn std::error::Error>> {
    // Resolve %APPDATA%\com.coerie.netwatch  (created automatically by Tauri)
    let app_data_dir = app
        .path()
        .app_data_dir()
        .expect("Tauri could not resolve the app data directory");

    // Ensure data subdirectories exist before the backend starts.
    // The backend creates these itself too, but doing it here guarantees they
    // exist before the first WebSocket frame is processed.
    std::fs::create_dir_all(app_data_dir.join("data").join("snapshots"))?;
    std::fs::create_dir_all(app_data_dir.join("soar").join("feeds"))?;

    let data_dir_str = app_data_dir.to_string_lossy().to_string();

    // Log the sidecar path so we can debug if the binary is missing or misnamed.
    println!("[Netwatch] Spawning sidecar 'netwatch-backend' with --data-dir: {data_dir_str}");

    // Spawn the PyInstaller-compiled backend as a Tauri sidecar.
    // The `--data-dir` flag overrides where the backend stores its DB,
    // settings.json, and other runtime files.
    let spawn_result = app
        .shell()
        .sidecar("netwatch-backend")?
        .args(["--data-dir", &data_dir_str])
        .spawn();

    let (mut rx, child) = match spawn_result {
        Ok(v) => v,
        Err(e) => {
            let log_path = app_data_dir.join("launch_error.log");
            let _ = std::fs::write(&log_path, format!("Failed to spawn netwatch-backend: {e}\n"));
            return Err(e.into());
        }
    };

    // Drain the backend's stdout/stderr in a background task so the pipe
    // buffer never fills up and blocks the backend process.
    tauri::async_runtime::spawn(async move {
        use tauri_plugin_shell::process::CommandEvent;
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    let msg = String::from_utf8_lossy(&line);
                    println!("[netwatch-backend] {msg}");
                }
                CommandEvent::Stderr(line) => {
                    let msg = String::from_utf8_lossy(&line);
                    eprintln!("[netwatch-backend:err] {msg}");
                }
                CommandEvent::Error(e) => {
                    eprintln!("[netwatch-backend] spawn error: {e}");
                    break;
                }
                CommandEvent::Terminated(status) => {
                    eprintln!(
                        "[netwatch-backend] terminated — code: {:?}, signal: {:?}",
                        status.code, status.signal
                    );
                    break;
                }
                _ => {}
            }
        }
    });

    Ok(child)
}

// ── Entry point ───────────────────────────────────────────────────────────────

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            match spawn_backend(app.handle()) {
                Ok(child) => {
                    app.manage(BackendState(std::sync::Arc::new(Mutex::new(Some(child)))));
                    println!("[Netwatch] Backend started successfully.");
                }
                Err(e) => {
                    eprintln!("[Netwatch] ERROR: Failed to start backend: {e}");
                    eprintln!("[Netwatch] The dashboard will load but network data will not be available.");
                    // Still register state so the close handler won't panic.
                    app.manage(BackendState(std::sync::Arc::new(Mutex::new(None))));
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { .. } = event {
                let state = window.app_handle().state::<BackendState>().inner().clone();
                let mut guard = state.0.lock().unwrap();
                if let Some(child) = guard.take() {
                    println!("[Netwatch] Shutting down backend...");
                    let _ = child.kill();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Netwatch");
}
