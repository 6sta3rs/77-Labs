use std::{fs, path::{Path, PathBuf}};
use tauri::WebviewWindow;

const STORAGE_OWNER: &str = "Seventy Seven Labs data storage v1";

pub(crate) fn data_dir(runtime: &Path) -> Result<PathBuf, String> {
    let default = runtime.parent().ok_or("Brak katalogu nadrzędnego silnika")?.join("data");
    let pointer = runtime.join("storage-location.json");
    crate::installer::no_links(&pointer)?;
    let raw = match fs::read(&pointer) {
        Ok(raw) if raw.len() <= 65536 => raw,
        Ok(_) => return Err("Plik lokalizacji danych jest zbyt duży.".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(default),
        Err(error) => return Err(format!("Nie można odczytać lokalizacji danych: {error}")),
    };
    let value: serde_json::Value = serde_json::from_slice(&raw).map_err(|_| "Nieprawidłowy plik lokalizacji danych")?;
    if value["schema"] != 1 || value["owner"] != STORAGE_OWNER {
        return Err("Nieobsługiwany plik lokalizacji danych.".into());
    }
    let active = PathBuf::from(value["active"].as_str().ok_or("Brak aktywnej lokalizacji danych")?);
    if !active.is_absolute() || active.components().any(|part| matches!(part, std::path::Component::ParentDir)) {
        return Err("Lokalizacja danych musi być pełną ścieżką lokalną.".into());
    }
    #[cfg(windows)]
    if !matches!(active.components().next(), Some(std::path::Component::Prefix(prefix)) if matches!(prefix.kind(), std::path::Prefix::Disk(_) | std::path::Prefix::VerbatimDisk(_))) {
        return Err("Dane wymagają lokalnej ścieżki dysku Windows.".into());
    }
    crate::installer::no_links(&active)?;
    if active != default {
        let receipt = active.join(".seventy-seven-data.json");
        crate::installer::no_links(&receipt)?;
        let raw = fs::read(receipt).map_err(|_| "Brak potwierdzenia ukończonej kopii danych")?;
        if raw.len() > 16 * 1024 * 1024 { return Err("Potwierdzenie kopii danych jest zbyt duże.".into()); }
        let marker: serde_json::Value = serde_json::from_slice(&raw).map_err(|_| "Błędne potwierdzenie kopii danych")?;
        if marker["schema"] != 1 || marker["owner"] != STORAGE_OWNER || marker["status"] != "complete" {
            return Err("Kopia danych nie została ukończona. Nie otwarto niepotwierdzonej bazy.".into());
        }
    }
    Ok(active)
}

#[tauri::command]
pub async fn settings_open_microphone(window: WebviewWindow) -> Result<(), String> {
    if window.label() != "main" { return Err("Ustawienia systemu można otworzyć z głównego okna.".into()); }
    tauri::async_runtime::spawn_blocking(|| {
        #[cfg(windows)] {
            use std::{ffi::c_void, ptr::null};
            #[link(name = "shell32")]
            extern "system" { fn ShellExecuteW(window: *mut c_void, operation: *const u16, file: *const u16, parameters: *const u16, directory: *const u16, show: i32) -> *mut c_void; }
            let operation: Vec<u16> = "open\0".encode_utf16().collect();
            let target: Vec<u16> = "ms-settings:privacy-microphone\0".encode_utf16().collect();
            let result = unsafe { ShellExecuteW(std::ptr::null_mut(), operation.as_ptr(), target.as_ptr(), null(), null(), 1) };
            if result as isize <= 32 { return Err("Windows nie otworzył ustawień mikrofonu.".into()); }
            Ok(())
        }
        #[cfg(not(windows))] { Err("Ustawienia mikrofonu są dostępne w aplikacji Windows.".into()) }
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn settings_choose_media_tool(window: WebviewWindow, runtime: tauri::State<'_, crate::runtime::Runtime>, tool: String) -> Result<Option<serde_json::Value>, String> {
    if window.label() != "main" || !matches!(tool.as_str(), "ffmpeg" | "ffprobe") {
        return Err("Wybierz FFmpeg lub FFprobe w głównym oknie.".into());
    }
    let runtime = runtime.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let Some(path) = pick_tool(&tool)? else { return Ok(None); };
        runtime.set_media_tool(&tool, &path).map(Some)
    }).await.map_err(|error| error.to_string())?
}

#[cfg(windows)]
fn pick_tool(tool: &str) -> Result<Option<String>, String> {
    use std::{ffi::c_void, ptr::{null, null_mut}};
    #[repr(C)]
    struct OpenFileName {
        size: u32, owner: *mut c_void, instance: *mut c_void, filter: *const u16,
        custom_filter: *mut u16, max_custom_filter: u32, filter_index: u32,
        file: *mut u16, max_file: u32, file_title: *mut u16, max_file_title: u32,
        initial_dir: *const u16, title: *const u16, flags: u32,
        file_offset: u16, file_extension: u16, default_ext: *const u16,
        custom_data: isize, hook: *mut c_void, template_name: *const u16,
        reserved: *mut c_void, reserved_dw: u32, flags_ex: u32,
    }
    #[link(name = "comdlg32")]
    extern "system" {
        fn GetOpenFileNameW(options: *mut OpenFileName) -> i32;
        fn CommDlgExtendedError() -> u32;
    }
    let filter: Vec<u16> = "Programy EXE\0*.exe\0\0".encode_utf16().collect();
    let title: Vec<u16> = format!("Wybierz {tool}.exe\0").encode_utf16().collect();
    let mut path = vec![0u16; 32768];
    let mut options = OpenFileName {
        size: std::mem::size_of::<OpenFileName>() as u32, owner: null_mut(), instance: null_mut(), filter: filter.as_ptr(),
        custom_filter: null_mut(), max_custom_filter: 0, filter_index: 1,
        file: path.as_mut_ptr(), max_file: path.len() as u32, file_title: null_mut(), max_file_title: 0,
        initial_dir: null(), title: title.as_ptr(), flags: 0x80000 | 0x1000 | 0x800 | 8 | 4,
        file_offset: 0, file_extension: 0, default_ext: null(), custom_data: 0,
        hook: null_mut(), template_name: null(), reserved: null_mut(), reserved_dw: 0, flags_ex: 0,
    };
    if unsafe { GetOpenFileNameW(&mut options) } == 0 {
        let code = unsafe { CommDlgExtendedError() };
        return if code == 0 { Ok(None) } else { Err(format!("Systemowy wybór programu nie powiódł się (kod {code}).")) };
    }
    let end = path.iter().position(|value| *value == 0).ok_or("Nieprawidłowa ścieżka programu")?;
    Ok(Some(String::from_utf16(&path[..end]).map_err(|error| error.to_string())?))
}

#[cfg(not(windows))]
fn pick_tool(_tool: &str) -> Result<Option<String>, String> { Err("Systemowy wybór programu jest dostępny na Windows.".into()) }

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn default_location_and_incomplete_copy() {
        let root = std::env::temp_dir().join(format!("ss-settings-{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        let runtime = root.join("runtime"); fs::create_dir_all(&runtime).unwrap();
        assert_eq!(data_dir(&runtime).unwrap(), root.join("data"));
        let target = root.join("other/data"); fs::create_dir_all(&target).unwrap();
        fs::write(runtime.join("storage-location.json"), serde_json::to_vec(&serde_json::json!({"schema":1,"owner":STORAGE_OWNER,"active":target})).unwrap()).unwrap();
        assert!(data_dir(&runtime).is_err());
        fs::write(target.join(".seventy-seven-data.json"), serde_json::to_vec(&serde_json::json!({"schema":1,"owner":STORAGE_OWNER,"status":"complete"})).unwrap()).unwrap();
        assert_eq!(data_dir(&runtime).unwrap(), target);
        // No recursive cleanup; keep the tiny private fixture available for inspection.
    }
}
