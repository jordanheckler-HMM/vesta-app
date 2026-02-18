use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconEvent},
    Manager, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_shell::{process::CommandChild as SidecarChild, ShellExt};

const TRAY_OPEN_MINI_ID: &str = "tray_open_mini";
const TRAY_OPEN_MAIN_ID: &str = "tray_open_main";
const TRAY_QUIT_ID: &str = "tray_quit";
const BACKEND_PORT: u16 = 8090;
const BACKEND_HOST: &str = "127.0.0.1";

// Global state to track the backend process.
enum BackendProcessHandle {
    Native(Child),
    Sidecar(SidecarChild),
}

struct BackendProcess(Arc<Mutex<Option<BackendProcessHandle>>>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            let backend_process = BackendProcess(Arc::new(Mutex::new(None)));
            let backend_arc = backend_process.0.clone();
            app.manage(backend_process);

            cleanup_stale_backend_processes();

            if cfg!(debug_assertions) {
                log::info!("Development mode: Starting Python backend from source...");
                start_dev_backend(app, backend_arc.clone())?;
            } else {
                log::info!("Production mode: Starting bundled backend sidecar...");
                start_prod_backend(app, backend_arc.clone())?;
            }

            log::info!("Waiting for backend to be ready...");
            if !wait_for_backend_ready(30) {
                log::warn!("Backend not fully ready after 30s, but proceeding to open UI...");
            } else {
                log::info!("Backend is ready!");
            }

            create_tray_icon(app)?;
            create_mini_window_if_needed(&app.handle())?;

            log::info!("Backend is ready!");
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app_handle, event| match event {
            tauri::RunEvent::WindowEvent { label, event, .. } => match event {
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    if label == "main" || label == "mini" {
                        api.prevent_close();
                        if let Some(window) = app_handle.get_webview_window(&label) {
                            let _ = window.hide();
                        }
                    }
                }
                tauri::WindowEvent::Focused(false) => {
                    if label == "mini" {
                        if let Some(window) = app_handle.get_webview_window("mini") {
                            let _ = window.hide();
                        }
                    }
                }
                _ => {}
            },
            tauri::RunEvent::MenuEvent(event) => {
                let event_id = event.id().as_ref();
                if event_id == TRAY_OPEN_MINI_ID {
                    show_mini_window(app_handle);
                } else if event_id == TRAY_OPEN_MAIN_ID {
                    show_main_window(app_handle);
                } else if event_id == TRAY_QUIT_ID {
                    cleanup_backend_process(app_handle);
                    app_handle.exit(0);
                }
            }
            tauri::RunEvent::TrayIconEvent(event) => {
                handle_tray_icon_event(app_handle, &event);
            }
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen {
                has_visible_windows,
                ..
            } => {
                if !has_visible_windows {
                    show_main_window(app_handle);
                }
            }
            tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit => {
                cleanup_backend_process(app_handle);
            }
            _ => {}
        });
}

fn create_tray_icon(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let open_mini =
        MenuItem::with_id(app, TRAY_OPEN_MINI_ID, "Open Mini Chat", true, None::<&str>)?;
    let open_main =
        MenuItem::with_id(app, TRAY_OPEN_MAIN_ID, "Open Main Window", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, TRAY_QUIT_ID, "Quit Vesta", true, None::<&str>)?;

    let tray_menu = Menu::with_items(app, &[&open_mini, &open_main, &quit_item])?;

    let mut tray_builder = tauri::tray::TrayIconBuilder::with_id("vesta_tray")
        .menu(&tray_menu)
        .show_menu_on_left_click(false)
        .tooltip("Vesta");

    if let Some(icon) = app.default_window_icon().cloned() {
        tray_builder = tray_builder.icon(icon);
    }

    tray_builder.build(app)?;
    Ok(())
}

