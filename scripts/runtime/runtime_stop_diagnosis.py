"""Explicit, owned frozen-CPU EXE stop diagnosis; no install or model action."""
from __future__ import annotations

import argparse
import asyncio
import json
import time
from pathlib import Path

from cpu_installer_acceptance import (
    ExeSession, OWNER as CPU_OWNER, assert_port_free, candidate_root, check,
    load, read_backend, sha, _runtime_ready, _uv_exe_matches,
)
from dictation_desktop_acceptance import (
    ROOT, Native, _owner_module, assert_webview_profile_environment,
    ipc, require_ipc, sandbox_parent, wait_for,
)
from release_cpu_smoke import (
    backend_identity, canonical_python_sha,
    next_log_number, no_old_processes,
)
from model_management import _no_link_ancestors

_QA_OUTPUT = Path(__file__).resolve().parents[2] / ".tmp/qa"
_QA_OUTPUT.mkdir(parents=True, exist_ok=True)

# Historical reproducer pins, independent of the continuation/release helper.
FROZEN_DEBUG_SHA = "72361e9b693af267362e3c6cd160b0415286c979a6ad0140fcc14d61a337fd0a"
FROZEN_COMMIT = "df232f47202eb0c3b9f44803733ccd20ebade831"
FROZEN_BOOTSTRAP_LF_SHA = "fe2d1efd656d96faf8f2caf3dfffb2fd5ec1bdb56881c020c81d797d0d09f5de"

TRANSPORT_LOGGER = r"""(()=>{
  const rows=window.__qaRuntimeCalls=[];
  const record=(command,args,transport)=>{
    const row={command,transport,started:performance.now()};
    if(command==='runtime_acquire')row.args={keepWarm:args?.keepWarm};
    if(command==='runtime_release')row.args={lease:args?.lease,cancelStartup:args?.cancelStartup};
    if(command==='plugin:http|fetch'&&args?.clientConfig){
      row.httpMethod=args.clientConfig.method;try{row.path=new URL(args.clientConfig.url).pathname}catch{}
    }
    if(command.startsWith('plugin:http|')&&Number.isSafeInteger(args?.rid))row.rid=args.rid;
    if(command.startsWith('runtime_')||command.startsWith('plugin:http|'))rows.push(row);
    return row;
  };
  const host=window.chrome?.webview,postOriginal=host?.postMessage;
  if(typeof postOriginal!=='function')throw Error('Missing native WebView2 transport');
  host.postMessage=function(raw){let value;try{value=typeof raw==='string'?JSON.parse(raw):raw}catch{}
    if(value?.cmd)record(value.cmd,value.payload||value.args||{},'postMessage');return postOriginal.call(host,raw)};
  const original=window.fetch;
  window.fetch=function(input,options){const url=new URL(typeof input==='string'||input instanceof URL?String(input):input.url,location.href);
    if(url.hostname!=='ipc.localhost')return original.call(this,input,options);
    const command=decodeURIComponent(url.pathname.slice(1));let args={};try{args=JSON.parse(options?.body||'{}')}catch{}
    const row=record(command,args,'custom-protocol');
    return original.call(this,input,options).then(async response=>{row.ended=performance.now();row.ok=response.ok;
      if(response.ok&&(command==='runtime_acquire'||command==='plugin:http|fetch')){
        try{const value=await response.clone().json();if(command==='runtime_acquire'){row.lease=value.lease;row.state=value.status?.state}else if(Number.isSafeInteger(value))row.createdRid=value}catch{}
      }return response;},error=>{row.ended=performance.now();row.ok=false;row.error=String(error?.message||error);throw error});
  };
  window.__qaTransportLogger=true;
})()"""


def cache_has_no_weights(path):
    # HF's import creates Xet diagnostic logs even with no downloads. Preserve
    # them, require that exact harmless location, and reject every other file.
    _no_link_ancestors(path)
    check(path.is_dir(), "Missing private cache")
    files = []
    for item in path.rglob("*"):
        _no_link_ancestors(item)
        if item.is_file():
            relative = item.relative_to(path)
            check(relative.parts[:2] == ("xet", "logs") and len(relative.parts) == 3 and item.suffix == ".log", "Unexpected cache data; no deletion or model execution allowed")
            files.append(relative.as_posix())
    return {"models_present": False, "preserved_xet_diagnostic_logs": len(files)}


