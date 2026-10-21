//! Opt-in Windows dictation utility. Hotkeys only show/hide a local window;
//! microphone capture and insertion always require a separate user action.
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::PathBuf,
    str::FromStr,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{
    AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

pub const WIDGET_LABEL: &str = "dictation-widget";
const DEFAULT_SHORTCUT: &str = "Ctrl+Alt+Shift+D";
const MAX_TEXT_CHARS: usize = 100_000;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(default, deny_unknown_fields)]
pub struct Preferences {
    pub enabled: bool,
    pub shortcut: String,
    pub paste_enabled: bool,
}
impl Default for Preferences {
    fn default() -> Self {
        Self {
            enabled: false,
            shortcut: DEFAULT_SHORTCUT.into(),
            paste_enabled: false,
        }
    }
}
#[derive(Clone)]
struct Target {
    handle: usize,
    process: u32,
    title: String,
    captured: Instant,
}
#[derive(Clone, Serialize)]
pub struct TargetSummary {
    pub title: String,
    pub available: bool,
}
#[derive(Clone, Serialize)]
pub struct DesktopStatus {
    pub supported: bool,
    pub preferences: Preferences,
    pub registered: bool,
    pub active_shortcut: Option<String>,
    pub widget_visible: bool,
    pub target: Option<TargetSummary>,
    pub error: Option<String>,
}
#[derive(Default)]
struct Inner {
    preferences: Preferences,
    registered: Option<String>,
    registered_id: Option<u32>,
    target: Option<Target>,
    error: Option<String>,
    widget_leases: Vec<u64>,
    stop_generation: u64,
    awaiting_stop: Option<u64>,
}
#[derive(Clone, Default)]
pub struct DictationDesktop {
    inner: Arc<Mutex<Inner>>,
    configuration: Arc<Mutex<()>>,
    opening: Arc<AtomicBool>,
    pressed: Arc<AtomicBool>,
    shutting_down: Arc<AtomicBool>,
    user_configured: Arc<AtomicBool>,
}

