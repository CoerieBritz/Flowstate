// Prevents a console window opening behind the app on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::Write;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, WindowEvent};
use tauri_plugin_shell::{process::CommandChild, ShellExt};

// ── State ─────────────────────────────────────────────────────────────────────

/// Holds the running backend process so we can kill it on app exit.
#[derive(Clone)]
struct BackendState(std::sync::Arc<Mutex<Option<CommandChild>>>);

// ── Backend lifecycle ─────────────────────────────────────────────────────────

fn log_to_file(log_path: &std::path::Path, msg: &str) {
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(log_path) {
        let _ = writeln!(f, "{msg}");
    }
    println!("{msg}");
}

fn spawn_backend(app: &AppHandle) -> Result<CommandChild, Box<dyn std::error::Error>> {
    // Resolve %APPDATA%\com.coerie.flowstate  (created automatically by Tauri)
    let app_data_dir = app
        .path()
        .app_data_dir()
        .expect("Tauri could not resolve the app data directory");

    let log_path = app_data_dir.join("flowstate.log");

    // Ensure data subdirectories exist before the backend starts.
    std::fs::create_dir_all(app_data_dir.join("data").join("snapshots"))?;
    std::fs::create_dir_all(app_data_dir.join("soar").join("feeds"))?;

    // Create a default settings.json if one does not already exist.
    let settings_path = app_data_dir.join("settings.json");
    if !settings_path.exists() {
        let default_settings = serde_json::json!({
            "theme": "dark",
            "refreshInterval": 2000,
            "notifications": true
        });
        let _ = std::fs::write(&settings_path, default_settings.to_string());
        log_to_file(&log_path, "[FlowState] Created default settings.json");
    }

    let data_dir_str = app_data_dir.to_string_lossy().to_string();

    // Resolve the sidecar binary path for logging (Tauri resolves the exact
    // arch-suffixed name, so we log the logical name and the data-dir).
    log_to_file(&log_path, &format!("[FlowState] Sidecar binary : netwatch-backend"));
    log_to_file(&log_path, &format!("[FlowState] Data directory : {data_dir_str}"));

    // Spawn the PyInstaller-compiled backend as a Tauri sidecar.
    let spawn_result = app
        .shell()
        .sidecar("netwatch-backend")?
        .args(["--data-dir", &data_dir_str])
        .spawn();

    let (mut rx, child) = match spawn_result {
        Ok(v) => v,
        Err(e) => {
            let msg = format!("[FlowState] ERROR: Failed to spawn netwatch-backend: {e}");
            log_to_file(&log_path, &msg);
            eprintln!("{msg}");
            return Err(e.into());
        }
    };

    log_to_file(&log_path, "[FlowState] netwatch-backend spawned successfully");

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
