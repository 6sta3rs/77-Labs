#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod library;
mod runtime;
mod installer;
mod dictation_desktop;
mod watch_folder;
mod license_sources;
mod settings_native;

use runtime::Runtime;
use tauri::Manager;

/// True when this build has an update feed (endpoints are injected only by tools/release/build-update.mjs via `--config`).
#[tauri::command]
fn app_updates_supported(app: tauri::AppHandle) -> bool {
    app.config().plugins.0.get("updater")
        .and_then(|u| u.get("endpoints")).and_then(|e| e.as_array())
        .is_some_and(|e| !e.is_empty())
}

fn main() {
    let runtime = Runtime::default();
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(runtime.clone())
        .manage(installer::Installer::default())
        .manage(dictation_desktop::DictationDesktop::default())
        .manage(watch_folder::WatchFolder::default())
        .invoke_handler(tauri::generate_handler![
            app_updates_supported,
            runtime::runtime_status,
            runtime::runtime_start,
            runtime::runtime_stop,
            runtime::runtime_acquire,
            runtime::runtime_release,
            runtime::runtime_set_idle_minutes,
            runtime::runtime_set_preload,
            installer::installer_status,
            installer::installer_start,
            installer::installer_cancel,
            installer::installer_activate,
            dictation_desktop::dictation_desktop_status,
            dictation_desktop::dictation_desktop_configure,
            dictation_desktop::dictation_widget_show,
            dictation_desktop::dictation_widget_hide,
            dictation_desktop::dictation_widget_stopped,
            dictation_desktop::dictation_widget_runtime_acquire,
            dictation_desktop::dictation_widget_runtime_release,
            dictation_desktop::dictation_desktop_copy,
            dictation_desktop::dictation_desktop_paste,
            watch_folder::watch_folder_status,
            watch_folder::watch_folder_start,
            watch_folder::watch_folder_stop,
            watch_folder::watch_folder_read,
            watch_folder::watch_folder_acknowledge,
            watch_folder::watch_folder_pick,
            license_sources::open_license_source,
            settings_native::settings_open_microphone,
            settings_native::settings_choose_media_tool,
            library::library_profiles,
            library::library_portrait
        ])
        .setup(move |app| {
            dictation_desktop::initialize(app.handle());
            let runtime = runtime.clone();
            runtime.watch_idle();
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Nie udało się uruchomić Seventy Seven Labs")
        .run(|app, event| {
            match event {
                tauri::RunEvent::WindowEvent { label, event: tauri::WindowEvent::CloseRequested { api, .. }, .. } if label == "main" => {
                    api.prevent_close(); app.exit(0);
                }
                tauri::RunEvent::ExitRequested { api, .. } => {
                    if dictation_desktop::begin_shutdown(app) { api.prevent_exit(); }
                }
                tauri::RunEvent::Exit => { app.state::<watch_folder::WatchFolder>().shutdown(); app.state::<Runtime>().stop(); }
                _ => {}
            }
        });
}
