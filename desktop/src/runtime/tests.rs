// Unit tests of the supervisor (runtime.rs); a child module, so private items are reachable through `super::`.
#[test]
fn new_bundle_preserves_legacy_archive_and_rejects_corruption() {
    let root = std::env::temp_dir().join(format!("seventy-seven-bundle-{}-{}", std::process::id(), super::SystemTime::now().duration_since(super::UNIX_EPOCH).unwrap().as_nanos()));
    std::fs::create_dir_all(&root).unwrap();
    let legacy = root.join("engine.zip");
    std::fs::write(&legacy, b"previous environment archive").unwrap();
    let archive = super::embedded_archive(&root).unwrap();
    assert_ne!(archive, legacy);
    assert_eq!(std::fs::read(&legacy).unwrap(), b"previous environment archive");
    assert_eq!(std::fs::read(&archive).unwrap(), super::ENGINE);
    assert_eq!(super::embedded_archive(&root).unwrap(), archive);
    std::fs::write(&archive, b"interrupted or modified").unwrap();
    assert!(super::embedded_archive(&root).is_err());
    assert_eq!(std::fs::read(&archive).unwrap(), b"interrupted or modified");
    std::fs::remove_dir_all(root).unwrap();
}
use super::*;

#[test]
fn idle_minutes_accept_only_fixed_choices() {
    let runtime = Runtime::default();
    assert_eq!(runtime.0.lock().unwrap().idle_timeout, Duration::from_secs(900), "Default keep-warm is 15 minutes");
    for minutes in [5, 15, 30, 60] {
        assert_eq!(runtime.set_idle_minutes(minutes), Ok(minutes));
        assert_eq!(runtime.0.lock().unwrap().idle_timeout, Duration::from_secs(minutes * 60));
    }
    for minutes in [1, 10, 45, 61, 900] {
        assert!(runtime.set_idle_minutes(minutes).is_err(), "{minutes} minutes must be rejected");
    }
    assert_eq!(runtime.0.lock().unwrap().idle_timeout, Duration::from_secs(3600), "Rejected values keep the previous budget");
    assert_eq!(runtime.set_idle_minutes(0), Ok(0), "0 = Zawsze (never stop for idleness)");
    assert_eq!(runtime.0.lock().unwrap().idle_timeout, Duration::MAX);
    assert_eq!(engine_idle_seconds(Duration::MAX), FOREVER_IDLE_SECONDS);
    assert_eq!(engine_idle_seconds(Duration::from_secs(300)), 300);
}

#[test]
fn preload_flag_defaults_on_and_is_switchable() {
    let runtime = Runtime::default();
    assert!(runtime.0.lock().unwrap().preload_tts, "Preload stays on by default");
    assert!(!runtime.set_preload(false));
    assert!(!runtime.0.lock().unwrap().preload_tts);
    assert!(runtime.set_preload(true));
}

#[test]
fn relocation_progress_renews_only_for_new_copied_data_and_resets_before_backup() {
    let start = Instant::now();
    let mut clock = StartupClock::new("owned".into(), "archive".into(), start);
    let progress = serde_json::json!({"phase":"copy_files","revision":1,"bytes_done":100,"bytes_total":1000});
    clock.observe_storage(&progress, start + Duration::from_secs(170));
    assert!(!clock.expired(start + Duration::from_secs(200)));
    assert_eq!(clock.progress.phase, "relocation_files");
    clock.observe_storage(&progress, start + Duration::from_secs(300));
    assert!(clock.expired(start + Duration::from_secs(170) + STARTUP_BUDGET));
    clock.observe_storage(&serde_json::json!({"phase":"relocation_complete","revision":2}), start + Duration::from_secs(340));
    assert_eq!(clock.progress.copied_bytes, 0);
    assert!(!clock.progress.backup_complete);
    clock.observe(&serde_json::json!({"phase":"backup_plan","archive_sha256":"archive"}), start + Duration::from_secs(341));
    clock.observe(&serde_json::json!({"phase":"backup_files","copied_bytes":1,"total_bytes":10}), start + Duration::from_secs(342));
    assert_eq!(clock.progress.copied_bytes, 1);
    assert!(!clock.expired(start + Duration::from_secs(400)));
}

