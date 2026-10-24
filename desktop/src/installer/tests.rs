// Unit tests of the installer (installer.rs); a child module, so private items are reachable through `super::`.
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
        for name in [".installer-owner.json", "bootstrap-provenance.json", "python-ready.json", "installation-ready.json",
                     "engine.zip", "engine/uv.lock", "engine/pyproject.toml", ".venv/Scripts/python.exe"] {
            let _ = fs::remove_file(self.root.join(name));
        }
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
    let mut changed = fixture.manifest.clone(); changed["python"]["version"] = "modified".into();
    atomic_json(&fixture.root.join("bootstrap-provenance.json"), &changed).unwrap();
    assert!(validate_ready_against(&fixture.root, &fixture.manifest).unwrap_err().contains("Certyfikat instalacji"));
}
#[test] fn build_time_changes_of_the_distribution_keep_a_working_environment() {
    let fixture = ReadyFixture::new();
    let mut updated_app = fixture.manifest.clone(); updated_app["uv"]["version"] = "0.99.0".into(); updated_app["dependencyPolicy"] = "reworded".into();
    validate_ready_against(&fixture.root, &updated_app).unwrap();
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
#[test] fn missing_paths_are_not_links_but_real_directories_pass() {
    let missing = std::env::temp_dir().join("seventy-seven-labs-no-such-dir").join("child");
    assert!(no_links(&missing).is_ok());
    assert!(no_links_with(&std::env::temp_dir(), "a", "b").is_ok());
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
    let script_text = concat!(
        "param([string]$PidPath)\n",
        "$child=Start-Process -FilePath ($PSHOME+'\\powershell.exe') -ArgumentList '-NoProfile','-NonInteractive',",
        "'-Command','Start-Sleep -Seconds 60' -WindowStyle Hidden -PassThru\n",
        "$child.Id | Set-Content -LiteralPath $PidPath\nStart-Sleep -Seconds 60\n");
    fs::write(&script, script_text).unwrap();
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

#[test]
fn failed_event_gives_the_reason_and_keeps_the_stage() {
    let path = std::env::temp_dir().join(format!("seventy-seven-failed-event-{}.log", std::process::id()));
    let log = concat!(
        "NEXT_BOOTSTRAP_EVENT {\"phase\":\"dependencies\",\"message\":\"Instalacja zależności\"}\n",
        "NEXT_BOOTSTRAP_EVENT {\"phase\":\"failed\",\"message\":\"Brak miejsca na dysku\"}\n");
    std::fs::write(&path, log).unwrap();
    let installer = Installer::default();
    let reason = installer.read_log(&path);
    let _ = std::fs::remove_file(&path);
    assert_eq!(reason.as_deref(), Some("Brak miejsca na dysku"));
    assert_eq!(installer.snapshot().phase, "dependencies");
}

#[test]
fn cleanup_removes_only_owned_incomplete_candidates_and_their_workspace() {
    let tmp = std::env::temp_dir().join(format!("seventy-seven-cleanup-{}", std::process::id()));
    let (base, temp) = (tmp.join("base"), tmp.join("temp"));
    fs::create_dir_all(&base).unwrap(); fs::create_dir_all(&temp).unwrap();
    let make = |name: &str, ready: bool| {
        let root = base.join(name); fs::create_dir_all(root.join("python")).unwrap();
        atomic_json(&root.join(".installer-owner.json"), &serde_json::json!({"owner": OWNER, "id": name})).unwrap();
        if ready { fs::write(root.join("installation-ready.json"), b"{}").unwrap(); }
        root
    };
    let failed = make("runtime_aa", false);
    let workspace = temp.join("ssb-0123456789ab"); fs::create_dir_all(&workspace).unwrap(); fs::write(workspace.join(".runtime-build-owner.json"), b"{}").unwrap();
    atomic_json(&failed.join("build-workspace.json"), &serde_json::json!({"path": workspace.to_string_lossy()})).unwrap();
    let complete = make("runtime_bb", true);
    let active = make("runtime_cc", false);
    let foreign = base.join("runtime_dd"); fs::create_dir_all(&foreign).unwrap();
    assert_eq!(cleanup_failed(&base, &["runtime_cc".into()], &temp).unwrap(), 1);
    assert!(!failed.exists() && !workspace.exists());
    assert!(complete.exists() && active.exists() && foreign.exists());
    let _ = fs::remove_dir_all(&tmp);
}
