"""Explicit small Windows docopt build repro. Never installs the full runtime.

Uses only uv/CPython executables from a marked failed private candidate. Each
probe creates its own venv/cache/temp outside the repo; originals stay read-only.
The exact upstream sdist hash and hash-required sync are retained. No cleanup
of directories: owned artifacts and logs remain available for inspection.
"""
from __future__ import annotations

# Repository source paths; deployed runtime still uses a flat, self-contained directory.
from pathlib import Path as _SourcePath
import sys as _source_sys
_source_sys.path.insert(0, str(_SourcePath(__file__).resolve().parents[1]))
import runtime_paths as _runtime_paths


import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import time
import tomllib
import urllib.request
import uuid
import zipfile

import bootstrap
from dictation_desktop_acceptance import _owner_module, sandbox_parent
from model_management import _no_link_ancestors

_QA_OUTPUT = Path(__file__).resolve().parents[2] / ".tmp/qa"
_QA_OUTPUT.mkdir(parents=True, exist_ok=True)

ROOT = Path(__file__).resolve().parents[2]
DOCOPT_HASH = "49b3a825280bd66b3aa83585ef59c4a8c82f2c8a522dbe754a8bc8d08c85c491"
BUDGET = 128 * 1024 ** 2


def size(root):
    total = 0
    for path in root.rglob("*"):
        try:
            if path.is_file(): total += path.stat().st_size
        except FileNotFoundError:
            pass  # uv atomically publishes/removes its own temporary files.
    return total


def run_owned(owner, command, *, cwd, environment, log, budget_roots=None):
    with log.open("xb") as stream:
        process = owner.spawn_owned(command, cwd=str(cwd), env=environment,
            stdin=subprocess.DEVNULL, stdout=stream, stderr=subprocess.STDOUT)
        started = time.monotonic()
        try:
            while process.poll() is None:
                if time.monotonic() - started > 90 or sum(size(path) for path in (budget_roots or [cwd])) > BUDGET:
                    raise RuntimeError("Docopt probe exceeded its 90 s / 128 MiB budget")
                time.sleep(.15)
            return {"exit_code": process.wait(), "seconds": round(time.monotonic() - started, 3), "log": str(log)}
        finally:
            if process.poll() is None:
                process.terminate()
                try: process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill(); process.wait(timeout=5)


