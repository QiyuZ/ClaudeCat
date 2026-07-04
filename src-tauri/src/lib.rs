use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, LogicalSize, Manager, PhysicalPosition, WebviewWindow,
};

/// The statusline hook, embedded so `install_statusline` can drop it on disk with no
/// external files. Kept byte-identical to scripts/statusline.js at build time.
const STATUSLINE_JS: &str = include_str!("../../scripts/statusline.js");

const STALE_AFTER_SECS: u64 = 10 * 60;
// Default window size at first paint; the frontend drives real sizing via set_window so
// the transparent window always hugs the current layout (cat size, weekly chip, setup).
const SIZE_DEFAULT: (f64, f64) = (156.0, 172.0);
const MARGIN: i32 = 24;

#[derive(Default)]
struct AppState {
    click_through: bool,
}

fn claude_dir() -> Option<std::path::PathBuf> {
    dirs::home_dir().map(|h| h.join(".claude"))
}

/// Read + classify the usage cache into the {status, data} envelope the UI expects.
fn read_usage() -> Value {
    let Some(file) = claude_dir().map(|d| d.join("cc-pet-usage.json")) else {
        return json!({ "status": "nodata", "data": null });
    };
    let Ok(text) = std::fs::read_to_string(&file) else {
        return json!({ "status": "nodata", "data": null });
    };
    let Ok(data) = serde_json::from_str::<Value>(&text) else {
        return json!({ "status": "nodata", "data": null });
    };

    // Staleness from updated_at (ISO string) vs now.
    let stale = data
        .get("updated_at")
        .and_then(|v| v.as_str())
        .and_then(parse_iso_secs)
        .map(|updated| {
            let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
            now.saturating_sub(updated) > STALE_AFTER_SECS
        })
        .unwrap_or(true);

    json!({ "status": if stale { "stale" } else { "ok" }, "data": data })
}

