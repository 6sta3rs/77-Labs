"""Prepared Release-only smoke using a previously accepted owned CPU install.

No action at import. Explicit --run and a passed, source-bound CPU receipt are
mandatory. No installer, activation, model, licence or MCP mutation is invoked.
This is not another fresh install and does not download Python/dependencies.
"""
from __future__ import annotations

# Repository source paths; deployed runtime still uses a flat, self-contained directory.
from pathlib import Path as _SourcePath
import sys as _source_sys
_source_sys.path.insert(0, str(_SourcePath(__file__).resolve().parents[1]))
import runtime_paths as _runtime_paths


import argparse
import asyncio
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import time
import uuid

from cpu_installer_acceptance import (
    OWNER as CPU_OWNER, ExeSession, assert_port_free, candidate_root, check,
    load, read_backend, sha, _runtime_ready, _uv_exe_matches,
)
from dictation_desktop_acceptance import (
    ROOT, Native, _owner_module, assert_webview_profile_environment, ipc,
    report_destination, require_ipc, sandbox_parent, wait_for,
)
from model_management import _no_link_ancestors

_QA_OUTPUT = Path(__file__).resolve().parents[2] / ".tmp/qa"
_QA_OUTPUT.mkdir(parents=True, exist_ok=True)

MANIFEST = ROOT / "scripts/runtime/bootstrap-provenance.json"
MANIFEST = ROOT / "scripts/runtime/vendor/bootstrap-provenance.json"
OWNER = "Seventy Seven Labs Release CPU smoke v1"
REQUIRED_CPU_CHECKS = {
    "full_cpu_candidate_ready", "candidate_certificate_matches_build",
    "cpu_doctor_passed_without_cuda_or_models", "doctor_imported_mcp_sdk_and_pywin32",
    "activation_persisted_correct_candidate", "selection_survives_exe_restart",
    "restarted_exe_uses_private_python", "restarted_health_version_and_unloaded_models",
    "first_exe_closes_gracefully", "restarted_exe_closes_gracefully",
}
READY_CPU_CHECKS = {
    "no_python_override_and_cold_stopped", "fresh_installer_idle", "cpu_selected_in_real_ui",
    "not_ready_activation_button_absent", "native_activation_refused_before_ready", "ui_called_cpu_install",
    "exe_embedded_manifest_is_current", "cancel_has_confirmed_terminal_status", "cancel_did_not_activate_or_mark_ready",
    "cancelled_candidate_has_no_live_children", "budget_still_sufficient_for_one_full_install",
    "retry_uses_new_candidate_preserving_old", "full_cpu_candidate_ready", "real_download_progress_was_observed",
    "candidate_not_implicitly_activated", "candidate_certificate_matches_build", "uv_zip_and_exact_exe_verified",
    "source_lock_and_archive_match_certificate", "cpu_doctor_passed_without_cuda_or_models",
    "doctor_imported_mcp_sdk_and_pywin32", "doctor_evidence_binds_source_and_lock", "no_model_weights_in_owned_caches",
    "activation_persisted_correct_candidate", "activation_preserved_private_empty_cache_pointer",
    "own_predecessor_files_unchanged", "first_start_uses_private_python", "first_backend_listener_is_owned",
    "health_uses_source_version", "no_models_loaded_after_activation",
}


def canonical_python_sha(path):
    return hashlib.sha256(Path(path).read_bytes().replace(b"\r\n", b"\n")).hexdigest()


def owned_json(path):
    _no_link_ancestors(path)
    return load(path)


def build_provenance(path):
    value = owned_json(path)
    check(value.get("sourceClean") is True and re.fullmatch(r"[a-f0-9]{40}", value.get("sourceCommit", ""))
          and re.fullmatch(r"[a-f0-9]{64}", value.get("sha256", "")) and isinstance(value.get("profile"), str),
          "Brak jednoznacznego, czystego commita/SHA/profilu w jawnie wskazanym provenance.")
    return value


def bootstrap_expected_sha(provenance):
    explicit = provenance.get("embeddedSourceCanonicalSha256", {}).get("bootstrap.py")
    if isinstance(explicit, str) and re.fullmatch(r"[a-f0-9]{64}", explicit):
        return explicit
    # Older frozen receipts contain only raw GitEOL bytes. Resolve immutable
    # source from their exact commit, without executing a candidate interpreter.
    # Build receipts may refer to commits before or after the source reorganization.
    for path in ("scripts/runtime/install/bootstrap.py", "scripts/runtime/bootstrap.py"):
        try:
            source = subprocess.check_output(["git", "show", provenance["sourceCommit"] + ":" + path], cwd=ROOT, stderr=subprocess.PIPE)
            break
        except subprocess.CalledProcessError:
            if path == "scripts/runtime/bootstrap.py":
                raise
    return hashlib.sha256(source.replace(b"\r\n", b"\n")).hexdigest()