fn lock_error() -> String {
    "Nie można odczytać stanu dyktowania desktopowego.".into()
}
fn preferences_path() -> Result<PathBuf, String> {
    Ok(
        PathBuf::from(std::env::var_os("LOCALAPPDATA").ok_or("Brak katalogu LOCALAPPDATA.")?)
            .join("VoiceStudioNext/data/dictation-desktop.json"),
    )
}
fn load_preferences() -> Result<Preferences, String> {
    let path = preferences_path()?;
    if !path.exists() {
        return Ok(Preferences::default());
    }
    if fs::metadata(&path)
        .map_err(|_| "Nie można odczytać ustawień dyktowania.")?
        .len()
        > 16_384
    {
        return Err("Plik ustawień dyktowania jest zbyt duży.".into());
    }
    serde_json::from_str(
        &fs::read_to_string(path).map_err(|_| "Nie można odczytać ustawień dyktowania.")?,
    )
    .map_err(|_| "Ustawienia dyktowania są nieprawidłowe. Skrót nie został włączony.".into())
}
fn store_preferences(value: &Preferences) -> Result<(), String> {
    let path = preferences_path()?;
    fs::create_dir_all(path.parent().ok_or("Brak katalogu ustawień.")?)
        .map_err(|_| "Nie można utworzyć katalogu ustawień.")?;
    let temporary = path.with_extension(format!("{}.tmp", std::process::id()));
    fs::write(
        &temporary,
        serde_json::to_vec_pretty(value).map_err(|_| "Nie można przygotować ustawień.")?,
    )
    .map_err(|_| "Nie można zapisać ustawień dyktowania.")?;
    fs::rename(&temporary, &path).map_err(|_| {
        let _ = fs::remove_file(&temporary);
        "Nie można zastąpić ustawień dyktowania; zachowano poprzedni plik.".to_string()
    })
}
pub fn validate_shortcut(value: &str) -> Result<String, String> {
    if value.len() > 100 {
        return Err("Skrót jest zbyt długi.".into());
    }
    let parts: Vec<_> = value.split('+').map(str::trim).collect();
    if parts.len() < 3 || parts.iter().any(|part| part.is_empty()) {
        return Err(
            "Użyj co najmniej dwóch modyfikatorów i klawisza, np. Ctrl+Alt+Shift+D.".into(),
        );
    }
    let mut modifiers = Vec::new();
    for part in &parts[..parts.len() - 1] {
        let canonical = match part.to_ascii_lowercase().as_str() {
            "ctrl" | "control" | "commandorcontrol" | "cmdorcontrol" => "Ctrl",
            "alt" | "option" => "Alt",
            "shift" => "Shift",
            "super" | "meta" | "win" => "Super",
            _ => return Err("Modyfikatory skrótu to Ctrl, Alt, Shift lub Super.".into()),
        };
        if modifiers.contains(&canonical) {
            return Err("Skrót zawiera powtórzony modyfikator.".into());
        }
        modifiers.push(canonical);
    }
    if !modifiers.contains(&"Ctrl") && !modifiers.contains(&"Alt") {
        return Err("Skrót powinien zawierać Ctrl lub Alt oraz drugi modyfikator.".into());
    }
    let key = parts[parts.len() - 1].to_ascii_uppercase();
    let key = if key == "SPACE" {
        "Space".to_string()
    } else if key.len() == 1 && key.as_bytes()[0].is_ascii_alphanumeric() {
        key
    } else if let Some(number) = key.strip_prefix('F').and_then(|v| v.parse::<u8>().ok()) {
        if !(1..=24).contains(&number) || number == 12 {
            return Err("Wybierz F1–F11 lub F13–F24. F12 jest zarezerwowany przez Windows.".into());
        }
        key
    } else {
        return Err("Wybierz literę, cyfrę, Space lub klawisz F1–F24 z wyjątkiem F12.".into());
    };
    let mut ordered = Vec::new();
    for modifier in ["Ctrl", "Alt", "Shift", "Super"] {
        if modifiers.contains(&modifier) {
            ordered.push(modifier.to_string());
        }
    }
    ordered.push(key);
    let normalized = ordered.join("+");
    Shortcut::from_str(&normalized)
        .map_err(|_| "Nie można zinterpretować tej kombinacji klawiszy.".to_string())?;
    Ok(normalized)
}
fn allowed(window: &WebviewWindow, widget_only: bool) -> Result<(), String> {
    if window.label() == WIDGET_LABEL || !widget_only && window.label() == "main" {
        Ok(())
    } else {
        Err("Ta operacja jest dostępna wyłącznie w lokalnym oknie studia.".into())
    }
}
fn status(app: &AppHandle) -> Result<DesktopStatus, String> {
    let state = app.state::<DictationDesktop>();
    let inner = state.inner.lock().map_err(|_| lock_error())?;
    Ok(DesktopStatus {
        supported: cfg!(target_os = "windows"),
        preferences: inner.preferences.clone(),
        registered: inner.registered.is_some(),
        active_shortcut: inner.registered.clone(),
        widget_visible: app
            .get_webview_window(WIDGET_LABEL)
            .and_then(|window| window.is_visible().ok())
            .unwrap_or(false),
        target: inner.target.as_ref().map(|target| TargetSummary {
            title: target.title.clone(),
            available: native::valid_target(target),
        }),
        error: inner.error.clone(),
    })
}
fn announce(app: &AppHandle) {
    if let Ok(value) = status(app) {
        let _ = app.emit("dictation-desktop:status", value);
    }
}
fn register(app: &AppHandle, shortcut: &str) -> Result<(), String> {
    app.global_shortcut().on_shortcut(shortcut,|app,shortcut,event|{
        let state=app.state::<DictationDesktop>();let active=state.inner.lock().ok().and_then(|inner|inner.registered_id);
        if active!=Some(shortcut.id()){return;}
        if event.state==ShortcutState::Released{state.pressed.store(false,Ordering::SeqCst);return;}
        if state.pressed.swap(true,Ordering::SeqCst){return;}
        let allow_target=state.inner.lock().map(|inner|inner.preferences.paste_enabled).unwrap_or(false);let target=if allow_target{native::foreground_target()}else{None};let handle=app.clone();
        tauri::async_runtime::spawn(async move{if let Err(error)=toggle_widget(&handle,target).await{if let Ok(mut inner)=handle.state::<DictationDesktop>().inner.lock(){inner.error=Some(error);}announce(&handle);}});
    }).map_err(|_|"Nie udało się zarejestrować skrótu. Kombinacja może być zajęta przez Windows lub inną aplikację; wybierz inną.".into())
}
fn configure(app: &AppHandle, mut preferences: Preferences, persist: bool) -> Result<(), String> {
    if !cfg!(target_os = "windows") {
        return Err("Dyktowanie desktopowe jest dostępne na Windows.".into());
    }
    preferences.shortcut = match validate_shortcut(&preferences.shortcut) {
        Ok(value) => value,
        Err(_) if !preferences.enabled => DEFAULT_SHORTCUT.into(),
        Err(error) => return Err(error),
    };
    let state = app.state::<DictationDesktop>();
    let _configuration = state.configuration.lock().map_err(|_| lock_error())?;
    if state.shutting_down.load(Ordering::SeqCst) {
        return Err("Aplikacja jest zamykana.".into());
    }
    if !persist && state.user_configured.load(Ordering::SeqCst) {
        return Ok(());
    }
    if !persist {
        // Keep the user's requested combination visible even when another
        // application has occupied it since the previous studio session.
        state.inner.lock().map_err(|_| lock_error())?.preferences = preferences.clone();
    }
    let old = state
        .inner
        .lock()
        .map_err(|_| lock_error())?
        .registered
        .clone();
    let desired = preferences.enabled.then(|| preferences.shortcut.clone());
    let changed = old != desired;
    if changed {
        if let Some(new) = &desired {
            register(app, new)?;
        }
        if let Some(previous) = &old {
            if app.global_shortcut().unregister(previous.as_str()).is_err() {
                if let Some(new) = &desired {
                    let _ = app.global_shortcut().unregister(new.as_str());
                }
                return Err("Nie udało się zwolnić poprzedniego skrótu. Zachowano dotychczasowe ustawienie.".into());
            }
        }
    }
    if persist {
        if let Err(error) = store_preferences(&preferences) {
            if changed {
                if let Some(new) = &desired {
                    let _ = app.global_shortcut().unregister(new.as_str());
                }
                if let Some(previous) = &old {
                    let _ = register(app, previous);
                }
            }
            return Err(error);
        }
    }
    {
        let mut inner = state.inner.lock().map_err(|_| lock_error())?;
        inner.registered = desired.clone();
        inner.registered_id = desired
            .as_ref()
            .and_then(|value| Shortcut::from_str(value).ok())
            .map(|shortcut| shortcut.id());
        inner.preferences = preferences;
        inner.error = None;
        if !inner.preferences.paste_enabled {
            inner.target = None;
        }
    }
    if persist {
        state.user_configured.store(true, Ordering::SeqCst);
    }
    state.pressed.store(false, Ordering::SeqCst);
    announce(app);
    Ok(())
}
/// Call after plugins/state have been installed; registration happens away from
/// setup's event thread because the official plugin dispatches to that thread.
pub fn initialize(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let result = load_preferences().and_then(|value| configure(&app, value, false));
        if let Err(error) = result {
            if let Ok(mut inner) = app.state::<DictationDesktop>().inner.lock() {
                inner.error = Some(error);
            }
            announce(&app);
        }
    });
}
async fn toggle_widget(app: &AppHandle, target: Option<Target>) -> Result<(), String> {
    if app
        .get_webview_window(WIDGET_LABEL)
        .and_then(|window| window.is_visible().ok())
        .unwrap_or(false)
    {
        return hide_widget(app).await;
    }
    show_widget(app, target).await
}
async fn show_widget(app: &AppHandle, target: Option<Target>) -> Result<(), String> {
    let state = app.state::<DictationDesktop>();
    if state.shutting_down.load(Ordering::SeqCst) {
        return Ok(());
    }
    if state.opening.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    let result = (|| {
        {
            let mut inner = state.inner.lock().map_err(|_| lock_error())?;
            inner.target = target;
            inner.awaiting_stop = None;
        }
        let window = if let Some(window) = app.get_webview_window(WIDGET_LABEL) {
            window
        } else {
            let window = WebviewWindowBuilder::new(
                app,
                WIDGET_LABEL,
                WebviewUrl::App("index.html?dictationWidget=1".into()),
            )
            .title("Dyktowanie — Seventy Seven Labs")
            .inner_size(440.0, 560.0)
            .min_inner_size(360.0, 360.0)
            .always_on_top(true)
            .skip_taskbar(true)
            .resizable(true)
            .build()
            .map_err(|_| "Nie można otworzyć pływającego okna dyktowania.".to_string())?;
            let handle = app.clone();
            window.on_window_event(move |event| {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let handle = handle.clone();
                    tauri::async_runtime::spawn(async move {
                        let _ = hide_widget(&handle).await;
                    });
                }
            });
            window
        };
        window
            .show()
            .map_err(|_| "Nie można pokazać okna dyktowania.")?;
        window
            .unminimize()
            .map_err(|_| "Nie można przywrócić okna dyktowania.")?;
        window
            .set_focus()
            .map_err(|_| "Windows nie pozwolił aktywować okna dyktowania.")?;
        let _ = window.emit("dictation-desktop:shown", ());
        Ok(())
    })();
    state.opening.store(false, Ordering::SeqCst);
    announce(app);
    result
}
fn release_widget_leases(app: &AppHandle) {
    let leases = app
        .state::<DictationDesktop>()
        .inner
        .lock()
        .map(|mut inner| std::mem::take(&mut inner.widget_leases))
        .unwrap_or_default();
    for lease in leases {
        crate::runtime::runtime_release(app.state::<crate::runtime::Runtime>(), lease, None);
    }
}
async fn hide_widget(app: &AppHandle) -> Result<(), String> {
    let generation = {
        let state = app.state::<DictationDesktop>();
        let mut inner = state.inner.lock().map_err(|_| lock_error())?;
        inner.target = None;
        inner.stop_generation += 1;
        let generation = inner.stop_generation;
        inner.awaiting_stop = Some(generation);
        generation
    };
    if let Some(window) = app.get_webview_window(WIDGET_LABEL) {
        let _ = window.emit("dictation-desktop:hidden", generation);
        window
            .hide()
            .map_err(|_| "Nie można ukryć okna dyktowania.")?;
    }
    release_widget_leases(app);
    announce(app);
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        std::thread::sleep(Duration::from_millis(1200));
        let awaiting = app
            .state::<DictationDesktop>()
            .inner
            .lock()
            .ok()
            .and_then(|inner| inner.awaiting_stop);
        if awaiting == Some(generation) {
            if let Some(window) = app.get_webview_window(WIDGET_LABEL) {
                let _ = window.destroy();
            }
            if let Ok(mut inner) = app.state::<DictationDesktop>().inner.lock() {
                inner.awaiting_stop = None;
            }
            release_widget_leases(&app);
        }
    });
    Ok(())
}
/// Call during RunEvent::ExitRequested while the event loop still accepts
/// plugin unregister work. Never unregister other modules' shortcuts.
fn shutdown(app: &AppHandle) {
    let state = app.state::<DictationDesktop>();
    let Ok(_configuration) = state.configuration.lock() else {
        return;
    };
    let registered = app
        .state::<DictationDesktop>()
        .inner
        .lock()
        .ok()
        .and_then(|mut inner| {
            inner.target = None;
            inner.registered_id = None;
            inner.registered.take()
        });
    if let Some(shortcut) = registered {
        let _ = app.global_shortcut().unregister(shortcut.as_str());
    }
    release_widget_leases(app);
}
/// In RunEvent::ExitRequested, call this and prevent_exit() when it returns
/// true. The plugin can then dispatch unregister work while the loop is alive;
/// the second ExitRequested emitted by app.exit(0) is allowed through.
pub fn begin_shutdown(app: &AppHandle) -> bool {
    if app
        .state::<DictationDesktop>()
        .shutting_down
        .swap(true, Ordering::SeqCst)
    {
        return false;
    }
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        shutdown(&app);
        app.exit(0);
    });
    true
}