#[test]
fn startup_stage_only_moves_forward_and_ignores_unknown_ids() {
    let mut clock = StartupClock::new("owned".into(), "archive".into(), Instant::now());
    assert_eq!(clock.progress.stage, None);
    for (reported, expected) in [("modules", "modules"), ("engine_files", "modules"), ("unknown", "modules"), ("ml_imports", "ml_imports"), ("server", "ml_imports"), ("services_start", "services_start")] {
        clock.advance_stage(reported);
        assert_eq!(clock.progress.stage.as_deref(), Some(expected), "after {reported}");
    }
    let (_, failed) = clock.failed("fixture".into());
    assert_eq!(failed.stage.as_deref(), Some("services_start"), "A failure keeps the last stage reached");
}

fn backup_clock(now: Instant) -> StartupClock {
    StartupClock::new("fixture-run".into(), "fixture-sha".into(), now)
}

fn backup_plan(clock: &mut StartupClock, now: Instant) {
    clock.observe(&serde_json::json!({"phase":"backup_plan","archive_sha256":"fixture-sha"}), now);
}

#[test]
fn startup_only_new_copied_data_renews_deadline() {
    let start = Instant::now();
    let mut clock = backup_clock(start);
    clock.observe(&serde_json::json!({"phase":"backup_database","copied_pages":5,"total_pages":10}), start + Duration::from_secs(170));
    clock.observe(&serde_json::json!({"phase":"backup_plan","archive_sha256":"old-sha"}), start + Duration::from_secs(170));
    assert!(!clock.backup_seen);
    backup_plan(&mut clock, start + Duration::from_secs(170));
    assert!(clock.expired(start + STARTUP_BUDGET), "Planning alone cannot extend startup");
    clock.observe(&serde_json::json!({"phase":"backup_database","copied_pages":5,"total_pages":10}), start + Duration::from_secs(170));
    assert_eq!(clock.progress.revision, 1);
    assert!(!clock.expired(start + Duration::from_secs(349)));
    for event in [
        serde_json::json!({"phase":"backup_database","copied_pages":5,"total_pages":10}),
        serde_json::json!({"phase":"backup_database","copied_pages":4,"total_pages":10}),
        serde_json::json!({"phase":"backup_database","copied_pages":6,"total_pages":11}),
        serde_json::json!({"phase":"backup_files","copied_bytes":-1,"total_bytes":100}),
        serde_json::json!({"phase":"backup_files","copied_bytes":9007199254740992_u64,"total_bytes":9007199254740992_u64}),
        serde_json::json!({"phase":"untrusted_keepalive","copied_bytes":100,"total_bytes":100}),
    ] { clock.observe(&event, start + Duration::from_secs(340)); }
    assert_eq!(clock.progress.revision, 1);
    assert!(clock.expired(start + Duration::from_secs(170) + STARTUP_BUDGET), "Duplicates, changing totals, malformed data and chatter must stall");
    clock.observe(&serde_json::json!({"phase":"backup_database","copied_pages":10,"total_pages":10}), start + Duration::from_secs(340));
    clock.observe(&serde_json::json!({"phase":"backup_files","copied_bytes":40,"total_bytes":80}), start + Duration::from_secs(500));
    assert!(!clock.expired(start + Duration::from_secs(679)));
    clock.observe(&serde_json::json!({"phase":"backup_files","copied_bytes":40,"total_bytes":80}), start + Duration::from_secs(675));
    assert!(clock.expired(start + Duration::from_secs(500) + STARTUP_BUDGET));
    assert!(clock.message().contains("40 / 80"));
}

#[test]
fn startup_complete_gives_backend_one_new_budget_and_preserves_failure() {
    let start = Instant::now();
    let mut clock = backup_clock(start);
    backup_plan(&mut clock, start);
    clock.observe(&serde_json::json!({"phase":"backup_files","copied_bytes":80,"total_bytes":80}), start);
    let (_, failure) = clock.failed("fixture failure".into());
    assert_eq!(failure.phase, "backup_failed");
    assert_eq!(failure.copied_bytes, 80);
    assert!(!failure.backup_complete);
    assert!(clock.timeout_message().contains("engine.log"));
    let complete = serde_json::json!({"phase":"backup_complete","copied_bytes":200,"files":2});
    clock.observe(&complete, start + Duration::from_secs(175));
    assert!(clock.progress.backup_complete);
    assert_eq!(clock.progress.phase, "backend_starting");
    assert_eq!(clock.progress.copied_bytes, 200, "Completion includes SQLite bytes too");
    assert!(!clock.expired(start + Duration::from_secs(354)));
    clock.observe(&complete, start + Duration::from_secs(350));
    assert!(clock.expired(start + Duration::from_secs(175) + STARTUP_BUDGET), "A replayed receipt cannot renew backend startup");
    assert_eq!(clock.failed("fixture".into()).1.phase, "startup_failed");
}