def preflight(exe, cpu_report, diagnostic_provenance=None):
    receipt = load(cpu_report)
    check(receipt.get("profile") == "cpu" and receipt.get("expected_source_version") == "0.5.7", "Not the specified CPU receipt")
    check(receipt.get("session_id") == "e43f32da70d74380b098f23351a49c32", "Not the authorized CPU session")
    check(receipt.get("candidate") == "runtime_18e045b43147cdf8", "Not the authorized candidate")
    check(receipt.get("error") == "Nie potwierdzono zatrzymania własnego backendu." and receipt.get("passed") is False, "The recorded symptom changed; do not reinterpret a passed/other receipt")
    check(len(receipt.get("checks", [])) >= 29 and all(row.get("passed") is True for row in receipt["checks"]), "CPU receipt contains another failure")
    check(receipt.get("guards_unchanged") is True and receipt.get("cleanup_errors") == [], "Previous cleanup/guard failed")
    session = sandbox_parent(Path(receipt["session"]))
    check(session.name == "seventy-seven-cpu-install-7tih8v6x", "Wrong sandbox")
    check(load(session / ".qa-owner.json") == {"owner": CPU_OWNER, "id": receipt["session_id"], "exe_sha256": FROZEN_DEBUG_SHA}, "CPU owner mismatch")
    _no_link_ancestors(exe)
    check(receipt["exe_sha256"] == FROZEN_DEBUG_SHA, "Original CPU install EXE hash mismatch")
    if diagnostic_provenance:
        _no_link_ancestors(diagnostic_provenance)
        diagnostic = load(diagnostic_provenance)
        check(diagnostic.get("sourceClean") is True and diagnostic.get("profile") == "debug/custom-protocol" and diagnostic.get("sha256") == sha(exe), "Diagnostic EXE must have a clean build receipt and matching exact hash")
    else:
        check(exe.is_file() and sha(exe) == FROZEN_DEBUG_SHA, "Frozen EXE hash mismatch")
        diagnostic = None
    frozen = load(ROOT / ".tmp/artifacts/df232f4/debug/provenance.json")
    check(frozen.get("sourceCommit") == FROZEN_COMMIT and frozen.get("sourceClean") is True and frozen.get("sha256") == FROZEN_DEBUG_SHA, "Frozen source provenance mismatch")
    local, roaming, webview = session / "local", session / "roaming", session / "webview2"
    for path in [local, roaming, webview]:
        _no_link_ancestors(path)
        check(path.is_dir(), "Missing own app-data/profile")
    profile = assert_webview_profile_environment({"WEBVIEW2_USER_DATA_FOLDER": str(webview)}, webview, session, reuse_owned=True)
    appbase = local / "VoiceStudioNext"
    candidate = candidate_root(appbase, receipt["candidate"])
    certificate = load(candidate / "bootstrap-provenance.json")
    check(certificate == load(ROOT / "scripts/runtime/bootstrap-provenance.json"), "Candidate build certificate mismatch")
    check(canonical_python_sha(candidate / "bootstrap.py") == FROZEN_BOOTSTRAP_LF_SHA, "Candidate bootstrap changed")
    for relative, key in [("engine.zip", "archiveSha256"), ("engine/uv.lock", "lockSha256"), ("engine/pyproject.toml", "pyprojectSha256")]:
        _no_link_ancestors(candidate / relative)
        check(sha(candidate / relative) == certificate["engine"][key], "Candidate sources changed")
    ready = load(candidate / "installation-ready.json")
    check(ready.get("profile") == "cpu" and ready.get("imports") == "passed" and ready.get("mcp_sdk") == "passed" and ready.get("pywin32") == "passed"
          and ready.get("cuda") is None and ready.get("cuda_available") is False and ready.get("torch") == certificate["cpuWheels"]["torch"]["version"]
          and ready.get("synthesize_tested") is False and ready.get("source_archive_sha256") == certificate["engine"]["archiveSha256"]
          and ready.get("lock_sha256") == certificate["engine"]["lockSha256"]
          and all(ready.get("health", {}).get(key) == value for key, value in {"status": 200, "owned": True, "isolatedData": True, "modelsLoaded": False}.items()), "CPU doctor not verified")
    python = candidate / ".venv/Scripts/python.exe"
    independent = load(candidate / "python-ready.json")
    check(python.is_file() and independent.get("independent") is True and Path(independent.get("python", "")).resolve() == python.resolve(), "Candidate Python mismatch")
    check(sha(candidate / "downloads/uv.zip") == certificate["uv"]["sha256"] and _uv_exe_matches(candidate), "uv integrity mismatch")
    check(load(appbase / "active-runtime.json") == {"id": candidate.name, "schema": 1}, "Active selection differs")
    models = session / "empty-models"
    check(load(candidate / "model-cache.json") == {"path": str(models), "owner": CPU_OWNER}, "Private cache pointer mismatch")
    caches = [cache_has_no_weights(models), cache_has_no_weights(candidate / "doctor-models")]
    protected = [appbase / "active-runtime.json", candidate / "model-cache.json", candidate / "installation-ready.json", candidate / "bootstrap-provenance.json", candidate / "bootstrap.py"]
    no_old_processes(session)
    assert_port_free(4312)
    return {"receipt": receipt, "session": session, "local": local, "roaming": roaming, "webview": webview, "candidate": candidate,
            "profile": profile, "caches": caches, "diagnostic_provenance": diagnostic, "protected": {str(path): sha(path) for path in protected}}


