//! Explicit local audio source. Polling is per enabled source, never global.
//! Originals are opened read-only; no rename, remove, shell or model execution.
use rusqlite::{params, Connection};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{collections::{HashMap, HashSet}, fs::{self, File, OpenOptions}, io::Read,
    path::{Component, Path, PathBuf}, sync::{Arc, Mutex}, thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH}};

const MAX_BYTES: u64 = 64 * 1024 * 1024;
const MAX_ENTRIES: usize = 2000;
const MAX_RECEIPTS: usize = 100_000;
const QUIET: Duration = Duration::from_secs(3);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchedFile { key: String, name: String, size: u64, modified_ns: String }
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchStatus {
    enabled: bool, state: String, path: String, recipe_id: String, message: String,
    pending: Vec<WatchedFile>, acknowledged: usize, skipped: usize, last_scan: u64,
}
impl Default for WatchStatus {
    fn default() -> Self { Self { enabled: false, state: "off".into(), path: String::new(), recipe_id: String::new(),
        message: "Obserwacja jest wyłączona. Wybierz folder i zapisaną recepturę audio.".into(),
        pending: vec![], acknowledged: 0, skipped: 0, last_scan: 0 } }
}
#[derive(Clone)]
struct Candidate { public: WatchedFile, path: PathBuf }
struct Sample { key: String, since: Instant }
#[derive(Default)]
struct Inner {
    status: WatchStatus, generation: u64, root: Option<PathBuf>,
    samples: HashMap<PathBuf, Sample>, pending: HashMap<String, Candidate>, receipts: HashSet<String>,
}
#[derive(Clone, Default)]
pub struct WatchFolder { inner: Arc<Mutex<Inner>> }

