"""Prepared REAL audio.cpp install/cancel/retry acceptance against owned QA only.

No action on import. Requires --run, the explicit reviewed disclosure_id and an
existing model to hash. No model/license selection, activation or cleanup/delete.
Only the backend owns/cancels the worker Job; this script never kills any PID.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import time
import urllib.error
import urllib.request
import uuid

from engine_installation import read_catalog
from model_management import _no_link_ancestors
from dictation_desktop_acceptance import report_destination, _owner_module

_QA_OUTPUT = Path(__file__).resolve().parents[2] / ".tmp/qa"
_QA_OUTPUT.mkdir(parents=True, exist_ok=True)

ROOT = Path(__file__).resolve().parents[2]
ENGINE_ID = "audio-cpp"
OWNER = "Seventy Seven Labs audio.cpp acceptance v1"
REVIEWED = {
    "version": "v0.7.4",
    "url": "https://github.com/0xShug0/audio.cpp/releases/download/v0.7.4/audio-v0.7.4-bin-windows-x64-vulkan.zip",
    "archive": "audio-v0.7.4-bin-windows-x64-vulkan.zip",
    "sha256": "057332f9e3fb37706a8ecb5075ac1797efcd85fdccd739f7b65761a5920f2828",
    "download_bytes": 56_818_905,
}
TRANSFER_LIMIT = 300_000_000
BINARY_LIMIT = 1_000_000_000
CHUNK = 256 * 1024


def digest(path):
    with Path(path).open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def load(path, fallback=None):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except FileNotFoundError:
        return fallback


def file_state(path):
    path = Path(path)
    return {"exists": path.is_file(), "sha256": digest(path) if path.is_file() else None,
            "bytes": path.stat().st_size if path.is_file() else 0}


def check(value, message):
    if not value:
        raise AssertionError(message)


def models_are_unloaded(status, loaded):
    # /model/loaded also reports changing RAM/VRAM. Those measurements must
    # never be treated as evidence of a loaded model or compared for equality.
    return status.get("loaded") is False and status.get("loading") is False and loaded.get("models") == [] and loaded.get("count") == 0


def has_cpu_device(text):
    return bool(re.search(r'^CPU:[ \t]*[0-9]+[ \t]+"[^"\r\n]*"[ \t]+\[CPU\][ \t]*\r?$', text, re.M))


def tree_state(root):
    """Own QA cache metadata only; never follows a link to another cache."""
    root = Path(root)
    _no_link_ancestors(root)
    result = {}
    if not root.exists():
        return result
    for directory, dirs, files in os.walk(root, followlinks=False):
        for name in dirs:
            try:
                _no_link_ancestors(Path(directory) / name)
            except FileNotFoundError:
                continue  # the owned installer atomically moves/removes temp dirs
        for name in files:
            path = Path(directory) / name
            try:
                _no_link_ancestors(path)
                info = path.stat()
            except FileNotFoundError:
                continue
            result[str(path.relative_to(root))] = {"bytes": info.st_size, "mtime_ns": info.st_mtime_ns, "links": info.st_nlink}
            check(len(result) <= 50_000, "Cache QA jest zbyt duży do tego małego odbioru; wybierz wydzieloną sesję.")
    return result


def native_bytes(attempt):
    return sum(item["bytes"] for item in tree_state(attempt).values())


def probe_native(install, output):
    """Fixed, hashed --list-devices only, in this acceptance's own retained Job."""
    owner = _owner_module(output)
    isolated = output / "native-probe"
    for directory in (isolated, isolated / "local", isolated / "roaming", isolated / "profile"):
        directory.mkdir(exist_ok=True)
    environment = {key: value for key in ("SYSTEMROOT", "WINDIR", "COMSPEC", "NUMBER_OF_PROCESSORS") if (value := os.environ.get(key))}
    check(environment.get("SYSTEMROOT"), "Brak katalogu Windows dla kontrolowanego programu.")
    environment.update(PATH=str(install) + os.pathsep + str(Path(environment["SYSTEMROOT"]) / "System32"),
                       LOCALAPPDATA=str(isolated / "local"), APPDATA=str(isolated / "roaming"), USERPROFILE=str(isolated / "profile"),
                       TEMP=str(isolated), TMP=str(isolated))
    with (isolated / "stdout.txt").open("wb") as stdout, (isolated / "stderr.txt").open("wb") as stderr:
        process = owner.spawn_owned([str(install / "audiocpp_server.exe"), "--list-devices"], cwd=str(install), env=environment,
                                    stdin=subprocess.DEVNULL, stdout=stdout, stderr=stderr)
        try:
            code = process.wait(timeout=20)
        except subprocess.TimeoutExpired:
            process.kill(); process.wait(timeout=5)
            raise RuntimeError("Własny test --list-devices przekroczył 20 s; zatrzymano jego Job.")
    text = (isolated / "stdout.txt").read_text(encoding="utf-8", errors="replace")[:20_000]
    error = (isolated / "stderr.txt").read_text(encoding="utf-8", errors="replace")[:10_000]
    (isolated / "process-result.json").write_text(json.dumps({"exit_code": code, "owned_process_exited": process.poll() is not None}), encoding="utf-8")
    check(code == 0 and has_cpu_device(text), "Przypięty program nie potwierdził urządzenia CPU bez modelu.")
    return {"command": "audiocpp_server.exe --list-devices", "exit_code": code, "stdout": text, "stderr": error,
            "owned_process_exited": process.poll() is not None, "model_argument_supplied": False}