def empty_owned_cache(path):
    """No model/config data; retain only bounded, recognized Xet diagnostics."""
    _no_link_ancestors(path)
    check(path.is_dir(), "Brak własnego pustego katalogu modeli z odbioru CPU.")
    logs, total = 0, 0
    for directory, dirs, files in os.walk(path, followlinks=False):
        for name in [*dirs, *files]:
            _no_link_ancestors(Path(directory) / name)
        for name in files:
            entry = Path(directory) / name
            relative = entry.relative_to(path)
            info = entry.stat()
            check(relative.parts[:2] == ("xet", "logs") and len(relative.parts) == 3 and entry.suffix == ".log"
                  and info.st_nlink == 1 and info.st_size <= 1024 ** 2,
                  "Własny cache zawiera dane inne niż małe logi Xet. Niczego nie usunięto ani nie przeniesiono.")
            logs += 1; total += info.st_size
            check(logs <= 100 and total <= 8 * 1024 ** 2, "Logi diagnostyczne Xet przekraczają budżet odbioru; zachowano je bez zmian.")
    return {"model_or_config_files": 0, "preserved_xet_diagnostic_logs": logs, "diagnostic_bytes": total}


def no_old_processes(session):
    """Refuse conflicts; never stop a discovered process or inspect its files."""
    import psutil
    needle = os.path.normcase(str(session))
    possible = {"python.exe", "pythonw.exe", "uv.exe", "uvx.exe", "msedgewebview2.exe"}
    for process in psutil.process_iter(["pid", "name"]):
        try:
            name = (process.info.get("name") or "").lower()
            # Product processes may have no sandbox argument. A conservative
            # refusal also protects any separately opened user application.
            check(name != "seventy-seven-labs.exe", "Aplikacja studia już działa. Nie zamknięto jej; odbiór odroczony.")
            if name in possible:
                command = process.cmdline()
                check(not any(needle in os.path.normcase(arg) for arg in command), "Pozostał żywy proces poprzedniej własnej sesji CPU. Nie zakończono go automatycznie.")
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue


def runtime_port_available():
    import psutil
    assert_port_free(4312)
    check(not any(item.laddr and item.laddr.port == 4312 and item.status == "LISTEN" for item in psutil.net_connections(kind="tcp")),
          "Port 4312 ma już listener IPv4/IPv6. Nie zamknięto cudzego procesu.")