/// Minimal ISO-8601 -> epoch seconds (handles the "...Z" form our hook writes).
fn parse_iso_secs(s: &str) -> Option<u64> {
    // Parse YYYY-MM-DDTHH:MM:SS (ignore fractional + tz beyond Z as UTC).
    let b = s.as_bytes();
    if b.len() < 19 {
        return None;
    }
    let num = |a: usize, z: usize| s.get(a..z)?.parse::<i64>().ok();
    let (y, mo, d) = (num(0, 4)?, num(5, 7)?, num(8, 10)?);
    let (h, mi, se) = (num(11, 13)?, num(14, 16)?, num(17, 19)?);
    // days since epoch via civil-from-days algorithm
    let yy = if mo <= 2 { y - 1 } else { y };
    let era = if yy >= 0 { yy } else { yy - 399 } / 400;
    let yoe = (yy - era * 400) as i64;
    let doy = (153 * (if mo > 2 { mo - 3 } else { mo + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146097 + doe - 719468;
    Some((days * 86400 + h * 3600 + mi * 60 + se).max(0) as u64)
}

#[tauri::command]
fn get_usage() -> Value {
    read_usage()
}

/// Whether our statusline hook is already registered — lets the UI say "waiting for
/// usage" instead of "connect" once setup is done.
#[tauri::command]
fn hook_installed() -> bool {
    claude_dir()
        .and_then(|d| std::fs::read_to_string(d.join("settings.json")).ok())
        .and_then(|t| serde_json::from_str::<Value>(&t).ok())
        .and_then(|v| {
            v.get("statusLine")
                .and_then(|s| s.get("command"))
                .and_then(|c| c.as_str())
                .map(|s| s.contains("cc-pet"))
        })
        .unwrap_or(false)
}

#[tauri::command]
fn set_window(window: WebviewWindow, w: f64, h: f64) {
    let _ = window.set_size(LogicalSize::new(w, h));
    position_top_right(&window);
}

/// Menu actions the in-app right-click menu can trigger.
#[tauri::command]
fn window_action(window: WebviewWindow, action: String) {
    match action.as_str() {
        "reset_pos" => position_top_right(&window),
        "hide" => {
            let _ = window.hide();
        }
        "quit" => window.app_handle().exit(0),
        _ => {}
    }
}

#[tauri::command]
fn set_click_through(window: WebviewWindow, ignore: bool) {
    let _ = window.set_ignore_cursor_events(ignore);
    if let Some(state) = window.app_handle().try_state::<Mutex<AppState>>() {
        state.lock().unwrap().click_through = ignore;
    }
}

/// Install the statusline hook: drop the script into ~/.claude/cc-pet/ and register it
/// in settings.json. Refuses to clobber a pre-existing (foreign) statusLine.
#[tauri::command]
fn install_statusline() -> Result<String, String> {
    let dir = claude_dir().ok_or("cannot locate ~/.claude")?;
    let pet_dir = dir.join("cc-pet");
    std::fs::create_dir_all(&pet_dir).map_err(|e| e.to_string())?;
    let script = pet_dir.join("statusline.js");
    std::fs::write(&script, STATUSLINE_JS).map_err(|e| e.to_string())?;

    let settings_path = dir.join("settings.json");
    let mut settings: Value = std::fs::read_to_string(&settings_path)
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_else(|| json!({}));

    let our_cmd = format!("node \"{}\"", script.to_string_lossy());
    if let Some(existing) = settings.get("statusLine").and_then(|s| s.get("command")).and_then(|c| c.as_str()) {
        if !existing.contains("cc-pet") {
            return Err(format!(
                "A different statusLine is already set:\n  {existing}\nLeaving it untouched to avoid clobbering it."
            ));
        }
    }
    settings["statusLine"] = json!({ "type": "command", "command": our_cmd });

    let _ = std::fs::copy(&settings_path, dir.join("settings.json.ccpet-backup"));
    std::fs::write(&settings_path, serde_json::to_string_pretty(&settings).unwrap())
        .map_err(|e| e.to_string())?;
    Ok("Statusline hook installed. Run a Claude Code session to see live data.".into())
}

fn position_top_right(window: &WebviewWindow) {
    let monitor = window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| window.primary_monitor().ok().flatten());
    if let Some(monitor) = monitor {
        let mp = monitor.position();
        let ms = monitor.size();
        if let Ok(ws) = window.outer_size() {
            let x = mp.x + ms.width as i32 - ws.width as i32 - MARGIN;
            let y = mp.y + MARGIN;
            let _ = window.set_position(PhysicalPosition::new(x, y));
        }
    }
}

fn toggle_visibility(window: &WebviewWindow) {
    match window.is_visible() {
        Ok(true) => {
            let _ = window.hide();
        }
        _ => {
            let _ = window.show();
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .manage(Mutex::new(AppState::default()))
        .invoke_handler(tauri::generate_handler![
            get_usage,
            hook_installed,
            set_window,
            window_action,
            set_click_through,
            install_statusline
        ])
        .setup(|app| {
            let window = app.get_webview_window("main").expect("main window missing");
            let _ = window.set_size(LogicalSize::new(SIZE_DEFAULT.0, SIZE_DEFAULT.1));
            position_top_right(&window);
            let _ = window.show();

            build_tray(app)?;

            // Poll the usage cache and push updates to the UI.
            let handle = app.handle().clone();
            std::thread::spawn(move || loop {
                let _ = handle.emit("usage-updated", read_usage());
                std::thread::sleep(Duration::from_secs(3));
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Show / Hide", true, None::<&str>)?;
    let install = MenuItem::with_id(app, "install", "Install statusline hook", true, None::<&str>)?;
    let reset = MenuItem::with_id(app, "reset_pos", "Reset position", true, None::<&str>)?;
    let passthrough = MenuItem::with_id(app, "passthrough", "Toggle click-through", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &show,
            &PredefinedMenuItem::separator(app)?,
            &install,
            &reset,
            &passthrough,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;

    TrayIconBuilder::with_id("main-tray")
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("ClaudeCat — Claude Code usage")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            let window = app.get_webview_window("main");
            match event.id.as_ref() {
                "show" => {
                    if let Some(w) = window {
                        toggle_visibility(&w);
                    }
                }
                "install" => {
                    let msg = match install_statusline() {
                        Ok(m) => m,
                        Err(e) => e,
                    };
                    let _ = app.emit("toast", msg);
                }
                "reset_pos" => {
                    if let Some(w) = window {
                        position_top_right(&w);
                    }
                }
                "passthrough" => {
                    let state = app.state::<Mutex<AppState>>();
                    let now = {
                        let mut s = state.lock().unwrap();
                        s.click_through = !s.click_through;
                        s.click_through
                    };
                    if let Some(w) = window {
                        let _ = w.set_ignore_cursor_events(now);
                    }
                }
                "quit" => app.exit(0),
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                if let Some(w) = tray.app_handle().get_webview_window("main") {
                    toggle_visibility(&w);
                }
            }
        })
        .build(app)?;
    Ok(())
}
