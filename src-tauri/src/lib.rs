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
// OAuth /usage fallback: the same undocumented endpoint Claude Code's own `/usage`
// command uses. We hit it only when the statusline path isn't delivering fresh data.
// The User-Agent MUST look like Claude Code or the endpoint aggressively 429s.
const OAUTH_USAGE_URL: &str = "https://api.anthropic.com/api/oauth/usage";
const OAUTH_BETA_HEADER: &str = "oauth-2025-04-20";
const CLAUDE_CODE_UA: &str = "claude-code/2.1.201";
const STATUSLINE_CACHE: &str = "cc-pet-usage.json";
const OAUTH_CACHE: &str = "cc-pet-usage-oauth.json";
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

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// True if a snapshot carries at least one real usage number (not the all-null shape a
/// fresh/API-less statusline render leaves behind).
fn snapshot_has_data(d: &Value) -> bool {
    let has = |k: &str| {
        d.get(k)
            .and_then(|w| w.get("used_percentage"))
            .and_then(|x| x.as_f64())
            .is_some()
    };
    has("five_hour") || has("weekly")
}

/// Load one cache source as (data, updated_secs, has_data), or None if absent/unparseable.
fn load_source(name: &str) -> Option<(Value, u64, bool)> {
    let file = claude_dir()?.join(name);
    let text = std::fs::read_to_string(&file).ok()?;
    let data: Value = serde_json::from_str(&text).ok()?;
    let updated = data.get("updated_at").and_then(|v| v.as_str()).and_then(parse_iso_secs)?;
    let has = snapshot_has_data(&data);
    Some((data, updated, has))
}

/// Read + classify usage into the {status, data} envelope the UI expects. Two sources
/// feed the cache: the statusline hook (`cc-pet-usage.json`) and the OAuth fallback
/// (`cc-pet-usage-oauth.json`). We prefer whichever actually has data, then whichever is
/// newer — so statusline wins when it works, and OAuth transparently fills in when it
/// doesn't (the common case, since `rate_limits` isn't emitted on every machine).
fn read_usage() -> Value {
    let mut cands: Vec<(Value, u64, bool)> = Vec::new();
    if let Some(s) = load_source(STATUSLINE_CACHE) {
        cands.push(s);
    }
    if let Some(s) = load_source(OAUTH_CACHE) {
        cands.push(s);
    }
    // has_data first (true before false), then newest updated_at first.
    cands.sort_by(|a, b| b.2.cmp(&a.2).then(b.1.cmp(&a.1)));

    let Some((data, updated, has)) = cands.into_iter().next() else {
        return json!({ "status": "nodata", "data": null });
    };
    if !has {
        // A file exists but neither source has real numbers yet.
        return json!({ "status": "nodata", "data": null });
    }
    let stale = now_secs().saturating_sub(updated) > STALE_AFTER_SECS;
    json!({ "status": if stale { "stale" } else { "ok" }, "data": data })
}