def validate_cpu_receipt(cpu_report, *, debug_receipt, manifest_path=MANIFEST, ready_continuation=False):
    """Read-only preflight, before Native(), profile changes or EXE creation."""
    _no_link_ancestors(cpu_report)
    receipt = load(cpu_report)
    if not ready_continuation and receipt.get("kind") == "ready_candidate_continuation_not_fresh_install":
        check(receipt.get("passed") is True and receipt.get("cleanup_errors") == [], "Release wymaga zakończonego passed=true raportu kontynuacji.")
        raw_session = Path(receipt.get("session", ""))
        check(raw_session.is_absolute() and raw_session.name.startswith("seventy-seven-cpu-install-"), "Kontynuacja nie wskazuje własnego sandboxu.")
        session = sandbox_parent(raw_session)
        provenance_path = Path(receipt.get("build_provenance_path", ""))
        _no_link_ancestors(provenance_path)
        resolved_provenance = provenance_path.resolve()
        check(resolved_provenance.is_relative_to(ROOT / ".tmp") or resolved_provenance.is_relative_to(session), "Provenance kontynuacji nie należy do własnych artefaktów QA.")
        tested = build_provenance(resolved_provenance)
        check(sha(resolved_provenance) == receipt.get("build_provenance_sha256") and tested["sha256"] == receipt.get("exe_sha256")
              and tested["sourceCommit"] == receipt.get("source_commit"), "Kontynuacja nie odpowiada zamrożonemu provenance EXE.")
        source_report = report_destination(Path(receipt.get("source_cpu_report", "")), session)
        check(source_report != Path(cpu_report).resolve() and sha(source_report) == receipt.get("cpu_report_sha256"), "Raport źródłowy kontynuacji jest niezgodny lub zmieniony.")
        checks = receipt.get("checks")
        required = {f"cycle_{cycle}_{name}" for cycle in (1, 2) for name in (
            "private_python_source", "owned_health_057", "no_models_or_work", "ui_stop_confirmed", "main_closed_gracefully", "own_tree_and_port_drained")}
        required |= {"final_own_processes_and_port_drained", "empty_own_model_caches_preserved", "selection_and_installation_evidence_unchanged", "cpu_install_receipt_unchanged"}
        check(isinstance(checks, list) and all(item.get("passed") is True for item in checks) and required <= {item.get("name") for item in checks},
              "Kontynuacja nie potwierdza obu startów/Stop/restartu i zamknięcia własnych procesów.")
        initial_stops = [item for item in receipt.get("stop_evidence", []) if item.get("via_ui") is True and item.get("first_attempt") is True]
        check(len(initial_stops) == 2 and all(item.get("budget_seconds") == 10 and isinstance(item.get("elapsed_seconds"), (int, float))
              and not isinstance(item["elapsed_seconds"], bool) and 0 <= item["elapsed_seconds"] < 10 for item in initial_stops),
              "Kontynuacja nie potwierdza obu pierwszych prób Stop poniżej 10 sekund.")
        context = validate_cpu_receipt(source_report, debug_receipt=debug_receipt, manifest_path=manifest_path, ready_continuation=True)
        check(context["session"] == session and context["candidate"].name == receipt.get("candidate") and context["ready_evidence"] == receipt.get("ready_evidence"),
              "Dowody kontynuacji nie odpowiadają zaakceptowanemu kandydatowi.")
        context["passed_continuation_receipt"] = {"path": str(cpu_report), "sha256": sha(cpu_report), "scope": receipt["kind"]}
        return context
    if ready_continuation:
        check(receipt.get("passed") is False and receipt.get("error") == "Nie potwierdzono zatrzymania własnego backendu.",
              "Kontynuacja dotyczy wyłącznie wskazanego błędu Stop po udanej instalacji; nie zmieniono wcześniejszego RED.")
    else:
        check(receipt.get("passed") is True, "Release smoke wymaga zakończonego raportu CPU passed=true; nie uruchomiono EXE.")
    check(receipt.get("profile") == "cpu", "Raport nie dotyczy własnego profilu CPU.")
    check(receipt.get("expected_source_version") == "0.5.7" and receipt.get("guards_unchanged") is True
          and receipt.get("cleanup_errors") == [], "Raport CPU nie potwierdza źródeł, ochrony danych lub poprawnego zamknięcia.")
    results = receipt.get("checks")
    check(isinstance(results, list) and results and all(item.get("passed") is True for item in results), "Raport CPU zawiera niezaliczoną kontrolę.")
    check((READY_CPU_CHECKS if ready_continuation else REQUIRED_CPU_CHECKS) <= {item.get("name") for item in results}, "Raport CPU nie obejmuje wymaganych dowodów gotowości, aktywacji i rzeczywistego uruchomienia.")
    check(re.fullmatch(r"[a-f0-9]{32}", receipt.get("session_id", "")), "Nieprawidłowy identyfikator własnej sesji CPU.")
    raw_session = Path(receipt.get("session", ""))
    check(raw_session.is_absolute() and raw_session.name.startswith("seventy-seven-cpu-install-"), "Raport nie wskazuje własnego sandboxu instalatora CPU.")
    session = sandbox_parent(raw_session)
    owner = owned_json(session / ".qa-owner.json")
    check(owner == {"owner": CPU_OWNER, "id": receipt["session_id"], "exe_sha256": receipt.get("exe_sha256")}, "Znacznik sesji nie odpowiada raportowi CPU.")
    _no_link_ancestors(debug_receipt)
    frozen = build_provenance(debug_receipt)
    check(frozen.get("profile") == "debug/custom-protocol" and receipt.get("exe_sha256") == frozen["sha256"], "Raport CPU nie pochodzi z jawnie wskazanego zamrożonego EXE instalatora.")
    local, roaming, webview = session / "local", session / "roaming", session / "webview2"
    for directory in (local, roaming, webview):
        _no_link_ancestors(directory)
        check(directory.is_dir(), "Brak własnego katalogu aplikacji/profilu CPU.")
    profile_proof = assert_webview_profile_environment({"WEBVIEW2_USER_DATA_FOLDER": str(webview)}, webview, session, reuse_owned=True)
    appbase = local / "VoiceStudioNext"
    check(isinstance(receipt.get("candidate"), str) and re.fullmatch(r"runtime_[a-f0-9]{1,32}", receipt["candidate"]), "Nieprawidłowy identyfikator kandydata CPU.")
    _no_link_ancestors(appbase / receipt["candidate"] / ".installer-owner.json")
    candidate = candidate_root(appbase, receipt.get("candidate"))
    certificate = owned_json(candidate / "bootstrap-provenance.json")
    expected = owned_json(manifest_path)
    check(certificate == expected, "Kandydat CPU odpowiada innemu manifestowi aplikacji.")
    _no_link_ancestors(candidate / "bootstrap.py")
    expected_bootstrap = bootstrap_expected_sha(frozen)
    check(canonical_python_sha(candidate / "bootstrap.py") == expected_bootstrap,
          "Kandydat nie odpowiada źródłu bootstrap z provenance; porównanie dopuszcza tylko różnicę LF/CRLF.")
    ready = owned_json(candidate / "installation-ready.json")
    if not ready_continuation:
        check(ready == receipt.get("ready_evidence"), "Wynik doctor zmienił się od udanego odbioru CPU.")
    check(str(ready.get("python", "")).startswith("3.11.") and ready.get("profile") == "cpu" and ready.get("imports") == "passed" and ready.get("mcp_sdk") == "passed"
          and ready.get("pywin32") == "passed" and ready.get("cuda") is None and ready.get("cuda_available") is False
          and ready.get("torch") == certificate["cpuWheels"]["torch"]["version"] and ready.get("synthesize_tested") is False
          and all(ready.get("health", {}).get(key) == value for key, value in {"status": 200, "owned": True, "isolatedData": True, "modelsLoaded": False}.items()), "Brak pełnego doctora CPU bez modeli.")
    python = candidate / ".venv/Scripts/python.exe"
    for relative in ("bootstrap.py", "python-ready.json", "installation-ready.json", "bootstrap-provenance.json", "engine.zip", "engine/uv.lock", "engine/pyproject.toml", ".venv/Scripts/python.exe", "model-cache.json"):
        _no_link_ancestors(candidate / relative)
    independent = owned_json(candidate / "python-ready.json")
    check(python.is_file() and independent.get("independent") is True and Path(independent.get("python", "")).resolve() == python.resolve(), "Brak niezależnego, własnego interpretera zaakceptowanego kandydata.")
    for relative, key in (("engine.zip", "archiveSha256"), ("engine/uv.lock", "lockSha256"), ("engine/pyproject.toml", "pyprojectSha256")):
        check(sha(candidate / relative) == certificate["engine"][key], "Integralność źródeł kandydata nie odpowiada certyfikatowi.")
    check(ready.get("source_archive_sha256") == certificate["engine"]["archiveSha256"] and ready.get("lock_sha256") == certificate["engine"]["lockSha256"], "Doctor nie jest związany z aktualnym archiwum i lockiem.")
    check(sha(candidate / "downloads/uv.zip") == certificate["uv"]["sha256"] and _uv_exe_matches(candidate), "Przypięty uv nie odpowiada certyfikatowi.")
    pointer_path = appbase / "active-runtime.json"
    _no_link_ancestors(pointer_path)
    check(owned_json(pointer_path) == {"id": candidate.name, "schema": 1}, "Własny wybór aktywnego runtime nie odpowiada raportowi CPU.")
    models = session / "empty-models"
    pointer = owned_json(candidate / "model-cache.json")
    check(pointer == {"path": str(models), "owner": CPU_OWNER}, "Cache kandydata nie wskazuje własnego pustego katalogu modeli.")
    cache_preflight = [empty_owned_cache(models), empty_owned_cache(candidate / "doctor-models")]
    protected = [pointer_path, candidate / "model-cache.json", candidate / "bootstrap-provenance.json", candidate / "installation-ready.json", candidate / "bootstrap.py"]
    return {"cpu_report": receipt, "session": session, "local": local, "roaming": roaming, "webview": webview,
            "candidate": candidate, "models": models, "cache_preflight": cache_preflight, "ready_evidence": ready, "profile_proof": profile_proof, "protected": {str(path): sha(path) for path in protected},
            "cpu_origin_commit": frozen["sourceCommit"], "bootstrap_canonical_lf_sha256": expected_bootstrap,
            "frozen_bootstrap_raw_sha256": frozen.get("embeddedSourceSha256", {}).get("bootstrap.py"), "bootstrap_raw_sha256": sha(candidate / "bootstrap.py")}


