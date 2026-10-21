"""Read-only acceptance hook for two already-owned CPU continuation cycles.

No process, backend, model, install or request starts on import. The continuation
harness owns preflight/start/stop/cleanup and calls check_catalogue_cycle only
after its own listener/health/model checks. This hook performs GET requests only.
"""
import asyncio
import hashlib
import json
from pathlib import Path
import sqlite3
import time

from cpu_installer_acceptance import read_backend
from model_management import _no_link_ancestors

PATHS = ("/engines", "/engines/tts", "/engines/asr", "/engines/llm")
FAMILIES = ("tts", "asr", "llm")


def _digest(path):
    _no_link_ancestors(path)
    if not path.exists(): return None
    with path.open("rb") as stream: return hashlib.file_digest(stream, "sha256").hexdigest()


def settings_snapshot(context):
    session, candidate = Path(context["session"]).resolve(), Path(context["candidate"]).resolve()
    data = candidate.parent / "data"
    if not data.resolve().is_relative_to(session): raise AssertionError("Settings evidence must stay inside the owned CPU sandbox")
    paths = {"prefs": data / "prefs.json", "environment": data / "environment", "integrations": data / "integration-settings.json",
             "active_runtime": candidate.parent / "active-runtime.json", "model_cache": candidate / "model-cache.json"}
    result = {key: _digest(path) for key, path in paths.items()}
    database = data / "omnivoice.db"
    _no_link_ancestors(database)
    connection = sqlite3.connect(database.as_uri() + "?mode=ro", uri=True, timeout=1)
    try:
        # Values stay local to the digest. No provider key, setting value or
        # local licence decision is written to a report or log.
        rows = connection.execute("SELECT key,value FROM settings ORDER BY key").fetchall()
        result["settings_rows"] = hashlib.sha256(json.dumps(rows, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()
        result["settings_count"] = len(rows)
    finally: connection.close()
    return result


def _cache_without_weights(path):
    _no_link_ancestors(path)
    if not path.is_dir(): raise AssertionError("Missing owned CPU cache")
    count, total = 0, 0
    for item in path.rglob("*"):
        _no_link_ancestors(item)
        if item.is_file():
            relative = item.relative_to(path)
            if relative.parts[:2] != ("xet", "logs") or len(relative.parts) != 3 or item.suffix != ".log":
                raise AssertionError("Owned CPU cache contains unexpected data; no file was removed")
            size = item.stat().st_size
            total += size
            if size > 1024 ** 2 or total > 8 * 1024 ** 2:
                raise AssertionError("Owned Xet diagnostics exceed 1 MiB/file or 8 MiB total; all files were preserved")
            count += 1
    return {"weights_present": False, "preserved_xet_logs": count, "preserved_xet_bytes": total}


def _family_shape(value, family):
    if not isinstance(value, dict) or value.get("availability_mode") != "metadata_only": raise AssertionError(f"{family}: missing metadata-only contract")
    if not isinstance(value.get("active"), str) or not isinstance(value.get("backends"), list): raise AssertionError(f"{family}: invalid stock family shape")
    ids = []
    for row in value["backends"]:
        if not isinstance(row.get("id"), str) or not row["id"] or row["id"] in ids: raise AssertionError(f"{family}: missing/duplicate backend ID")
        ids.append(row["id"])
        if row.get("available") is not False or row.get("inference_verified") is not False: raise AssertionError(f"{family}: discovery falsely claims tested readiness")
        if row.get("hardware_check") != "not_checked" or not isinstance(row.get("can_verify"), bool): raise AssertionError(f"{family}: missing honest verification state")
        if family != "tts" and row.get("supports_cloning") is True: raise AssertionError(f"{family}: non-TTS engine incorrectly claims voice cloning")
    if not ids: raise AssertionError(f"{family}: empty catalogue")
    return {"ids": sorted(ids), "active": value["active"], "configured_active": value.get("configured_active"),
            "active_model": value.get("active_model"), "can_verify": sorted(row["id"] for row in value["backends"] if row["can_verify"])}


async def check_catalogue_cycle(*, cycle, instance, report, context):
    observation = {"cycle": cycle, "transport": "actual owned loopback GET only", "requests": [], "families": {},
                   "limits": "No-import proof is provided by separate module import traps; this runtime hook proves latency, no model load and no observed settings mutations."}
    report.setdefault("catalogue_cycles", []).append(observation)
    def check(name, passed):
        report.setdefault("checks", []).append({"name": f"cycle_{cycle}_catalogue_{name}", "passed": bool(passed)})
        if not passed: raise AssertionError(f"Catalogue acceptance failed: {name}")
    check("owned_listener", instance.owns_listener(4312))
    _health, token = await asyncio.to_thread(read_backend, "/health")
    check("owned_marker_present", bool(token))
    before = await asyncio.to_thread(settings_snapshot, context)
    observation["settings_before"] = before
    baseline = None
    for iteration in range(4):
        for path in PATHS:
            started = time.perf_counter()
            value, response_token = await asyncio.to_thread(read_backend, path, token)
            seconds = time.perf_counter() - started
            request = {"method": "GET", "path": path, "iteration": iteration, "seconds": round(seconds, 6), "budget_seconds": 2.0 if iteration == 0 else .5}
            observation["requests"].append(request)
            check("ownership_" + str(len(observation["requests"])), response_token == token)
            check("latency_" + str(len(observation["requests"])), seconds < request["budget_seconds"])
            if path == "/engines":
                if not set(FAMILIES) <= set(value): raise AssertionError("Combined catalogue misses a family")
                families = {family: _family_shape(value[family], family) for family in FAMILIES}
                if baseline is None: baseline = families; observation["families"] = families
                check("stable_combined_" + str(iteration), families == baseline)
            else:
                family = path.rsplit("/", 1)[-1]
                check("matching_family_" + family + "_" + str(iteration), _family_shape(value, family) == baseline[family])
    after = await asyncio.to_thread(settings_snapshot, context)
    observation["settings_after"] = after
    check("settings_unchanged", before == after)
    state, state_token = await asyncio.to_thread(read_backend, "/model/status", token)
    loaded, loaded_token = await asyncio.to_thread(read_backend, "/model/loaded", token)
    check("no_models_loaded", state_token == loaded_token == token and not state.get("loaded") and not state.get("loading") and not loaded.get("models"))
    observation["model_state"] = {"loaded": state.get("loaded"), "loading": state.get("loading"), "loaded_models": len(loaded.get("models", []))}
    observation["cache"] = await asyncio.to_thread(_cache_without_weights, Path(context["models"]))
    check("no_model_weights", observation["cache"]["weights_present"] is False)
    observation["passed"] = True