/// Whether the statusline path alone already has fresh, real data — if so the OAuth
/// poller stays quiet to avoid needless calls to the aggressively-rate-limited endpoint.
fn statusline_fresh_with_data() -> bool {
    matches!(load_source(STATUSLINE_CACHE), Some((_, updated, true))
        if now_secs().saturating_sub(updated) <= STALE_AFTER_SECS)
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

/// epoch seconds -> "YYYY-MM-DDTHH:MM:SSZ" (the shape parse_iso_secs + the UI expect).
fn now_iso() -> String {
    let secs = now_secs() as i64;
    let days = secs.div_euclid(86400);
    let rem = secs.rem_euclid(86400);
    let (h, mi, s) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    // Howard Hinnant's civil_from_days.
    let z = days + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = y + if m <= 2 { 1 } else { 0 };
    format!("{y:04}-{m:02}-{d:02}T{h:02}:{mi:02}:{s:02}Z")
}

/// Read the OAuth access token from ~/.claude/.credentials.json (the same login Claude
/// Code already maintains — no separate sign-in). Claude Code refreshes this file as you
/// use it, so the token stays valid without us implementing token refresh.
fn read_oauth_token() -> Option<String> {
    let file = claude_dir()?.join(".credentials.json");
    let text = std::fs::read_to_string(&file).ok()?;
    let v: Value = serde_json::from_str(&text).ok()?;
    let obj = v.get("claudeAiOauth").unwrap_or(&v);
    for k in ["accessToken", "access_token", "token"] {
        if let Some(t) = obj.get(k).and_then(|x| x.as_str()) {
            if !t.is_empty() {
                return Some(t.to_string());
            }
        }
    }
    None
}

enum FetchResult {
    Body(String),
    RateLimited,
    Other,
}

fn fetch_oauth_usage(token: &str) -> FetchResult {
    let req = ureq::get(OAUTH_USAGE_URL)
        .set("Authorization", &format!("Bearer {token}"))
        .set("anthropic-beta", OAUTH_BETA_HEADER)
        .set("User-Agent", CLAUDE_CODE_UA)
        .timeout(Duration::from_secs(15));
    match req.call() {
        Ok(resp) => resp.into_string().map(FetchResult::Body).unwrap_or(FetchResult::Other),
        Err(ureq::Error::Status(429, _)) => FetchResult::RateLimited,
        Err(_) => FetchResult::Other,
    }
}

/// Convert one `{ "utilization": .., "resets_at": ".." }` window to our normalized
/// `{ "used_percentage": .., "resets_at": ".." }` shape.
fn norm_oauth_window(w: Option<&Value>) -> Option<Value> {
    let w = w?;
    let util = w.get("utilization").and_then(|x| x.as_f64())?;
    let mut out = json!({ "used_percentage": util });
    if let Some(r) = w.get("resets_at").and_then(|x| x.as_str()) {
        out["resets_at"] = json!(r);
    }
    Some(out)
}

/// Parse an OAuth /usage body and atomically write our normalized snapshot. Returns
/// false (writing nothing) if the body has no usable window, so a bad response never
/// clobbers a good cache.
fn write_oauth_snapshot(body: &str) -> bool {
    let Ok(v) = serde_json::from_str::<Value>(body) else {
        return false;
    };
    let five = norm_oauth_window(v.get("five_hour"));
    let weekly = norm_oauth_window(v.get("seven_day"));
    if five.is_none() && weekly.is_none() {
        return false;
    }
    let snapshot = json!({
        "five_hour": five,
        "weekly": weekly,
        "updated_at": now_iso(),
        "source": "oauth",
    });
    let Some(dir) = claude_dir() else {
        return false;
    };
    let file = dir.join(OAUTH_CACHE);
    let tmp = dir.join(format!("{OAUTH_CACHE}.tmp"));
    if std::fs::write(&tmp, serde_json::to_string_pretty(&snapshot).unwrap()).is_err() {
        return false;
    }
    std::fs::rename(&tmp, &file).is_ok()
}

/// Background poller for the OAuth fallback. Stays quiet while the statusline path is
/// delivering fresh data; otherwise fetches every ~60s, backing off on 429.
fn oauth_poll_loop() {
    let base = 60u64;
    let mut interval = base;
    std::thread::sleep(Duration::from_secs(3)); // let the app finish launching
    loop {
        if statusline_fresh_with_data() {
            std::thread::sleep(Duration::from_secs(base));
            continue;
        }
        match read_oauth_token() {
            Some(token) => match fetch_oauth_usage(&token) {
                FetchResult::Body(body) => {
                    write_oauth_snapshot(&body);
                    interval = base; // success resets any backoff
                    std::thread::sleep(Duration::from_secs(interval));
                }
                FetchResult::RateLimited => {
                    interval = (interval * 2).min(600); // exponential backoff, cap 10 min
                    std::thread::sleep(Duration::from_secs(interval));
                }
                FetchResult::Other => std::thread::sleep(Duration::from_secs(120)),
            },
            None => std::thread::sleep(Duration::from_secs(120)),
        }
    }
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
    // Resize in place, keeping the RIGHT edge fixed (the cat is right-anchored) so growing
    // the panel — weekly popup, menu — never shifts the cat or snaps it back to the corner
    // after the user has dragged the widget somewhere else. Position is only reset to the
    // corner explicitly, via launch and the "reset position" action.
    let scale = window.scale_factor().unwrap_or(1.0);
    let old_pos = window.outer_position().ok();
    let old_w = window.outer_size().map(|s| s.width as i32).ok();
    let _ = window.set_size(LogicalSize::new(w, h));
    if let (Some(pos), Some(ow)) = (old_pos, old_w) {
        let new_w = (w * scale).round() as i32;
        let _ = window.set_position(PhysicalPosition::new(pos.x + (ow - new_w), pos.y));
    }
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

            // Fallback data source: fetch usage straight from the OAuth endpoint whenever
            // the statusline hook isn't providing fresh data. Writes cc-pet-usage-oauth.json,
            // which the poll above picks up like any other source.
            std::thread::spawn(oauth_poll_loop);

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
