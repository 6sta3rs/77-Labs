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
    /// Set when the status is read: a runnable environment exists (the state above only describes the installer).
    #[serde(default)]
    pub environment_present: bool,
    /// Set when the status is read: the NVIDIA driver library is installed (CUDA cannot work without it).
    #[serde(default)]
    pub cuda_driver: bool,
}

impl Default for InstallerStatus {
    fn default() -> Self {
        Self { state: "idle".into(), phase: "idle".into(), message: "Instalacja uruchamia się wyłącznie po wybraniu przycisku.".into(), profile: "cpu".into(), candidate: None, downloaded_bytes: 0, total_bytes: None, logs: vec![], environment_present: false, cuda_driver: false }
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
        if profile == "cuda" && !cuda_driver_present() { return Err("Nie wykryto sterownika NVIDIA (brak nvcuda.dll). Wybierz wariant CPU albo zainstaluj sterownik.".into()); }
        let mut status = self.status.lock().unwrap_or_else(|e| e.into_inner());
        if active(&status.state) { return Err("Instalacja już trwa.".into()); }
        let id = format!("runtime_{:x}", SystemTime::now().duration_since(UNIX_EPOCH).map_err(|e| e.to_string())?.as_nanos());
        *status = InstallerStatus { state: "running".into(), phase: "preflight".into(), profile: profile.clone(), candidate: Some(id.clone()), message: "Sprawdzanie nowego katalogu instalacji…".into(), ..Default::default() };
        self.cancel.store(false, Ordering::SeqCst);
        drop(status);
        self.update(|_| {}, true);
        let installer = self.clone();
        thread::spawn(move || {
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| installer.install(&id, &profile)))
                .unwrap_or_else(|_| Err("Instalator zatrzymał się z nieoczekiwanym błędem. Szczegóły są w dzienniku instalacji.".into()));
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
            .redirect(reqwest::redirect::Policy::custom(|attempt| {
                if attempt.previous().len() >= 5 { attempt.error("Zbyt wiele przekierowań") }
                else if attempt.url().scheme() == "https" { attempt.follow() } else { attempt.error("Wymagane HTTPS") }
            }))
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
                let failure = self.read_log(&path);
                return if code.success() { Ok(()) } else {
                    let stage = self.snapshot().phase;
                    Err(match failure {
                        Some(reason) => format!("Etap {stage} nie powiódł się: {reason}"),
                        None => format!("Etap {stage} zakończył się kodem {}. Sprawdź dziennik instalacji.", code.code().map_or("nieznanym".into(), |c| c.to_string())),
                    })
                };
            }
            thread::sleep(Duration::from_millis(150));
        }
    }
    /// Updates the status from the log tail; returns the reason of a `failed` event, if the log has one.
    fn read_log(&self, path: &Path) -> Option<String> {
        let mut failure = None;
        let Ok(mut file) = File::open(path) else { return None; };
        let size = file.metadata().map(|m| m.len()).unwrap_or(0);
        let _ = file.seek(SeekFrom::Start(size.saturating_sub(24_000)));
        let mut bytes = vec![];
        if file.read_to_end(&mut bytes).is_err() { return None; }
        let content = String::from_utf8_lossy(&bytes);
        let lines: Vec<String> = content.lines().rev().take(60).map(|line| line.chars().take(500).collect()).collect::<Vec<_>>().into_iter().rev().collect();
        self.update(|status| {
            for line in &lines {
                if let Some(body) = line.strip_prefix("NEXT_BOOTSTRAP_EVENT ") {
                    if let Ok(event) = serde_json::from_str::<serde_json::Value>(body) {
                        let message = event["message"].as_str();
                        if event["phase"].as_str() == Some("failed") { failure = message.map(String::from); }
                        else if let Some(phase) = event["phase"].as_str() { status.phase = phase.into(); }
                        if let Some(message) = message { status.message = message.into(); }
                    }
                }
            }
            status.logs = lines;
        }, false);
        failure
    }
}