def probe(candidate, report_path):
    _no_link_ancestors(candidate)
    candidate = bootstrap.validate_root(candidate.resolve(), candidate.resolve().parent)
    manifest = json.loads((candidate / "bootstrap-provenance.json").read_text(encoding="utf-8"))
    uv, python = candidate / "tools/uv.exe", candidate / "python/cpython-3.11.14-windows-x86_64-none/python.exe"
    for path in (uv, python):
        _no_link_ancestors(path)
        if not path.is_file(): raise ValueError("Missing private uv/CPython executable")
    archive = candidate / "downloads/uv.zip"
    if bootstrap.sha256(archive) != manifest["uv"]["sha256"]: raise ValueError("Pinned uv archive mismatch")
    with zipfile.ZipFile(archive) as source:
        names = [name for name in source.namelist() if Path(name).name == "uv.exe"]
        if len(names) != 1 or hashlib.sha256(source.read(names[0])).hexdigest() != bootstrap.sha256(uv):
            raise ValueError("uv executable differs from verified release")
    packages = tomllib.loads((candidate / "engine/uv.lock").read_text(encoding="utf-8"))["package"]
    docopt = next(package for package in packages if package["name"] == "docopt")
    if docopt["version"] != "0.6.2" or docopt["sdist"]["hash"] != "sha256:" + DOCOPT_HASH:
        raise ValueError("Unexpected upstream docopt pin")
    session = Path(tempfile.mkdtemp(prefix="ssdoc-", dir=sandbox_parent())).resolve()
    receipt = {"owner": "Seventy Seven Labs docopt regression v1", "id": uuid.uuid4().hex,
               "candidate": str(candidate), "budget_bytes": BUDGET}
    bootstrap.atomic_json(session / ".qa-owner.json", receipt)
    payload = session / "docopt-0.6.2.tar.gz"
    with urllib.request.urlopen(docopt["sdist"]["url"], timeout=20) as response:
        content = response.read(262145)
    if len(content) != docopt["sdist"]["size"] or hashlib.sha256(content).hexdigest() != DOCOPT_HASH:
        raise ValueError("Pinned sdist did not verify")
    payload.write_bytes(content)
    report = {"scope": "Actual docopt-only build; not full CPU installer acceptance", "session": str(session),
              "candidate": str(candidate), "docopt_sha256": DOCOPT_HASH, "sdist_bytes": len(content),
              "uv_sha256": bootstrap.sha256(uv), "python_sha256": bootstrap.sha256(python), "cases": []}
    owner = _owner_module(session)
    original_cache_length = len(str(candidate / "wheel-cache"))
    long_cache = session / ("p" * max(1, original_cache_length - len(str(session)) - len("wheel-cache") - 2)) / "wheel-cache"
    venv = session / "v"
    requirements = session / "requirements.txt"
    requirements.write_text("docopt==0.6.2 --hash=sha256:" + DOCOPT_HASH + "\n", encoding="utf-8")
    for label, cache in (("long-cache", long_cache), ("short-cache", session / "c")):
        temporary = session / "t"; temporary.mkdir(exist_ok=True)
        environment = {key: value for key, value in os.environ.items()
            if not key.startswith(("UV_", "PIP_", "HF_", "OMNIVOICE_", "TRANSFORMERS_", "PYTHON")) and key != "VIRTUAL_ENV"}
        environment.update(UV_NO_CONFIG="1", UV_LINK_MODE="copy", UV_CACHE_DIR=str(cache),
            UV_PYTHON_DOWNLOADS="never", TEMP=str(temporary), TMP=str(temporary),
            PYTHONUTF8="1", PYTHONIOENCODING="utf-8", PYTHONDONTWRITEBYTECODE="1")
        if not venv.exists():
            created = run_owned(owner, [str(uv), "venv", "--no-python-downloads", "--python", str(python), str(venv)],
                cwd=session, environment=environment, log=session / "venv.log")
            if created["exit_code"]: raise RuntimeError("Probe venv creation failed")
        command = [str(uv), "-v", "pip", "sync", "--python", str(venv / "Scripts/python.exe"),
                   "--require-hashes", "--link-mode", "copy", "--cache-dir", str(cache),
                   "--default-index", "https://pypi.org/simple", str(requirements)]
        result = run_owned(owner, command, cwd=session, environment=environment, log=session / (label + ".log"))
        result.update(case=label, cache=str(cache), cache_characters=len(str(cache)))
        report["cases"].append(result)
        print(json.dumps(result), flush=True)
    long_log = (session / "long-cache.log").read_text(encoding="utf-8", errors="replace")
    short_log = (session / "short-cache.log").read_text(encoding="utf-8", errors="replace")
    report["failure_symptom_matched"] = "dependency_links.txt" in long_log and "No such file or directory" in long_log and "build_wheel" in long_log
    report["build_tools"] = {"long": sorted(set(re.findall(r"Selecting: setuptools==([\w.]+)", long_log))),
                             "short": sorted(set(re.findall(r"Selecting: setuptools==([\w.]+)", short_log)))}
    report["red_green"] = (report["cases"][0]["exit_code"] != 0 and report["cases"][1]["exit_code"] == 0 and
                           report["failure_symptom_matched"] and report["build_tools"]["long"] == report["build_tools"]["short"])
    # A third clean venv exercises the ACTUAL bootstrap path/env builder. Only
    # docopt is requested, and no failed candidate file is modified or imported.
    own_candidate = session / "local/VoiceStudioNext/runtime_abc0123"
    own_candidate.mkdir(parents=True)
    bootstrap.atomic_json(own_candidate / ".installer-owner.json", {"owner": bootstrap.OWNER, "id": own_candidate.name})
    workspace = bootstrap.prepare_build_workspace(own_candidate, "cpu")
    (own_candidate / "requirements.lock.txt").write_bytes(requirements.read_bytes())
    with bootstrap.build_environment(workspace):
        own_environment = dict(environment)
        own_environment.update({name: os.environ[name] for name in ("TEMP", "TMP", "UV_CACHE_DIR")})
        result = run_owned(owner, [str(uv), "venv", "--no-python-downloads", "--python", str(python), str(own_candidate / ".venv")],
            cwd=session, environment=own_environment, log=session / "bootstrap-venv.log")
        if result["exit_code"]: raise RuntimeError("Bootstrap-path venv creation failed")
        command = bootstrap.commands(own_candidate, "cpu", build_workspace=workspace)["dependencies"]
        command[0] = str(uv)  # the verified executable is used read-only
        result = run_owned(owner, command, cwd=own_candidate, environment=own_environment, log=session / "bootstrap-layout.log",
                           budget_roots=[session, Path(workspace["path"])])
        result.update(case="actual-bootstrap-layout", workspace=workspace,
            target_python=str(own_candidate / ".venv/Scripts/python.exe"),
            source_sha256=DOCOPT_HASH, require_hashes="--require-hashes" in command, link_mode="copy")
        installed = own_candidate / ".venv/Lib/site-packages/docopt.py"
        result["installed_independent_file"] = installed.is_file() and installed.stat().st_nlink == 1
        report["cases"].append(result)
        print(json.dumps(result), flush=True)
    report["bootstrap_layout_passed"] = result["exit_code"] == 0 and result["installed_independent_file"]
    report["same_venv_requirements_temp_for_red_green"] = True
    report["registry_setting_changed"] = False
    if os.name == "nt":
        import winreg
        with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"SYSTEM\CurrentControlSet\Control\FileSystem") as key:
            report["long_paths_enabled"] = winreg.QueryValueEx(key, "LongPathsEnabled")[0]
    report["candidate_executables_unchanged"] = report["uv_sha256"] == bootstrap.sha256(uv) and report["python_sha256"] == bootstrap.sha256(python)
    report["disk_bytes"] = size(session)
    report["bootstrap_scratch_bytes"] = size(Path(workspace["path"]))
    report["sources"] = ["uv 0.10.6 (a91bcf268 2026-02-24) local help pip sync: --cache-dir, --require-hashes, --link-mode copy",
                         "https://docs.astral.sh/uv/concepts/cache/#cache-directory"]
    report["limits"] = ["Actual docopt-only source builds; full CPU dependency installation, doctor and activation have not been retried.",
                        "No registry, package version, source hash or original candidate dependency file was changed.",
                        "Isolated source-build tools are resolved by uv; runtime package archives remain hash-required. Both comparison cases resolved the same setuptools.",
                        "Owned sandbox and scratch are retained; only processes from retained Windows Jobs were terminated/waited."]
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", action="store_true")
    parser.add_argument("--candidate", type=Path, required=True)
    parser.add_argument("--report", type=Path, default=ROOT / ".tmp/qa/bootstrap-docopt-windows.json")
    args = parser.parse_args()
    if not args.run: parser.error("Explicit --run is required; no full installation will run")
    _no_link_ancestors(args.report)
    if args.report.resolve().parent != ROOT / ".tmp/qa": parser.error("Report must stay in .tmp/qa")
    result = probe(args.candidate, args.report)
    print(json.dumps({"red_green": result["red_green"], "report": str(args.report)}))
    raise SystemExit(0 if result["red_green"] and result["bootstrap_layout_passed"] and result["candidate_executables_unchanged"] else 1)


if __name__ == "__main__": main()