def next_log_number(session):
    number = 3
    while (session / f"exe-{number}.log").exists() or (session / f"webview-profile-preflight-{number}.json").exists():
        number += 1
    return number


def backend_identity(instance, candidate):
    import psutil
    owned = {instance.process.pid, *(child.pid for child in instance.root_process.children(recursive=True))}
    listeners = [item for item in psutil.net_connections(kind="tcp") if item.laddr and item.laddr.port == 4312 and item.status == "LISTEN"]
    check(listeners and len({item.pid for item in listeners}) == 1
          and all(item.pid in owned and item.laddr.ip in {"127.0.0.1", "::1"} for item in listeners), "Backend nie należy do własnego drzewa Release EXE na loopback.")
    process = psutil.Process(listeners[0].pid)
    executable = Path(process.exe()).resolve()
    check(executable.is_relative_to(candidate), "Listener nie używa Pythona z zaakceptowanego prywatnego kandydata.")
    environment = process.environ()  # only the verified own child; never retain tokens
    check("VOICESTUDIO_NEXT_PYTHON" not in environment and environment.get("HF_HUB_OFFLINE") == "1"
          and environment.get("TRANSFORMERS_OFFLINE") == "1" and environment.get("OMNIVOICE_MCP_DISABLE") == "1", "Własny backend nie zachował offline/MCP-off lub zawiera wymuszony Python.")
    return {"pid": process.pid, "private_python": str(executable), "owned_loopback_listener": True, "offline": True, "mcp_disabled": True, "python_override": False}


