use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs::{self, File, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
    net::{SocketAddr, TcpListener, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

const PORT: u16 = 4312;
const STARTUP_BUDGET: Duration = Duration::from_secs(300);
// Graceful exit for a loaded engine (CUDA models need time); startup-only children hold nothing.
const STOP_GRACE: Duration = Duration::from_secs(15);
const STARTUP_STOP_GRACE: Duration = Duration::from_secs(3);
const UNRESPONSIVE_STOP: Duration = Duration::from_secs(90);
const BACKUP_LOG_BYTES_PER_POLL: u64 = 64 * 1024;
const BACKUP_LOG_LINE_BYTES: usize = 8 * 1024;
const BACKUP_EVENT: &str = "NEXT_BACKUP_EVENT ";
const STORAGE_EVENT: &str = "NEXT_STORAGE_EVENT ";
const STARTUP_EVENT: &str = "NEXT_STARTUP_EVENT ";
// Startup stages in order: the first four are announced by launcher.py in engine.log, the rest are the
// engine's own `/startup/progress` step ids. The UI (frontend/src/platform/engine-startup.ts) keeps the same order.
const STAGES: [&str; 10] = ["engine_files", "backup", "modules", "server", "env_prefs", "native_preload", "ml_imports", "api_routes", "db_migrate", "services_start"];
const MAX_SAFE_COUNTER: u64 = 9_007_199_254_740_991;
const LAUNCHER: &str = include_str!("../../scripts/runtime/app/launcher.py");
const AUDIOBOOK_STREAMING: &str = include_str!("../../scripts/runtime/app/audiobook_streaming.py");
const AI_TAGGING: &str = include_str!("../../scripts/runtime/app/ai_tagging.py");
const ACTIVITY: &str = include_str!("../../scripts/runtime/app/activity.py");
const MODEL_MANAGEMENT: &str = include_str!("../../scripts/runtime/app/model_management.py");
const INTEGRATION_SETTINGS: &str = include_str!("../../scripts/runtime/app/integration_settings.py");
const STORAGE_SETTINGS: &str = include_str!("../../scripts/runtime/app/storage_settings.py");
const SYSTEM_SETTINGS: &str = include_str!("../../scripts/runtime/app/system_settings.py");
const GENERAL_SETTINGS: &str = include_str!("../../scripts/runtime/app/general_settings.py");
const REMOTE_BACKEND: &str = include_str!("../../scripts/runtime/app/remote_backend.py");
const PREVIEW_CACHE: &str = include_str!("../../scripts/runtime/app/preview_cache.py");
const PRIVATE_ENVIRONMENT: &str = include_str!("../../scripts/runtime/install/private_environment.py");
const ENGINE_INSTALLATION: &str = include_str!("../../scripts/runtime/install/engine_installation.py");
const DISTRIBUTION_MANIFEST: &str = include_str!("../../scripts/runtime/vendor/bootstrap-provenance.json");
const WINDOWS_RUNTIME_PATHS: &str = include_str!("../../scripts/runtime/install/windows_runtime_paths.py");
const ENGINE_PROVENANCE: &str = include_str!("../../scripts/runtime/vendor/engine-provenance.json");
const RUNTIME_BACKUP: &str = include_str!("../../scripts/runtime/app/runtime_backup.py");
const ENGINE_CATALOGUE_METADATA: &str = include_str!("../../scripts/runtime/app/engine_catalogue_metadata.py");
const ENGINE_CATALOGUE_DATA: &str = include_str!("../../scripts/runtime/app/engine_catalogue_data.json");
const TTS_EXTENSIONS: &[(&str, &str)] = &[
    ("tts_catalog.py", include_str!("../../scripts/runtime/app/tts_catalog.py")),
    ("tts_extensions.py", include_str!("../../scripts/runtime/app/tts_extensions.py")),
    ("tts_worker.py", include_str!("../../scripts/runtime/app/tts_worker.py")),
    ("prepare_tts.py", include_str!("../../scripts/runtime/install/prepare_tts.py")),
];
const ENGINE: &[u8] = include_bytes!("../../scripts/runtime/vendor/engine.zip");

fn embedded_archive(root: &Path) -> Result<PathBuf, String> {
    // Keep the environment installer's original archive and evidence intact.
    // Each app build publishes its own immutable, content-addressed bundle.
    let directory = root.join("bundles").join(format!("{:x}", Sha256::digest(ENGINE)));
    crate::installer::no_links(&directory)?;
    fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    let target = directory.join("engine.zip");
    crate::installer::no_links(&target)?;
    if target.exists() {
        if fs::read(&target).map_err(|e| e.to_string())? != ENGINE {
            return Err("Zapisana paczka silnika jest niekompletna lub zmieniona. Zachowano ją bez nadpisania.".into());
        }
        return Ok(target);
    }
    let temporary = directory.join(format!(".engine-{}-{}.tmp", std::process::id(), SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos()));
    let result = (|| -> Result<(), String> {
        let mut output = OpenOptions::new().write(true).create_new(true).open(&temporary).map_err(|e| e.to_string())?;
        output.write_all(ENGINE).map_err(|e| e.to_string())?;
        output.sync_all().map_err(|e| e.to_string())?;
        drop(output);
        fs::rename(&temporary, &target).map_err(|e| e.to_string())
    })();
    if result.is_err() { let _ = fs::remove_file(&temporary); }
    result?;
    Ok(target)
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStatus {
    pub(crate) state: String,
    message: String,
    port: u16,
    data_dir: Option<String>,
    source: Option<String>,
    managed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    startup: Option<StartupProgress>,
}

impl RuntimeStatus {
    fn new(state: &str, message: impl Into<String>) -> Self {
        Self {
            state: state.into(),
            message: message.into(),
            port: PORT,
            data_dir: None,
            source: None,
            managed: false,
            startup: None,
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct StartupProgress {
    run_id: String,
    phase: String,
    revision: u64,
    copied_pages: u64,
    total_pages: Option<u64>,
    copied_bytes: u64,
    total_bytes: Option<u64>,
    files: Option<u64>,
    backup_complete: bool,
    log_read_error: bool,
    stage: Option<String>,
}

struct StartupClock {
    progress: StartupProgress,
    expected_archive: String,
    deadline: Instant,
    backup_seen: bool,
}

impl StartupClock {
    fn observe_storage(&mut self, value: &serde_json::Value, now: Instant) {
        if self.backup_seen || self.progress.backup_complete { return; }
        let revision = Self::counter(value, "revision").unwrap_or(0);
        if revision <= self.progress.revision { return; }
        let phase = value.get("phase").and_then(serde_json::Value::as_str).unwrap_or("");
        match phase {
            "copy_files" => {
                let (Some(done), Some(total)) = (Self::counter(value, "bytes_done"), Self::counter(value, "bytes_total")) else { return; };
                if done > total || done < self.progress.copied_bytes || done == self.progress.copied_bytes { return; }
                self.progress.copied_bytes = done; self.progress.total_bytes = Some(total);
                self.progress.phase = "relocation_files".into();
            }
            "backup_database" => {
                let (Some(done), Some(total)) = (Self::counter(value, "pages_done"), Self::counter(value, "pages_total")) else { return; };
                if done > total || total == 0 || done <= self.progress.copied_pages { return; }
                self.progress.copied_pages = done; self.progress.total_pages = Some(total);
                self.progress.phase = "relocation_database".into();
            }
            "relocation_complete" | "relocation_failed" => {
                self.progress.phase = "preparing".into();
                self.progress.copied_bytes = 0; self.progress.total_bytes = None;
                self.progress.copied_pages = 0; self.progress.total_pages = None;
            }
            _ => return,
        }
        self.progress.revision = revision;
        self.deadline = now + STARTUP_BUDGET;
    }
    fn new(run_id: String, expected_archive: String, now: Instant) -> Self {
        Self {
            progress: StartupProgress {
                run_id, phase: "preparing".into(), revision: 0,
                copied_pages: 0, total_pages: None, copied_bytes: 0,
                total_bytes: None, files: None, backup_complete: false,
                log_read_error: false, stage: None,
            },
            expected_archive, deadline: now + STARTUP_BUDGET, backup_seen: false,
        }
    }

    /// Stages only move forward, so a late or repeated report can never rewind the display.
    fn advance_stage(&mut self, id: &str) {
        let Some(rank) = STAGES.iter().position(|stage| *stage == id) else { return; };
        let current = self.progress.stage.as_deref().and_then(|stage| STAGES.iter().position(|known| *known == stage));
        if current.is_none_or(|current| rank > current) { self.progress.stage = Some(id.into()); }
    }

    fn counter(value: &serde_json::Value, key: &str) -> Option<u64> {
        value.get(key)?.as_u64().filter(|number| *number <= MAX_SAFE_COUNTER)
    }

    fn observe(&mut self, value: &serde_json::Value, now: Instant) {
        if self.progress.backup_complete { return; }
        match value.get("phase").and_then(serde_json::Value::as_str) {
            Some("backup_plan") if !self.backup_seen => {
                if value.get("archive_sha256").and_then(serde_json::Value::as_str) != Some(self.expected_archive.as_str()) { return; }
                self.backup_seen = true;
                self.progress.phase = "backup_plan".into();
                // Planning/inventory is not proof of copied data and cannot
                // renew the initial startup budget.
            }
            Some("backup_database") if self.backup_seen && self.progress.phase != "backup_files" => {
                let (Some(copied), Some(total)) = (Self::counter(value, "copied_pages"), Self::counter(value, "total_pages")) else { return; };
                if total == 0 || copied > total || copied < self.progress.copied_pages
                    || self.progress.total_pages.is_some_and(|previous| previous != total) { return; }
                self.progress.phase = "backup_database".into();
                self.progress.total_pages = Some(total);
                if copied > self.progress.copied_pages {
                    self.progress.copied_pages = copied;
                    self.advanced(now);
                }
            }
            Some("backup_files") if self.backup_seen => {
                let (Some(copied), Some(total)) = (Self::counter(value, "copied_bytes"), Self::counter(value, "total_bytes")) else { return; };
                if copied > total || copied < self.progress.copied_bytes
                    || self.progress.total_bytes.is_some_and(|previous| previous != total) { return; }
                self.progress.phase = "backup_files".into();
                self.progress.total_bytes = Some(total);
                if copied > self.progress.copied_bytes {
                    self.progress.copied_bytes = copied;
                    self.advanced(now);
                }
            }
            Some("backup_complete") if self.backup_seen => {
                let (Some(copied), Some(files)) = (Self::counter(value, "copied_bytes"), Self::counter(value, "files")) else { return; };
                if files == 0 || copied < self.progress.copied_bytes
                    || self.progress.total_bytes.is_some_and(|total| copied < total) { return; }
                self.progress.phase = "backend_starting".into();
                self.progress.copied_bytes = copied;
                self.progress.total_bytes = Some(copied);
                self.progress.files = Some(files);
                self.progress.backup_complete = true;
                // Completion is emitted after the durable manifest/marker.
                // Give imports/migrations their ordinary, separate budget.
                self.advanced(now);
            }
            _ => {}
        }
    }

    fn advanced(&mut self, now: Instant) {
        self.progress.revision = self.progress.revision.saturating_add(1);
        self.deadline = now + STARTUP_BUDGET;
    }

    fn expired(&self, now: Instant) -> bool { now >= self.deadline }

    fn message(&self) -> String {
        match self.progress.phase.as_str() {
            "relocation_files" => format!("Kopiowanie danych do nowego folderu: {} / {} bajtów. Dane źródłowe pozostają zachowane.", self.progress.copied_bytes, self.progress.total_bytes.unwrap_or(0)),
            "relocation_database" => format!("Kopiowanie prywatnej bazy: {} / {} stron.", self.progress.copied_pages, self.progress.total_pages.unwrap_or(0)),
            "backup_plan" => "Kopia bezpieczeństwa przed aktualizacją: przygotowywanie listy danych. Oczekiwanie na potwierdzony postęp…".into(),
            "backup_database" => format!("Kopia bezpieczeństwa SQLite: {} / {} stron. Silnik uruchomi się po zakończeniu kopii.", self.progress.copied_pages, self.progress.total_pages.unwrap_or(0)),
            "backup_files" => format!("Kopia bezpieczeństwa plików: {} / {} bajtów. Silnik uruchomi się po zakończeniu kopii.", self.progress.copied_bytes, self.progress.total_bytes.unwrap_or(0)),
            "backend_starting" => format!("Kopia danych ukończona ({} plików, {} bajtów). Uruchamianie prywatnego silnika…", self.progress.files.unwrap_or(0), self.progress.copied_bytes),
            _ => "Uruchamianie lokalnego silnika…".into(),
        }
    }

    fn timeout_message(&self) -> String {
        if self.backup_seen && !self.progress.backup_complete {
            "Nie otrzymano nowego postępu kopii danych w wymaganym czasie. Zatrzymano własny proces; niedokończoną kopię zachowano. Sprawdź VoiceStudioNext/runtime/engine.log i ponów start.".into()
        } else {
            "Przekroczono czas uruchamiania silnika. Szczegóły: VoiceStudioNext/runtime/engine.log".into()
        }
    }

    fn failed(&self, message: String) -> (String, StartupProgress) {
        let mut progress = self.progress.clone();
        progress.phase = if self.backup_seen && !progress.backup_complete { "backup_failed" } else { "startup_failed" }.into();
        let message = if self.backup_seen && !progress.backup_complete {
            format!("Nie potwierdzono ukończenia kopii danych. Sprawdź jej stan w dzienniku przed ponowieniem startu. {message}")
        } else { message };
        (message, progress)
    }
}

struct StartupLog {
    file: File,
    offset: u64,
    pending: Vec<u8>,
    discarding: bool,
    invalidated: bool,
}

impl StartupLog {
    fn new(file: File, offset: u64) -> Self {
        Self { file, offset, pending: Vec::new(), discarding: false, invalidated: false }
    }

    fn poll(&mut self, clock: &mut StartupClock, now: Instant) -> std::io::Result<()> {
        if self.invalidated || clock.progress.backup_complete { return Ok(()); }
        let length = self.file.metadata()?.len();
        if length < self.offset {
            // Never rewind into a truncated/replaced log and adopt old events.
            self.invalidated = true;
            return Err(std::io::Error::new(std::io::ErrorKind::InvalidData, "startup log truncated"));
        }
        self.file.seek(SeekFrom::Start(self.offset))?;
        let mut chunk = Vec::new();
        (&mut self.file).take((length - self.offset).min(BACKUP_LOG_BYTES_PER_POLL)).read_to_end(&mut chunk)?;
        self.offset += chunk.len() as u64;
        for byte in chunk {
            if byte == b'\n' {
                if !self.discarding {
                    if let Ok(line) = std::str::from_utf8(&self.pending) {
                        if let Some(raw) = line.trim_end_matches('\r').strip_prefix(BACKUP_EVENT) {
                            if let Ok(event) = serde_json::from_str(raw) { clock.observe(&event, now); }
                        } else if let Some(raw) = line.trim_end_matches('\r').strip_prefix(STORAGE_EVENT) {
                            if let Ok(event) = serde_json::from_str(raw) { clock.observe_storage(&event, now); }
                        } else if let Some(raw) = line.trim_end_matches('\r').strip_prefix(STARTUP_EVENT) {
                            if let Ok(event) = serde_json::from_str::<serde_json::Value>(raw) {
                                if let Some(stage) = event.get("stage").and_then(serde_json::Value::as_str) { clock.advance_stage(stage); }
                            }
                        }
                    }
                }
                self.pending.clear(); self.discarding = false;
            } else if !self.discarding {
                if self.pending.len() < BACKUP_LOG_LINE_BYTES { self.pending.push(byte); }
                else { self.pending.clear(); self.discarding = true; }
            }
        }
        Ok(())
    }
}

struct Process {
    child: Child,
    token: String,
    ready: bool,
    unresponsive_since: Option<Instant>,
    startup: StartupClock,
    startup_log: StartupLog,
}

struct Inner {
    process: Option<Process>,
    status: RuntimeStatus,
    leases: HashMap<u64, bool>,
    next_lease: u64,
    last_use: Instant,
    idle_timeout: Duration,
    /// Warm the TTS model at engine start (read once per spawn; the UI re-applies the stored choice).
    preload_tts: bool,
}

impl Drop for Inner {
    fn drop(&mut self) {
        if let Some(mut process) = self.process.take() {
            // Only this launcher's child handle is ever terminated. The
            // backend stdin watchdog also handles an unexpected shell exit.
            stop_owned_child(&mut process, STOP_GRACE);
        }
    }
}

#[derive(Clone)]
pub struct Runtime(Arc<Mutex<Inner>>);

impl Default for Runtime {
    fn default() -> Self {
        Self(Arc::new(Mutex::new(Inner {
            process: None,
            status: RuntimeStatus::new("stopped", "Silnik lokalny jest zatrzymany"),
            leases: HashMap::new(),
            next_lease: 0,
            last_use: Instant::now(),
            idle_timeout: Duration::from_secs(900),
            preload_tts: true,
        })))
    }
}

fn runtime_root() -> Result<PathBuf, String> {
    let local = std::env::var_os("LOCALAPPDATA").ok_or("Brak katalogu LOCALAPPDATA")?;
    let base = PathBuf::from(local).join("VoiceStudioNext");
    let root = crate::installer::selected_runtime_root(&base)?.unwrap_or_else(|| base.join("runtime"));
    fs::create_dir_all(&root)
        .map_err(|error| format!("Nie można przygotować katalogu silnika: {error}"))?;
    Ok(root)
}

pub(crate) fn active_data_dir() -> Result<PathBuf, String> {
    crate::settings_native::data_dir(&runtime_root()?)
}

fn python(root: &Path) -> Result<(PathBuf, &'static str), String> {
    if let Some(custom) = std::env::var_os("VOICESTUDIO_NEXT_PYTHON") {
        let path = PathBuf::from(custom);
        if path.is_absolute() && path.is_file() {
            return Ok((path, "configured-python"));
        }
        return Err("VOICESTUDIO_NEXT_PYTHON musi wskazywać istniejący interpreter Python".into());
    }
    let private = root.join(".venv/Scripts/python.exe");
    if private.is_file() && root.join("python-ready.json").is_file() {
        return Ok((private, "private-python"));
    }
    Err(
        "Brak prywatnego środowiska Python. Otwórz Ustawienia → Modele i silnik → Samodzielne środowisko Python i pobierz runtime."
            .into(),
    )
}

fn owns_healthy_listener(token: &str) -> bool {
    let address = SocketAddr::from(([127, 0, 0, 1], PORT));
    let Ok(mut stream) = TcpStream::connect_timeout(&address, Duration::from_millis(300)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(500)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(300)));
    if stream
        .write_all(b"GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
        .is_err()
    {
        return false;
    }
    let mut response = String::new();
    let _ = stream.take(16384).read_to_string(&mut response);
    let (headers, _) = response.split_once("\r\n\r\n").unwrap_or((&response, ""));
    headers.starts_with("HTTP/1.1 200")
        && headers.lines().any(|line| {
            line.split_once(':').is_some_and(|(name, value)| {
                name.eq_ignore_ascii_case("x-voicestudio-next") && value.trim() == token
            })
        })
}

impl Runtime {
    pub(crate) fn set_media_tool(&self, tool: &str, path: &str) -> Result<serde_json::Value, String> {
        let lease = self.acquire(true);
        let result = (|| {
            if lease.status.state != "ready" { return Err("Poczekaj na uruchomienie prywatnego silnika i wybierz program ponownie.".into()); }
            let token = {
                let inner = self.0.lock().unwrap_or_else(|error| error.into_inner());
                inner.process.as_ref().filter(|process| process.ready).ok_or("Prywatny silnik nie jest gotowy")?.token.clone()
            };
            let body = serde_json::to_vec(&serde_json::json!({"tool":tool,"path":path})).map_err(|error| error.to_string())?;
            let mut stream = TcpStream::connect_timeout(&SocketAddr::from(([127,0,0,1], PORT)), Duration::from_secs(3)).map_err(|error| error.to_string())?;
            stream.set_read_timeout(Some(Duration::from_secs(90))).map_err(|error| error.to_string())?;
            stream.set_write_timeout(Some(Duration::from_secs(5))).map_err(|error| error.to_string())?;
            write!(stream, "POST /next/settings/media-tool HTTP/1.1\r\nHost: 127.0.0.1:{PORT}\r\nX-VoiceStudio-Next: {token}\r\nX-VoiceStudio-CSRF: 1\r\nOrigin: http://tauri.localhost\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len()).map_err(|error| error.to_string())?;
            stream.write_all(&body).map_err(|error| error.to_string())?;
            let mut response = Vec::new(); stream.take(2 * 1024 * 1024).read_to_end(&mut response).map_err(|error| error.to_string())?;
            let boundary = response.windows(4).position(|bytes| bytes == b"\r\n\r\n").ok_or("Nieprawidłowa odpowiedź prywatnego silnika")?;
            let headers = std::str::from_utf8(&response[..boundary]).map_err(|_| "Nieprawidłowe nagłówki silnika")?;
            if !headers.lines().any(|line| line.split_once(':').is_some_and(|(key,value)| key.eq_ignore_ascii_case("x-voicestudio-next") && value.trim() == token)) {
                return Err("Nie potwierdzono własności prywatnego silnika.".into());
            }
            let value: serde_json::Value = serde_json::from_slice(&response[boundary+4..]).map_err(|_| "Silnik nie zwrócił poprawnego wyniku konfiguracji")?;
            if !headers.lines().next().is_some_and(|line| line.starts_with("HTTP/1.1 200 ")) {
                return Err(value["detail"].as_str().unwrap_or("Nie zapisano programu do obsługi multimediów.").chars().take(350).collect());
            }
            Ok(value)
        })();
        self.release(lease.lease);
        result
    }
    pub fn watch_idle(&self) {
        let weak = Arc::downgrade(&self.0);
        std::thread::spawn(move || loop {
            std::thread::sleep(Duration::from_secs(10));
            let Some(inner) = weak.upgrade() else {
                break;
            };
            Runtime(inner).idle_tick();
        });
    }

    fn idle_tick(&self) -> bool {
        let mut inner = self.0.lock().unwrap_or_else(|e| e.into_inner());
        if inner.leases.values().any(|keep_warm| *keep_warm) || inner.last_use.elapsed() < inner.idle_timeout {
            return false;
        }
        let Some(process) = inner.process.as_ref() else {
            return false;
        };
        if !process.ready {
            return false;
        }
        // The lease lock stays held through the probe and stop. New UI work
        // either owns a lease already, or waits here and starts a fresh engine.
        let Some(activity) = backend_activity(&process.token) else {
            return false;
        };
        if activity.busy || activity.keep_alive || activity.idle_seconds < inner.idle_timeout.as_secs_f64() {
            return false;
        }
        let minutes = inner.idle_timeout.as_secs() / 60;
        stop_process(&mut inner, STOP_GRACE);
        inner.status.message =
            format!("Silnik uśpiony po {minutes} min bezczynności. Uruchomi się przy następnym zadaniu.");
        true
    }

    /// Only the fixed UI choices are accepted; the idle monitor reads the new budget on its next tick.
    /// 0 means "always": the engine is never stopped for idleness (the budget never elapses).
    fn set_idle_minutes(&self, minutes: u64) -> Result<u64, String> {
        if !matches!(minutes, 0 | 5 | 15 | 30 | 60) {
            return Err("Nieobsługiwany czas bezczynności silnika. Wybierz 5, 15, 30, 60 minut albo Zawsze.".into());
        }
        let (timeout, token) = {
            let mut inner = self.0.lock().unwrap_or_else(|e| e.into_inner());
            inner.idle_timeout = if minutes == 0 { Duration::MAX } else { Duration::from_secs(minutes * 60) };
            (inner.idle_timeout, inner.process.as_ref().filter(|process| process.ready).map(|process| process.token.clone()))
        };
        // A running engine unloads its model on its own clock: keep it equal to this one.
        if let Some(token) = token { push_model_idle(token, timeout); }
        Ok(minutes)
    }

    /// Applies from the next engine start; a running engine keeps the setting it was launched with.
    fn set_preload(&self, enabled: bool) -> bool {
        self.0.lock().unwrap_or_else(|e| e.into_inner()).preload_tts = enabled;
        enabled
    }

    fn acquire(&self, keep_warm: bool) -> RuntimeLease {
        let lease = {
            let mut inner = self.0.lock().unwrap_or_else(|e| e.into_inner());
            inner.next_lease += 1;
            let lease = inner.next_lease;
            inner.leases.insert(lease, keep_warm);
            if keep_warm {
                inner.last_use = Instant::now();
            }
            lease
        };
        let status = if keep_warm {
            self.start()
        } else {
            self.status()
        };
        RuntimeLease { lease, status }
    }

    fn release(&self, lease: u64) {
        self.release_with_cancel(lease, false);
    }

    fn release_with_cancel(&self, lease: u64, cancel_startup: bool) {
        let mut inner = self.0.lock().unwrap_or_else(|e| e.into_inner());
        let removed = inner.leases.remove(&lease);
        if removed == Some(true) {
            inner.last_use = Instant::now();
        }
        if cancel_startup && removed == Some(true)
            && !inner.leases.values().any(|keep_warm| *keep_warm)
            && inner.process.as_ref().is_some_and(|process| !process.ready) {
            stop_process(&mut inner, STARTUP_STOP_GRACE);
            inner.status.message = "Zatrzymano uruchamianie prywatnego silnika. Niedokończona kopia pozostaje do sprawdzenia; dane źródłowe nie są usuwane.".into();
        }
    }

    pub fn status(&self) -> RuntimeStatus {
        let mut inner = self.0.lock().unwrap_or_else(|error| error.into_inner());
        if let Some(process) = inner.process.as_mut() {
            match process.child.try_wait() {
                Ok(Some(code)) => {
                    // Capture the final durable receipt/progress even when the
                    // child exits between two UI polls.
                    if !process.ready && process.startup_log.poll(&mut process.startup, Instant::now()).is_err() {
                        process.startup.progress.log_read_error = true;
                    }
                    let (message, startup) = process.startup.failed(format!("Silnik zakończył działanie ({code}). Szczegóły: VoiceStudioNext/runtime/engine.log"));
                    inner.process = None;
                    inner.status.state = "error".into();
                    inner.status.managed = false;
                    inner.status.message = message;
                    inner.status.startup = Some(startup);
                }
                Err(error) => {
                    inner.status.state = "error".into();
                    inner.status.message = format!("Nie można sprawdzić silnika: {error}");
                }
                Ok(None) => {
                    let now = Instant::now();
                    if !process.ready && process.startup_log.poll(&mut process.startup, now).is_err() {
                        process.startup.progress.log_read_error = true;
                    }
                    if !process.ready {
                        // Once the socket is bound the engine itself names the step it is running.
                        let step = backend_get(&process.token, "/startup/progress", Duration::from_millis(300))
                            .and_then(|body| serde_json::from_str::<serde_json::Value>(&body).ok())
                            .and_then(|value| value.get("step").and_then(serde_json::Value::as_str).map(str::to_owned));
                        if let Some(step) = step { process.startup.advance_stage(&step); }
                    }
                    if owns_healthy_listener(&process.token) {
                        let (just_ready, token) = (!process.ready, process.token.clone());
                        process.ready = true;
                        process.unresponsive_since = None;
                        inner.status.state = "ready".into();
                        if let Ok(data) = active_data_dir() { inner.status.data_dir = Some(data.to_string_lossy().into()); }
                        inner.status.startup = None;
                        if just_ready { push_model_idle(token, inner.idle_timeout); }
                        inner.status.message = if inner.status.source.as_deref() == Some("shared-python") {
                            "Silnik działa; tymczasowo korzysta ze współdzielonych bibliotek Python".into()
                        } else { "Silnik lokalny jest gotowy".into() };
                    } else if !process.ready && process.startup.expired(now) {
                        let (message, startup) = process.startup.failed(process.startup.timeout_message());
                        stop_owned_child(process, STARTUP_STOP_GRACE);
                        inner.process = None;
                        inner.status.state = "error".into();
                        inner.status.managed = false;
                        inner.status.message = message;
                        inner.status.startup = Some(startup);
                    } else {
                        let message = if process.ready {
                            let secs = now.duration_since(*process.unresponsive_since.get_or_insert(now)).as_secs();
                            if secs >= UNRESPONSIVE_STOP.as_secs() {
                                format!("Silnik nie odpowiada od {secs} s. Możesz go zatrzymać i uruchomić ponownie.")
                            } else { "Silnik chwilowo nie odpowiada; sprawdzanie gotowości…".into() }
                        } else { process.startup.message() };
                        inner.status.startup = if process.ready { None } else { Some(process.startup.progress.clone()) };
                        inner.status.state = "starting".into();
                        inner.status.message = message;
                    }
                }
            }
        }
        inner.status.clone()
    }

    pub fn start(&self) -> RuntimeStatus {
        let mut inner = self.0.lock().unwrap_or_else(|error| error.into_inner());
        if inner.process.is_some() {
            return inner.status.clone();
        }
        let preload_tts = inner.preload_tts;
        let result = (|| -> Result<(Process, RuntimeStatus), String> {
            let root = runtime_root()?;
            // A busy port is reported at once, before anything else that could fail or take time.
            let listener =
                TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], PORT))).map_err(|_| {
                    format!(
                        "Port {PORT} jest zajęty. Seventy Seven Labs nie przejmie obcego procesu."
                    )
                })?;
            let (python, source) = python(&root)?;
            fs::write(root.join("launcher.py"), LAUNCHER).map_err(|e| e.to_string())?;
            fs::write(root.join("audiobook_streaming.py"), AUDIOBOOK_STREAMING).map_err(|e| e.to_string())?;
            fs::write(root.join("ai_tagging.py"), AI_TAGGING).map_err(|e| e.to_string())?;
            fs::write(root.join("activity.py"), ACTIVITY).map_err(|e| e.to_string())?;
            fs::write(root.join("model_management.py"), MODEL_MANAGEMENT).map_err(|e| e.to_string())?;
            fs::write(root.join("integration_settings.py"), INTEGRATION_SETTINGS).map_err(|e| e.to_string())?;
            fs::write(root.join("storage_settings.py"), STORAGE_SETTINGS).map_err(|e| e.to_string())?;
            fs::write(root.join("system_settings.py"), SYSTEM_SETTINGS).map_err(|e| e.to_string())?;
            fs::write(root.join("general_settings.py"), GENERAL_SETTINGS).map_err(|e| e.to_string())?;
            fs::write(root.join("remote_backend.py"), REMOTE_BACKEND).map_err(|e| e.to_string())?;
            fs::write(root.join("preview_cache.py"), PREVIEW_CACHE).map_err(|e| e.to_string())?;
            fs::write(root.join("private_environment.py"), PRIVATE_ENVIRONMENT).map_err(|e| e.to_string())?;
            fs::write(root.join("engine_installation.py"), ENGINE_INSTALLATION).map_err(|e| e.to_string())?;
            fs::write(root.join("runtime-distribution.json"), DISTRIBUTION_MANIFEST).map_err(|e| e.to_string())?;
            fs::write(root.join("windows_runtime_paths.py"), WINDOWS_RUNTIME_PATHS).map_err(|e| e.to_string())?;
            fs::write(root.join("engine-provenance.json"), ENGINE_PROVENANCE).map_err(|e| e.to_string())?;
            fs::write(root.join("runtime_backup.py"), RUNTIME_BACKUP).map_err(|e| e.to_string())?;
            fs::write(root.join("engine_catalogue_metadata.py"), ENGINE_CATALOGUE_METADATA).map_err(|e| e.to_string())?;
            fs::write(root.join("engine_catalogue_data.json"), ENGINE_CATALOGUE_DATA).map_err(|e| e.to_string())?;
            for (name, source) in TTS_EXTENSIONS {
                fs::write(root.join(name), source).map_err(|e| e.to_string())?;
            }
            let bundle = embedded_archive(&root)?;
            let log_path = root.join("engine.log");
            crate::installer::no_links(&log_path)?;
            let log = OpenOptions::new()
                .create(true)
                .append(true)
                .open(&log_path)
                .map_err(|e| e.to_string())?;
            // Capture EOF and the original read handle BEFORE spawning. Old
            // sessions (including a final partial line) can never renew a start.
            let log_offset = log.metadata().map_err(|e| e.to_string())?.len();
            let startup_log = StartupLog::new(File::open(&log_path).map_err(|e| e.to_string())?, log_offset);
            let token = format!(
                "{}-{}",
                std::process::id(),
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_nanos()
            );
            let mut command = Command::new(python);
            command
                .arg("-B")
                .arg("-u")
                .arg(root.join("launcher.py"))
                .current_dir(&root)
                .env("VOICESTUDIO_NEXT_TOKEN", &token)
                .env("PYTHONDONTWRITEBYTECODE", "1")
                .env("PYTHONNOUSERSITE", "1")
                .env_remove("PYTHONPATH")
                .env_remove("PYTHONHOME")
                .env("VOICESTUDIO_NEXT_BUNDLE", bundle)
                .env("PYTHONUTF8", "1")
                // The Vite dev origin (:4310) is trusted only in debug builds.
                .env("VOICESTUDIO_DEV_ORIGINS", if cfg!(debug_assertions) { "1" } else { "0" })
                // Warm the TTS model in the background so the first synthesis does not wait for the weights (user-switchable).
                .env("VOICESTUDIO_NEXT_PRELOAD_TTS", if preload_tts { "1" } else { "0" })
                .stdin(Stdio::piped())
                .stdout(Stdio::from(log.try_clone().map_err(|e| e.to_string())?))
                .stderr(Stdio::from(log));
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                command.creation_flags(0x08000000);
            }
            drop(listener);
            let child = command
                .spawn()
                .map_err(|e| format!("Nie można uruchomić silnika Python: {e}"))?;
            let startup = StartupClock::new(
                format!("{}-{}", child.id(), SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos()),
                format!("{:x}", Sha256::digest(ENGINE)), Instant::now(),
            );
            let mut status = RuntimeStatus::new("starting", "Przygotowywanie lokalnego silnika…");
            status.managed = true;
            status.source = Some(source.into());
            status.data_dir = Some(crate::settings_native::data_dir(&root)?.to_string_lossy().into());
            status.startup = Some(startup.progress.clone());
            Ok((
                Process {
                    child,
                    token,
                    ready: false,
                    unresponsive_since: None,
                    startup,
                    startup_log,
                },
                status,
            ))
        })();
        match result {
            Ok((process, status)) => {
                inner.last_use = Instant::now();
                inner.process = Some(process);
                inner.status = status;
            }
            Err(message) => {
                inner.status = RuntimeStatus::new("error", message);
            }
        }
        inner.status.clone()
    }

    pub fn stop(&self) -> RuntimeStatus {
        let mut inner = self.0.lock().unwrap_or_else(|error| error.into_inner());
        stop_process(&mut inner, STOP_GRACE);
        inner.status.clone()
    }

    fn request_stop(&self) -> Result<RuntimeStatus, String> {
        let mut inner = self.0.lock().unwrap_or_else(|e| e.into_inner());
        // A monitor lease protects its dispatch bookkeeping, not a task.
        // Actual work still requires a warm lease and backend idle proof.
        if inner.leases.values().any(|keep_warm| *keep_warm) {
            return Err("Poczekaj na zakończenie zadań silnika.".into());
        }
        if let Some(process) = inner.process.as_ref() {
            // A ready engine that has not answered for UNRESPONSIVE_STOP may be stopped
            // manually (never automatically). A busy answer always blocks.
            let stale = process.unresponsive_since.is_some_and(|since| since.elapsed() >= UNRESPONSIVE_STOP);
            if !process.ready || match backend_activity(&process.token) { Some(activity) => activity.busy, None => !stale } {
                return Err("Silnik pracuje lub nie potwierdził bezczynności. Spróbuj po zakończeniu zadania.".into());
            }
        }
        stop_process(&mut inner, STOP_GRACE);
        Ok(inner.status.clone())
    }
}

fn stop_process(inner: &mut Inner, grace: Duration) {
    if let Some(mut process) = inner.process.take() {
        stop_owned_child(&mut process, grace);
    }
    inner.status.state = "stopped".into();
    inner.status.managed = false;
    inner.status.startup = None;
    inner.status.message =
        "Silnik lokalny jest zatrzymany. Uruchomi się przy następnym zadaniu.".into();
}

fn stop_owned_child(process: &mut Process, grace: Duration) {
    // On Windows the venv executable can be a redirector supervising another
    // Python process. Let stdin EOF reach that process before killing its parent.
    drop(process.child.stdin.take());
    let deadline = Instant::now() + grace;
    loop {
        match process.child.try_wait() {
            Ok(Some(_)) => return,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(50)),
            _ => break,
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // The child still owns this live handle/PID. Only its own descendants
        // are terminated, including an early-start redirector without watchdog.
        let _ = Command::new("taskkill.exe")
            .args(["/PID", &process.child.id().to_string(), "/T", "/F"])
            .creation_flags(0x08000000)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    let _ = process.child.kill();
    let _ = process.child.wait();
}

#[derive(Deserialize)]
struct BackendActivity {
    busy: bool,
    idle_seconds: f64,
    #[serde(default)]
    keep_alive: bool,
}

fn backend_get(token: &str, path: &str, read_timeout: Duration) -> Option<String> {
    let mut stream = TcpStream::connect_timeout(
        &SocketAddr::from(([127, 0, 0, 1], PORT)),
        Duration::from_millis(300),
    )
    .ok()?;
    stream.set_read_timeout(Some(read_timeout)).ok()?;
    stream
        .set_write_timeout(Some(Duration::from_millis(300)))
        .ok()?;
    write!(stream, "GET {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nX-VoiceStudio-Next: {token}\r\nConnection: close\r\n\r\n").ok()?;
    let mut response = String::new();
    stream.take(16384).read_to_string(&mut response).ok()?;
    let (headers, body) = response.split_once("\r\n\r\n")?;
    if !headers.starts_with("HTTP/1.1 200")
        || !headers.lines().any(|line| {
            line.split_once(':').is_some_and(|(k, v)| {
                k.eq_ignore_ascii_case("x-voicestudio-next") && v.trim() == token
            })
        })
    {
        return None;
    }
    Some(body.to_owned())
}

/// Mirrors `IDLE_FOREVER_S` in system_settings.py: what "Zawsze" means to the engine's own idle clock.
const FOREVER_IDLE_SECONDS: u64 = 10 * 365 * 24 * 3600;

/// PUT with the owner headers the engine's admin guard expects (same as `set_media_tool`). True only on a 200 from this engine.
fn backend_put(token: &str, path: &str, body: &str) -> bool {
    let Ok(mut stream) = TcpStream::connect_timeout(&SocketAddr::from(([127, 0, 0, 1], PORT)), Duration::from_millis(500)) else { return false };
    let _ = stream.set_read_timeout(Some(Duration::from_secs(10)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(2)));
    if write!(stream, "PUT {path} HTTP/1.1\r\nHost: 127.0.0.1:{PORT}\r\nX-VoiceStudio-Next: {token}\r\nX-VoiceStudio-CSRF: 1\r\nOrigin: http://tauri.localhost\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).is_err() {
        return false;
    }
    let mut response = String::new();
    let _ = stream.take(16384).read_to_string(&mut response);
    let headers = response.split_once("\r\n\r\n").map_or(response.as_str(), |(headers, _)| headers);
    headers.starts_with("HTTP/1.1 200")
        && headers.lines().any(|line| line.split_once(':').is_some_and(|(key, value)| key.eq_ignore_ascii_case("x-voicestudio-next") && value.trim() == token))
}

fn engine_idle_seconds(timeout: Duration) -> u64 {
    if timeout == Duration::MAX { FOREVER_IDLE_SECONDS } else { timeout.as_secs() }
}

/// Best effort in the background (never blocks the UI or the status lock); the engine keeps the value in its preferences.
fn push_model_idle(token: String, timeout: Duration) {
    std::thread::spawn(move || {
        let body = format!("{{\"seconds\":{}}}", engine_idle_seconds(timeout));
        for attempt in 0..5 {
            if attempt > 0 { std::thread::sleep(Duration::from_secs(3)); }
            if backend_put(&token, "/next/settings/model-idle", &body) { return; }
        }
    });
}

fn backend_activity(token: &str) -> Option<BackendActivity> {
    let activity: BackendActivity = serde_json::from_str(&backend_get(token, "/next/activity", Duration::from_secs(1))?).ok()?;
    if !activity.idle_seconds.is_finite() || activity.idle_seconds < 0.0 {
        return None;
    }
    Some(activity)
}

#[derive(Serialize)]
pub struct RuntimeLease {
    lease: u64,
    status: RuntimeStatus,
}

#[tauri::command]
pub async fn runtime_acquire(
    runtime: tauri::State<'_, Runtime>,
    keep_warm: bool,
) -> Result<RuntimeLease, String> {
    let runtime = runtime.inner().clone();
    tauri::async_runtime::spawn_blocking(move || runtime.acquire(keep_warm))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn runtime_set_idle_minutes(runtime: tauri::State<'_, Runtime>, minutes: u64) -> Result<u64, String> {
    runtime.set_idle_minutes(minutes)
}

#[tauri::command]
pub fn runtime_set_preload(runtime: tauri::State<'_, Runtime>, enabled: bool) -> bool {
    runtime.set_preload(enabled)
}

#[tauri::command]
pub fn runtime_release(runtime: tauri::State<'_, Runtime>, lease: u64, cancel_startup: Option<bool>) {
    runtime.release_with_cancel(lease, cancel_startup.unwrap_or(false));
}

#[tauri::command]
pub async fn runtime_status(runtime: tauri::State<'_, Runtime>) -> Result<RuntimeStatus, String> {
    let runtime = runtime.inner().clone();
    tauri::async_runtime::spawn_blocking(move || runtime.status())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn runtime_start(runtime: tauri::State<'_, Runtime>) -> Result<RuntimeStatus, String> {
    let runtime = runtime.inner().clone();
    tauri::async_runtime::spawn_blocking(move || runtime.start())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn runtime_stop(runtime: tauri::State<'_, Runtime>) -> Result<RuntimeStatus, String> {
    let runtime = runtime.inner().clone();
    tauri::async_runtime::spawn_blocking(move || runtime.request_stop())
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests;