#[tauri::command]
pub fn dictation_desktop_status(
    window: WebviewWindow,
    app: AppHandle,
) -> Result<DesktopStatus, String> {
    allowed(&window, false)?;
    status(&app)
}
#[tauri::command]
pub async fn dictation_desktop_configure(
    window: WebviewWindow,
    app: AppHandle,
    preferences: Preferences,
) -> Result<DesktopStatus, String> {
    if window.label() != "main" {
        return Err("Ustawienia skrótu można zmieniać w głównym oknie studia.".into());
    }
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || configure(&handle, preferences, true))
        .await
        .map_err(|_| "Przerwano zapis ustawień dyktowania.".to_string())??;
    status(&app)
}
#[tauri::command]
pub async fn dictation_widget_show(
    window: WebviewWindow,
    app: AppHandle,
) -> Result<DesktopStatus, String> {
    allowed(&window, false)?;
    show_widget(&app, None).await?;
    status(&app)
}
#[tauri::command]
pub async fn dictation_widget_hide(window: WebviewWindow, app: AppHandle) -> Result<(), String> {
    allowed(&window, false)?;
    hide_widget(&app).await
}
#[tauri::command]
pub fn dictation_widget_stopped(
    window: WebviewWindow,
    app: AppHandle,
    generation: u64,
) -> Result<(), String> {
    allowed(&window, true)?;
    let state = app.state::<DictationDesktop>();
    let mut inner = state.inner.lock().map_err(|_| lock_error())?;
    if inner.awaiting_stop == Some(generation) {
        inner.awaiting_stop = None;
    }
    Ok(())
}
#[tauri::command]
pub async fn dictation_widget_runtime_acquire(
    window: WebviewWindow,
    app: AppHandle,
) -> Result<serde_json::Value, String> {
    allowed(&window, true)?;
    if !window.is_visible().unwrap_or(false) {
        return Err("Najpierw otwórz okno dyktowania.".into());
    }
    let value = serde_json::to_value(
        crate::runtime::runtime_acquire(app.state::<crate::runtime::Runtime>(), true).await?,
    )
    .map_err(|_| "Nie można odczytać rezerwacji silnika.")?;
    let lease = value
        .get("lease")
        .and_then(|value| value.as_u64())
        .ok_or("Silnik nie zwrócił identyfikatora rezerwacji.")?;
    if !window.is_visible().unwrap_or(false) {
        crate::runtime::runtime_release(app.state::<crate::runtime::Runtime>(), lease, None);
        return Err("Okno dyktowania zostało zamknięte.".into());
    }
    app.state::<DictationDesktop>()
        .inner
        .lock()
        .map_err(|_| lock_error())?
        .widget_leases
        .push(lease);
    Ok(value)
}
#[tauri::command]
pub fn dictation_widget_runtime_release(
    window: WebviewWindow,
    app: AppHandle,
    lease: u64,
) -> Result<(), String> {
    allowed(&window, true)?;
    let owned = {
        let state = app.state::<DictationDesktop>();
        let mut inner = state.inner.lock().map_err(|_| lock_error())?;
        if let Some(index) = inner.widget_leases.iter().position(|value| *value == lease) {
            inner.widget_leases.swap_remove(index);
            true
        } else {
            false
        }
    };
    if owned {
        crate::runtime::runtime_release(app.state::<crate::runtime::Runtime>(), lease, None);
    }
    Ok(())
}
fn validate_text(text: &str) -> Result<(), String> {
    if text.trim().is_empty() {
        return Err("Brak tekstu do skopiowania lub wklejenia.".into());
    }
    if text.chars().count() > MAX_TEXT_CHARS || text.contains('\0') {
        return Err("Tekst jest zbyt długi lub zawiera niedozwolony znak.".into());
    }
    Ok(())
}
#[tauri::command]
pub fn dictation_desktop_copy(
    window: WebviewWindow,
    app: AppHandle,
    text: String,
) -> Result<(), String> {
    allowed(&window, false)?;
    validate_text(&text)?;
    app.clipboard()
        .write_text(text)
        .map_err(|_| "Nie można zapisać tekstu w schowku Windows.".into())
}
#[tauri::command]
pub async fn dictation_desktop_paste(
    window: WebviewWindow,
    app: AppHandle,
    text: String,
) -> Result<(), String> {
    allowed(&window, true)?;
    if !window.is_visible().unwrap_or(false) || !window.is_focused().unwrap_or(false) {
        return Err("Kliknij przycisk wklejania w widocznym, aktywnym oknie dyktowania.".into());
    }
    validate_text(&text)?;
    let target = {
        let state = app.state::<DictationDesktop>();
        let mut inner = state.inner.lock().map_err(|_| lock_error())?;
        if !inner.preferences.paste_enabled {
            return Err("Wklejanie do innych aplikacji jest wyłączone w ustawieniach.".into());
        }
        inner.target.take().ok_or(
            "Brak okna docelowego. Użyj globalnego skrótu z okna, do którego chcesz wkleić tekst.",
        )?
    };
    tauri::async_runtime::spawn_blocking(move || {
        native::prepare_paste(&target)?;
        app.clipboard()
            .write_text(text)
            .map_err(|_| "Nie można przygotować schowka Windows.".to_string())?;
        native::paste(&target)
    })
    .await
    .map_err(|_| "Przerwano wklejanie tekstu.".to_string())?
}