STOP_RESPONSE_OBSERVER = r"""(()=>{
  window.__qaStopInstalled=true;window.__qaNativeStops=[];window.__qaRuntimeCalls=[];
  const dispatch=(command,transport)=>{
    if(command!=='runtime_status'&&command!=='runtime_stop')return null;
    window.__qaRuntimeCalls.push({command,transport});
    if(command==='runtime_stop'){
      const row={pending:true,transport,exact_response_observed:false};
      window.__qaNativeStops.push(row);return row;
    }return null;
  };
  const host=window.chrome?.webview,postOriginal=host?.postMessage;
  if(typeof postOriginal==='function'){
    host.postMessage=function(raw){
      const forwarded=postOriginal.apply(this,arguments);
      try{const message=typeof raw==='string'?JSON.parse(raw):raw;dispatch(message?.cmd,'postMessage')}catch{}
      return forwarded;
    };
  }
  const original=window.fetch;
  window.fetch=function(input,options){
    // Keep the EXACT native promise and response for the SDK. A failed or
    // permanently pending observer must never alter the product's settlement.
    const forwarded=original.apply(this,arguments);
    try{
      const url=new URL(typeof input==='string'||input instanceof URL?String(input):input.url,location.href);
      if(url.hostname!=='ipc.localhost')return forwarded;
      const row=dispatch(decodeURIComponent(url.pathname.slice(1)),'custom-protocol');
      if(row){
        void forwarded.then(response=>{
          let copy,kind;
          try{copy=response.clone();kind=response.headers.get('Tauri-Response')}
          catch{row.pending=false;row.observation_error='clone_failed';return}
          // This branch is intentionally detached. Never return or await its
          // JSON promise in the fetch path that Tauri consumes.
          void Promise.resolve().then(()=>copy.json()).then(value=>{
            row.pending=false;
            if(kind!=='ok'&&kind!=='error'){row.observation_error='unknown_tauri_response';return}
            row.exact_response_observed=true;row.ok=kind==='ok';
            if(row.ok)row.value=value;else row.error=typeof value==='string'?value:JSON.stringify(value);
          },()=>{row.pending=false;row.observation_error='decode_failed'}).catch(()=>{row.pending=false;row.observation_error='observer_failed'});
        },()=>{row.pending=false;row.transport_error='fetch_rejected'}).catch(()=>{row.pending=false;row.observation_error='observer_failed'});
      }
    }catch{}
    return forwarded;
  };
})()"""