fn clean_command(program: &Path, root: &Path) -> Result<Command, String> {
    let mut command = Command::new(program);
    command.env_clear().current_dir(root);
    for key in ["SYSTEMROOT", "WINDIR", "TEMP", "TMP", "LOCALAPPDATA", "APPDATA", "USERPROFILE", "COMSPEC", "NUMBER_OF_PROCESSORS",
        "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "ALL_PROXY", "SSL_CERT_FILE", "REQUESTS_CA_BUNDLE", "CURL_CA_BUNDLE"] {
        if let Some(value) = std::env::var_os(key) { command.env(key, value); }
    }
    let windows = std::env::var_os("SYSTEMROOT").ok_or("Brak katalogu Windows")?;
    command.env("PATH", format!("{};{}", PathBuf::from(&windows).join("System32").display(), PathBuf::from(windows).display()));
    command.env("UV_NO_CONFIG", "1").env("UV_LINK_MODE", "copy").env("UV_CACHE_DIR", root.join("wheel-cache")).env("UV_PYTHON_INSTALL_DIR", root.join("python")).env("UV_PYTHON_BIN_DIR", root.join("bin")).env("UV_NATIVE_TLS", "true");
    command.env("TEMP", root.join("tmp")).env("TMP", root.join("tmp")).env("TORCH_HOME", root.join("doctor-models/torch")).env("MPLCONFIGDIR", root.join("doctor-cache/matplotlib")).env("NUMBA_CACHE_DIR", root.join("doctor-cache/numba")).env("XDG_CACHE_HOME", root.join("doctor-cache"));
    command.env("HF_HUB_OFFLINE", "1").env("TRANSFORMERS_OFFLINE", "1").env("PYTHONUTF8", "1").env("PYTHONIOENCODING", "utf-8").env("PYTHONDONTWRITEBYTECODE", "1");
    Ok(command)
}

/// Explains the two errors a virus scanner or a locked file produces on Windows instead of showing the raw code.
fn io_hint(error: &std::io::Error) -> String {
    match error.raw_os_error() {
        Some(225) => "Program antywirusowy zablokował plik instalatora. Dodaj wyjątek dla katalogu VoiceStudioNext i ponów.".into(),
        Some(5) => "Odmowa dostępu do pliku instalatora (blokada antywirusa lub otwarty plik). Zamknij inne programy i ponów.".into(),
        _ => error.to_string(),
    }
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
    no_links_with(path, "Katalog runtime zawiera junction lub dowiązanie.", "Katalog runtime zawiera dowiązanie.")
}

