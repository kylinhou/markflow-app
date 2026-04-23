use tauri::{State, Window};
use tauri::Manager;
use crate::{AppState, FileData};
use crate::file::{self, suggest_file_name};
use crate::theme;

#[tauri::command]
pub async fn open_file(
    window: Window,
    state: State<'_, AppState>,
) -> Result<Option<FileData>, String> {
    let file_path = file::open_file_dialog(&window).await?;
    
    if let Some(path) = file_path {
        let content = file::read_file(&path).await?;
        
        // Setup file watcher
        let window_label = window.label().to_string();
        {
            let mut window_state = state.get_or_create_window_state(&window_label);
            window_state.file_path = Some(path.clone());
            state.update_window_state(&window_label, window_state);
        }
        
        // Update window title
        if let Some(file_name) = path.file_name() {
            window.set_title(&format!("{} — MarkFlow", file_name.to_string_lossy()))
                .map_err(|e| e.to_string())?;
        }
        
        Ok(Some(FileData {
            path: path.to_string_lossy().to_string(),
            content,
        }))
    } else {
        Ok(None)
    }
}

#[tauri::command]
pub async fn open_file_path(
    path: String,
    window: Window,
    state: State<'_, AppState>,
) -> Result<Option<FileData>, String> {
    let path = std::path::PathBuf::from(path);
    let content = file::read_file(&path).await?;
    
    // Setup file watcher
    let window_label = window.label().to_string();
    {
        let mut window_state = state.get_or_create_window_state(&window_label);
        window_state.file_path = Some(path.clone());
        state.update_window_state(&window_label, window_state);
    }
    
    // Update window title
    if let Some(file_name) = path.file_name() {
        window.set_title(&format!("{} — MarkFlow", file_name.to_string_lossy()))
            .map_err(|e| e.to_string())?;
    }
    
    Ok(Some(FileData {
        path: path.to_string_lossy().to_string(),
        content,
    }))
}

#[tauri::command]
pub async fn save_file(
    content: String,
    window: Window,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    let window_label = window.label().to_string();
    let file_path = {
        let window_state = state.get_or_create_window_state(&window_label);
        window_state.file_path.clone()
    };
    
    let path = if let Some(path) = file_path {
        path
    } else {
        // Show save dialog
        let suggested_name = suggest_file_name(&content);
        match file::save_file_dialog(&window, suggested_name.as_deref()).await? {
            Some(p) => {
                let mut window_state = state.get_or_create_window_state(&window_label);
                window_state.file_path = Some(p.clone());
                state.update_window_state(&window_label, window_state);
                p
            }
            None => return Ok(false),
        }
    };
    
    // Mark as internal save to prevent watcher from triggering
    {
        let mut window_state = state.get_or_create_window_state(&window_label);
        window_state.is_internal_save = true;
        state.update_window_state(&window_label, window_state);
    }
    
    // Write file
    file::write_file(&path, &content).await?;
    
    // Reset internal save flag after a delay
    {
        let mut window_state = state.get_or_create_window_state(&window_label);
        window_state.is_internal_save = false;
        state.update_window_state(&window_label, window_state);
    }
    
    // Update window title
    if let Some(file_name) = path.file_name() {
        window.set_title(&format!("{} — MarkFlow", file_name.to_string_lossy()))
            .map_err(|e| e.to_string())?;
    }
    
    Ok(true)
}

#[tauri::command]
pub async fn save_file_as(
    content: String,
    window: Window,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    let window_label = window.label().to_string();
    let suggested_name = suggest_file_name(&content);
    
    let path = match file::save_file_dialog(&window, suggested_name.as_deref()).await? {
        Some(p) => p,
        None => return Ok(false),
    };
    
    // Mark as internal save
    {
        let mut window_state = state.get_or_create_window_state(&window_label);
        window_state.is_internal_save = true;
        window_state.file_path = Some(path.clone());
        state.update_window_state(&window_label, window_state);
    }
    
    // Write file
    file::write_file(&path, &content).await?;
    
    // Reset internal save flag
    {
        let mut window_state = state.get_or_create_window_state(&window_label);
        window_state.is_internal_save = false;
        state.update_window_state(&window_label, window_state);
    }
    
    // Update window title
    if let Some(file_name) = path.file_name() {
        window.set_title(&format!("{} — MarkFlow", file_name.to_string_lossy()))
            .map_err(|e| e.to_string())?;
    }
    
    Ok(true)
}

#[tauri::command]
pub async fn export_html(
    html_content: String,
    window: Window,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    let suggested_name = {
        let window_label = window.label().to_string();
        let window_state = state.get_or_create_window_state(&window_label);
        window_state.file_path.as_ref()
            .and_then(|p| p.file_stem())
            .map(|s| s.to_string_lossy().to_string())
    };
    
    let output_path = file::export_html_dialog(&window, suggested_name.as_deref()).await?;
    
    if let Some(path) = output_path {
        tokio::fs::write(&path, html_content).await
            .map_err(|e| format!("Failed to write HTML: {}", e))?;
        Ok(true)
    } else {
        Ok(false)
    }
}

#[tauri::command]
pub async fn load_custom_theme(
    window: Window,
) -> Result<Option<theme::ThemeData>, String> {
    theme::load_custom_theme(&window).await
}

#[tauri::command]
pub async fn load_theme_css(file_name: String) -> Result<Option<String>, String> {
    theme::load_theme_css(&file_name).await
}

#[tauri::command]
pub fn get_themes_dir() -> Result<String, String> {
    theme::get_themes_dir()
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| e.to_string())
}