fn fixture_log(name: &str, initial: &[u8]) -> (PathBuf, StartupLog) {
    let path = std::env::temp_dir().join(format!("seventy-seven-startup-{name}-{}-{}", std::process::id(), SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
    fs::write(&path, initial).unwrap();
    let reader = StartupLog::new(File::open(&path).unwrap(), initial.len() as u64);
    (path, reader)
}

fn append_fixture(path: &Path, bytes: &[u8]) {
    let mut file = OpenOptions::new().append(true).open(path).unwrap();
    file.write_all(bytes).unwrap();
    file.flush().unwrap();
}

#[test]
fn startup_log_ignores_history_and_waits_for_complete_current_lines() {
    let start = Instant::now();
    let history = b"NEXT_BACKUP_EVENT {\"phase\":\"backup_plan\",\"archive_sha256\":\"fixture-sha\"}\nNEXT_BACKUP_EVENT {\"phase\":\"backup_complete\",\"copied_bytes\":200,\"files\":2}\npartial history";
    let (path, mut log) = fixture_log("history", history);
    let mut clock = backup_clock(start);
    log.poll(&mut clock, start + Duration::from_secs(170)).unwrap();
    assert!(!clock.backup_seen);
    append_fixture(&path, b"NEXT_BACKUP_EVENT {\"phase\":\"backup_plan\",\"archive_sha256\":\"fixture-sha\"}\r\nNEXT_BACKUP_EVENT {\"phase\":\"backup_database\",\"copied_pages\":8,");
    log.poll(&mut clock, start + Duration::from_secs(170)).unwrap();
    assert!(clock.backup_seen);
    assert_eq!(clock.progress.revision, 0);
    append_fixture(&path, b"\"total_pages\":10}\n");
    log.poll(&mut clock, start + Duration::from_secs(175)).unwrap();
    assert_eq!(clock.progress.copied_pages, 8);
    log.poll(&mut clock, start + Duration::from_secs(350)).unwrap();
    assert!(clock.expired(start + Duration::from_secs(175) + STARTUP_BUDGET), "Rereading without new bytes is not progress");
    drop(log);
    fs::remove_file(path).unwrap();
}

#[test]
fn startup_log_is_bounded_and_truncation_never_rewinds() {
    let start = Instant::now();
    let (path, mut log) = fixture_log("bounds", b"");
    let mut clock = backup_clock(start);
    let mut oversized = vec![b'x'; BACKUP_LOG_BYTES_PER_POLL as usize + 1];
    oversized.extend_from_slice(b"\nNEXT_BACKUP_EVENT {\"phase\":\"backup_plan\",\"archive_sha256\":\"fixture-sha\"}\n");
    append_fixture(&path, &oversized);
    log.poll(&mut clock, start).unwrap();
    assert_eq!(log.offset, BACKUP_LOG_BYTES_PER_POLL);
    assert!(log.pending.len() <= BACKUP_LOG_LINE_BYTES);
    assert!(!clock.backup_seen);
    log.poll(&mut clock, start).unwrap();
    assert!(clock.backup_seen, "Oversized unrelated lines do not swallow the next valid line");
    fs::write(&path, b"short").unwrap();
    assert!(log.poll(&mut clock, start + Duration::from_secs(170)).is_err());
    append_fixture(&path, &oversized);
    log.poll(&mut clock, start + Duration::from_secs(175)).unwrap();
    assert!(clock.expired(start + STARTUP_BUDGET));
    assert!(log.invalidated);
    drop(log);
    fs::remove_file(path).unwrap();
}

// An owned test executable waits for stdin EOF, without Python, a server,
// models or any real user data. Normal suite invocation returns immediately.
#[test]
fn startup_fixture_child() {
    if std::env::var("SEVENTY_SEVEN_STARTUP_FIXTURE").as_deref() == Ok("1") {
        let mut buffer = Vec::new();
        std::io::stdin().read_to_end(&mut buffer).unwrap();
    }
}

fn runtime_with_fixture_child() -> (Runtime, PathBuf) {
    let (path, log) = fixture_log("cancel", b"");
    let mut command = Command::new(std::env::current_exe().unwrap());
    command.args(["--exact", "runtime::tests::startup_fixture_child", "--nocapture"])
        .env("SEVENTY_SEVEN_STARTUP_FIXTURE", "1")
        .stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::null());
    #[cfg(windows)] { use std::os::windows::process::CommandExt; command.creation_flags(0x08000000); }
    let runtime = Runtime::default();
    {
        let mut inner = runtime.0.lock().unwrap();
        inner.status = RuntimeStatus::new("starting", "fixture");
        inner.process = Some(Process { child: command.spawn().unwrap(), token: "fixture-not-auth".into(), ready: false, unresponsive_since: None, startup: backup_clock(Instant::now()), startup_log: log });
        inner.leases.insert(1, true);
        inner.leases.insert(2, true);
        inner.leases.insert(3, false);
    }
    (runtime, path)
}

#[test]
fn startup_cancel_only_stops_owned_child_after_last_warm_waiter() {
    let (runtime, path) = runtime_with_fixture_child();
    runtime.release_with_cancel(1, true);
    assert!(runtime.0.lock().unwrap().process.is_some(), "Another warm waiter still needs startup");
    runtime.release_with_cancel(2, true);
    assert!(runtime.0.lock().unwrap().process.is_none(), "The last cancelled startup waiter releases the owned child");
    assert_eq!(runtime.0.lock().unwrap().status.state, "stopped");
    runtime.release_with_cancel(2, true);
    drop(runtime);
    fs::remove_file(path).unwrap();
    let (runtime, path) = runtime_with_fixture_child();
    runtime.release(1);
    runtime.release(2);
    assert!(runtime.0.lock().unwrap().process.is_some(), "Ordinary release is not cancellation");
    runtime.0.lock().unwrap().process.as_mut().unwrap().ready = true;
    runtime.0.lock().unwrap().leases.insert(4, true);
    runtime.release_with_cancel(4, true);
    assert!(runtime.0.lock().unwrap().process.is_some(), "Ready work is protected from startup cancellation");
    runtime.stop();
    drop(runtime);
    fs::remove_file(path).unwrap();
}

#[test]
fn monitoring_and_metadata_do_not_start_python() {
    let runtime = Runtime::default();
    let lease = runtime.acquire(false);
    assert_eq!(lease.status.state, "stopped");
    runtime.release(lease.lease);
    assert!(runtime.0.lock().unwrap().process.is_none());
    assert_eq!(runtime.status().state, "stopped");
}

#[test]
fn monitor_release_is_idempotent_and_never_starts_python() {
    let runtime = Runtime::default();
    let lease = runtime.acquire(false);
    assert!(runtime.request_stop().is_ok());
    assert!(!runtime.idle_tick());
    runtime.release(lease.lease);
    runtime.release(lease.lease);
    assert!(runtime.request_stop().is_ok());
}

#[test]
fn manual_stop_only_warm_leases_block_it() {
    let runtime = Runtime::default();
    let monitor = runtime.acquire(false);
    assert!(runtime.request_stop().is_ok(), "Metadata observation is not a running job");
    runtime.0.lock().unwrap().leases.insert(99, true);
    assert!(runtime.request_stop().is_err(), "Actual warm work remains protected");
    runtime.release(99);
    runtime.release(monitor.lease);
    assert!(runtime.request_stop().is_ok());
}

static ACTIVITY_TEST_PORT: Mutex<()> = Mutex::new(());

fn activity_fixture_reply(busy: bool, keep_alive: bool, responses: usize) -> std::thread::JoinHandle<()> {
    let listener = TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], PORT))).expect("Only the free loopback QA port may be used");
    listener.set_nonblocking(true).unwrap();
    std::thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(4);
        let mut count = 0;
        while count < responses && Instant::now() < deadline {
            match listener.accept() {
                Ok((mut stream, _)) => {
                    stream.set_read_timeout(Some(Duration::from_millis(500))).unwrap();
                    let mut request = [0_u8; 2048];
                    let length = stream.read(&mut request).unwrap();
                    assert!(String::from_utf8_lossy(&request[..length]).contains("X-VoiceStudio-Next: fixture-not-auth"));
                    let body = format!("{{\"busy\":{busy},\"keep_alive\":{keep_alive},\"idle_seconds\":999}}");
                    write!(stream, "HTTP/1.1 200 OK\r\nX-VoiceStudio-Next: fixture-not-auth\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
                    count += 1;
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => std::thread::sleep(Duration::from_millis(5)),
                Err(error) => panic!("Own fixture listener failed: {error}"),
            }
        }
        assert_eq!(count, responses, "The actual guarded probe must reach the owned fixture");
    })
}