async def diagnose(arguments):
    context = preflight(arguments.exe.resolve(), arguments.cpu_report.resolve(), arguments.diagnostic_provenance)
    print("STOP_DIAG_PREFLIGHT_PASS", flush=True)
    report = {"scope": "Actual owned debug EXE, existing authorized CPU candidate; not an installation", "exe_sha256": sha(arguments.exe),
              "source_commit": FROZEN_COMMIT, "session": str(context["session"]), "candidate": context["candidate"].name,
              "profile_preflight": context["profile"], "cache_preflight": context["caches"], "attempts": [], "installation_performed": False,
                "model_license_decision_performed": False, "generation_performed": False, "models_downloaded": False,
                "lease_observation": "Native custom-protocol/postMessage logger is validated by a real runtime_status; no headers/query/body recorded",
                "diagnostic_build": context["diagnostic_provenance"]}
    current = None
    try:
        from playwright.async_api import async_playwright
        owner = _owner_module(context["session"])
        native = Native()
        async with async_playwright() as playwright:
            current = ExeSession(arguments.exe.resolve(), context["session"], context["local"], context["roaming"], context["webview"], owner, native)
            number = next_log_number(context["session"])
            await current.start(playwright, number)
            report["exe_pid"] = current.process.pid
            report["log_number"] = number
            page = current.page
            # Metadata only: no token/header/form-data interception. These
            # records identify pending UI leases without changing their release.
            await page.evaluate(TRANSPORT_LOGGER)
            report["cold_status"] = await require_ipc(page, "runtime_status")
            report["invoke_property"] = await page.evaluate("()=>{const d=Object.getOwnPropertyDescriptor(window.__TAURI_INTERNALS__,'invoke');return {writable:d?.writable,configurable:d?.configurable,getter:!!d?.get,wrapperInstalled:window.__qaTransportLogger&&window.__qaRuntimeCalls.some(row=>row.command==='runtime_status')}}")
            check(report["invoke_property"]["wrapperInstalled"], "Transport observation did not capture own runtime_status; no zero-call inference allowed")
            check(report["cold_status"]["state"] == "stopped", "Not cold/stopped")
            await current.settings()
            start = time.monotonic()
            await page.get_by_role("button", name="Uruchom silnik", exact=True).click()
            report["ready_status"] = await wait_for(lambda: _runtime_ready(page), 185, "Own CPU backend did not start")
            report["startup_seconds"] = round(time.monotonic() - start, 3)
            report["backend_identity"] = backend_identity(current, context["candidate"])
            health, token = await asyncio.to_thread(read_backend, "/health")
            check(token and health.get("version") == "0.5.7", "Owned health/version mismatch")
            report["health"] = health  # body has no authentication marker
            models, models_token = await asyncio.to_thread(read_backend, "/model/status", token)
            check(models_token == token and not models.get("loaded") and not models.get("loading"), "Unexpected model activity")
            print("STOP_DIAG_CPU_READY", flush=True)
            if arguments.diagnose_engines:
                # Allow the ordinary real UI catalogue requests to reach their
                # actual handler. No extra model probe or fake response is run.
                await asyncio.sleep(2)
                diagnostics, diagnostic_token = await asyncio.to_thread(read_backend, "/next/activity?threads=1", token)
                check(diagnostic_token == token and isinstance(diagnostics.get("diagnostics"), dict), "Owned explicit diagnostics not available")
                report["engine_handler_diagnostics"] = diagnostics
                report["runtime_calls_before_stop"] = await page.evaluate("()=>window.__qaRuntimeCalls")
                arguments.report.write_text(json.dumps(report, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")
                print("STOP_DIAG_OWNED_STACK_CAPTURED", flush=True)
            began = time.monotonic()
            minimized = False
            while time.monotonic() - began < arguments.observe_seconds:
                if arguments.close_settings_after is not None and not minimized and time.monotonic()-began >= arguments.close_settings_after:
                    await page.locator(".settings-back").click()
                    minimized = True
                    report["closed_settings_after_seconds"] = round(time.monotonic()-began, 3)
                activity, activity_token = await asyncio.to_thread(read_backend, "/next/activity", token)
                check(activity_token == token, "Activity ownership differs")
                status = await require_ipc(page, "runtime_status")
                result = await ipc(page, "runtime_stop")
                calls = await page.evaluate("()=>window.__qaRuntimeCalls")
                pending = [row for row in calls if row["command"] == "runtime_acquire" and row.get("ok") is True and not any(other["command"] == "runtime_release" and other.get("args", {}).get("lease") == row.get("lease") and other.get("ok") is True for other in calls)]
                report["attempts"].append({"seconds": round(time.monotonic()-began, 3), "status": status, "activity": activity, "stop": result,
                                           "settings_closed": minimized, "lease_observation_valid": report["invoke_property"]["wrapperInstalled"],
                                           "pending_observed_leases": [{"lease": row["lease"], "keepWarm": row["args"].get("keepWarm"), "state": row.get("state")} for row in pending] if report["invoke_property"]["wrapperInstalled"] else None})
                arguments.report.write_text(json.dumps(report, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")
                print(json.dumps({"stop_seconds": report["attempts"][-1]["seconds"], "stop": result, "busy": activity.get("busy"), "active": activity.get("active"), "pending_leases": len(pending)}, ensure_ascii=True), flush=True)
                if result.get("ok") and result.get("value", {}).get("state") == "stopped":
                    report["stop_confirmed"] = True
                    break
                await asyncio.sleep(.5)
            report["runtime_calls"] = await page.evaluate("()=>window.__qaRuntimeCalls")
            report["stop_confirmed"] = report.get("stop_confirmed", False)
            report["original_10s_stop_confirmed"] = report["stop_confirmed"] and report["attempts"][-1]["seconds"] <= 10
    except Exception as error:
        report["error"] = str(error)[:2000]
    finally:
        if current:
            report["own_exe_closed_gracefully"] = await current.close()
        try:
            assert_port_free(4312)
            report["port_4312_free_after_cleanup"] = True
        except Exception as error: report["cleanup_error"] = str(error)
        report["protected_unchanged"] = all(Path(path).is_file() and sha(path) == digest for path,digest in context["protected"].items())
        arguments.report.write_text(json.dumps(report, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")
    print(json.dumps({"report": str(arguments.report), "stop_confirmed": report.get("stop_confirmed"), "error": report.get("error"), "protected_unchanged": report["protected_unchanged"]}), flush=True)
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--run", action="store_true")
    parser.add_argument("--exe", type=Path, required=True)
    parser.add_argument("--cpu-report", type=Path, default=ROOT / ".tmp/qa/cpu-installer-exe.json")
    parser.add_argument("--report", type=Path, default=ROOT / ".tmp/qa/runtime-stop-cpu-diagnosis.json")
    parser.add_argument("--observe-seconds", type=int, choices=range(10,61), default=35)
    parser.add_argument("--close-settings-after", type=int, default=None)
    parser.add_argument("--diagnose-engines", action="store_true")
    parser.add_argument("--diagnostic-provenance", type=Path, default=None)
    args = parser.parse_args()
    if not args.run: parser.error("Explicit --run required")
    result = asyncio.run(diagnose(args))
    raise SystemExit(0 if result.get("stop_confirmed") is True and result.get("protected_unchanged") is True and not result.get("error") else 1)
