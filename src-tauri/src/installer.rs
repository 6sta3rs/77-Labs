//! Explicit clean-machine runtime installation. Never edits the legacy runtime.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
    path::{Component, Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{atomic::{AtomicBool, Ordering}, Arc, Mutex},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

const ENGINE: &[u8] = include_bytes!("../../scripts/runtime/vendor/engine.zip");
const BOOTSTRAP: &str = include_str!("../../scripts/runtime/install/bootstrap.py");
const WINDOWS_RUNTIME_PATHS: &str = include_str!("../../scripts/runtime/install/windows_runtime_paths.py");
const PROVENANCE: &str = include_str!("../../scripts/runtime/vendor/bootstrap-provenance.json");
const OWNER: &str = "Seventy Seven Labs runtime installer v1";

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallerStatus {
    pub state: String,
    pub phase: String,
    pub message: String,
    pub profile: String,
    pub candidate: Option<String>,
    pub downloaded_bytes: u64,
    pub total_bytes: Option<u64>,
    pub logs: Vec<String>,
}

impl Default for InstallerStatus {
    fn default() -> Self {
        Self { state: "idle".into(), phase: "idle".into(), message: "Instalacja uruchamia się wyłącznie po wybraniu przycisku.".into(), profile: "cpu".into(), candidate: None, downloaded_bytes: 0, total_bytes: None, logs: vec![] }
    }
}

#[derive(Clone)]
pub struct Installer {
    status: Arc<Mutex<InstallerStatus>>,
    cancel: Arc<AtomicBool>,
}

fn base_dir() -> Result<PathBuf, String> {
    Ok(PathBuf::from(std::env::var_os("LOCALAPPDATA").ok_or("Brak LOCALAPPDATA")?).join("VoiceStudioNext"))
}

fn active(state: &str) -> bool { matches!(state, "running" | "cancelling") }

impl Default for Installer {
    fn default() -> Self {
        let mut status = base_dir().ok().and_then(|base| fs::read(base.join("installer-status.json")).ok()).and_then(|body| serde_json::from_slice::<InstallerStatus>(&body).ok()).unwrap_or_default();
        if active(&status.state) {
            status.state = "interrupted".into();
            status.message = "Instalacja została przerwana przy zamknięciu aplikacji. Ponów ją w nowym kandydacie; dotychczasowy runtime pozostaje zachowany.".into();
        }
        Self { status: Arc::new(Mutex::new(status)), cancel: Arc::new(AtomicBool::new(false)) }
    }
}

impl Installer {
    fn snapshot(&self) -> InstallerStatus { self.status.lock().unwrap_or_else(|e| e.into_inner()).clone() }
    fn update(&self, action: impl FnOnce(&mut InstallerStatus), persist: bool) {
        let mut status = self.status.lock().unwrap_or_else(|e| e.into_inner());
        action(&mut status);
        if persist {
            if let Ok(base) = base_dir() { let _ = atomic_json(&base.join("installer-status.json"), &*status); }
        }
    }
    fn phase(&self, phase: &str, message: &str) {
        self.update(|status| { status.phase = phase.into(); status.message = message.into(); status.downloaded_bytes = 0; status.total_bytes = None; }, true);
    }
    fn check_cancel(&self) -> Result<(), String> {
        if self.cancel.load(Ordering::SeqCst) { Err("Anulowano instalację. Istniejący runtime pozostaje zachowany.".into()) } else { Ok(()) }
    }
    pub fn cancel(&self) -> InstallerStatus {
        if !active(&self.snapshot().state) { return self.snapshot(); }
        self.update(|status| { if active(&status.state) { self.cancel.store(true, Ordering::SeqCst); status.state = "cancelling".into(); status.message = "Zatrzymywanie wyłącznie własnego pobierania i drzewa instalacji…".into(); } }, true);
        self.snapshot()
    }
    fn start(&self, profile: String) -> Result<InstallerStatus, String> {
        if !cfg!(all(windows, target_arch = "x86_64")) { return Err("Instalator obsługuje obecnie Windows x64.".into()); }
        if !matches!(profile.as_str(), "cpu" | "cuda") { return Err("Wybierz CPU albo NVIDIA CUDA.".into()); }
        let mut status = self.status.lock().unwrap_or_else(|e| e.into_inner());
        if active(&status.state) { return Err("Instalacja już trwa.".into()); }
        let id = format!("runtime_{:x}", SystemTime::now().duration_since(UNIX_EPOCH).map_err(|e| e.to_string())?.as_nanos());
        *status = InstallerStatus { state: "running".into(), phase: "preflight".into(), profile: profile.clone(), candidate: Some(id.clone()), message: "Sprawdzanie nowego katalogu instalacji…".into(), ..Default::default() };
        self.cancel.store(false, Ordering::SeqCst);
        drop(status);
        self.update(|_| {}, true);
        let installer = self.clone();
        thread::spawn(move || {
            let result = installer.install(&id, &profile);
            installer.update(|status| match result {
                Ok(()) => { status.state = "ready".into(); status.phase = "ready".into(); status.message = "Nowy runtime przeszedł doctor i /health. Zatrzymaj silnik i wybierz Użyj tego środowiska.".into(); },
                Err(error) => { status.state = if installer.cancel.load(Ordering::SeqCst) { "cancelled" } else { "failed" }.into(); status.message = error; },
            }, true);
        });
        Ok(self.snapshot())
    }
    fn install(&self, id: &str, profile: &str) -> Result<(), String> {
        let base = base_dir()?;
        fs::create_dir_all(&base).map_err(|e| e.to_string())?;
        no_links(&base)?;
        let root = candidate_path(&base, id)?;
        fs::create_dir(&root).map_err(|e| format!("Nie można utworzyć nowego kandydata: {e}"))?;
        atomic_json(&root.join(".installer-owner.json"), &serde_json::json!({"owner": OWNER, "id": id}))?;
        fs::create_dir(root.join("tools")).map_err(|e| e.to_string())?;
        fs::create_dir(root.join("downloads")).map_err(|e| e.to_string())?;
        fs::create_dir(root.join("tmp")).map_err(|e| e.to_string())?;
        fs::write(root.join("engine.zip"), ENGINE).map_err(|e| e.to_string())?;
        fs::write(root.join("bootstrap.py"), BOOTSTRAP).map_err(|e| e.to_string())?;
        fs::write(root.join("windows_runtime_paths.py"), WINDOWS_RUNTIME_PATHS).map_err(|e| e.to_string())?;
        fs::write(root.join("bootstrap-provenance.json"), PROVENANCE).map_err(|e| e.to_string())?;
        let manifest: serde_json::Value = serde_json::from_str(PROVENANCE).map_err(|e| e.to_string())?;
        self.check_cancel()?;
        self.phase("uv", "Pobieranie przypiętego uv z oficjalnego wydania Astral; poniżej rzeczywista liczba bajtów.");
        let archive = root.join("downloads/uv.zip");
        tauri::async_runtime::block_on(self.download(manifest["uv"]["url"].as_str().ok_or("Brak URL uv")?, manifest["uv"]["sha256"].as_str().ok_or("Brak SHA uv")?, &archive))?;
        self.check_cancel()?;
        extract_uv(&archive, &root.join("tools/uv.exe"))?;
        self.phase("python", "Pobieranie CPython 3.11.14 przez przypięty uv, z weryfikacją wbudowanego SHA-256; bez instalacji globalnej.");
        let mut command = clean_command(&root.join("tools/uv.exe"), &root)?;
        command.args(["python", "install", "cpython-3.11.14-windows-x86_64-none", "--no-bin", "--no-config", "--no-progress", "--install-dir"]).arg(root.join("python"));
        self.run_owned(command, &root)?;
        self.check_cancel()?;
        let python = root.join("python/cpython-3.11.14-windows-x86_64-none/python.exe");
        if !python.is_file() { return Err("uv nie utworzył przypiętego interpretera CPython.".into()); }
        self.phase("engine", "Przygotowanie prywatnego silnika i zależności z uv.lock.");
        let mut command = clean_command(&python, &root)?;
        command.arg("-u").arg(root.join("bootstrap.py")).arg("--root").arg(&root).arg("--profile").arg(profile).env("SEVENTY_SEVEN_INSTALLER_OWNED", "1");
        self.run_owned(command, &root)?;
        self.check_cancel()?;
        validate_ready(&root)?;
        Ok(())
    }
    async fn download(&self, url: &str, expected: &str, path: &Path) -> Result<(), String> {
        use tauri_plugin_http::reqwest;
        let client = reqwest::Client::builder().user_agent("SeventySevenLabs/0.2 runtime-installer")
            .connect_timeout(Duration::from_secs(15)).read_timeout(Duration::from_secs(5)).timeout(Duration::from_secs(600))
            .redirect(reqwest::redirect::Policy::custom(|attempt| if attempt.url().scheme() == "https" { attempt.follow() } else { attempt.error("Wymagane HTTPS") }))
            .build().map_err(|e| e.to_string())?;
        let mut response = client.get(url).send().await.map_err(|e| format!("Pobieranie uv: {e}"))?.error_for_status().map_err(|e| e.to_string())?;
        let total = response.content_length();
        let mut output = OpenOptions::new().write(true).create_new(true).open(path).map_err(|e| e.to_string())?;
        let mut digest = Sha256::new();
        let mut received = 0;
        while let Some(chunk) = response.chunk().await.map_err(|e| format!("Pobieranie przerwano: {e}"))? {
            self.check_cancel()?;
            received += chunk.len() as u64;
            if received > 100 * 1024 * 1024 { return Err("Archiwum uv przekracza dozwolony rozmiar.".into()); }
            output.write_all(&chunk).map_err(|e| e.to_string())?;
            digest.update(&chunk);
            self.update(|status| { status.downloaded_bytes = received; status.total_bytes = total; }, false);
        }
        if format!("{:x}", digest.finalize()) != expected { return Err("SHA-256 pobranego uv jest niezgodne. Nie uruchomiono pliku.".into()); }
        Ok(())
    }
    fn run_owned(&self, mut command: Command, root: &Path) -> Result<(), String> {
        let path = root.join("installation.log");
        let log = OpenOptions::new().create(true).append(true).open(&path).map_err(|e| e.to_string())?;
        command.stdin(Stdio::piped()).stdout(log.try_clone().map_err(|e| e.to_string())?).stderr(log);
        let mut child = OwnedChild::spawn(command)?;
        let deadline = Instant::now() + Duration::from_secs(7200);
        loop {
            self.read_log(&path);
            if self.cancel.load(Ordering::SeqCst) {
                if let Err(error) = child.stop() { self.cancel.store(false, Ordering::SeqCst); return Err(error); }
                return self.check_cancel();
            }
            if Instant::now() > deadline { child.stop()?; return Err("Przekroczono 2 godziny etapu instalacji; własne procesy zatrzymano.".into()); }
            if let Some(code) = child.child.try_wait().map_err(|e| e.to_string())? {
                child.drain()?;
                self.read_log(&path);
                return if code.success() { Ok(()) } else { Err(format!("Etap {} zakończył się kodem {}. Sprawdź dziennik instalacji.", self.snapshot().phase, code)) };
            }
            thread::sleep(Duration::from_millis(150));
        }
    }
    fn read_log(&self, path: &Path) {
        let Ok(mut file) = File::open(path) else { return; };
        let size = file.metadata().map(|m| m.len()).unwrap_or(0);
        let _ = file.seek(SeekFrom::Start(size.saturating_sub(24_000)));
        let mut bytes = vec![];
        if file.read_to_end(&mut bytes).is_err() { return; }
        let content = String::from_utf8_lossy(&bytes);
        let lines: Vec<String> = content.lines().rev().take(60).map(|line| line.chars().take(500).collect()).collect::<Vec<_>>().into_iter().rev().collect();
        self.update(|status| {
            for line in &lines {
                if let Some(body) = line.strip_prefix("NEXT_BOOTSTRAP_EVENT ") {
                    if let Ok(event) = serde_json::from_str::<serde_json::Value>(body) {
                        if let Some(phase) = event["phase"].as_str() { status.phase = phase.into(); }
                        if let Some(message) = event["message"].as_str() { status.message = message.into(); }
                    }
                }
            }
            status.logs = lines;
        }, false);
    }
}

fn clean_command(program: &Path, root: &Path) -> Result<Command, String> {
    let mut command = Command::new(program);
    command.env_clear().current_dir(root);
    for key in ["SYSTEMROOT", "WINDIR", "TEMP", "TMP", "LOCALAPPDATA", "APPDATA", "USERPROFILE", "COMSPEC", "NUMBER_OF_PROCESSORS"] {
        if let Some(value) = std::env::var_os(key) { command.env(key, value); }
    }
    let windows = std::env::var_os("SYSTEMROOT").ok_or("Brak katalogu Windows")?;
    command.env("PATH", format!("{};{}", PathBuf::from(&windows).join("System32").display(), PathBuf::from(windows).display()));
    command.env("UV_NO_CONFIG", "1").env("UV_LINK_MODE", "copy").env("UV_CACHE_DIR", root.join("wheel-cache")).env("UV_PYTHON_INSTALL_DIR", root.join("python")).env("UV_PYTHON_BIN_DIR", root.join("bin")).env("UV_NATIVE_TLS", "true");
    command.env("TEMP", root.join("tmp")).env("TMP", root.join("tmp")).env("TORCH_HOME", root.join("doctor-models/torch")).env("MPLCONFIGDIR", root.join("doctor-cache/matplotlib")).env("NUMBA_CACHE_DIR", root.join("doctor-cache/numba")).env("XDG_CACHE_HOME", root.join("doctor-cache"));
    command.env("HF_HUB_OFFLINE", "1").env("TRANSFORMERS_OFFLINE", "1").env("PYTHONUTF8", "1").env("PYTHONIOENCODING", "utf-8").env("PYTHONDONTWRITEBYTECODE", "1");
    Ok(command)
}

fn atomic_json(path: &Path, value: &impl Serialize) -> Result<(), String> {
    let temporary = path.with_extension("tmp");
    fs::write(&temporary, serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    fs::rename(temporary, path).map_err(|e| e.to_string())
}

fn safe_id(id: &str) -> bool { id.strip_prefix("runtime_").is_some_and(|tail| !tail.is_empty() && tail.len() <= 32 && tail.bytes().all(|b| b.is_ascii_hexdigit())) }

fn candidate_path(base: &Path, id: &str) -> Result<PathBuf, String> {
    if !safe_id(id) { return Err("Nieprawidłowy identyfikator kandydata runtime.".into()); }
    no_links(base)?;
    let root = base.join(id);
    no_links(&root)?;
    Ok(root)
}

pub(crate) fn no_links(path: &Path) -> Result<(), String> {
    for current in path.ancestors() {
        if let Ok(metadata) = fs::symlink_metadata(current) {
            #[cfg(windows)]
            { use std::os::windows::fs::MetadataExt; if metadata.file_attributes() & 0x400 != 0 { return Err("Katalog runtime zawiera junction lub dowiązanie.".into()); } }
            if metadata.file_type().is_symlink() { return Err("Katalog runtime zawiera dowiązanie.".into()); }
        }
    }
    Ok(())
}

fn extract_uv(archive: &Path, destination: &Path) -> Result<(), String> {
    let mut zip = zip::ZipArchive::new(File::open(archive).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let mut found = false;
    for index in 0..zip.len() {
        let mut entry = zip.by_index(index).map_err(|e| e.to_string())?;
        let enclosed = entry.enclosed_name().ok_or("Archiwum uv zawiera niebezpieczną ścieżkę")?;
        if enclosed.components().any(|component| !matches!(component, Component::Normal(_))) || entry.unix_mode().is_some_and(|mode| mode & 0o170000 == 0o120000) { return Err("Archiwum uv zawiera dowiązanie lub niebezpieczną ścieżkę.".into()); }
        if enclosed.file_name().is_some_and(|name| name == "uv.exe") {
            if found || entry.size() > 256 * 1024 * 1024 { return Err("Nieprawidłowy plik uv.exe w archiwum.".into()); }
            let mut output = OpenOptions::new().create_new(true).write(true).open(destination).map_err(|e| e.to_string())?;
            std::io::copy(&mut entry, &mut output).map_err(|e| e.to_string())?;
            found = true;
        }
    }
    if found { Ok(()) } else { Err("Archiwum nie zawiera uv.exe.".into()) }
}

fn validate_ready(root: &Path) -> Result<(), String> {
    let manifest: serde_json::Value = serde_json::from_str(PROVENANCE)
        .map_err(|_| "Osadzony manifest dystrybucji jest nieprawidłowy.".to_string())?;
    validate_ready_against(root, &manifest)
}

fn validate_ready_against(root: &Path, current: &serde_json::Value) -> Result<(), String> {
    no_links(root)?;
    let read_evidence = |name: &str, message: &str| -> Result<serde_json::Value, String> {
        let path = root.join(name);
        no_links(&path)?;
        serde_json::from_slice(&fs::read(&path).map_err(|_| message.to_string())?)
            .map_err(|_| message.to_string())
    };
    let marker = read_evidence(".installer-owner.json", "Brak prawidłowego znacznika własności instalacji.")?;
    if marker["owner"] != OWNER || marker["id"].as_str() != root.file_name().and_then(|name| name.to_str()) {
        return Err("Kandydat nie ma prawidłowego znacznika własności instalacji.".into());
    }
    let certificate_error = "Brak lub uszkodzony certyfikat instalacji. Zachowano środowisko bez zmian. Przygotuj nowego kandydata w instalatorze.";
    let certificate = read_evidence("bootstrap-provenance.json", certificate_error)?;
    let doctor_error = "Kandydat nie ma pełnego wyniku doctor i /health bez załadowanych modeli. Przygotuj nowego kandydata w instalatorze.";
    let ready = read_evidence("installation-ready.json", doctor_error)?;
    let python_ready = read_evidence("python-ready.json", doctor_error)?;
    let python = root.join(".venv/Scripts/python.exe");
    no_links(&python)?;
    let python_marker_matches = python_ready["python"].as_str().and_then(|path| fs::canonicalize(path).ok())
        .zip(fs::canonicalize(&python).ok()).is_some_and(|(marked, actual)| marked == actual);
    let cpu = ready["profile"] == "cpu";
    let cuda = ready["profile"] == "cuda";
    let profile_matches = if cpu {
        ready.get("cuda").is_some_and(serde_json::Value::is_null)
            && ready["cuda_available"] == false
            && certificate["cpuWheels"]["torch"]["version"].as_str()
                .is_some_and(|version| ready["torch"].as_str() == Some(version))
    } else {
        cuda && ready["cuda"] == "12.8" && ready["cuda_available"] == true
    };
    if ready["health"]["owned"] != true || ready["health"]["isolatedData"] != true
        || ready["health"]["status"] != 200 || ready["health"]["modelsLoaded"] != false
        || ready["imports"] != "passed" || ready["synthesize_tested"] != false
        || ready["mcp_sdk"] != "passed" || ready["pywin32"] != "passed"
        || python_ready["independent"] != true || !python_marker_matches || !profile_matches
        || !ready["python"].as_str().is_some_and(|version| version.starts_with("3.11.")) {
        return Err(doctor_error.into());
    }
    let valid_digest = |value: &serde_json::Value| value.as_str().is_some_and(|text| text.len() == 64 && text.bytes().all(|byte| byte.is_ascii_hexdigit()));
    let integrity_error = "Certyfikat instalacji nie odpowiada wynikom doctor lub zapisanym źródłom. Zachowano środowisko bez zmian. Przygotuj nowego kandydata.";
    if !valid_digest(&ready["lock_sha256"]) || !valid_digest(&ready["source_archive_sha256"])
        || ready["lock_sha256"] != certificate["engine"]["lockSha256"]
        || ready["source_archive_sha256"] != certificate["engine"]["archiveSha256"] {
        return Err(integrity_error.into());
    }
    // Compare the retained archive/metadata with the installation's OWN
    // certificate first. A valid older generation has a compatibility error,
    // not an invented doctor failure. Never edit it in place during an update.
    for (relative, key) in [("engine.zip", "archiveSha256"), ("engine/uv.lock", "lockSha256"), ("engine/pyproject.toml", "pyprojectSha256")] {
        let path = root.join(relative);
        no_links(&path)?;
        if !valid_digest(&certificate["engine"][key])
            || format!("{:x}", Sha256::digest(fs::read(path).map_err(|_| integrity_error.to_string())?)) != certificate["engine"][key] {
            return Err(integrity_error.into());
        }
    }
    if certificate["engine"] != current["engine"] {
        return Err("Wybrane środowisko przygotowano dla innej wersji aplikacji. Zachowano je bez zmian. Pobierz i aktywuj nowe środowisko w instalatorze.".into());
    }
    if certificate != *current {
        return Err("Certyfikat instalacji nie odpowiada bieżącej dystrybucji aplikacji. Zachowano środowisko bez zmian. Przygotuj i aktywuj nowego kandydata.".into());
    }
    Ok(())
}

pub fn selected_runtime_root(base: &Path) -> Result<Option<PathBuf>, String> {
    let pointer = base.join("active-runtime.json");
    if !pointer.exists() { return Ok(None); }
    let value: serde_json::Value = serde_json::from_slice(&fs::read(pointer).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let root = candidate_path(base, value["id"].as_str().ok_or("Brak identyfikatora runtime")?)?;
    validate_ready(&root)?;
    Ok(Some(root))
}

#[tauri::command]
pub fn installer_status(installer: tauri::State<'_, Installer>) -> InstallerStatus { installer.snapshot() }
#[tauri::command]
pub fn installer_start(installer: tauri::State<'_, Installer>, profile: String) -> Result<InstallerStatus, String> { installer.start(profile) }
#[tauri::command]
pub fn installer_cancel(installer: tauri::State<'_, Installer>) -> InstallerStatus { installer.cancel() }
#[tauri::command]
pub fn installer_activate(installer: tauri::State<'_, Installer>, runtime: tauri::State<'_, crate::runtime::Runtime>) -> Result<InstallerStatus, String> {
    if runtime.status().state != "stopped" { return Err("Zatrzymaj silnik przed przełączeniem środowiska.".into()); }
    if std::env::var_os("VOICESTUDIO_NEXT_PYTHON").is_some() { return Err("Interpreter jest wymuszony przez VOICESTUDIO_NEXT_PYTHON. Usuń to nadpisanie przed aktywacją nowego środowiska.".into()); }
    let status = installer.snapshot();
    if status.state != "ready" { return Err("Kandydat nie jest gotowy do aktywacji.".into()); }
    let id = status.candidate.ok_or("Brak kandydata")?;
    let base = base_dir()?;
    let root = candidate_path(&base, &id)?;
    validate_ready(&root)?;
    // Preserve only the private cache pointer when upgrading. Model bytes,
    // database rows, and the old dependency environment are never copied or
    // modified. A clean machine simply has no pointer to preserve.
    let previous = selected_runtime_root(&base).ok().flatten().unwrap_or_else(|| base.join("runtime"));
    let previous_cache = previous.join("model-cache.json");
    if previous != root && previous_cache.is_file() && !root.join("model-cache.json").exists() {
        no_links(&previous_cache)?;
        let cache: serde_json::Value = serde_json::from_slice(&fs::read(previous_cache).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        if !cache["path"].as_str().is_some_and(|path| Path::new(path).is_absolute()) { return Err("Dotychczasowy wskaźnik katalogu modeli jest nieprawidłowy.".into()); }
        atomic_json(&root.join("model-cache.json"), &cache)?;
    }
    atomic_json(&base.join("active-runtime.json"), &serde_json::json!({"id": id, "schema": 1}))?;
    installer.update(|status| { status.state = "activated".into(); status.message = "Wybrano nowe środowisko. Uruchom silnik i pobierz wymagane modele.".into(); }, true);
    Ok(installer.snapshot())
}

struct OwnedChild { child: Child, #[cfg(windows)] job: windows_job::Job }
impl OwnedChild {
    fn spawn(mut command: Command) -> Result<Self, String> {
        #[cfg(windows)]
        {
            use std::os::windows::{io::AsRawHandle, process::CommandExt};
            command.creation_flags(0x08000000 | 0x00000004);
            let job = windows_job::Job::new()?;
            let mut child = command.spawn().map_err(|e| e.to_string())?;
            if let Err(error) = job.assign_and_resume(child.as_raw_handle(), child.id()) { let _ = child.kill(); let _ = child.wait(); return Err(error); }
            Ok(Self { child, job })
        }
        #[cfg(not(windows))]
        { let _ = command; Err("Natywny instalator wymaga Windows.".into()) }
    }
    fn drain(&mut self) -> Result<(), String> {
        #[cfg(windows)] { self.job.terminate_and_wait()?; }
        Ok(())
    }
    fn stop(&mut self) -> Result<(), String> {
        drop(self.child.stdin.take());
        let deadline = Instant::now() + Duration::from_secs(2);
        while self.child.try_wait().map_err(|e| e.to_string())?.is_none() && Instant::now() < deadline { thread::sleep(Duration::from_millis(50)); }
        self.drain()?;
        self.child.wait().map_err(|e| e.to_string())?;
        Ok(())
    }
}

#[cfg(windows)]
mod windows_job {
    use super::*;
    use std::{ffi::c_void, mem::{size_of, zeroed}, ptr::{null, null_mut}};
    type Handle = *mut c_void;
    #[repr(C)] struct Limits { user: i64, kernel: i64, flags: u32, min: usize, max: usize, active: u32, affinity: usize, priority: u32, scheduling: u32 }
    #[repr(C)] struct Extended { limits: Limits, io: [u64; 6], process_memory: usize, job_memory: usize, peak_process: usize, peak_job: usize }
    #[repr(C)] struct Accounting { times: [i64; 4], faults: u32, total: u32, active: u32, terminated: u32 }
    #[repr(C)] struct ThreadEntry { size: u32, usage: u32, id: u32, owner: u32, base: i32, delta: i32, flags: u32 }
    #[link(name = "kernel32")]
    extern "system" {
        fn CreateJobObjectW(attributes: *const c_void, name: *const u16) -> Handle;
        fn SetInformationJobObject(job: Handle, class: i32, info: *const c_void, size: u32) -> i32;
        fn QueryInformationJobObject(job: Handle, class: i32, info: *mut c_void, size: u32, length: *mut u32) -> i32;
        fn AssignProcessToJobObject(job: Handle, process: Handle) -> i32;
        fn TerminateJobObject(job: Handle, code: u32) -> i32;
        fn CloseHandle(handle: Handle) -> i32;
        fn CreateToolhelp32Snapshot(flags: u32, pid: u32) -> Handle;
        fn Thread32First(snapshot: Handle, entry: *mut ThreadEntry) -> i32;
        fn Thread32Next(snapshot: Handle, entry: *mut ThreadEntry) -> i32;
        fn OpenThread(access: u32, inherit: i32, id: u32) -> Handle;
        fn ResumeThread(thread: Handle) -> u32;
    }
    pub struct Job(Handle);
    impl Job {
        pub fn new() -> Result<Self, String> {
            unsafe {
                let handle = CreateJobObjectW(null(), null());
                if handle.is_null() { return Err(std::io::Error::last_os_error().to_string()); }
                let job = Self(handle);
                let mut limits: Extended = zeroed(); limits.limits.flags = 0x2000;
                if SetInformationJobObject(handle, 9, &limits as *const _ as *const c_void, size_of::<Extended>() as u32) == 0 { return Err(std::io::Error::last_os_error().to_string()); }
                Ok(job)
            }
        }
        pub fn assign_and_resume(&self, process: Handle, pid: u32) -> Result<(), String> {
            unsafe {
                if AssignProcessToJobObject(self.0, process) == 0 { return Err(std::io::Error::last_os_error().to_string()); }
                let snapshot = CreateToolhelp32Snapshot(4, 0);
                if snapshot as isize == -1 { return Err(std::io::Error::last_os_error().to_string()); }
                let mut entry: ThreadEntry = zeroed(); entry.size = size_of::<ThreadEntry>() as u32;
                let mut found = Thread32First(snapshot, &mut entry);
                let mut result = Err("Nie znaleziono wstrzymanego wątku instalatora.".to_string());
                while found != 0 {
                    if entry.owner == pid {
                        let thread = OpenThread(2, 0, entry.id);
                        if !thread.is_null() { result = if ResumeThread(thread) != u32::MAX { Ok(()) } else { Err(std::io::Error::last_os_error().to_string()) }; CloseHandle(thread); }
                        break;
                    }
                    found = Thread32Next(snapshot, &mut entry);
                }
                CloseHandle(snapshot);
                result
            }
        }
        pub fn terminate_and_wait(&self) -> Result<(), String> {
            unsafe {
                if TerminateJobObject(self.0, 1) == 0 { return Err(std::io::Error::last_os_error().to_string()); }
                let deadline = Instant::now() + Duration::from_secs(5);
                loop {
                    let mut info: Accounting = zeroed();
                    if QueryInformationJobObject(self.0, 1, &mut info as *mut _ as *mut c_void, size_of::<Accounting>() as u32, null_mut()) == 0 { return Err(std::io::Error::last_os_error().to_string()); }
                    if info.active == 0 { return Ok(()); }
                    if Instant::now() >= deadline { return Err("Nie potwierdzono zamknięcia prywatnego drzewa instalatora.".into()); }
                    thread::sleep(Duration::from_millis(30));
                }
            }
        }
        #[cfg(test)]
        pub fn active_processes(&self) -> Result<u32, String> {
            unsafe {
                let mut info: Accounting = zeroed();
                if QueryInformationJobObject(self.0, 1, &mut info as *mut _ as *mut c_void, size_of::<Accounting>() as u32, null_mut()) == 0 { return Err(std::io::Error::last_os_error().to_string()); }
                Ok(info.active)
            }
        }
    }
    impl Drop for Job { fn drop(&mut self) { unsafe { TerminateJobObject(self.0, 1); CloseHandle(self.0); } } }
}

#[cfg(test)]
mod tests {
    use super::*;
    struct ReadyFixture { base: PathBuf, root: PathBuf, manifest: serde_json::Value }
    impl ReadyFixture {
        fn new() -> Self {
            let id = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
            let base = std::env::temp_dir().join(format!("seventy-seven-ready-fixture-{id}"));
            let root = base.join(format!("runtime_{id:x}"));
            fs::create_dir_all(root.join(".venv/Scripts")).unwrap();
            fs::create_dir(root.join("engine")).unwrap();
            fs::write(root.join("engine.zip"), b"source archive fixture, never extracted or executed").unwrap();
            fs::write(root.join("engine/uv.lock"), b"fixture lockfile").unwrap();
            fs::write(root.join("engine/pyproject.toml"), b"[project]\nversion='fixture'\n").unwrap();
            fs::write(root.join(".venv/Scripts/python.exe"), b"fixture interpreter, never executable").unwrap();
            let mut manifest: serde_json::Value = serde_json::from_str(PROVENANCE).unwrap();
            for (name, key) in [("engine.zip", "archiveSha256"), ("engine/uv.lock", "lockSha256"), ("engine/pyproject.toml", "pyprojectSha256")] {
                manifest["engine"][key] = format!("{:x}", Sha256::digest(fs::read(root.join(name)).unwrap())).into();
            }
            atomic_json(&root.join(".installer-owner.json"), &serde_json::json!({"owner": OWNER, "id": root.file_name().unwrap().to_str().unwrap()})).unwrap();
            atomic_json(&root.join("bootstrap-provenance.json"), &manifest).unwrap();
            atomic_json(&root.join("python-ready.json"), &serde_json::json!({"independent": true, "python": root.join(".venv/Scripts/python.exe")})).unwrap();
            atomic_json(&root.join("installation-ready.json"), &serde_json::json!({
                "imports": "passed", "python": "3.11.14 (controlled fixture)", "torch": manifest["cpuWheels"]["torch"]["version"],
                "profile": "cpu", "cuda": null, "cuda_available": false, "synthesize_tested": false,
                "mcp_sdk": "passed", "pywin32": "passed",
                "health": {"owned": true, "isolatedData": true, "status": 200, "modelsLoaded": false},
                "lock_sha256": manifest["engine"]["lockSha256"], "source_archive_sha256": manifest["engine"]["archiveSha256"]
            })).unwrap();
            Self { base, root, manifest }
        }
    }
    impl Drop for ReadyFixture {
        fn drop(&mut self) {
            // Known fixture files only; no recursive deletion of computed paths.
            for name in [".installer-owner.json", "bootstrap-provenance.json", "python-ready.json", "installation-ready.json", "engine.zip", "engine/uv.lock", "engine/pyproject.toml", ".venv/Scripts/python.exe"] { let _ = fs::remove_file(self.root.join(name)); }
            for name in [".venv/Scripts", ".venv", "engine"] { let _ = fs::remove_dir(self.root.join(name)); }
            let _ = fs::remove_dir(&self.root); let _ = fs::remove_dir(&self.base);
        }
    }
    #[test] fn ready_candidate_binds_own_certificate_and_current_distribution() {
        let fixture = ReadyFixture::new();
        validate_ready_against(&fixture.root, &fixture.manifest).unwrap();
    }
    #[test] fn missing_or_invalid_installation_certificate_has_specific_error() {
        let fixture = ReadyFixture::new();
        fs::remove_file(fixture.root.join("bootstrap-provenance.json")).unwrap();
        assert!(validate_ready_against(&fixture.root, &fixture.manifest).unwrap_err().contains("certyfikat"));
        fs::write(fixture.root.join("bootstrap-provenance.json"), b"not JSON").unwrap();
        assert!(validate_ready_against(&fixture.root, &fixture.manifest).unwrap_err().contains("certyfikat"));
    }
    #[test] fn changed_installation_certificate_cannot_pass_same_engine_lock() {
        let fixture = ReadyFixture::new();
        let mut changed = fixture.manifest.clone(); changed["uv"]["version"] = "modified".into();
        atomic_json(&fixture.root.join("bootstrap-provenance.json"), &changed).unwrap();
        assert!(validate_ready_against(&fixture.root, &fixture.manifest).unwrap_err().contains("Certyfikat instalacji"));
    }
    #[test] fn older_valid_sources_get_compatibility_error_even_when_lock_is_unchanged() {
        let fixture = ReadyFixture::new();
        let before = fs::read(fixture.root.join("bootstrap-provenance.json")).unwrap();
        let mut updated_app = fixture.manifest.clone(); updated_app["engine"]["archiveSha256"] = "f".repeat(64).into();
        let error = validate_ready_against(&fixture.root, &updated_app).unwrap_err();
        assert!(error.contains("innej wersji aplikacji"));
        assert!(error.contains("Pobierz i aktywuj"));
        assert_eq!(fs::read(fixture.root.join("bootstrap-provenance.json")).unwrap(), before);
    }
    #[test] fn doctor_source_evidence_must_match_candidate_certificate() {
        let fixture = ReadyFixture::new();
        let mut ready: serde_json::Value = serde_json::from_slice(&fs::read(fixture.root.join("installation-ready.json")).unwrap()).unwrap();
        ready["source_archive_sha256"] = "e".repeat(64).into();
        atomic_json(&fixture.root.join("installation-ready.json"), &ready).unwrap();
        assert!(validate_ready_against(&fixture.root, &fixture.manifest).unwrap_err().contains("Certyfikat instalacji"));
    }
    #[test] fn changed_retained_sources_fail_integrity_not_version_comparison() {
        let fixture = ReadyFixture::new();
        fs::write(fixture.root.join("engine.zip"), b"altered archive").unwrap();
        assert!(validate_ready_against(&fixture.root, &fixture.manifest).unwrap_err().contains("zapisanym źródłom"));
    }
    #[test] fn candidate_owner_and_no_model_doctor_are_required() {
        let fixture = ReadyFixture::new();
        let mut ready: serde_json::Value = serde_json::from_slice(&fs::read(fixture.root.join("installation-ready.json")).unwrap()).unwrap();
        ready["health"]["modelsLoaded"] = true.into();
        atomic_json(&fixture.root.join("installation-ready.json"), &ready).unwrap();
        assert!(validate_ready_against(&fixture.root, &fixture.manifest).unwrap_err().contains("bez załadowanych modeli"));
        atomic_json(&fixture.root.join(".installer-owner.json"), &serde_json::json!({"owner": OWNER, "id": "runtime_other"})).unwrap();
        assert!(validate_ready_against(&fixture.root, &fixture.manifest).unwrap_err().contains("własności"));
    }
    #[test] fn ready_candidate_requires_mcp_sdk_and_pywin32_import_evidence() {
        let fixture = ReadyFixture::new();
        let original: serde_json::Value = serde_json::from_slice(&fs::read(fixture.root.join("installation-ready.json")).unwrap()).unwrap();
        for field in ["mcp_sdk", "pywin32"] {
            let mut missing = original.clone();
            missing.as_object_mut().unwrap().remove(field);
            atomic_json(&fixture.root.join("installation-ready.json"), &missing).unwrap();
            assert!(validate_ready_against(&fixture.root, &fixture.manifest).unwrap_err().contains("doctor"), "Missing evidence: {field}");
            let mut failed = original.clone(); failed[field] = "not-applicable".into();
            atomic_json(&fixture.root.join("installation-ready.json"), &failed).unwrap();
            assert!(validate_ready_against(&fixture.root, &fixture.manifest).unwrap_err().contains("doctor"), "Unpassed Windows evidence: {field}");
        }
    }
    #[test] fn candidate_identifiers_cannot_escape() {
        assert!(safe_id("runtime_abcdef0123"));
        for id in ["runtime", "runtime_", "runtime_../old", "../runtime_ab", "runtime_ab/other", "runtime_xyz"] { assert!(!safe_id(id)); }
    }
    #[test] fn embedded_provenance_matches_archive() {
        let manifest: serde_json::Value = serde_json::from_str(PROVENANCE).unwrap();
        assert_eq!(format!("{:x}", Sha256::digest(ENGINE)), manifest["engine"]["archiveSha256"]);
    }
    #[test] fn status_checks_do_not_start_installer() {
        let installer = Installer { status: Arc::new(Mutex::new(Default::default())), cancel: Arc::new(AtomicBool::new(false)) };
        assert_eq!(installer.snapshot().state, "idle");
        assert_eq!(installer.cancel().state, "idle");
    }
    #[test] fn uv_extraction_rejects_traversal_without_executing_anything() {
        let id = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let root = std::env::temp_dir().join(format!("seventy-seven-uv-fixture-{id}"));
        fs::create_dir(&root).unwrap();
        let archive = root.join("fixture.zip");
        let output = root.join("uv.exe");
        {
            let mut writer = zip::ZipWriter::new(File::create(&archive).unwrap());
            writer.start_file("uv.exe", zip::write::SimpleFileOptions::default()).unwrap();
            writer.write_all(b"controlled fixture, never executable").unwrap();
            writer.finish().unwrap();
        }
        extract_uv(&archive, &output).unwrap();
        assert_eq!(fs::read(&output).unwrap(), b"controlled fixture, never executable");
        fs::remove_file(&output).unwrap();
        {
            let mut writer = zip::ZipWriter::new(File::create(&archive).unwrap());
            writer.start_file("../uv.exe", zip::write::SimpleFileOptions::default()).unwrap();
            writer.write_all(b"forbidden").unwrap();
            writer.finish().unwrap();
        }
        assert!(extract_uv(&archive, &output).is_err());
        assert!(!output.exists());
        fs::remove_file(archive).unwrap();
        fs::remove_dir(root).unwrap();
    }
    #[cfg(windows)]
    #[test] fn native_owner_cancels_only_its_complete_process_tree() {
        let id = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let root = std::env::temp_dir().join(format!("seventy-seven-installer-test-{id}"));
        fs::create_dir(&root).unwrap();
        let script = root.join("fixture.ps1");
        let pids = root.join("helper-pid.txt");
        fs::write(&script, "param([string]$PidPath)\n$child=Start-Process -FilePath ($PSHOME+'\\powershell.exe') -ArgumentList '-NoProfile','-NonInteractive','-Command','Start-Sleep -Seconds 60' -WindowStyle Hidden -PassThru\n$child.Id | Set-Content -LiteralPath $PidPath\nStart-Sleep -Seconds 60\n").unwrap();
        let powershell = PathBuf::from(std::env::var_os("SYSTEMROOT").unwrap()).join("System32/WindowsPowerShell/v1.0/powershell.exe");
        let mut command = Command::new(&powershell);
        command.arg("-NoProfile").arg("-NonInteractive").args(["-ExecutionPolicy", "Bypass"]).arg("-File").arg(&script).arg(&pids).stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::null());
        let mut child = OwnedChild::spawn(command).unwrap();
        let mut other = Command::new(&powershell);
        other.args(["-NoProfile", "-NonInteractive", "-Command", "Start-Sleep -Seconds 60"]).stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::null());
        let mut unrelated = OwnedChild::spawn(other).unwrap();
        let deadline = Instant::now() + Duration::from_secs(8);
        while !pids.is_file() && Instant::now() < deadline { thread::sleep(Duration::from_millis(50)); }
        assert!(pids.is_file(), "Controlled PowerShell helper did not start");
        assert!(child.job.active_processes().unwrap() >= 2);
        let started = Instant::now();
        child.stop().unwrap();
        assert_eq!(child.job.active_processes().unwrap(), 0);
        assert!(child.child.try_wait().unwrap().is_some());
        assert!(started.elapsed() < Duration::from_secs(8));
        assert!(unrelated.child.try_wait().unwrap().is_none());
        unrelated.stop().unwrap();
        fs::remove_file(script).unwrap();
        fs::remove_file(pids).unwrap();
        fs::remove_dir(root).unwrap();
    }
}
