use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

pub mod commands;
pub mod file;
pub mod menu;
pub mod theme;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileData {
    pub path: String,
    pub content: String,
}

#[derive(Debug, Clone)]
pub struct WindowState {
    pub file_path: Option<PathBuf>,
    pub is_internal_save: bool,
}

impl Default for WindowState {
    fn default() -> Self {
        Self {
            file_path: None,
            is_internal_save: false,
        }
    }
}

pub struct AppState {
    pub windows: Mutex<HashMap<String, WindowState>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            windows: Mutex::new(HashMap::new()),
        }
    }
}

impl AppState {
    pub fn get_window_state(&self, window_label: &str) -> Option<WindowState> {
        let windows = self.windows.lock().unwrap();
        windows.get(window_label).cloned()
    }

    pub fn get_or_create_window_state(&self, window_label: &str) -> WindowState {
        let mut windows = self.windows.lock().unwrap();
        windows.entry(window_label.to_string()).or_default().clone()
    }
    
    pub fn update_window_state(&self, window_label: &str, state: WindowState) {
        let mut windows = self.windows.lock().unwrap();
        windows.insert(window_label.to_string(), state);
    }
}

/// Handle CLI file argument - emit event to frontend to open the file
fn handle_cli_file(app: &AppHandle, file_path: PathBuf) {
    log::info!("Opening file from CLI: {:?}", file_path);
    if let Err(e) = app.emit("open-file-from-cli", file_path.to_string_lossy().to_string()) {
        log::error!("Failed to emit open-file-from-cli event: {}", e);
    }
}

/// Get file path from command line arguments
fn get_cli_file_path() -> Option<PathBuf> {
    let args: Vec<String> = std::env::args().collect();
    for arg in args.iter().skip(1) {
        let path = PathBuf::from(arg);
        if let Some(ext) = path.extension() {
            let ext_lower = ext.to_string_lossy().to_lowercase();
            if matches!(ext_lower.as_str(), "md" | "markdown" | "mdown" | "mkd" | "mkdn" | "mdwn" | "mdtxt" | "mdtext") {
                if path.exists() {
                    return Some(path);
                }
            }
        }
    }
    None
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Get CLI file path before building app
    let cli_file_path = get_cli_file_path();
    
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .manage(AppState::default())
        .setup(move |app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            
            // Build menu
            menu::build_menu(app)?;
            
            // Handle CLI file argument after setup is complete
            if let Some(file_path) = cli_file_path.clone() {
                let app_handle = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(500));
                    handle_cli_file(&app_handle, file_path);
                });
            }
            
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::open_file,
            commands::open_file_path,
            commands::save_file,
            commands::save_file_as,
            commands::export_html,
            commands::load_custom_theme,
            commands::load_theme_css,
            commands::get_themes_dir,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