fn ready_monitor_fixture() -> (Runtime, PathBuf) {
    let (runtime, path) = runtime_with_fixture_child();
    {
        let mut inner = runtime.0.lock().unwrap();
        inner.leases.remove(&1); inner.leases.remove(&2);
        inner.process.as_mut().unwrap().ready = true;
        inner.idle_timeout = Duration::from_secs(1);
        inner.last_use = Instant::now() - Duration::from_secs(10);
    }
    (runtime, path)
}

#[test]
fn idle_monitor_lease_does_not_keep_owned_idle_child_alive() {
    let _port = ACTIVITY_TEST_PORT.lock().unwrap();
    let (runtime, path) = ready_monitor_fixture();
    let server = activity_fixture_reply(false, false, 1);
    assert!(runtime.idle_tick(), "A false metadata lease cannot renew a completed idle budget");
    server.join().unwrap();
    assert!(runtime.0.lock().unwrap().process.is_none());
    drop(runtime); fs::remove_file(path).unwrap();
}

#[test]
fn mcp_keep_alive_prevents_idle_but_allows_explicit_stop() {
    let _port = ACTIVITY_TEST_PORT.lock().unwrap();
    let (runtime, path) = ready_monitor_fixture();
    let server = activity_fixture_reply(false, true, 2);
    assert!(!runtime.idle_tick(), "MCP keeps its listener reachable during idle");
    assert!(runtime.request_stop().is_ok(), "A deliberate Stop remains allowed for idle MCP");
    server.join().unwrap();
    drop(runtime); fs::remove_file(path).unwrap();
}

