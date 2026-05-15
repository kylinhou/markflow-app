use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::mpsc::{self, Sender};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

/// Channel sender that acts as the watcher handle.
/// Dropping this (by removing it from the HashMap) closes the channel and
/// causes the watcher thread to exit cleanly.
pub type WatcherHandle = Sender<()>;

/// HashMap of watcher handles, keyed by window label.
pub type WatcherMap = Mutex<HashMap<String, WatcherHandle>>;

/// Start watching a file for a given window.
/// Stops and replaces any existing watcher for this window first.
pub fn start_watcher(
    watchers: &WatcherMap,
    window_label: &str,
    path: PathBuf,
    app_handle: AppHandle,
) -> Result<(), String> {
    let label = window_label.to_string();

    // Stop any existing watcher for this window first
    {
        let mut guards = watchers.lock().unwrap();
        guards.remove(window_label);
        log::info!("Cleared existing watcher for window: {}", window_label);
    }

    // Channel: dropping the sender (tx) causes rx.recv() to error and the thread exits
    let (tx, rx) = mpsc::channel::<()>();

    // Clone everything we need for the watcher thread
    let app_handle_thread = app_handle.clone();
    let label_thread = label.clone();
    let path_thread = path.clone();

    // Spawn the watcher on its own thread
    thread::spawn(move || {
        // Build the watcher
        let watcher_result = RecommendedWatcher::new(
            move |res: Result<notify::Event, notify::Error>| {
                if let Ok(event) = res {
                    use notify::EventKind;
                    if matches!(event.kind, EventKind::Modify(_) | EventKind::Create(_)) {
                        let target_label = label_thread.clone();
                        let handle = app_handle_thread.clone();
                        let _ = handle.emit_to(
                            tauri::EventTarget::webview_window(&target_label),
                            "file-changed",
                            (),
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

        if let Err(e) = watcher.watch(&path_thread, RecursiveMode::NonRecursive) {
            log::error!("Failed to watch {:?}: {}", path_thread, e);
            return;
        }

        log::info!("File watcher started for: {:?}", path_thread);

        // Keep the watcher alive until the stop signal is received
        // (rx.recv() blocks until tx is dropped)
        while rx.recv().is_ok() {
            // The stop signal is rx.recv() returning Err (channel closed)
            // This loop normally runs forever since tx is never re-sent
        }

        log::info!("File watcher stopped for: {:?}", path_thread);
    });

    // Store the sender handle; dropping it stops the thread
    let mut guards = watchers.lock().unwrap();
    guards.insert(label, tx);

    Ok(())
}
