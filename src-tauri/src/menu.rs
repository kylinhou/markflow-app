use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::App;
use tauri::{Emitter, Manager};
use tauri_plugin_shell::ShellExt;

pub fn build_menu(app: &App) -> Result<(), String> {
    let app_handle = app.handle();

    // File menu
    let new_item = MenuItem::with_id(app_handle, "new", "New", true, Some("CmdOrCtrl+N"))
        .map_err(|e| e.to_string())?;
    let open_item = MenuItem::with_id(app_handle, "open", "Open...", true, Some("CmdOrCtrl+O"))
        .map_err(|e| e.to_string())?;
    let save_item = MenuItem::with_id(app_handle, "save", "Save", true, Some("CmdOrCtrl+S"))
        .map_err(|e| e.to_string())?;
    let save_as_item = MenuItem::with_id(
        app_handle,
        "save-as",
        "Save As...",
        true,
        Some("CmdOrCtrl+Shift+S"),
    )
    .map_err(|e| e.to_string())?;
    let export_html_item = MenuItem::with_id(
        app_handle,
        "export-html",
        "Export HTML...",
        true,
        None::<&str>,
    )
    .map_err(|e| e.to_string())?;

    // Theme menu items
    let theme_light = MenuItem::with_id(app_handle, "theme-light", "Light", true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let theme_dark = MenuItem::with_id(app_handle, "theme-dark", "Dark", true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let theme_elegant =
        MenuItem::with_id(app_handle, "theme-elegant", "Elegant", true, None::<&str>)
            .map_err(|e| e.to_string())?;
    let theme_newsprint = MenuItem::with_id(
        app_handle,
        "theme-newsprint",
        "Newsprint",
        true,
        None::<&str>,
    )
    .map_err(|e| e.to_string())?;
    let import_theme = MenuItem::with_id(
        app_handle,
        "import-theme",
        "Import Theme...",
        true,
        None::<&str>,
    )
    .map_err(|e| e.to_string())?;

    // Build theme submenu
    let theme_submenu = Submenu::with_items(
        app_handle,
        "Theme",
        true,
        &[
            &theme_light,
            &theme_dark,
            &theme_elegant,
            &theme_newsprint,
            &PredefinedMenuItem::separator(app_handle).map_err(|e| e.to_string())?,
            &import_theme,
        ],
    )
    .map_err(|e| e.to_string())?;

    // File submenu
    let file_submenu = Submenu::with_items(
        app_handle,
        "File",
        true,
        &[
            &new_item,
            &open_item,
            &PredefinedMenuItem::separator(app_handle).map_err(|e| e.to_string())?,
            &save_item,
            &save_as_item,
            &PredefinedMenuItem::separator(app_handle).map_err(|e| e.to_string())?,
            &export_html_item,
        ],
    )
    .map_err(|e| e.to_string())?;

    // Edit submenu
    let edit_submenu = Submenu::with_items(
        app_handle,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app_handle, None).map_err(|e| e.to_string())?,
            &PredefinedMenuItem::redo(app_handle, None).map_err(|e| e.to_string())?,
            &PredefinedMenuItem::separator(app_handle).map_err(|e| e.to_string())?,
            &PredefinedMenuItem::cut(app_handle, None).map_err(|e| e.to_string())?,
            &PredefinedMenuItem::copy(app_handle, None).map_err(|e| e.to_string())?,
            &PredefinedMenuItem::paste(app_handle, None).map_err(|e| e.to_string())?,
            &PredefinedMenuItem::select_all(app_handle, None).map_err(|e| e.to_string())?,
        ],
    )
    .map_err(|e| e.to_string())?;

    // View submenu
    let view_submenu = Submenu::with_items(
        app_handle,
        "View",
        true,
        &[
            &PredefinedMenuItem::separator(app_handle).map_err(|e| e.to_string())?,
            &PredefinedMenuItem::fullscreen(app_handle, None).map_err(|e| e.to_string())?,
        ],
    )
    .map_err(|e| e.to_string())?;

    // Help submenu
    let about_item = MenuItem::with_id(app_handle, "about", "About MarkFlow", true, None::<&str>)
        .map_err(|e| e.to_string())?;

    let help_submenu =
        Submenu::with_items(app_handle, "Help", true, &[&about_item]).map_err(|e| e.to_string())?;

    // Main menu
    let menu = Menu::with_items(
        app_handle,
        &[
            &file_submenu,
            &edit_submenu,
            &view_submenu,
            &theme_submenu,
            &help_submenu,
        ],
    )
    .map_err(|e| e.to_string())?;

    app.set_menu(menu).map_err(|e| e.to_string())?;

    // Set up menu event handler
    let app_handle_clone = app_handle.clone();
    app.on_menu_event(move |app, event| {
        let id = event.id().0.as_str();

        // Get focused window
        if let Some(window) = app.get_webview_window("main") {
            match id {
                "new" => {
                    let _ = window.emit("menu-new", ());
                }
                "open" => {
                    let _ = window.emit("menu-open", ());
                }
                "save" => {
                    let _ = window.emit("menu-save", ());
                }
                "save-as" => {
                    let _ = window.emit("menu-save-as", ());
                }
                "export-html" => {
                    let _ = window.emit("menu-export-html", ());
                }
                "theme-light" => {
                    let _ = window.emit("set-theme", "light");
                }
                "theme-dark" => {
                    let _ = window.emit("set-theme", "dark");
                }
                "theme-elegant" => {
                    let _ = window.emit("set-theme", "elegant");
                }
                "theme-newsprint" => {
                    let _ = window.emit("set-theme", "newsprint");
                }
                "import-theme" => {
                    let _ = window.emit("menu-import-theme", ());
                }
                "about" => {
                    let _ = app
                        .shell()
                        .open("https://github.com/marswaveai/markflow", None);
                }
                _ => {}
            }
        }
    });

    Ok(())
}
