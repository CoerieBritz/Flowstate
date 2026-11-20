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

/// Holds the WebSocket auth token generated at startup.
struct TokenState(String);

// ── Token generation ──────────────────────────────────────────────────────────

fn generate_token() -> String {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    (0..16).map(|_| format!("{:02x}", rng.gen::<u8>())).collect()
}

// ── Tauri command ─────────────────────────────────────────────────────────────

#[tauri::command]
fn get_ws_token(state: tauri::State<TokenState>) -> String {
    state.0.clone()
}

// ── Backend lifecycle ─────────────────────────────────────────────────────────

fn log_to_file(log_path: &std::path::Path, msg: &str) {
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(log_path) {
        let _ = writeln!(f, "{msg}");
    }
    println!("{msg}");
}

fn spawn_backend(app: &AppHandle, token: &str) -> Result<CommandChild, Box<dyn std::error::Error>> {
    // Resolve %APPDATA%\com.coerie.flowstate  (created automatically by Tauri)
    let app_data_dir = app
        .path()
        .app_data_dir()
        .expect("Tauri could not resolve the app data directory");

    let log_path = app_data_dir.join("flowstate.log");

    // Ensure data subdirectories exist before the backend starts.
    std::fs::create_dir_all(app_data_dir.join("snapshots"))?;
    std::fs::create_dir_all(app_data_dir.join("feeds"))?;
    std::fs::create_dir_all(app_data_dir.join("playbooks"))?;

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

    log_to_file(&log_path, &format!("[FlowState] Sidecar binary : netwatch-backend"));
    log_to_file(&log_path, &format!("[FlowState] Data directory : {data_dir_str}"));

    // Spawn the PyInstaller-compiled backend as a Tauri sidecar.
    // Pass the auth token so the backend can verify WebSocket clients.
    let spawn_result = app
        .shell()
        .sidecar("netwatch-backend")?
        .args(["--data-dir", &data_dir_str])
        .env("FLOWSTATE_TOKEN", token)
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
    // Every line is also appended to flowstate.log with a timestamp.
    let log_path2 = log_path.clone();
    tauri::async_runtime::spawn(async move {
        use tauri_plugin_shell::process::CommandEvent;
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    let msg = String::from_utf8_lossy(&line);
                    let ts  = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
                    let entry = format!("[{ts}] [stdout] {msg}");
                    log_to_file(&log_path2, &entry);
                }
                CommandEvent::Stderr(line) => {
                    let msg = String::from_utf8_lossy(&line);
                    let ts  = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
                    let entry = format!("[{ts}] [stderr] {msg}");
                    log_to_file(&log_path2, &entry);
                }
                CommandEvent::Error(e) => {
                    let ts = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
                    let entry = format!("[{ts}] [error] spawn error: {e}");
                    log_to_file(&log_path2, &entry);
                    break;
                }
                CommandEvent::Terminated(status) => {
                    let ts = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
                    let entry = format!(
                        "[{ts}] [terminated] code: {:?}, signal: {:?}",
                        status.code, status.signal
                    );
                    log_to_file(&log_path2, &entry);
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
        .invoke_handler(tauri::generate_handler![get_ws_token])
        .setup(|app| {
            let token = generate_token();
            app.manage(TokenState(token.clone()));
            match spawn_backend(app.handle(), &token) {
                Ok(child) => {
                    app.manage(BackendState(std::sync::Arc::new(Mutex::new(Some(child)))));
                    println!("[FlowState] Backend started successfully.");
                }
                Err(e) => {
                    eprintln!("[FlowState] ERROR: Failed to start backend: {e}");
                    eprintln!("[FlowState] The dashboard will load but network data will not be available.");
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
                    println!("[FlowState] Shutting down backend...");
                    let _ = child.kill();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running FlowState");
}
