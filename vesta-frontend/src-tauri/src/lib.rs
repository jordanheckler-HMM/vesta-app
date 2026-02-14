use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconEvent},
    Manager, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_shell::{process::CommandChild as SidecarChild, ShellExt};

const TRAY_OPEN_MINI_ID: &str = "tray_open_mini";
const TRAY_OPEN_MAIN_ID: &str = "tray_open_main";
const TRAY_QUIT_ID: &str = "tray_quit";

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

            if cfg!(debug_assertions) {
                log::info!("Development mode: Starting Python backend from source...");
                start_dev_backend(app, backend_arc.clone())?;
            } else {
                log::info!("Production mode: Starting bundled backend sidecar...");
                start_prod_backend(app, backend_arc.clone())?;
            }

            log::info!("Waiting for backend to be ready...");
            if !wait_for_backend_ready(10) {
                log::error!("Backend failed to start with required endpoints within timeout");
                return Err("Backend failed readiness checks".into());
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
                log::info!("Terminating backend process...");
                match process {
                    BackendProcessHandle::Native(mut process) => {
                        let _ = process.kill();
                        let _ = process.wait();
                    }
                    BackendProcessHandle::Sidecar(process) => {
                        let _ = process.kill();
                    }
                }
            }
        }
    }
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
        .args([
            "-m",
            "uvicorn",
            "main:app",
            "--host",
            "127.0.0.1",
            "--port",
            "8090",
        ])
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
        .env("VESTA_BACKEND_PORT", "8090")
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
        Ok(client) => match client.get("http://localhost:8090/health").send() {
            Ok(response) => {
                if !response.status().is_success() {
                    log::warn!("Backend health check failed with status: {}", response.status());
                    return false;
                }

                match client.get("http://localhost:8090/knowledge/files").send() {
                    Ok(knowledge_response) => {
                        if knowledge_response.status().is_success() {
                            log::info!("Backend readiness check passed");
                            true
                        } else {
                            log::warn!(
                                "Knowledge endpoint check failed with status: {}",
                                knowledge_response.status()
                            );
                            false
                        }
                    }
                    Err(error) => {
                        log::debug!("Knowledge endpoint check error: {}", error);
                        false
                    }
                }
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