/// Rejects a path whose own entry or any ancestor is a symlink or a Windows reparse point.
/// A missing entry cannot be a link; any other read failure is an error.
pub(crate) fn no_links_with(path: &Path, reparse_message: &str, symlink_message: &str) -> Result<(), String> {
    for current in path.ancestors() {
        let metadata = match fs::symlink_metadata(current) {
            Ok(metadata) => metadata,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
            Err(e) => return Err(format!("Brak dostępu do {}: {e}", current.display())),
        };
        #[cfg(windows)]
        { use std::os::windows::fs::MetadataExt; if metadata.file_attributes() & 0x400 != 0 { return Err(reparse_message.into()); } }
        if metadata.file_type().is_symlink() { return Err(symlink_message.into()); }
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
            let mut output = OpenOptions::new().create_new(true).write(true).open(destination).map_err(|e| io_hint(&e))?;
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
    // Only what defines the installed environment must match; the uv pin, download URLs and policy text are build-time details.
    if ["platform", "python", "cpuWheels"].iter().any(|key| certificate[*key] != current[*key]) {
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

/// The active environment's folder, read from the pointer without validating it: a broken one must still hand over its settings.
fn previous_runtime_root(base: &Path) -> PathBuf {
    fs::read(base.join("active-runtime.json")).ok().and_then(|raw| serde_json::from_slice::<serde_json::Value>(&raw).ok())
        .and_then(|value| value["id"].as_str().and_then(|id| candidate_path(base, id).ok()))
        .unwrap_or_else(|| base.join("runtime"))
}

fn cuda_driver_present() -> bool {
    std::env::var_os("SYSTEMROOT").is_some_and(|windows| PathBuf::from(windows).join("System32").join("nvcuda.dll").is_file())
}

/// True when a private (or explicitly configured) Python environment can start the engine.
fn environment_present() -> bool { crate::runtime::runtime_root().and_then(|root| crate::runtime::python(&root)).is_ok() }
#[tauri::command]
pub fn installer_status(installer: tauri::State<'_, Installer>) -> InstallerStatus {
    let mut status = installer.snapshot();
    status.environment_present = environment_present();
    status.cuda_driver = cuda_driver_present();
    status
}
#[tauri::command]
pub fn installer_start(installer: tauri::State<'_, Installer>, profile: String) -> Result<InstallerStatus, String> { installer.start(profile) }
#[tauri::command]
pub fn installer_cancel(installer: tauri::State<'_, Installer>) -> InstallerStatus { installer.cancel() }
#[tauri::command]
pub fn installer_activate(installer: tauri::State<'_, Installer>, runtime: tauri::State<'_, crate::runtime::Runtime>) -> Result<InstallerStatus, String> {
    // A failed start leaves the state at "error" with no process; that must not block activation.
    if runtime.status().state == "error" { runtime.stop(); }
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
    let previous = previous_runtime_root(&base);
    let previous_cache = previous.join("model-cache.json");
    if previous != root && previous_cache.is_file() && !root.join("model-cache.json").exists() {
        no_links(&previous_cache)?;
        let cache: serde_json::Value = serde_json::from_slice(&fs::read(previous_cache).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        if !cache["path"].as_str().is_some_and(|path| Path::new(path).is_absolute()) { return Err("Dotychczasowy wskaźnik katalogu modeli jest nieprawidłowy.".into()); }
        atomic_json(&root.join("model-cache.json"), &cache)?;
    }
    // The relocated-data pointer lives in the runtime root too; without it the new environment would open an empty default data folder.
    let previous_storage = previous.join("storage-location.json");
    if previous != root && previous_storage.is_file() && !root.join("storage-location.json").exists() {
        no_links(&previous_storage)?;
        let pointer: serde_json::Value = serde_json::from_slice(&fs::read(previous_storage).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        atomic_json(&root.join("storage-location.json"), &pointer)?;
    }
    atomic_json(&base.join("active-runtime.json"), &serde_json::json!({"id": id, "schema": 1}))?;
    installer.update(|status| { status.state = "activated".into(); status.message = "Wybrano nowe środowisko. Uruchom silnik i pobierz wymagane modele.".into(); }, true);
    Ok(installer.snapshot())
}

/// Removes failed or cancelled candidates (owned by this installer, never complete ones) and their retained build workspaces.
fn cleanup_failed(base: &Path, keep: &[String], temp: &Path) -> Result<u64, String> {
    no_links(base)?;
    let mut removed = 0;
    for entry in fs::read_dir(base).map_err(|e| e.to_string())?.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if !safe_id(&name) || keep.contains(&name) { continue; }
        let root = candidate_path(base, &name)?;
        let owned = fs::read(root.join(".installer-owner.json")).ok().and_then(|raw| serde_json::from_slice::<serde_json::Value>(&raw).ok())
            .is_some_and(|marker| marker["owner"] == OWNER && marker["id"] == name.as_str());
        if !owned || root.join("installation-ready.json").exists() { continue; }
        let receipt = fs::read(root.join("build-workspace.json")).ok().and_then(|raw| serde_json::from_slice::<serde_json::Value>(&raw).ok());
        if let Some(workspace) = receipt.as_ref().and_then(|value| value["path"].as_str()).map(PathBuf::from) {
            let plain = workspace.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.strip_prefix("ssb-").is_some_and(|tail| tail.len() == 12 && tail.bytes().all(|b| b.is_ascii_hexdigit())));
            if plain && workspace.parent() == Some(temp) && workspace.join(".runtime-build-owner.json").is_file() && no_links(&workspace).is_ok() {
                fs::remove_dir_all(&workspace).map_err(|e| format!("Nie udało się usunąć cache budowania: {e}"))?;
            }
        }
        fs::remove_dir_all(&root).map_err(|e| format!("Nie udało się usunąć {name}: {}", io_hint(&e)))?;
        removed += 1;
    }
    Ok(removed)
}
#[tauri::command]
pub fn installer_cleanup(installer: tauri::State<'_, Installer>) -> Result<u64, String> {
    let status = installer.snapshot();
    if active(&status.state) { return Err("Trwa instalacja. Anuluj ją przed czyszczeniem.".into()); }
    let base = base_dir()?;
    let mut keep: Vec<String> = status.candidate.into_iter().filter(|_| status.state == "ready").collect();
    keep.extend(previous_runtime_root(&base).file_name().map(|n| n.to_string_lossy().into_owned()));
    cleanup_failed(&base, &keep, &std::env::temp_dir())
}

struct OwnedChild { child: Child, #[cfg(windows)] job: windows_job::Job }
impl OwnedChild {
    fn spawn(mut command: Command) -> Result<Self, String> {
        #[cfg(windows)]
        {
            use std::os::windows::{io::AsRawHandle, process::CommandExt};
            command.creation_flags(0x08000000 | 0x00000004);
            let job = windows_job::Job::new()?;
            let mut child = command.spawn().map_err(|e| io_hint(&e))?;
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
mod tests;