class Api:
    def __init__(self, marker, port=4312):
        check(port in (4312, 4313), "Port odbioru musi należeć do jawnego QA 4312/4313.")
        self.marker, self.port = marker, port

    def call(self, path, body=None):
        headers = {"Origin": "http://tauri.localhost", "X-VoiceStudio-CSRF": "1", "Sec-Fetch-Site": "same-origin", "X-VoiceStudio-Next": self.marker}
        payload = json.dumps(body).encode("utf-8") if body is not None else None
        if payload is not None:
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(f"http://127.0.0.1:{self.port}" + path, data=payload, headers=headers)
        try:
            response = urllib.request.urlopen(request, timeout=15)
        except urllib.error.HTTPError as exc:
            raise RuntimeError(f"{path}: HTTP {exc.code}: " + exc.read(1000).decode("utf-8", errors="replace")) from exc
        with response:
            check(response.headers.get("x-voicestudio-next") == self.marker, "Odpowiedź nie pochodzi z oznaczonego backendu QA.")
            return json.load(response)

    def job(self):
        response = self.call("/next/engine-runtimes/jobs")
        return next((item for item in response["jobs"] if item["engine_id"] == ENGINE_ID), None), response


def wait_until(function, seconds, message):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        result = function()
        if result:
            return result
        time.sleep(.075)
    raise RuntimeError(message)


def owned_qa_backend(qa_root, port=4312):
    import psutil
    check(port in (4312, 4313), "Nieprawidłowy port wydzielonego QA.")
    listeners = [item for item in psutil.net_connections(kind="tcp") if item.laddr and item.laddr.port == port and item.status == "LISTEN"]
    check(listeners and all(item.laddr.ip in {"127.0.0.1", "::1"} and item.pid for item in listeners), "QA nie ma jednoznacznego lokalnego listenera.")
    check(len({item.pid for item in listeners}) == 1, "Więcej niż jeden proces posiada port QA.")
    process = psutil.Process(listeners[0].pid)
    command = process.cmdline()
    check(any(Path(value).name.lower() == "qa_session.py" for value in command), "Listener nie jest własną qa_session.py; nie uruchomiono testu.")
    check("--root" in command and Path(command[command.index("--root") + 1]).resolve() == qa_root, "Listener QA należy do innego katalogu --root.")
    check("--port" in command and command[command.index("--port") + 1] == str(port), "Listener QA nie ma jawnego oczekiwanego --port.")
    return process


def recipe_for(engine, catalog, disclosure):
    local = next(item for item in read_catalog(engine) if item["engine_id"] == ENGINE_ID)
    remote = next(item for item in catalog["engines"] if item["engine_id"] == ENGINE_ID)
    check(remote["kind"] == "native" and remote["supported"] and not remote["license_required"], "Receptura wymaga innego zakresu lub decyzji dla modelu.")
    check(local["disclosure_id"] == remote["disclosure_id"] == disclosure, "Podane jawne disclosure_id nie odpowiada bieżącej recepturze QA i kodowi.")
    check(remote["source_urls"] == [REVIEWED["url"]] and remote["archive_name"] == REVIEWED["archive"] and remote["archive_sha256"] == REVIEWED["sha256"]
          and remote["download_bytes"] == REVIEWED["download_bytes"] and remote["version"] == REVIEWED["version"], "Przypięty artefakt zmienił się; wymagany nowy przegląd.")
    return remote