async def capture_stop_responses(page):
    # Observe only these commands, forwarding original native transport values.
    # Do not reuse the historical logger's promise-transforming then chain.
    installed = await page.evaluate("window.__qaStopInstalled===true")
    if not installed:
        await page.evaluate(STOP_RESPONSE_OBSERVER)
    await require_ipc(page, "runtime_status")
    observed = await page.evaluate("window.__qaRuntimeCalls?.some(row=>row.command==='runtime_status')===true")
    check(observed, "Transport logger nie zaobserwował rzeczywistego runtime_status. Nie wolno interpretować pustej listy jako braku odmów.")
    return {"runtime_status_observed": True, "exact_stop_response_transport": "custom-protocol", "post_message_completion_not_claimed": True,
            "original_promise_forwarded_unchanged": True, "clone_observation_detached": True}


async def stop_with_evidence(page, report, *, via_ui, first_attempt=True):
    """Keep the exact native error/pending response instead of discarding it."""
    evidence = {"via_ui": via_ui, "first_attempt": first_attempt, "budget_seconds": 10, "diagnostic_budget_seconds": 30,
                "native_responses": [], "last_status": None}
    report.setdefault("stop_evidence", []).append(evidence)
    began = None
    try:
        if via_ui:
            evidence["observer"] = await capture_stop_responses(page)
            began = time.perf_counter()
            await page.locator(".runtime-card").get_by_role("button", name="Zatrzymaj", exact=True).click()
        else:
            began = time.perf_counter()
            response = await asyncio.wait_for(ipc(page, "runtime_stop"), 8)
            evidence["native_responses"].append(response)
            evidence["exact_response_observed"] = True
            check(response.get("ok"), "runtime_stop: " + str(response.get("error", "brak odpowiedzi")))
        async def stopped():
            if via_ui:
                evidence["native_responses"] = await page.evaluate("window.__qaNativeStops||[]")
                evidence["exact_response_observed"] = any(row.get("exact_response_observed") is True for row in evidence["native_responses"])
            status = await asyncio.wait_for(ipc(page, "runtime_status"), 4)
            evidence["last_status"] = status
            failed = next((value for value in evidence["native_responses"] if value.get("ok") is False), None)
            check(failed is None, "runtime_stop: " + str(failed.get("error") if failed else ""))
            check(status.get("ok"), "runtime_status: " + str(status.get("error", "brak odpowiedzi")))
            backend_stopped = status.get("value", {}).get("state") == "stopped"
            if via_ui and backend_stopped:
                evidence["ui"] = await page.locator(".runtime-card").evaluate("""card=>{
                  const buttons=[...card.querySelectorAll('button')];
                  const start=buttons.find(button=>button.textContent.trim()==='Uruchom silnik');
                  const stop=buttons.find(button=>button.textContent.trim()==='Zatrzymaj');
                  return {label:card.querySelector('.runtime-heading > div > span')?.textContent.trim(),
                    start_enabled:!!start&&!start.disabled,stop_enabled:!!stop&&!stop.disabled};
                }""")
                state = evidence["ui"]
                evidence["ui_stop_rendered"] = state.get("label") == "Zatrzymany" and state.get("start_enabled") is True and state.get("stop_enabled") is False
                return evidence["ui_stop_rendered"]
            return backend_stopped
        await wait_for(stopped, 30, "runtime_stop nie zakończył się w ciągu 30 s; dokładne odpowiedzi zachowano w stop_evidence.")
        evidence["elapsed_seconds"] = time.perf_counter() - began
        evidence["within_budget"] = 0 <= evidence["elapsed_seconds"] < evidence["budget_seconds"]
        if first_attempt:
            report.setdefault("checks", []).append({"name": f"stop_{len(report['stop_evidence'])}_first_attempt_under_10s", "passed": evidence["within_budget"]})
            check(evidence["within_budget"], f"Pierwsza próba runtime_stop trwała {evidence['elapsed_seconds']:.3f} s; wymagane poniżej 10 s. Limit 30 s służy wyłącznie diagnostyce.")
    except Exception as exc:
        evidence["error"] = str(exc) or type(exc).__name__
        raise RuntimeError(evidence["error"]) from exc
    finally:
        if began is not None and "elapsed_seconds" not in evidence:
            evidence["elapsed_seconds"] = time.perf_counter() - began