fn no_links(path: &Path) -> Result<(), String> {
    crate::installer::no_links_with(path, "Folder i pliki nie mogą być dowiązaniami ani punktami ponownej analizy.", "Dowiązania symboliczne nie są obsługiwane.")
}
fn selected_root(value: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(value);
    if !path.is_absolute() || value.chars().any(char::is_control) || path.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err("Wybierz istniejący lokalny folder o pełnej ścieżce.".into());
    }
    #[cfg(windows)]
    {
        use std::path::Prefix;
        if !matches!(path.components().next(), Some(Component::Prefix(prefix)) if matches!(prefix.kind(), Prefix::Disk(_))) {
            return Err("Wybierz folder na lokalnym dysku; UNC i ścieżki urządzeń są wyłączone.".into());
        }
    }
    no_links(&path)?;
    if !path.is_dir() { return Err("Wskazana ścieżka nie jest folderem.".into()); }
    path.canonicalize().map_err(|e| e.to_string())
}
fn database_path(create: bool) -> Result<PathBuf, String> {
    let base = PathBuf::from(std::env::var_os("LOCALAPPDATA").ok_or("Brak LOCALAPPDATA")?).join("VoiceStudioNext");
    if create { fs::create_dir_all(&base).map_err(|e| e.to_string())?; }
    no_links(&base)?;
    let path = base.join("watch-folder.sqlite");
    if path.exists() { no_links(&path)?; if !path.is_file() { return Err("Nieprawidłowy magazyn obserwacji.".into()); } }
    Ok(path)
}
fn database() -> Result<Connection, String> {
    let connection = Connection::open(database_path(true)?).map_err(|e| e.to_string())?;
    connection.busy_timeout(Duration::from_secs(3)).map_err(|e| e.to_string())?;
    connection.execute_batch("CREATE TABLE IF NOT EXISTS config (id INTEGER PRIMARY KEY CHECK(id=1), path TEXT NOT NULL, recipe TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS receipts (fingerprint TEXT PRIMARY KEY, run_id TEXT NOT NULL, accepted_ms INTEGER NOT NULL);").map_err(|e| e.to_string())?;
    Ok(connection)
}
fn fingerprint(path: &Path, size: u64, modified_ns: &str) -> Result<String, String> {
    let text = path.to_str().ok_or("Nazwa pliku nie jest poprawnym tekstem Unicode.")?;
    #[cfg(windows)] let text = text.to_lowercase();
    let mut digest = Sha256::new();
    digest.update(text.as_bytes()); digest.update([0]); digest.update(size.to_le_bytes()); digest.update([0]); digest.update(modified_ns.as_bytes());
    Ok(format!("{:x}", digest.finalize()))
}
fn describe(path: &Path, root: &Path) -> Result<Option<Candidate>, String> {
    let extension = path.extension().and_then(|p| p.to_str()).unwrap_or("").to_ascii_lowercase();
    if !matches!(extension.as_str(), "wav" | "mp3" | "flac" | "ogg" | "m4a" | "aac" | "opus" | "webm") { return Ok(None); }
    no_links(path)?;
    let canonical = path.canonicalize().map_err(|e| e.to_string())?;
    if canonical.parent() != Some(root) { return Err("Plik wykracza poza wybrany folder.".into()); }
    let metadata = fs::metadata(&canonical).map_err(|e| e.to_string())?;
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > MAX_BYTES { return Ok(None); }
    let modified = metadata.modified().map_err(|e| e.to_string())?;
    if modified > SystemTime::now() { return Ok(None); }
    let modified_ns = modified.duration_since(UNIX_EPOCH).map_err(|e| e.to_string())?.as_nanos().to_string();
    let name = canonical.file_name().and_then(|p| p.to_str()).ok_or("Nieprawidłowa nazwa pliku.")?.to_owned();
    Ok(Some(Candidate { public: WatchedFile { key: fingerprint(&canonical, metadata.len(), &modified_ns)?, name, size: metadata.len(), modified_ns }, path: canonical }))
}
fn header_valid(name: &str, bytes: &[u8]) -> bool {
    let extension = name.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    match extension.as_str() {
        "wav" => {
            if bytes.len() < 44 || &bytes[..4] != b"RIFF" || &bytes[8..12] != b"WAVE" { return false; }
            let end = u32::from_le_bytes(bytes[4..8].try_into().unwrap()) as usize + 8;
            if end > bytes.len() || end < 44 { return false; }
            let mut offset = 12; let mut audio = false;
            while offset + 8 <= end {
                let size = u32::from_le_bytes(bytes[offset+4..offset+8].try_into().unwrap()) as usize;
                if offset.checked_add(8).and_then(|n| n.checked_add(size)).is_none_or(|n| n > end) { return false; }
                if &bytes[offset..offset+4] == b"data" && size > 0 { audio = true; }
                offset += 8 + size + (size % 2);
            }
            audio
        },
        "flac" => bytes.len() >= 42 && bytes.starts_with(b"fLaC"),
        "ogg" | "opus" => bytes.len() >= 27 && bytes.starts_with(b"OggS"),
        "m4a" => bytes.len() >= 16 && &bytes[4..8] == b"ftyp",
        "webm" => bytes.len() >= 16 && bytes.starts_with(&[0x1a, 0x45, 0xdf, 0xa3]),
        "mp3" => bytes.len() >= 128 && (bytes.starts_with(b"ID3") || bytes[0] == 0xff && bytes[1] & 0xe0 == 0xe0),
        "aac" => bytes.len() >= 7 && bytes[0] == 0xff && bytes[1] & 0xf6 == 0xf0,
        _ => false,
    }
}
fn open_audio(path: &Path, root: &Path) -> Result<File, String> {
    no_links(path)?;
    let mut options = OpenOptions::new(); options.read(true);
    #[cfg(windows)] { use std::os::windows::fs::OpenOptionsExt; options.share_mode(0).custom_flags(0x00200000); }
    let file = options.open(path).map_err(|e| format!("Plik jest nadal zapisywany lub niedostępny: {e}"))?;
    #[cfg(windows)] {
        use std::{ffi::c_void, os::windows::io::AsRawHandle};
        #[link(name = "kernel32")]
        extern "system" { fn GetFinalPathNameByHandleW(file: *mut c_void, path: *mut u16, size: u32, flags: u32) -> u32; }
        let mut value = vec![0u16; 32768];
        let length = unsafe { GetFinalPathNameByHandleW(file.as_raw_handle(), value.as_mut_ptr(), value.len() as u32, 0) } as usize;
        if length == 0 || length >= value.len() { return Err("Nie potwierdzono rzeczywistej ścieżki uchwytu pliku.".into()); }
        let final_path = PathBuf::from(String::from_utf16(&value[..length]).map_err(|e| e.to_string())?);
        if final_path.parent() != Some(root) { return Err("Rzeczywisty uchwyt pliku wykracza poza wybrany folder.".into()); }
    }
    #[cfg(not(windows))]
    if path.canonicalize().map_err(|e| e.to_string())?.parent() != Some(root) { return Err("Plik wykracza poza wybrany folder.".into()); }
    Ok(file)
}
fn can_queue(candidate: &Candidate, root: &Path) -> bool {
    let Ok(mut file) = open_audio(&candidate.path, root) else { return false; };
    let mut header = [0u8; 16];
    if file.read_exact(&mut header).is_err() { return false; }
    if candidate.public.name.to_ascii_lowercase().ends_with(".wav") {
        return &header[..4] == b"RIFF" && &header[8..12] == b"WAVE"
            && u64::from(u32::from_le_bytes(header[4..8].try_into().unwrap())) + 8 <= candidate.public.size
            && u32::from_le_bytes(header[4..8].try_into().unwrap()) >= 36;
    }
    true // Full bounded read and format validation run immediately before enqueue.
}
fn read_candidate(candidate: &Candidate, root: &Path) -> Result<Vec<u8>, String> {
    let before = describe(&candidate.path, root)?.ok_or("Plik nie spełnia ograniczeń audio do 64 MB.")?;
    if before.public.key != candidate.public.key { return Err("Plik zmienił się przed odczytem; zaczekaj na zakończenie zapisu.".into()); }
    // Windows rejects files still held by writers. The handle remains exclusive
    // until the complete bounded copy and metadata recheck are finished.
    let mut file = open_audio(&candidate.path, root)?;
    let mut bytes = Vec::with_capacity(candidate.public.size as usize);
    (&mut file).take(MAX_BYTES + 1).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    let metadata = file.metadata().map_err(|e| e.to_string())?;
    let modified_ns = metadata.modified().map_err(|e| e.to_string())?.duration_since(UNIX_EPOCH).map_err(|e| e.to_string())?.as_nanos().to_string();
    if bytes.len() as u64 != candidate.public.size || fingerprint(&candidate.path, metadata.len(), &modified_ns)? != candidate.public.key {
        return Err("Plik zmienił się podczas odczytu; nie dodano go do kolejki.".into());
    }
    if !header_valid(&candidate.public.name, &bytes) { return Err("Nagłówek audio jest niekompletny albo niezgodny z rozszerzeniem.".into()); }
    Ok(bytes)
}
impl WatchFolder {
    pub fn shutdown(&self) { self.stop(); }
    fn snapshot(&self) -> WatchStatus { self.inner.lock().unwrap_or_else(|e| e.into_inner()).status.clone() }
    fn restore_selection(&self) {
        let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        if !inner.status.path.is_empty() { return; }
        let restored = database_path(false).ok().filter(|p| p.is_file()).and_then(|path| Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).ok())
            .and_then(|db| db.query_row("SELECT path,recipe FROM config WHERE id=1", [], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))).ok());
        if let Some((path, recipe)) = restored { inner.status.path = path; inner.status.recipe_id = recipe; }
    }
    fn start(&self, path: String, recipe: String) -> Result<WatchStatus, String> {
        if recipe.is_empty() || recipe.len() > 100 || !recipe.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') { return Err("Wybierz zapisaną recepturę audio.".into()); }
        let root = selected_root(&path)?;
        let connection = database()?;
        let mut query = connection.prepare("SELECT fingerprint FROM receipts LIMIT 100001").map_err(|e| e.to_string())?;
        let receipts = query.query_map([], |row| row.get::<_, String>(0)).map_err(|e| e.to_string())?.collect::<Result<HashSet<_>, _>>().map_err(|e| e.to_string())?;
        if receipts.len() >= MAX_RECEIPTS { return Err("Osiągnięto limit 100 000 potwierdzeń folderu. Obserwacja pozostaje wyłączona.".into()); }
        let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        if inner.status.enabled { return Err("Obserwacja już trwa. Najpierw ją zatrzymaj.".into()); }
        connection.execute("INSERT INTO config(id,path,recipe) VALUES(1,?1,?2) ON CONFLICT(id) DO UPDATE SET path=excluded.path,recipe=excluded.recipe", params![path, recipe]).map_err(|e| e.to_string())?;
        inner.generation += 1; let generation = inner.generation;
        inner.samples.clear(); inner.pending.clear(); inner.root = Some(root); inner.receipts = receipts;
        inner.status = WatchStatus { enabled: true, state: "watching".into(), path, recipe_id: recipe, acknowledged: inner.receipts.len(),
            message: "Obserwacja włączona. Pliki czekają co najmniej 3 s na ustabilizowanie; oryginały pozostają w folderze.".into(), ..Default::default() };
        drop(inner);
        let owned = self.clone();
        thread::spawn(move || loop {
            { let state = owned.inner.lock().unwrap_or_else(|e| e.into_inner()); if !state.status.enabled || state.generation != generation { break; } }
            if let Err(error) = owned.scan(generation) {
                let mut state = owned.inner.lock().unwrap_or_else(|e| e.into_inner());
                if state.generation == generation { state.status.enabled = false; state.status.state = "error".into(); state.status.message = format!("Obserwacja zatrzymana: {error}"); state.pending.clear(); state.status.pending.clear(); }
                break;
            }
            thread::sleep(Duration::from_millis(500));
        });
        Ok(self.snapshot())
    }
    fn stop(&self) -> WatchStatus {
        let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        inner.generation += 1; inner.status.enabled = false; inner.status.state = "off".into();
        inner.pending.clear(); inner.samples.clear(); inner.status.pending.clear();
        inner.status.message = "Obserwacja wyłączona. Zadania już dodane do kolejki zachowują własny stan; oryginały są bez zmian.".into();
        inner.status.clone()
    }
    fn scan(&self, generation: u64) -> Result<(), String> {
        let root = { let inner = self.inner.lock().unwrap_or_else(|e| e.into_inner()); inner.root.clone().ok_or("Brak folderu")? };
        no_links(&root)?;
        let mut discovered = Vec::new(); let mut skipped = 0;
        for (index, entry) in fs::read_dir(&root).map_err(|e| e.to_string())?.enumerate() {
            if index >= MAX_ENTRIES { return Err("Folder przekracza limit 2000 wpisów. Wybierz mniejszy folder wejściowy.".into()); }
            let entry = entry.map_err(|e| e.to_string())?;
            // No recursion: directories, links and unsupported files never run.
            match describe(&entry.path(), &root) { Ok(Some(value)) => discovered.push(value), Ok(None) | Err(_) => skipped += 1 }
        }
        let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        if !inner.status.enabled || generation != inner.generation { return Ok(()); }
        let existing: HashSet<_> = discovered.iter().map(|item| item.path.clone()).collect();
        let valid_keys: HashSet<_> = discovered.iter().map(|item| item.public.key.clone()).collect();
        inner.samples.retain(|path, _| existing.contains(path));
        inner.pending.retain(|key, _| valid_keys.contains(key));
        for item in discovered {
            if inner.receipts.contains(&item.public.key) { continue; }
            let sample = inner.samples.entry(item.path.clone()).or_insert_with(|| Sample { key: item.public.key.clone(), since: Instant::now() });
            if sample.key != item.public.key { *sample = Sample { key: item.public.key.clone(), since: Instant::now() }; }
            if sample.since.elapsed() >= QUIET && inner.pending.len() < 20 && can_queue(&item, &root) { inner.pending.insert(item.public.key.clone(), item); }
        }
        let mut pending: Vec<_> = inner.pending.values().map(|item| item.public.clone()).collect();
        pending.sort_by(|a, b| a.name.cmp(&b.name)); inner.status.pending = pending;
        inner.status.skipped = skipped; inner.status.last_scan = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64;
        Ok(())
    }
    fn read(&self, key: &str) -> Result<Vec<u8>, String> {
        let (candidate, root) = { let inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
            if !inner.status.enabled { return Err("Obserwacja jest wyłączona.".into()); }
            (inner.pending.get(key).cloned().ok_or("Plik nie oczekuje na odczyt.")?, inner.root.clone().ok_or("Brak folderu")?) };
        read_candidate(&candidate, &root)
    }
    fn acknowledge(&self, key: String, run_id: String) -> Result<WatchStatus, String> {
        if key.len() != 64 || !key.bytes().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()) || run_id != format!("watch-{key}") { return Err("Nieprawidłowe potwierdzenie kolejki.".into()); }
        let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        if !inner.status.enabled || !inner.pending.contains_key(&key) { return Err("Plik nie oczekuje na potwierdzenie w aktywnym źródle.".into()); }
        if inner.receipts.len() >= MAX_RECEIPTS { return Err("Osiągnięto limit potwierdzeń; zatrzymaj obserwację.".into()); }
        database()?.execute("INSERT OR IGNORE INTO receipts(fingerprint,run_id,accepted_ms) VALUES(?1,?2,?3)", params![key, run_id, SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as i64]).map_err(|e| e.to_string())?;
        inner.receipts.insert(key.clone()); inner.pending.remove(&key); inner.status.pending.retain(|item| item.key != key);
        inner.status.acknowledged = inner.receipts.len(); inner.status.message = "Zapisano wejście i potwierdzenie w lokalnej kolejce. Obserwacja trwa; oryginał jest bez zmian.".into();
        Ok(inner.status.clone())
    }
}