def acceptance(arguments):
    import psutil
    check(os.name == "nt", "Ten odbiór dotyczy przypiętego wydania Windows x64.")
    check(re.fullmatch(r"[a-f0-9]{64}", arguments.disclosure_id), "Podaj jawny disclosure_id z katalogu QA.")
    qa_root = arguments.qa_root.resolve()
    runtime, data = qa_root / "runtime", qa_root / "data"
    for path in (arguments.qa_root, runtime, data, arguments.engine_path):
        _no_link_ancestors(path)
    check(runtime.is_dir() and data.is_dir() and (qa_root / "server.log").is_file(), "Brak struktury wydzielonej sesji QA.")
    for variable in ("LOCALAPPDATA", "APPDATA"):
        if os.environ.get(variable):
            actual = Path(os.environ[variable]).resolve()
            for suffix in ("VoiceStudioNext", "OmniVoice", "Programs/VoiceStudio"):
                protected = actual / suffix
                check(not qa_root.is_relative_to(protected), "Test nie może wskazywać rzeczywistych danych aplikacji.")
    engine = arguments.engine_path.resolve()
    check(engine.is_relative_to(runtime), "Źródła wybranego silnika nie należą do runtime QA.")
    model = arguments.guard_model.resolve()
    check(model.is_file(), "Brak jawnie wskazanego istniejącego modelu do ochrony SHA.")
    api = Api(arguments.qa_marker, arguments.port)
    health = api.call("/health")
    check(health.get("version") == "0.5.7", "QA nie korzysta z docelowych źródeł 0.5.7.")
    backend = owned_qa_backend(qa_root, arguments.port)
    catalog = api.call("/next/engine-runtimes/catalog")
    check(Path(catalog["root"]).resolve() == (runtime / "sidecars").resolve(), "Katalog instalacji API nie odpowiada wskazanemu runtime QA.")
    recipe = recipe_for(engine, catalog, arguments.disclosure_id)
    job_before, jobs_before = api.job()
    post_fix = bool(arguments.post_fix_of)
    verify_existing = bool(arguments.verify_existing_attempt)
    check(not verify_existing or post_fix, "Weryfikacja po poprawce parsera wymaga jawnego --post-fix-of.")
    if verify_existing:
        check(re.fullmatch(r"[a-f0-9]{32}", arguments.verify_existing_attempt), "Nieprawidłowy identyfikator istniejącej instalacji.")
        check(job_before and job_before["state"] == "complete" and job_before.get("verified") and job_before["attempt_id"] == arguments.verify_existing_attempt
              and job_before["disclosure_id"] == arguments.disclosure_id, "Można sprawdzić wyłącznie wskazaną własną, ukończoną instalację.")
    elif post_fix:
        check(re.fullmatch(r"[a-f0-9]{32}", arguments.post_fix_of), "Nieprawidłowy identyfikator poprzedniej nieudanej próby.")
        check(job_before and job_before["state"] == "failed" and job_before["attempt_id"] == arguments.post_fix_of and job_before["disclosure_id"] == arguments.disclosure_id,
              "Dodatkowy odbiór wymaga dokładnie wskazanej własnej, nieudanej próby bieżącej receptury.")
    else:
        check(job_before is None, "Istnieje już job audio-cpp. Zachowano go; do nowego odbioru użyj nowej sesji QA.")
    check(not jobs_before["busy"] and not api.call("/next/activity")["busy"], "Backend QA lub inny instalator jest zajęty.")
    # At most TWO fixed-size responses are requested: early cancellation and
    # one retry. Worker aborts a response after expected size + one chunk.
    # This static upper bound is stronger than summing sampled progress bytes.
    response_count = 3 if post_fix else 2
    transfer_upper_bound = response_count * (REVIEWED["download_bytes"] + CHUNK)
    check(transfer_upper_bound < TRANSFER_LIMIT, "Jawne próby przekroczyłyby limit transferu 300 MB.")
    required = recipe["required_bytes"] + 5 * 1024**3
    check(shutil.disk_usage(runtime).free >= required, "Brak miejsca wymaganego przez rzeczywistą recepturę wraz z zapasem.")
    environment = data / "environment"
    environment_before = file_state(environment)
    model_before = file_state(model)
    cache_before = tree_state(runtime / "sidecar-cache")
    pointer_before = file_state(runtime / "model-cache.json")
    model_status_before = api.call("/model/status")
    loaded_before = api.call("/model/loaded")
    check(models_are_unloaded(model_status_before, loaded_before), "Na minimalny odbiór zaczekaj do sesji QA bez wczytanych modeli.")
    records_before = {item["engine_id"]: item for item in jobs_before["jobs"] if not (post_fix and item["engine_id"] == ENGINE_ID)}
    previous_attempt = runtime / "sidecars" / ENGINE_ID / arguments.post_fix_of if post_fix else None
    previous_files = tree_state(previous_attempt) if previous_attempt else {}
    output = qa_root / "acceptance" / ("audio-cpp-" + uuid.uuid4().hex)
    _no_link_ancestors(output)
    output.mkdir(parents=True)
    arguments.report = report_destination(arguments.report, output)
    (output / ".qa-owner.json").write_text(json.dumps({"owner": OWNER, "qa_marker": arguments.qa_marker, "artifact": REVIEWED}), encoding="utf-8")
    (output / "jobs-before.json").write_text(json.dumps(jobs_before, ensure_ascii=False, indent=2), encoding="utf-8")
    if (data / "engine-runtime-jobs.json").is_file():
        (output / "jobs-before-exact.json").write_bytes((data / "engine-runtime-jobs.json").read_bytes())
    report = {"schema": 1, "backend": "owned disposable QA", "port": arguments.port, "qa_root": str(qa_root), "backup": str(output), "artifact": REVIEWED,
              "limits": {"transfer_bytes": TRANSFER_LIMIT, "cumulative_response_upper_bound_bytes": transfer_upper_bound, "maximum_responses_this_receipt": 0 if verify_existing else 1 if post_fix else 2, "native_tree_bytes": BINARY_LIMIT},
              "disclosure_id": arguments.disclosure_id, "checks": [], "observations": [], "activation_performed": False,
              "model_license_decision_performed": False, "models_downloaded": False, "generation_performed": False,
              "torch_packages_installed": False, "torch_library_import_possible": True, "guard_model": model.name, "cleanup_errors": []}
    report["model_state_before"] = {"status": model_status_before, "loaded": loaded_before}
    report["receipt_kind"] = "verify_existing_post_fix_install_no_transfer" if verify_existing else "single_post_fix_install" if post_fix else "initial_cancel_and_retry"
    report["post_fix_of"] = arguments.post_fix_of
    observed, owned_attempt, active = {}, None, False
    peaks = {"measured_download_bytes": 0, "observed_private_tree_bytes": 0}

    def record(name, value):
        report["checks"].append({"name": name, "passed": bool(value)})
        check(value, name)

    def sample():
        nonlocal owned_attempt
        job, state = api.job()
        check(job is not None, "Backend utracił własny job testowy.")
        check(job["disclosure_id"] == arguments.disclosure_id, "Bieżący job nie należy do potwierdzonej receptury.")
        attempt_id = job["attempt_id"]
        check(re.fullmatch(r"[a-f0-9]{32}", attempt_id), "Nieprawidłowa ścieżka joba QA.")
        attempt = runtime / "sidecars" / ENGINE_ID / attempt_id
        check(owned_attempt is None or attempt == owned_attempt, "Backend zastąpił nasz job inną operacją; nie anulowano jej.")
        owned_attempt = attempt
        _no_link_ancestors(attempt)
        usage = native_bytes(attempt)
        peaks["observed_private_tree_bytes"] = max(peaks["observed_private_tree_bytes"], usage)
        peaks["measured_download_bytes"] = max(peaks["measured_download_bytes"], job.get("downloaded_bytes") or 0)
        check(usage <= BINARY_LIMIT, "Własne pliki binarne/tymczasowe przekroczyły 1 GB; wymagana anulacja własnego joba.")
        check((job.get("downloaded_bytes") or 0) <= REVIEWED["download_bytes"], "Postęp przekroczył rozmiar przypiętego artefaktu.")
        for child in backend.children(recursive=True):
            try:
                if any(str(attempt).lower() in argument.lower() for argument in child.cmdline()):
                    observed[(child.pid, child.create_time())] = child
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                pass
        previous = report["observations"][-1] if report["observations"] else {}
        if (job["state"], job["phase"]) != (previous.get("state"), previous.get("phase")):
            report["observations"].append({key: job.get(key) for key in ("state", "phase", "downloaded_bytes", "total_bytes")})
            print("NEXT_AUDIOCPP_ACCEPTANCE " + json.dumps(report["observations"][-1]), flush=True)
        return job, state

    def assert_drained():
        _gone, alive = psutil.wait_procs(list(observed.values()), timeout=3)
        # Stable Process objects retain create_time, protecting against PID reuse.
        still_owned = []
        for child in alive:
            try:
                if (child.pid, child.create_time()) in observed and child.is_running():
                    still_owned.append(child.pid)
            except psutil.NoSuchProcess:
                pass
        check(not still_owned, "Nie zakończyło się całe zaobserwowane własne drzewo instalatora.")
        for child in backend.children(recursive=True):
            try:
                check(not any(str(owned_attempt).lower() in argument.lower() for argument in child.cmdline()), "Pozostał żywy potomek własnej próby.")
            except psutil.NoSuchProcess:
                pass

    try:
        payload = {"engine_id": ENGINE_ID, "disclosure_id": arguments.disclosure_id, "accepted": True}
        def terminal():
            job, state = sample()
            return (job, state) if job["state"] not in {"starting", "installing", "verifying", "cancelling"} else None
        if not post_fix:
            api.call("/next/engine-runtimes/install", payload); active = True
            def downloaded():
                job, _ = sample()
                check(job["state"] not in {"complete", "failed", "cancelled"}, "Pierwsza próba zakończyła się przed zaplanowaną anulacją.")
                return job if job["phase"] == "native_download" and (job.get("downloaded_bytes") or 0) > 0 else None
            first = wait_until(downloaded, arguments.timeout_seconds, "Brak rzeczywistego postępu pobierania w pierwszej próbie.")
            report["first_attempt_id"] = first["attempt_id"]
            api.call("/next/engine-runtimes/cancel", {"engine_id": ENGINE_ID})
            cancelled, state = wait_until(terminal, 25, "Brak potwierdzonego zatrzymania własnego Job.")
            active = False
            report["cancelled_job"] = cancelled
            record("cancel_terminal_and_busy_released", cancelled["state"] == "cancelled" and not state["busy"])
            assert_drained(); record("cancel_complete_process_tree_drained", True)
            record("cancel_wrote_no_success_marker", not (owned_attempt / ".seventy-seven-runtime-complete.json").exists())
        # One retry, or one separately authorized post-fix install. No hidden loop.
        if not verify_existing:
            api.call("/next/engine-runtimes/install", payload); active = True
        complete, state = wait_until(terminal, arguments.timeout_seconds, "Nie ukończono jedynej pełnej próby.")
        active = False
        report["post_fix_terminal_job" if post_fix else "retry_terminal_job"] = complete
        record("post_fix_complete_verified_and_drained" if post_fix else "retry_complete_verified_and_drained", complete["state"] == "complete" and complete.get("verified") and not state["busy"])
        if post_fix:
            record("post_fix_created_new_immutable_attempt", complete["attempt_id"] != arguments.post_fix_of)
            retained = owned_attempt / "downloads" / REVIEWED["archive"]
            record("pinned_archive_retained_and_verified", retained.is_file() and retained.stat().st_size == REVIEWED["download_bytes"] and digest(retained) == REVIEWED["sha256"])
        else:
            record("retry_reused_only_own_attempt", complete["attempt_id"] == report["first_attempt_id"])
        assert_drained(); record("successful_process_tree_drained", True)
        marker = load(owned_attempt / ".seventy-seven-runtime-complete.json")
        install = Path(marker["install_dir"])
        _no_link_ancestors(install)
        record("success_marker_is_own_native_tree", install == owned_attempt / "native" and marker["engine_id"] == ENGINE_ID and marker["disclosure_id"] == arguments.disclosure_id)
        binaries = marker["binaries"]
        record("both_native_exe_hashes_match_verified_marker", set(binaries) == {"audiocpp_server.exe", "audiocpp_cli.exe"} and all(digest(install / name) == value for name, value in binaries.items()))
        files = tree_state(install)
        report["installed_artifacts"] = [{"file": name, "bytes": value["bytes"], "sha256": digest(install / name)} for name, value in files.items()]
        record("native_files_are_copies_under_one_gb", sum(item["bytes"] for item in files.values()) <= BINARY_LIMIT and all(item["links"] == 1 for item in files.values()))
        # Stock _install already required exit 0; acceptance separately retains
        # a Job and records the actual device output, never a model/server run.
        record("stock_device_probe_source_is_reviewed", recipe["installer_sha256"] == digest(engine / "backend/services/audiocpp_runtime_install.py"))
        report["native_probe"] = probe_native(install, output)
        record("real_native_device_probe_without_model", report["native_probe"]["owned_process_exited"])
        record("no_activation_or_model_action", not complete.get("activation") and not complete.get("restart_required"))
        report["completion_marker"] = marker
        report["pinned_archive_verified_by_worker"] = True
    except Exception as exc:
        report["error"] = str(exc)[:1600]
    finally:
        if active:
            try:
                job, _ = api.job()
                if job and owned_attempt and job.get("attempt_id") == owned_attempt.name and job.get("disclosure_id") == arguments.disclosure_id:
                    api.call("/next/engine-runtimes/cancel", {"engine_id": ENGINE_ID})
                    wait_until(lambda: api.job()[0]["state"] not in {"starting", "installing", "verifying", "cancelling"}, 25, "Nie potwierdzono anulacji podczas cleanup.")
                    assert_drained()
            except Exception as exc:
                report["cleanup_errors"].append(str(exc))
        # Preserve EVERYTHING on disk. Compare rather than restore/delete.
        try:
            if owned_attempt:
                assert_drained()
                record("final_terminal_process_tree_drained", True)
            environment_after, model_after = file_state(environment), file_state(model)
            report["guards"] = {"environment_before": environment_before, "environment_after": environment_after,
                                "model_before": model_before, "model_after": model_after}
            record("data_environment_hash_unchanged", environment_before == environment_after)
            record("existing_model_hash_unchanged", model_before == model_after)
            record("cache_pointer_unchanged", pointer_before == file_state(runtime / "model-cache.json"))
            cache_after = tree_state(runtime / "sidecar-cache")
            record("all_previous_private_cache_entries_preserved", all(cache_after.get(key) == value for key, value in cache_before.items()))
            _, jobs_after = api.job()
            after_map = {item["engine_id"]: item for item in jobs_after["jobs"]}
            record("all_other_previous_jobs_preserved", all(after_map.get(key) == value for key, value in records_before.items()))
            if previous_attempt:
                now_previous = tree_state(previous_attempt)
                record("previous_failed_attempt_files_preserved", all(now_previous.get(key) == value for key, value in previous_files.items()))
            now_model, now_loaded = api.call("/model/status"), api.call("/model/loaded")
            report["model_state_after"] = {"status": now_model, "loaded": now_loaded}
            record("no_additional_model_loaded", models_are_unloaded(now_model, now_loaded))
        except Exception as exc:
            report["cleanup_errors"].append(str(exc))
        report["peaks"] = peaks
        report["observed_process_count"] = len(observed)
        report["passed"] = not report.get("error") and not report["cleanup_errors"] and bool(report["checks"]) and all(item["passed"] for item in report["checks"])
        arguments.report.parent.mkdir(parents=True, exist_ok=True)
        arguments.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        (output / "report.json").write_bytes(arguments.report.read_bytes())
    return report


