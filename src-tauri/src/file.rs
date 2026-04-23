use std::path::PathBuf;
use tauri::{Manager, Window};
use tauri_plugin_dialog::{DialogExt, FilePath};

pub async fn open_file_dialog(window: &Window) -> Result<Option<PathBuf>, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    
    let handle = window.app_handle().clone();
    
    handle.dialog()
        .file()
        .add_filter("Markdown", &["md", "markdown", "mdown", "mkd"])
        .add_filter("Text", &["txt"])
        .add_filter("All Files", &["*"])
        .pick_file(move |file_path| {
            let _ = tx.send(file_path);
        });
    
    match rx.await {
        Ok(Some(FilePath::Path(path))) => Ok(Some(path)),
        Ok(Some(FilePath::Url(_))) => Err("URL not supported".to_string()),
        Ok(None) => Ok(None),
        Err(_) => Err("Dialog cancelled".to_string()),
    }
}

pub async fn save_file_dialog(
    window: &Window,
    default_name: Option<&str>,
) -> Result<Option<PathBuf>, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    
    let handle = window.app_handle().clone();
    let mut dialog = handle.dialog().file()
        .add_filter("Markdown", &["md"])
        .add_filter("All Files", &["*"]);
    
    if let Some(name) = default_name {
        dialog = dialog.set_file_name(name);
    }
    
    dialog.save_file(move |file_path| {
        let _ = tx.send(file_path);
    });
    
    match rx.await {
        Ok(Some(FilePath::Path(path))) => Ok(Some(path)),
        Ok(Some(FilePath::Url(_))) => Err("URL not supported".to_string()),
        Ok(None) => Ok(None),
        Err(_) => Err("Dialog cancelled".to_string()),
    }
}

pub async fn export_pdf_dialog(
    window: &Window,
    default_name: Option<&str>,
) -> Result<Option<PathBuf>, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    
    let handle = window.app_handle().clone();
    let mut dialog = handle.dialog().file()
        .add_filter("PDF", &["pdf"]);
    
    if let Some(name) = default_name {
        dialog = dialog.set_file_name(name);
    }
    
    dialog.save_file(move |file_path| {
        let _ = tx.send(file_path);
    });
    
    match rx.await {
        Ok(Some(FilePath::Path(path))) => Ok(Some(path)),
        Ok(Some(FilePath::Url(_))) => Err("URL not supported".to_string()),
        Ok(None) => Ok(None),
        Err(_) => Err("Dialog cancelled".to_string()),
    }
}

pub async fn export_html_dialog(
    window: &Window,
    default_name: Option<&str>,
) -> Result<Option<PathBuf>, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    
    let handle = window.app_handle().clone();
    let mut dialog = handle.dialog().file()
        .add_filter("HTML", &["html"]);
    
    if let Some(name) = default_name {
        dialog = dialog.set_file_name(name);
    }
    
    dialog.save_file(move |file_path| {
        let _ = tx.send(file_path);
    });
    
    match rx.await {
        Ok(Some(FilePath::Path(path))) => Ok(Some(path)),
        Ok(Some(FilePath::Url(_))) => Err("URL not supported".to_string()),
        Ok(None) => Ok(None),
        Err(_) => Err("Dialog cancelled".to_string()),
    }
}

pub async fn read_file(path: &PathBuf) -> Result<String, String> {
    tokio::fs::read_to_string(path)
        .await
        .map_err(|e| format!("Failed to read file: {}", e))
}

pub async fn write_file(path: &PathBuf, content: &str) -> Result<(), String> {
    tokio::fs::write(path, content)
        .await
        .map_err(|e| format!("Failed to write file: {}", e))
}

pub fn suggest_file_name(content: &str) -> Option<String> {
    // Extract first heading or first non-empty line
    let first_line = content.lines().find(|line| !line.trim().is_empty())?;
    
    let title = if first_line.starts_with("# ") {
        first_line[2..].trim()
    } else {
        first_line.trim()
    };
    
    let sanitized: String = title
        .chars()
        .filter(|c| !matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'))
        .take(60)
        .collect();
    
    if sanitized.is_empty() {
        None
    } else {
        Some(sanitized)
    }
}
