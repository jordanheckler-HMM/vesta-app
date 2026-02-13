use std::process::{Child, Command};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::Manager;
use tauri_plugin_shell::{process::CommandChild as SidecarChild, ShellExt};

// Global state to track the backend process
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

            // Initialize backend process state
            let backend_process = BackendProcess(Arc::new(Mutex::new(None)));
            let backend_arc = backend_process.0.clone();
            app.manage(backend_process);

            // Start the Python backend in development mode
            if cfg!(debug_assertions) {
                log::info!("Development mode: Starting Python backend from source...");
                start_dev_backend(app, backend_arc.clone())?;
            } else {
                log::info!("Production mode: Starting bundled backend sidecar...");
                start_prod_backend(app, backend_arc.clone())?;
            }

            // Wait for backend to be ready
            log::info!("Waiting for backend to be ready...");
            if !wait_for_backend_ready(10) {
                log::error!("Backend failed to start within timeout");
                // Note: User will see error in the UI when they try to send a message
            }

            log::info!("Backend is ready!");
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                // Clean up backend process when app exits
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
        });
}

fn start_dev_backend(
    _app: &tauri::App,
    backend_process: Arc<Mutex<Option<BackendProcessHandle>>>,
) -> Result<(), Box<dyn std::error::Error>> {
    // Resolve backend path from the checked-out source tree.
    // CARGO_MANIFEST_DIR points to vesta-frontend/src-tauri during development.
    let backend_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|p| p.parent())
        .map(|p| p.join("vesta-backend"))
        .ok_or("Failed to resolve backend directory from CARGO_MANIFEST_DIR")?;

    log::info!("Starting backend from: {:?}", backend_dir);

    // Check if Python and uvicorn are available
    if !backend_dir.exists() {
        log::error!("Backend directory not found: {:?}", backend_dir);
        return Err("Backend directory not found".into());
    }

    // Start uvicorn with the FastAPI app
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
                if response.status().is_success() {
                    log::info!("Backend health check passed");
                    true
                } else {
                    log::warn!("Backend health check failed with status: {}", response.status());
                    false
                }
            }
            Err(e) => {
                log::debug!("Backend health check error: {}", e);
                false
            }
        },
        Err(e) => {
            log::error!("Failed to create HTTP client: {}", e);
            false
        }
    }
}