def main():
    parser = argparse.ArgumentParser(description="Jawny realny odbiór przypiętego audio.cpp tylko w wydzielonym QA.")
    parser.add_argument("--run", action="store_true")
    parser.add_argument("--qa-root", type=Path, required=True)
    parser.add_argument("--port", type=int, choices=(4312, 4313), default=4312)
    parser.add_argument("--post-fix-of", default=None, help="Jedno osobne pobranie po naprawie, tylko dla wskazanego failed attempt; bez cancel/retry.")
    parser.add_argument("--verify-existing-attempt", default=None, help="Wyłącznie hash/probe istniejącej complete instalacji; zero POST/install/transferu.")
    parser.add_argument("--engine-path", type=Path, required=True)
    parser.add_argument("--disclosure-id", required=True)
    parser.add_argument("--guard-model", type=Path, required=True)
    parser.add_argument("--qa-marker", default="seventy-seven-qa-owned")
    parser.add_argument("--timeout-seconds", type=int, default=300)
    parser.add_argument("--report", type=Path, default=ROOT / ".tmp/qa/audio-cpp-install-acceptance.json")
    arguments = parser.parse_args()
    if not arguments.run:
        parser.error("Wymagane jawne --run po gotowości QA i sygnale rozpoczęcia odbioru.")
    result = acceptance(arguments)
    print(json.dumps({"passed": result["passed"], "checks": len(result["checks"]), "report": str(arguments.report)}, ensure_ascii=False))
    raise SystemExit(0 if result["passed"] else 1)


if __name__ == "__main__":
    main()