#[cfg(windows)]
mod native {
    use super::Target;
    use std::time::{Duration, Instant};
    use windows_sys::Win32::{
        Foundation::HWND,
        System::Threading::GetCurrentProcessId,
        UI::{
            Input::KeyboardAndMouse::{
                GetAsyncKeyState, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT,
                KEYEVENTF_KEYUP, VK_CONTROL, VK_LWIN, VK_MENU, VK_RWIN, VK_SHIFT, VK_V,
            },
            WindowsAndMessaging::{
                GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId, IsWindow,
                IsWindowVisible, SetForegroundWindow,
            },
        },
    };
    fn title(window: HWND) -> String {
        let mut buffer = [0u16; 512];
        let count = unsafe { GetWindowTextW(window, buffer.as_mut_ptr(), buffer.len() as i32) };
        String::from_utf16_lossy(&buffer[..count.max(0) as usize])
    }
    pub(super) fn foreground_target() -> Option<Target> {
        let window = unsafe { GetForegroundWindow() };
        let mut process = 0;
        unsafe { GetWindowThreadProcessId(window, &mut process) };
        if window.is_null()
            || process == 0
            || process == unsafe { GetCurrentProcessId() }
            || unsafe { IsWindowVisible(window) } == 0
        {
            return None;
        }
        Some(Target {
            handle: window as usize,
            process,
            title: title(window),
            captured: Instant::now(),
        })
    }
    pub(super) fn valid_target(target: &Target) -> bool {
        let window = target.handle as HWND;
        let mut process = 0;
        unsafe { GetWindowThreadProcessId(window, &mut process) };
        target.captured.elapsed() < Duration::from_secs(20 * 60)
            && unsafe { IsWindow(window) } != 0
            && unsafe { IsWindowVisible(window) } != 0
            && process == target.process
            && process != unsafe { GetCurrentProcessId() }
            && title(window) == target.title
    }
    pub(super) fn prepare_paste(target: &Target) -> Result<(), String> {
        if !valid_target(target) {
            return Err("Okno docelowe nie jest już tym samym aktywnym dokumentem lub cel wygasł. Otwórz je i ponownie użyj globalnego skrótu.".into());
        }
        let mut process = 0;
        unsafe { GetWindowThreadProcessId(GetForegroundWindow(), &mut process) };
        if process != unsafe { GetCurrentProcessId() } {
            return Err("Najpierw kliknij przycisk wklejania w aktywnym oknie dyktowania.".into());
        }
        if [VK_CONTROL, VK_MENU, VK_SHIFT, VK_LWIN, VK_RWIN]
            .iter()
            .any(|key| unsafe { GetAsyncKeyState(*key as i32) } < 0)
        {
            return Err("Zwolnij Ctrl, Alt, Shift i klawisz Windows przed wklejeniem.".into());
        }
        Ok(())
    }
    fn key(key: u16, up: bool) -> INPUT {
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: key,
                    wScan: 0,
                    dwFlags: if up { KEYEVENTF_KEYUP } else { 0 },
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        }
    }
    pub(super) fn paste(target: &Target) -> Result<(), String> {
        let window = target.handle as HWND;
        if !valid_target(target) || unsafe { SetForegroundWindow(window) } == 0 {
            return Err("Windows nie pozwolił przywrócić okna docelowego. Tekst jest w schowku; wklej go ręcznie.".into());
        }
        for _ in 0..10 {
            if unsafe { GetForegroundWindow() } == window {
                break;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        if !valid_target(target) || unsafe { GetForegroundWindow() } != window {
            return Err(
                "Okno docelowe nie uzyskało fokusu. Tekst jest w schowku; wklej go ręcznie.".into(),
            );
        }
        let input = [
            key(VK_CONTROL, false),
            key(VK_V, false),
            key(VK_V, true),
            key(VK_CONTROL, true),
        ];
        let count = unsafe {
            SendInput(
                input.len() as u32,
                input.as_ptr(),
                std::mem::size_of::<INPUT>() as i32,
            )
        };
        if count != input.len() as u32 {
            let release = [key(VK_V, true), key(VK_CONTROL, true)];
            unsafe {
                SendInput(
                    release.len() as u32,
                    release.as_ptr(),
                    std::mem::size_of::<INPUT>() as i32,
                )
            };
            return Err("Windows zablokował wklejenie lub aplikacja działa z innymi uprawnieniami. Tekst jest w schowku; wklej go ręcznie.".into());
        }
        Ok(())
    }
}
#[cfg(not(windows))]
mod native {
    use super::Target;
    pub(super) fn foreground_target() -> Option<Target> {
        None
    }
    pub(super) fn valid_target(_: &Target) -> bool {
        false
    }
    pub(super) fn prepare_paste(_: &Target) -> Result<(), String> {
        Err("Wklejanie desktopowe jest dostępne na Windows.".into())
    }
    pub(super) fn paste(_: &Target) -> Result<(), String> {
        Err("Wklejanie desktopowe jest dostępne na Windows.".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn defaults_require_opt_in() {
        let preferences = Preferences::default();
        assert!(!preferences.enabled);
        assert!(!preferences.paste_enabled);
        assert_eq!(
            validate_shortcut(&preferences.shortcut).unwrap(),
            DEFAULT_SHORTCUT
        );
    }
    #[test]
    fn shortcut_validation_and_canonicalization() {
        assert_eq!(
            validate_shortcut(" shift + Control + d ").unwrap(),
            "Ctrl+Shift+D"
        );
        assert!(validate_shortcut("D").is_err());
        assert!(validate_shortcut("Ctrl+D").is_err());
        assert!(validate_shortcut("Shift+Super+D").is_err());
        assert!(validate_shortcut("Ctrl+Ctrl+D").is_err());
        assert!(validate_shortcut("Ctrl+Alt+F12").is_err());
        assert!(validate_shortcut("Ctrl+Alt+Delete").is_err());
    }
    #[test]
    fn insertion_requires_real_text() {
        assert!(validate_text("").is_err());
        assert!(validate_text("a\0b").is_err());
        assert!(validate_text(&"x".repeat(MAX_TEXT_CHARS + 1)).is_err());
        assert!(validate_text("Zażółć gęślą jaźń.").is_ok());
    }
    #[test]
    fn unknown_preference_fields_are_rejected() {
        assert!(serde_json::from_str::<Preferences>(
            r#"{"enabled":true,"paste_enabled":true,"auto_record":true}"#
        )
        .is_err());
    }
    #[cfg(windows)]
    #[test]
    fn invalid_paste_target_never_changes_foreground() {
        use windows_sys::Win32::UI::WindowsAndMessaging::GetForegroundWindow;
        let before = unsafe { GetForegroundWindow() };
        let target = Target {
            handle: 0,
            process: 0,
            title: String::new(),
            captured: Instant::now(),
        };
        assert!(!native::valid_target(&target));
        assert!(native::prepare_paste(&target).is_err());
        assert!(native::paste(&target).is_err());
        assert_eq!(unsafe { GetForegroundWindow() }, before);
    }
    #[cfg(windows)]
    #[test]
    #[ignore = "Explicit native OS registration check; does not press keys or touch microphone/clipboard"]
    fn native_hotkey_roundtrip_and_collision() {
        use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
            RegisterHotKey, UnregisterHotKey, MOD_ALT, MOD_CONTROL, MOD_NOREPEAT, MOD_SHIFT, VK_F11,
        };
        let first = unsafe {
            RegisterHotKey(
                std::ptr::null_mut(),
                0x6a31,
                MOD_CONTROL | MOD_ALT | MOD_SHIFT | MOD_NOREPEAT,
                VK_F11 as u32,
            )
        };
        assert_ne!(
            first, 0,
            "QA combination was already occupied; no existing registration was changed"
        );
        let second = unsafe {
            RegisterHotKey(
                std::ptr::null_mut(),
                0x6a32,
                MOD_CONTROL | MOD_ALT | MOD_SHIFT | MOD_NOREPEAT,
                VK_F11 as u32,
            )
        };
        let released = unsafe { UnregisterHotKey(std::ptr::null_mut(), 0x6a31) };
        assert_eq!(second, 0, "Windows must report an occupied shortcut");
        assert_ne!(released, 0);
        let reusable = unsafe {
            RegisterHotKey(
                std::ptr::null_mut(),
                0x6a32,
                MOD_CONTROL | MOD_ALT | MOD_SHIFT | MOD_NOREPEAT,
                VK_F11 as u32,
            )
        };
        let released_again = unsafe { UnregisterHotKey(std::ptr::null_mut(), 0x6a32) };
        assert_ne!(reusable, 0);
        assert_ne!(released_again, 0);
    }
}