async def run_smoke(arguments, *, ready_continuation=False, cycle_probe=None):
    context = validate_cpu_receipt(arguments.cpu_report, debug_receipt=arguments.cpu_provenance, ready_continuation=ready_continuation)
    exe = arguments.exe.resolve()
    _no_link_ancestors(arguments.exe)
    check(exe.is_file() and exe.name == "seventy-seven-labs.exe", "Wskaż zamrożony własny EXE studia.")
    release_sha = sha(exe)
    tested = build_provenance(arguments.build_provenance)
    check(release_sha == tested["sha256"], "EXE nie odpowiada SHA nowego, jawnie wskazanego frozen provenance.")
    if ready_continuation:
        check(tested["profile"] == "debug/custom-protocol", "Kontynuacja wymaga jawnie zamrożonego debug/custom-protocol EXE.")
    else:
        check(tested["profile"].startswith("release") and "release" in [part.lower() for part in exe.parts], "Wskaż nowe wydanie Release, nie poprzedni debug EXE.")
    no_old_processes(context["session"])
    runtime_port_available()
    session = context["session"]
    run_dir = session / ("release-smoke-" + uuid.uuid4().hex)
    run_dir.mkdir()
    arguments.report = report_destination(arguments.report, run_dir)
    check(arguments.report.resolve() != arguments.cpu_report.resolve(), "Release smoke nie może nadpisać raportu instalacji CPU.")
    report = {"schema": 1, "kind": "ready_candidate_continuation_not_fresh_install" if ready_continuation else "release_smoke_existing_cpu_install_not_fresh_install_or_vm", "exe_sha256": release_sha,
              "source_commit": tested["sourceCommit"], "cpu_origin_commit": context["cpu_origin_commit"], "cpu_report_sha256": sha(arguments.cpu_report), "session": str(session), "run": str(run_dir),
              "build_provenance_path": str(arguments.build_provenance.resolve()), "build_provenance_sha256": sha(arguments.build_provenance),
              "source_cpu_report": str(arguments.cpu_report.resolve()),
              "candidate": context["candidate"].name, "bootstrap_canonical_lf_sha256": context["bootstrap_canonical_lf_sha256"],
              "bootstrap_raw_sha256": context["bootstrap_raw_sha256"], "frozen_bootstrap_raw_sha256": context["frozen_bootstrap_raw_sha256"],
              "profile_preflight": context["profile_proof"], "checks": [], "launches": [], "cleanup_errors": [],
              "cache_preflight": context["cache_preflight"],
              "installation_performed": False, "activation_performed": False, "models_downloaded": False,
              "model_license_decision_performed": False, "generation_performed": False, "physical_microphone_used": False}
    report["source_cpu_report_passed"] = context["cpu_report"]["passed"]
    report["input_cpu_evidence_passed"] = bool(context.get("passed_continuation_receipt")) or context["cpu_report"]["passed"]
    report["ready_evidence"] = context["ready_evidence"]
    if context.get("passed_continuation_receipt"):
        report["passed_continuation_receipt"] = context["passed_continuation_receipt"]
    (run_dir / ".qa-owner.json").write_text(json.dumps({"owner": OWNER, "cpu_session_id": context["cpu_report"]["session_id"], "exe_sha256": release_sha}), encoding="utf-8")
    native, instances = Native(), []
    original_focus = native.identity(native.user.GetForegroundWindow())
    def record(name, passed):
        report["checks"].append({"name": name, "passed": bool(passed)})
        check(passed, name)
    try:
        from playwright.async_api import async_playwright
        owner = _owner_module(run_dir)
        async with async_playwright() as playwright:
            for cycle in (1, 2):
                no_old_processes(session)
                runtime_port_available()
                current = ExeSession(exe, session, context["local"], context["roaming"], context["webview"], owner, native)
                instances.append(current)  # preserve ownership even if start fails
                number = next_log_number(session)
                await current.start(playwright, number)
                await capture_stop_responses(current.page)
                launch = {"cycle": cycle, "log_number": number, "exe_pid": current.process.pid, "packaged_url": current.page.url}
                report["launches"].append(launch)
                record(f"cycle_{cycle}_packaged_url", current.page.url.startswith(("http://tauri.localhost/", "tauri://localhost/")))
                record(f"cycle_{cycle}_cold_stopped", (await require_ipc(current.page, "runtime_status"))["state"] == "stopped")
                installer = await require_ipc(current.page, "installer_status")
                record(f"cycle_{cycle}_accepted_selection_persisted", installer["state"] == "activated" and installer["candidate"] == context["candidate"].name)
                await current.settings()
                await current.page.get_by_role("button", name="Uruchom silnik", exact=True).click()
                status = await wait_for(lambda: _runtime_ready(current.page), 185, "Release nie uruchomił zaakceptowanego prywatnego Pythona.")
                record(f"cycle_{cycle}_private_python_source", status.get("source") == "private-python" and status.get("managed") is True)
                launch["backend"] = backend_identity(current, context["candidate"])
                health, token = await asyncio.to_thread(read_backend, "/health")
                check(token, "Brak markera własności backendu Release.")
                state, state_token = await asyncio.to_thread(read_backend, "/model/status", token)
                loaded, loaded_token = await asyncio.to_thread(read_backend, "/model/loaded", token)
                activity, activity_token = await asyncio.to_thread(read_backend, "/next/activity", token)
                record(f"cycle_{cycle}_owned_health_057", health.get("version") == "0.5.7" and all(value == token for value in (state_token, loaded_token, activity_token)))
                record(f"cycle_{cycle}_no_models_or_work", state.get("loaded") is False and state.get("loading") is False and loaded.get("models") == [] and loaded.get("count") == 0 and activity.get("busy") is False)
                record(f"cycle_{cycle}_no_microphone_request", await current.page.evaluate("window.__qaMicRequests===0"))
                launch["health"] = health
                if cycle_probe is not None:
                    await cycle_probe(cycle=cycle, instance=current, report=report, context=context)
                await stop_with_evidence(current.page, report, via_ui=True)
                record(f"cycle_{cycle}_ui_stop_confirmed", True)
                record(f"cycle_{cycle}_main_closed_gracefully", await current.close())
                runtime_port_available()
                no_old_processes(session)
                record(f"cycle_{cycle}_own_tree_and_port_drained", True)
    except Exception as exc:
        report["error"] = str(exc)[:1600]
    finally:
        for instance in reversed(instances):
            if instance.process is not None and instance.process.poll() is None:
                try:
                    await asyncio.wait_for(stop_with_evidence(instance.page, report, via_ui=False, first_attempt=False), 12)
                except Exception:
                    pass
                try:
                    await instance.close()
                except Exception as exc:
                    report["cleanup_errors"].append(str(exc))
        try:
            runtime_port_available()
            no_old_processes(session)
            record("final_own_processes_and_port_drained", True)
            report["cache_after"] = [empty_owned_cache(context["models"]), empty_owned_cache(context["candidate"] / "doctor-models")]
            record("empty_own_model_caches_preserved", True)
            record("selection_and_installation_evidence_unchanged", all(sha(path) == expected for path, expected in context["protected"].items()))
            record("cpu_install_receipt_unchanged", sha(arguments.cpu_report) == report["cpu_report_sha256"])
        except Exception as exc:
            report["cleanup_errors"].append(str(exc))
        live = native.identity(native.user.GetForegroundWindow())
        own_pids = {os.getpid(), *(instance.process.pid for instance in instances if instance.process)}
        if live["pid"] in own_pids and native.matches(original_focus):
            report["focus_restored"] = bool(native.user.SetForegroundWindow(original_focus["handle"]))
        else:
            report["focus_restored"] = "skipped_later_user_action_or_target_gone"
        report["passed"] = not report.get("error") and not report["cleanup_errors"] and bool(report["checks"]) and all(item["passed"] for item in report["checks"])
        arguments.report.parent.mkdir(parents=True, exist_ok=True)
        arguments.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        (run_dir / "report.json").write_bytes(arguments.report.read_bytes())
    return report


def main():
    parser = argparse.ArgumentParser(description="Release smoke na istniejącym, odebranym własnym CPU runtime; bez pobierania.")
    parser.add_argument("--run", action="store_true")
    parser.add_argument("--exe", type=Path, required=True)
    parser.add_argument("--cpu-report", type=Path, required=True)
    parser.add_argument("--cpu-provenance", type=Path, required=True, help="Provenance debug EXE, które utworzyło istniejący CPU runtime.")
    parser.add_argument("--build-provenance", type=Path, required=True, help="Provenance nowego frozen EXE badanego w tym smoke.")
    parser.add_argument("--report", type=Path, default=ROOT / ".tmp/qa/release-cpu-smoke.json")
    arguments = parser.parse_args()
    if not arguments.run:
        parser.error("Wymagane jawne --run po udanym CPU odbiorze i RootGO dla zamrożonego Release EXE.")
    result = asyncio.run(run_smoke(arguments))
    print(json.dumps({"passed": result["passed"], "checks": len(result["checks"]), "report": str(arguments.report)}, ensure_ascii=False))
    raise SystemExit(0 if result["passed"] else 1)


if __name__ == "__main__":
    main()
