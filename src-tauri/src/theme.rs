use std::path::PathBuf;
use serde::{Deserialize, Serialize};
use tauri::{Manager, Window};
use tauri_plugin_dialog::{DialogExt, FilePath};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThemeData {
    pub name: String,
    pub css: String,
}

pub fn get_themes_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir()
        .ok_or("Failed to get home directory")?;
    let themes_dir = home.join(".markflow").join("themes");
    
    // Ensure directory exists
    std::fs::create_dir_all(&themes_dir)
        .map_err(|e| format!("Failed to create themes directory: {}", e))?;
    
    Ok(themes_dir)
}

pub async fn load_custom_theme(window: &Window) -> Result<Option<ThemeData>, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    
    let handle = window.app_handle().clone();
    
    handle.dialog()
        .file()
        .add_filter("CSS", &["css"])
        .pick_file(move |file_path| {
            let _ = tx.send(file_path);
        });
    
    let file_path = match rx.await {
        Ok(Some(FilePath::Path(path))) => path,
        Ok(Some(FilePath::Url(_))) => return Err("URL not supported".to_string()),
        Ok(None) => return Ok(None),
        Err(_) => return Err("Dialog cancelled".to_string()),
    };
    
    // Read the CSS file
    let css = tokio::fs::read_to_string(&file_path)
        .await
        .map_err(|e| format!("Failed to read theme file: {}", e))?;
    
    // Copy to themes directory
    let file_name = file_path.file_name()
        .ok_or("Invalid file name")?
        .to_string_lossy()
        .to_string();
    
    let themes_dir = get_themes_dir()?;
    let dest_path = themes_dir.join(&file_name);
    
    tokio::fs::copy(&file_path, &dest_path)
        .await
        .map_err(|e| format!("Failed to copy theme file: {}", e))?;
    
    Ok(Some(ThemeData {
        name: file_name,
        css,
    }))
}

pub async fn load_theme_css(file_name: &str) -> Result<Option<String>, String> {
    let themes_dir = get_themes_dir()?;
    let file_path = themes_dir.join(file_name);
    
    match tokio::fs::read_to_string(&file_path).await {
        Ok(css) => Ok(Some(css)),
        Err(_) => Ok(None),
    }
}

pub fn scan_custom_themes() -> Result<Vec<String>, String> {
    let themes_dir = get_themes_dir()?;
    
    let mut themes = Vec::new();
    
    if let Ok(entries) = std::fs::read_dir(&themes_dir) {
        for entry in entries.flatten() {
            if let Some(name) = entry.file_name().to_str() {
                if name.ends_with(".css") {
                    themes.push(name.to_string());
                }
            }
        }
    }
    
    themes.sort();
    Ok(themes)
}