#[test]
fn real_backend_busy_or_unknown_proof_still_blocks_monitor_stop() {
    let _port = ACTIVITY_TEST_PORT.lock().unwrap();
    let (runtime, path) = ready_monitor_fixture();
    let server = activity_fixture_reply(true, false, 2);
    assert!(!runtime.idle_tick(), "Physical/background work remains protected");
    assert!(runtime.request_stop().is_err());
    server.join().unwrap();
    // The listener is gone: inability to prove backend idle remains closed.
    assert!(runtime.request_stop().is_err());
    assert!(runtime.0.lock().unwrap().process.is_some());
    runtime.stop(); drop(runtime); fs::remove_file(path).unwrap();
}

#[test]
fn unresponsive_ready_engine_is_stoppable_only_after_grace() {
    let _port = ACTIVITY_TEST_PORT.lock().unwrap();
    let (runtime, path) = ready_monitor_fixture();
    runtime.0.lock().unwrap().process.as_mut().unwrap().unresponsive_since = Some(Instant::now() - Duration::from_secs(10));
    assert!(runtime.request_stop().is_err(), "A short health gap is not yet an unresponsive engine");
    runtime.0.lock().unwrap().process.as_mut().unwrap().unresponsive_since = Some(Instant::now() - Duration::from_secs(91));
    assert!(runtime.status().message.contains("nie odpowiada od"));
    assert!(runtime.request_stop().is_ok(), "A stale unresponsive ready engine may be stopped manually");
    assert!(runtime.0.lock().unwrap().process.is_none());
    drop(runtime); fs::remove_file(path).unwrap();
}