fn create_mini_window_if_needed<R: tauri::Runtime>(
    app_handle: &tauri::AppHandle<R>,
) -> Result<(), Box<dyn std::error::Error>> {
    if app_handle.get_webview_window("mini").is_some() {
        return Ok(());
    }

    let mini_url = if cfg!(debug_assertions) {
        WebviewUrl::External("http://localhost:8081/?view=mini".parse()?)
    } else {
        WebviewUrl::App("index.html?view=mini".into())
    };

    WebviewWindowBuilder::new(app_handle, "mini", mini_url)
        .title("Vesta Mini")
        .inner_size(480.0, 680.0)
        .resizable(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .build()?;

    Ok(())
}

fn show_main_window<R: tauri::Runtime>(app_handle: &tauri::AppHandle<R>) {
    if let Some(window) = app_handle.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn show_mini_window<R: tauri::Runtime>(app_handle: &tauri::AppHandle<R>) {
    if let Err(error) = create_mini_window_if_needed(app_handle) {
        log::error!("Failed to create mini window: {error}");
        return;
    }

    if let Some(window) = app_handle.get_webview_window("mini") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn handle_tray_icon_event<R: tauri::Runtime>(
    app_handle: &tauri::AppHandle<R>,
    event: &TrayIconEvent,
) {
    if let TrayIconEvent::Click {
        button,
        button_state,
        ..
    } = event
    {
        if *button == MouseButton::Left && *button_state == MouseButtonState::Up {
            show_mini_window(app_handle);
        }
    }
}

fn cleanup_backend_process<R: tauri::Runtime>(app_handle: &tauri::AppHandle<R>) {
    if let Some(backend_state) = app_handle.try_state::<BackendProcess>() {
        if let Ok(mut process_guard) = backend_state.0.lock() {
            if let Some(process) = process_guard.take() {
                terminate_backend_process(process);
            }
        }
    }
}

fn terminate_backend_process(process: BackendProcessHandle) {
    match process {
        BackendProcessHandle::Native(mut process) => {
            let pid = process.id();
            match process.try_wait() {
                Ok(Some(status)) => {
                    log::info!("Backend process {pid} already exited with status: {status}");
                    return;
                }
                Ok(None) => {}
                Err(error) => {
                    log::warn!("Could not read backend process status for {pid}: {error}");
                }
            }

            log::info!("Terminating backend process {pid}...");
            if let Err(error) = process.kill() {
                log::warn!("Failed to kill backend process {pid} via Child handle: {error}");
            }
            if let Err(error) = process.wait() {
                log::warn!("Failed waiting for backend process {pid} to exit: {error}");
            }
            ensure_pid_terminated(pid);
        }
        BackendProcessHandle::Sidecar(process) => {
            let pid = process.pid();
            log::info!("Terminating backend sidecar process {pid}...");
            if let Err(error) = process.kill() {
                log::warn!("Failed to kill sidecar process {pid} via shell handle: {error}");
            }
            ensure_pid_terminated(pid);
        }
    }
}

fn cleanup_stale_backend_processes() {
    let stale_pids = find_backend_listener_pids(BACKEND_PORT);
    if stale_pids.is_empty() {
        return;
    }

    for pid in stale_pids {
        log::warn!(
            "Detected stale backend process {pid} still listening on port {BACKEND_PORT}; terminating before startup."
        );
        terminate_pid(pid);
    }
}

fn find_backend_listener_pids(port: u16) -> Vec<u32> {
    let output = match Command::new("lsof")
        .arg(format!("-ti:{port}"))
        .arg("-sTCP:LISTEN")
        .output()
    {
        Ok(output) => output,
        Err(error) => {
            log::debug!("Unable to check listeners on port {port}: {error}");
            return Vec::new();
        }
    };

    if !output.status.success() {
        return Vec::new();
    }

    String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| line.trim().parse::<u32>().ok())
        .filter(|pid| *pid != std::process::id())
        .filter(|pid| is_vesta_backend_pid(*pid))
        .collect()
}

fn is_vesta_backend_pid(pid: u32) -> bool {
    let output = match Command::new("ps")
        .arg("-p")
        .arg(pid.to_string())
        .arg("-o")
        .arg("command=")
        .output()
    {
        Ok(output) => output,
        Err(error) => {
            log::debug!("Unable to inspect process {pid}: {error}");
            return false;
        }
    };

    if !output.status.success() {
        return false;
    }

    let command = String::from_utf8_lossy(&output.stdout).to_lowercase();
    command.contains("/vesta-backend")
        && (command.contains("vesta-backend")
            || command.contains("uvicorn")
            || command.contains("sidecar_entry.py"))
}

fn terminate_pid(pid: u32) {
    if !send_signal(pid, "-TERM") {
        return;
    }

    if !wait_for_pid_exit(pid, Duration::from_secs(2)) {
        let _ = send_signal(pid, "-KILL");
        let _ = wait_for_pid_exit(pid, Duration::from_secs(1));
    }
}

fn ensure_pid_terminated(pid: u32) {
    if is_pid_running(pid) {
        log::warn!("Backend process {pid} still running after graceful shutdown; forcing termination.");
        terminate_pid(pid);
    }
}

fn wait_for_pid_exit(pid: u32, timeout: Duration) -> bool {
    let start = Instant::now();
    while start.elapsed() < timeout {
        if !is_pid_running(pid) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    !is_pid_running(pid)
}

fn is_pid_running(pid: u32) -> bool {
    Command::new("kill")
        .arg("-0")
        .arg(pid.to_string())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn send_signal(pid: u32, signal: &str) -> bool {
    Command::new("kill")
        .arg(signal)
        .arg(pid.to_string())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn start_dev_backend(
    _app: &tauri::App,
    backend_process: Arc<Mutex<Option<BackendProcessHandle>>>,
) -> Result<(), Box<dyn std::error::Error>> {
    let backend_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|p| p.parent())
        .map(|p| p.join("vesta-backend"))
        .ok_or("Failed to resolve backend directory from CARGO_MANIFEST_DIR")?;

    log::info!("Starting backend from: {:?}", backend_dir);

    if !backend_dir.exists() {
        log::error!("Backend directory not found: {:?}", backend_dir);
        return Err("Backend directory not found".into());
    }

    let child = Command::new("python3")
        .args(["-m", "uvicorn", "main:app", "--host", BACKEND_HOST, "--port"])
        .arg(BACKEND_PORT.to_string())
        .current_dir(&backend_dir)
        .spawn()?;

    let mut process_guard = backend_process.lock().unwrap();
    *process_guard = Some(BackendProcessHandle::Native(child));

    Ok(())
}

fn start_prod_backend(
    app: &tauri::App,
    backend_process: Arc<Mutex<Option<BackendProcessHandle>>>,
) -> Result<(), Box<dyn std::error::Error>> {
    let (_rx, child) = app
        .shell()
        .sidecar("vesta-backend")?
        .env("VESTA_BACKEND_PORT", BACKEND_PORT.to_string())
        .spawn()?;

    let mut process_guard = backend_process.lock().unwrap();
    *process_guard = Some(BackendProcessHandle::Sidecar(child));

    Ok(())
}

fn wait_for_backend_ready(timeout_seconds: u64) -> bool {
    let start = std::time::Instant::now();
    let timeout = Duration::from_secs(timeout_seconds);

    while start.elapsed() < timeout {
        if check_backend_health() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(500));
    }

    false
}

fn check_backend_health() -> bool {
    match reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
    {
        Ok(client) => match client
            .get(format!("http://{BACKEND_HOST}:{BACKEND_PORT}/health"))
            .send()
        {
            Ok(response) => {
                let success = response.status().is_success();
                if !success {
                    log::warn!("Backend health check returned status: {}", response.status());
                }
                success
            }
            Err(error) => {
                log::debug!("Backend health check error: {}", error);
                false
            }
        },
        Err(error) => {
            log::error!("Failed to create HTTP client: {}", error);
            false
        }
    }
}