#[tauri::command]
pub fn watch_folder_status(state: tauri::State<'_, WatchFolder>) -> WatchStatus { state.restore_selection(); state.snapshot() }
#[tauri::command]
pub async fn watch_folder_start(state: tauri::State<'_, WatchFolder>, path: String, recipe_id: String) -> Result<WatchStatus, String> {
    let owned = state.inner().clone(); tauri::async_runtime::spawn_blocking(move || owned.start(path, recipe_id)).await.map_err(|e| e.to_string())?
}
#[tauri::command]
pub fn watch_folder_stop(state: tauri::State<'_, WatchFolder>) -> WatchStatus { state.stop() }
#[tauri::command]
pub async fn watch_folder_read(state: tauri::State<'_, WatchFolder>, key: String) -> Result<tauri::ipc::Response, String> {
    let owned = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || owned.read(&key).map(tauri::ipc::Response::new)).await.map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn watch_folder_acknowledge(state: tauri::State<'_, WatchFolder>, key: String, run_id: String) -> Result<WatchStatus, String> {
    let owned = state.inner().clone(); tauri::async_runtime::spawn_blocking(move || owned.acknowledge(key, run_id)).await.map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn watch_folder_pick() -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(pick_folder).await.map_err(|e| e.to_string())?
}
#[cfg(windows)]
fn pick_folder() -> Result<Option<String>, String> {
    // An owned STA thread uses the system folder dialog directly. No shell,
    // helper executable, new crate or process can outlive the application.
    thread::spawn(|| unsafe {
        use std::{ffi::c_void, ptr::{null, null_mut}};
        #[repr(C)] struct BrowseInfo {
            owner: *mut c_void, root: *const c_void, display: *mut u16, title: *const u16,
            flags: u32, callback: Option<unsafe extern "system" fn(*mut c_void, u32, isize, isize) -> i32>, parameter: isize, image: i32,
        }
        #[link(name = "shell32")]
        extern "system" {
            fn SHBrowseForFolderW(info: *const BrowseInfo) -> *mut c_void;
            fn SHGetPathFromIDListEx(list: *const c_void, path: *mut u16, length: u32, flags: u32) -> i32;
        }
        #[link(name = "ole32")]
        extern "system" {
            fn CoInitializeEx(reserved: *mut c_void, flags: u32) -> i32;
            fn CoUninitialize();
            fn CoTaskMemFree(pointer: *mut c_void);
        }
        if CoInitializeEx(null_mut(), 6) < 0 { return Err("Nie przygotowano systemowego wyboru folderu. Wpisz pełną ścieżkę ręcznie.".into()); }
        struct Apartment;
        impl Drop for Apartment { fn drop(&mut self) { unsafe { CoUninitialize(); } } }
        let _apartment = Apartment;
        let title: Vec<u16> = "Wybierz lokalny folder nagrań do automatyzacji\0".encode_utf16().collect();
        let mut display = [0u16; 260];
        let info = BrowseInfo { owner: null_mut(), root: null(), display: display.as_mut_ptr(), title: title.as_ptr(), flags: 0x41, callback: None, parameter: 0, image: 0 };
        let list = SHBrowseForFolderW(&info);
        if list.is_null() { return Ok(None); }
        let mut path = vec![0u16; 32768];
        let success = SHGetPathFromIDListEx(list, path.as_mut_ptr(), path.len() as u32, 0);
        CoTaskMemFree(list);
        if success == 0 { return Err("Wybierz folder systemu plików na lokalnym dysku.".into()); }
        let end = path.iter().position(|value| *value == 0).ok_or("Nieprawidłowa ścieżka systemowa")?;
        Ok(Some(String::from_utf16(&path[..end]).map_err(|e| e.to_string())?))
    }).join().map_err(|_| "Systemowy wybór folderu został przerwany.".to_owned())?
}
#[cfg(not(windows))]
fn pick_folder() -> Result<Option<String>, String> { Err("Systemowy wybór folderu jest dostępny na Windows. Wpisz pełną ścieżkę lokalną.".into()) }

#[cfg(test)]
mod tests {
    use super::*;
    fn wav() -> Vec<u8> {
        let mut bytes = vec![0u8; 48]; bytes[..4].copy_from_slice(b"RIFF"); bytes[4..8].copy_from_slice(&40u32.to_le_bytes()); bytes[8..12].copy_from_slice(b"WAVE");
        bytes[12..16].copy_from_slice(b"fmt "); bytes[16..20].copy_from_slice(&16u32.to_le_bytes()); bytes[36..40].copy_from_slice(b"data"); bytes[40..44].copy_from_slice(&4u32.to_le_bytes()); bytes
    }
    #[test] fn audio_header_rejects_truncation_and_disguised_executable() {
        assert!(header_valid("probe.wav", &wav()));
        assert!(!header_valid("probe.wav", &wav()[..46]));
        assert!(!header_valid("probe.mp3", &[b'M', b'Z', 0, 0]));
        assert!(!header_valid("probe.wav.exe", &wav()));
    }
    #[test] fn dedup_fingerprint_changes_only_with_path_size_or_mtime() {
        let path = Path::new("fixture.wav");
        assert_eq!(fingerprint(path, 48, "1").unwrap(), fingerprint(path, 48, "1").unwrap());
        assert_ne!(fingerprint(path, 48, "1").unwrap(), fingerprint(path, 49, "1").unwrap());
        assert_ne!(fingerprint(path, 48, "1").unwrap(), fingerprint(path, 48, "2").unwrap());
        assert_ne!(fingerprint(path, 48, "1").unwrap(), fingerprint(Path::new("other.wav"), 48, "1").unwrap());
    }
    #[test] fn default_and_stop_never_enable_a_source() {
        let source = WatchFolder::default(); assert!(!source.snapshot().enabled);
        assert!(!source.stop().enabled); assert!(source.snapshot().pending.is_empty());
    }
    #[test] fn relative_parent_and_device_paths_are_rejected() {
        assert!(selected_root("relative").is_err()); assert!(selected_root("../outside").is_err());
        #[cfg(windows)] { assert!(selected_root(r"\\server\share").is_err()); assert!(selected_root(r"\\.\C:").is_err()); }
    }
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
            let base = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.tmp/watch-folder-tests");
            fs::create_dir_all(&base).unwrap();
            let root = base.join(format!("{}-{}", SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos(), NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)));
            fs::create_dir(&root).unwrap(); Self(root.canonicalize().unwrap())
        }
        fn source(&self) -> WatchFolder {
            let source = WatchFolder::default();
            { let mut inner = source.inner.lock().unwrap(); inner.root = Some(self.0.clone()); inner.generation = 1; inner.status.enabled = true; }
            source
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let base = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.tmp/watch-folder-tests").canonicalize().unwrap();
            assert!(self.0.starts_with(base)); fs::remove_dir_all(&self.0).unwrap();
        }
    }
    #[test] fn native_scan_waits_for_stability_and_resets_changed_versions() {
        use std::io::Write;
        let fixture = Fixture::new(); let path = fixture.0.join("probe.wav"); fs::write(&path, wav()).unwrap();
        fs::write(fixture.0.join("do-not-run.exe"), b"MZ fixture, never executable").unwrap();
        let source = fixture.source(); source.scan(1).unwrap(); assert!(source.snapshot().pending.is_empty());
        for sample in source.inner.lock().unwrap().samples.values_mut() { sample.since = Instant::now() - QUIET; }
        source.scan(1).unwrap(); assert_eq!(source.snapshot().pending.len(), 1); let first = source.snapshot().pending[0].key.clone();
        assert_eq!(source.read(&first).unwrap(), wav());
        OpenOptions::new().append(true).open(&path).unwrap().write_all(&[0]).unwrap();
        source.scan(1).unwrap(); assert!(source.snapshot().pending.is_empty()); assert!(source.read(&first).is_err());
        for sample in source.inner.lock().unwrap().samples.values_mut() { sample.since = Instant::now() - QUIET; }
        source.scan(1).unwrap(); assert_eq!(source.snapshot().pending.len(), 1); assert_ne!(source.snapshot().pending[0].key, first);
        assert_eq!(fs::read(path).unwrap().len(), 49); source.shutdown(); assert!(source.snapshot().pending.is_empty());
    }
    #[test] fn native_scan_keeps_truncated_wav_out_and_never_recurses() {
        let fixture = Fixture::new(); let bytes = wav();
        fs::write(fixture.0.join("partial.wav"), &bytes[..46]).unwrap();
        fs::create_dir(fixture.0.join("child")).unwrap(); fs::write(fixture.0.join("child/nested.wav"), &bytes).unwrap();
        let source = fixture.source(); source.scan(1).unwrap();
        for sample in source.inner.lock().unwrap().samples.values_mut() { sample.since = Instant::now() - QUIET; }
        source.scan(1).unwrap(); assert!(source.snapshot().pending.is_empty());
        assert_eq!(fs::read(fixture.0.join("partial.wav")).unwrap(), &bytes[..46]);
    }
    #[cfg(windows)]
    #[test] fn native_reader_waits_until_the_writer_handle_is_closed() {
        use std::io::Write;
        let fixture = Fixture::new(); let path = fixture.0.join("probe.wav");
        let mut writer = File::create(&path).unwrap(); writer.write_all(&wav()).unwrap(); writer.flush().unwrap();
        let candidate = describe(&path, &fixture.0).unwrap().unwrap();
        assert!(!can_queue(&candidate, &fixture.0)); assert!(read_candidate(&candidate, &fixture.0).is_err());
        drop(writer);
        let closed = describe(&path, &fixture.0).unwrap().unwrap();
        assert!(can_queue(&closed, &fixture.0)); assert_eq!(read_candidate(&closed, &fixture.0).unwrap(), wav());
    }
}