fn http(path: &str, body: Option<&str>) -> Vec<u8> {
    let mut stream = TcpStream::connect(("127.0.0.1", PORT)).unwrap();
    stream
        .set_read_timeout(Some(Duration::from_secs(360)))
        .unwrap();
    let body = body.unwrap_or("");
    let method = if body.is_empty() { "GET" } else { "POST" };
    write!(stream, "{method} {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\nContent-Type: application/x-www-form-urlencoded\r\nContent-Length: {}\r\n\r\n{body}", body.len()).unwrap();
    let mut response = Vec::new();
    stream.read_to_end(&mut response).unwrap();
    assert!(
        response.starts_with(b"HTTP/1.1 200"),
        "{}",
        String::from_utf8_lossy(&response[..response.len().min(1200)])
    );
    response
}

#[test]
#[ignore = "Starts only the private local backend; optionally performs one real synthesis"]
fn lifecycle_live() {
    let guard = TcpListener::bind(("127.0.0.1", PORT))
        .expect("Port 4312 must be free; never stop another process");
    drop(guard);
    let runtime = Runtime::default();
    let profiles = crate::library::read_profiles().unwrap();
    assert!(runtime.0.lock().unwrap().process.is_none());
    println!("COLD_LIBRARY count={}, python_processes=0", profiles.len());
    let lease = runtime.acquire(true);
    assert_eq!(lease.status.state, "starting", "{}", lease.status.message);
    let deadline = Instant::now() + Duration::from_secs(305);
    while runtime.status().state != "ready" {
        assert!(Instant::now() < deadline, "Backend start timed out");
        std::thread::sleep(Duration::from_millis(500));
    }
    assert!(runtime.request_stop().is_err());
    let token = runtime
        .0
        .lock()
        .unwrap()
        .process
        .as_ref()
        .unwrap()
        .token
        .clone();
    assert!(backend_activity(&token).is_some());
    let response = http("/profiles", None);
    let boundary = response.windows(4).position(|w| w == b"\r\n\r\n").unwrap() + 4;
    let remote: serde_json::Value = serde_json::from_slice(&response[boundary..]).unwrap();
    let local = serde_json::to_value(&profiles).unwrap();
    assert_eq!(remote.as_array().unwrap().len(), profiles.len());
    for (native, server) in local
        .as_array()
        .unwrap()
        .iter()
        .zip(remote.as_array().unwrap())
    {
        for field in ["id", "name", "description", "language", "kind", "image_url"] {
            assert_eq!(
                native[field], server[field],
                "Native profile differs: {field}"
            );
        }
    }
    let synthesis = std::env::var("VOICESTUDIO_NEXT_TEST_SYNTHESIS").as_deref() == Ok("1");
    let mut audio_bytes = 0;
    if synthesis {
        let profile = local[0]["id"]
            .as_str()
            .expect("A private voice is required");
        let start = Instant::now();
        let response = http("/generate", Some(&format!("text=To+jest+test+lekkiego+studia.&profile_id={profile}&engine=omnivoice&language=Polish&speed=1&num_step=16&seed=42")));
        let boundary = response.windows(4).position(|w| w == b"\r\n\r\n").unwrap() + 4;
        assert!(String::from_utf8_lossy(&response[..boundary]).contains("audio/"));
        assert_eq!(&response[boundary..boundary + 4], b"RIFF");
        assert_eq!(&response[boundary + 8..boundary + 12], b"WAVE");
        audio_bytes = response.len() - boundary;
        assert!(audio_bytes > 1000);
        println!(
            "SYNTHESIS audio_bytes={audio_bytes}, seconds={:.2}",
            start.elapsed().as_secs_f64()
        );
    }
    runtime.release(lease.lease);
    runtime.0.lock().unwrap().idle_timeout = Duration::from_secs(2);
    let deadline = Instant::now() + Duration::from_secs(40);
    while !runtime.idle_tick() {
        assert!(
            Instant::now() < deadline,
            "Engine did not confirm safe idle"
        );
        std::thread::sleep(Duration::from_secs(1));
    }
    assert_eq!(runtime.status().state, "stopped");
    assert!(TcpListener::bind(("127.0.0.1", PORT)).is_ok());
    // A new task must be able to restart after the supervisor freed RAM.
    let second = runtime.acquire(true);
    assert_eq!(second.status.state, "starting");
    runtime.release(second.lease);
    runtime.stop();
    assert!(TcpListener::bind(("127.0.0.1", PORT)).is_ok());
    println!("LIVE_PASS native_profiles_match=true, active_lease_protected=true, idle_stopped=true, restart=true, port_released=true, audio_bytes={audio_bytes}");
}
