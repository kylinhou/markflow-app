use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::mpsc::{self, Sender};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use crate::AppState;

/// Payload sent with the file-changed event so the frontend
/// knows which file was modified.
#[derive(Clone, serde::Serialize)]
pub struct FileChangedPayload {
    pub path: String,
}

/// Channel sender that acts as the watcher handle.
/// Dropping this (by removing it from the HashMap) closes the channel and
/// causes the watcher thread to exit cleanly.
pub type WatcherHandle = Sender<()>;

/// HashMap of watcher handles, keyed by (window_label, file_path).
pub type WatcherMap = Mutex<HashMap<(String, PathBuf), WatcherHandle>>;

/// Start watching a file for a given window.
pub fn start_watcher(
    watchers: &WatcherMap,
    window_label: &str,
    path: PathBuf,
    app_handle: AppHandle,
) -> Result<(), String> {
    let label = window_label.to_string();
    let path_key = path.clone();

    // Check if we're already watching this file for this window
    {
        let guards = watchers.lock().unwrap();
        if guards.contains_key(&(label.clone(), path_key.clone())) {
            return Ok(());
        }
    }

    // Channel: dropping the sender (tx) causes rx.recv() to return Err
    // and the watcher thread exits cleanly.
    let (tx, rx) = mpsc::channel::<()>();

    // Clone everything we need for the watcher thread
    let app_handle_thread = app_handle.clone();
    let label_thread = label.clone();
    let path_clone = path.clone();

    // Spawn the watcher on its own thread
    thread::spawn(move || {
        let watcher_result = RecommendedWatcher::new(
            move |res: Result<notify::Event, notify::Error>| {
                if let Ok(event) = res {
                    use notify::EventKind;
                    if matches!(event.kind, EventKind::Modify(_) | EventKind::Create(_)) {
                        let state = app_handle_thread.state::<AppState>();
                        
                        // Ignore if this is an internal save
                        if state.is_internal_save(&label_thread, &path_clone) {
                            log::info!("Ignoring internal save event for: {:?}", path_clone);
                            return;
                        }

                        let target_label = label_thread.clone();
                        let handle = app_handle_thread.clone();
                        let file_path = path_clone.to_string_lossy().to_string();
                        let _ = handle.emit_to(
                            tauri::EventTarget::webview_window(&target_label),
                            "file-changed",
                            FileChangedPayload { path: file_path },
                        );
                    }
                }
            },
            Config::default().with_poll_interval(Duration::from_secs(1)),
        );

        let mut watcher = match watcher_result {
            Ok(w) => w,
            Err(e) => {
                log::error!("Failed to create file watcher: {}", e);
                return;
            }
        };

        if let Err(e) = watcher.watch(&path, RecursiveMode::NonRecursive) {
            log::error!("Failed to watch {:?}: {}", path, e);
            return;
        }

        log::info!("File watcher started for: {:?}", path);

        // Block until the stop signal (sender dropped)
        while rx.recv().is_ok() {
            // Channel is open — tx is still alive, keep watching
        }

        log::info!("File watcher stopped for: {:?}", path);
    });

    // Store the sender handle; dropping it stops the thread
    let mut guards = watchers.lock().unwrap();
    guards.insert((label, path_key), tx);

    Ok(())
}

/// Stop watching a specific file for a given window.
pub fn stop_watcher(
    watchers: &WatcherMap,
    window_label: &str,
    path: PathBuf,
) {
    let mut guards = watchers.lock().unwrap();
    if guards.remove(&(window_label.to_string(), path.clone())).is_some() {
        log::info!("Stopped watcher for window: {}, path: {:?}", window_label, path);
    }
}
