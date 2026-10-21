"""Parent-pipe regressions. --ml opts into real isolated numpy/torch imports.

Default tests are stdlib-only. The explicit Windows ML case starts one private
venv worker at a time, with an open parent pipe, and exercises normal exit and
EOF/tree cancellation without inference, model access, or network downloads.
"""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import queue
import subprocess
import sys
import tempfile
import threading
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import bootstrap
import model_management

_QA_OUTPUT = Path(__file__).resolve().parents[2] / ".tmp/qa"
_QA_OUTPUT.mkdir(parents=True, exist_ok=True)


RUN_ML = "--ml" in sys.argv
EVIDENCE = []
REPORT = Path(".tmp/qa/watchdog-runtime.json")


class WatchdogTests(unittest.TestCase):
    def test_peek_never_reads_an_empty_pipe_and_calls_only_its_own_exit(self):
        for subject in (model_management, bootstrap):
            with self.subTest(module=subject.__name__):
                samples = iter([(0, 0), (4, 0), (0, 0), OSError("parent gone")])
                reads, sleeps, exits = [], [], []
                def peek(handle):
                    self.assertEqual(handle, 17)
                    sample = next(samples)
                    if isinstance(sample, Exception):
                        raise sample
                    return sample
                subject._watch_windows_parent_pipe(17, lambda: exits.append("operation-only"), peek=peek,
                                                    read_file=lambda handle, size: reads.append((handle, size)), sleep=sleeps.append)
                self.assertEqual(reads, [(17, 4)])
                self.assertEqual(sleeps, [0.25, 0.25])
                self.assertEqual(exits, ["operation-only"])

    def test_start_disables_the_backend_watcher_and_preserves_data_environment(self):
        for subject, code in ((model_management, 72), (bootstrap, 0)):
            with self.subTest(module=subject.__name__):
                started, exits = [], []
                class Thread:
                    def __init__(self, **options):
                        self.options = options
                    def start(self):
                        started.append(self.options)
                with patch.dict(os.environ, {"OMNIVOICE_DESKTOP_CONTAINED": "1", "OMNIVOICE_DATA_DIR": "fixture-main-data"}), patch.object(subject.threading, "Thread", Thread), patch.object(subject.os, "_exit", exits.append):
                    subject._start_parent_watchdog(code)
                    self.assertNotIn("OMNIVOICE_DESKTOP_CONTAINED", os.environ)
                    self.assertEqual(os.environ["OMNIVOICE_DATA_DIR"], "fixture-main-data")
                    self.assertEqual(len(started), 1)
                    self.assertTrue(started[0]["daemon"])
                    self.assertEqual(started[0]["target"], subject._watch_parent_pipe)
                    started[0]["args"][0]()
                    self.assertEqual(exits, [code])

    def test_doctor_arms_exactly_one_watcher_before_backend_import(self):
        root = Path("fixture-candidate")
        starts, runs = [], []
        fake_backend = SimpleNamespace(app=object())
        fake_uvicorn = SimpleNamespace(run=lambda app, **options: runs.append((app, options, os.environ.get("OMNIVOICE_DESKTOP_CONTAINED"))))
        class Thread:
            def __init__(self, **options):
                self.options = options
            def start(self):
                starts.append(self.options)
        previous_path = list(sys.path)
        try:
            with patch.dict(os.environ, {"OMNIVOICE_DESKTOP_CONTAINED": "1"}), patch.dict(sys.modules, {"main": fake_backend, "uvicorn": fake_uvicorn}), patch.object(bootstrap.threading, "Thread", Thread), patch.object(bootstrap.os, "chdir"), patch.object(bootstrap, "use_source_version", return_value="0.5.7"), patch.object(bootstrap, "configure_windows_runtime_paths") as paths:
                bootstrap.doctor_server(root, 4567, "fixture")
                self.assertEqual(len(starts), 1)
                self.assertEqual(len(runs), 1)
                paths.assert_called_once_with()
                self.assertIsNone(runs[0][2], "main must not inherit permission to arm its backend watcher")
        finally:
            sys.path[:] = previous_path

    @unittest.skipUnless(os.name == "nt" and RUN_ML, "Explicit --ml Windows import/tree acceptance")
    def test_private_venv_ml_import_normal_exit_and_owned_cancel(self):
        import psutil
        self.assertIn(".venv", Path(sys.executable).parts, "Use the isolated runtime venv")
        source = Path(sys.executable).resolve().parents[2] / "engine/backend/core/contained_subprocess.py"
        if not source.is_file():
            self.fail(f"Missing real upstream process owner: {source}")
        definition = importlib.util.spec_from_file_location("watchdog_real_process_owner", source)
        owner = importlib.util.module_from_spec(definition)
        definition.loader.exec_module(owner)
        with tempfile.TemporaryDirectory(prefix="seventy-seven-watchdog-") as temporary:
            root = Path(temporary)
            sentinel = root / "parent-run-sentinel.json"
            sentinel.write_text('{"owner":"main-backend","must_survive":true}', encoding="utf-8")
            expected_sentinel = sentinel.read_bytes()
            script = root / "fixture_worker.py"
            helper = root / "fixture_helper.py"
            helper.write_text("import os,sys,json,time\nfrom pathlib import Path\nPath(sys.argv[1]).write_text(json.dumps({'pid':os.getpid()}))\ntime.sleep(60)\n", encoding="utf-8")
            script.write_text(
                "import importlib.util,json,os,sys,threading,time,subprocess\n"
                "from pathlib import Path\n"
                "from types import SimpleNamespace\n"
                "sys.path.insert(0,str(Path(sys.argv[1]).parent))\n"
                "definition=importlib.util.spec_from_file_location('actual_operation',sys.argv[1])\n"
                "operation=importlib.util.module_from_spec(definition);sys.modules[definition.name]=operation;definition.loader.exec_module(operation)\n"
                "def wrong_clear():\n Path(sys.argv[4]).unlink(missing_ok=True)\n"
                "sys.modules['core']=SimpleNamespace(run_sentinel=SimpleNamespace(clear_sentinel=wrong_clear))\n"
                "operation._start_parent_watchdog(int(sys.argv[3]))\n"
                "assert 'OMNIVOICE_DESKTOP_CONTAINED' not in os.environ\n"
                "import numpy,torch\n"
                "record=dict(pid=os.getpid(),numpy=numpy.__version__,torch=torch.__version__,watchers=sum(t.name=='next-operation-parent-watchdog' for t in threading.enumerate()))\n"
                "assert record['watchers']==1\n"
                "if sys.argv[2]=='cancel':\n"
                " child=subprocess.Popen([sys.executable,sys.argv[5],sys.argv[6]],creationflags=subprocess.CREATE_NO_WINDOW)\n"
                " record['helper_redirector']=child.pid\n"
                " while not Path(sys.argv[6]).is_file():time.sleep(.02)\n"
                " record['helper']=json.loads(Path(sys.argv[6]).read_text())['pid']\n"
                "print('QA_WATCHDOG_READY '+json.dumps(record),flush=True)\n"
                "if sys.argv[2]=='cancel':time.sleep(60)\n",
                encoding="utf-8")
            unrelated = owner.spawn_owned([sys.executable, "-c", "import time;time.sleep(60)"], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            try:
                for subject, code in ((model_management, 72), (bootstrap, 0)):
                    for mode in ("normal", "cancel"):
                        with self.subTest(module=subject.__name__, mode=mode):
                            helper_pid = root / f"{subject.__name__}-{mode}.json"
                            command = [sys.executable, str(script), str(Path(subject.__file__).resolve()), mode, str(code), str(sentinel), str(helper), str(helper_pid)]
                            process = owner.spawn_owned(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                                        text=True, encoding="utf-8", errors="replace", env=dict(os.environ, OMNIVOICE_DESKTOP_CONTAINED="1", PYTHONDONTWRITEBYTECODE="1", PYTHONUTF8="1", PYTHONIOENCODING="utf-8"))
                            messages, lines = queue.Queue(), []
                            def collect():
                                for line in process.stdout:
                                    lines.append(line)
                                    if line.startswith("QA_WATCHDOG_READY "):
                                        messages.put(json.loads(line[len("QA_WATCHDOG_READY "):]))
                            reader = threading.Thread(target=collect, daemon=True)
                            reader.start()
                            started = time.monotonic()
                            try:
                                try:
                                    ready = messages.get(timeout=90)
                                except queue.Empty:
                                    self.fail("ML imports did not finish with the parent pipe open. " + "".join(lines[-10:]))
                                # stdin is still open here: importing ML must
                                # never require closing the containment pipe.
                                self.assertFalse(process.stdin.closed)
                                self.assertEqual(ready["watchers"], 1)
                                pids = {process.pid, ready["pid"]}
                                if mode == "cancel":
                                    pids.update((ready["helper_redirector"], ready["helper"]))
                                    pids.update(child.pid for child in psutil.Process(process.pid).children(recursive=True))
                                handles = []
                                for pid in pids:
                                    try:
                                        handles.append(psutil.Process(pid))
                                    except psutil.NoSuchProcess:
                                        pass
                                if mode == "cancel":
                                    process.stdin.close()
                                returncode = process.wait(timeout=10)
                                self.assertEqual(returncode, code if mode == "cancel" else 0, "".join(lines[-8:]))
                                _gone, alive = psutil.wait_procs(handles, timeout=3)
                                self.assertEqual([entry.pid for entry in alive], [])
                                self.assertEqual(sentinel.read_bytes(), expected_sentinel, "Main backend sentinel was touched")
                                self.assertIsNone(unrelated.poll(), "Operation cancellation killed an unrelated process")
                                EVIDENCE.append({"module": subject.__name__, "mode": mode, **ready, "pids_confirmed_gone": sorted(pids), "returncode": returncode,
                                                 "parent_pipe_open_during_import": True, "parent_sentinel_unchanged": True, "unrelated_process_alive": True,
                                                 "elapsed_s": round(time.monotonic() - started, 3)})
                            finally:
                                process.kill()
                                process.wait(timeout=5)
                                if not process.stdin.closed:
                                    process.stdin.close()
                                reader.join(timeout=3)
                                process.stdout.close()
            finally:
                unrelated.kill(); unrelated.wait(timeout=5)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--ml", action="store_true")
    parser.add_argument("--report", type=Path, default=REPORT)
    args, remaining = parser.parse_known_args()
    result = unittest.main(argv=[sys.argv[0], *remaining], verbosity=2, exit=False).result
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps({"passed": result.wasSuccessful(), "tests_run": result.testsRun, "skipped": len(result.skipped), "ml_import_requested": args.ml,
                                       "python": sys.executable, "evidence": EVIDENCE,
                                       "limits": ["No inference or model access", "No package/model downloads", "Existing QA backend was not restarted"]}, ensure_ascii=False, indent=2), encoding="utf-8")
    raise SystemExit(0 if result.wasSuccessful() else 1)
