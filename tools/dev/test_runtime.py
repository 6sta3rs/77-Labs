"""Run source-only Python regressions. No acceptance scripts or live models."""
from pathlib import Path
import sys
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tests"))
import runtime_paths

if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    failures = []
    # The stock backend caches config/db modules. Separate processes prevent one
    # test's temporary DATA directory from leaking into another test module.
    with tempfile.TemporaryDirectory(prefix="seventy-seven-source-tests-") as folder:
        engine = Path(folder) / "engine"
        with zipfile.ZipFile(runtime_paths.runtime_source("engine.zip")) as bundle:
            bundle.extractall(engine)
        for file in sorted((ROOT / "tests/runtime").glob("test_*.py")):
            print(f"\n=== {file.name} ===", flush=True)
            if 'parser.add_argument("--engine"' in file.read_text(encoding="utf-8"):
                command = [sys.executable, "-X", "utf8", "-B", str(file), "--engine", str(engine), "-v"]
            else:
                command = [sys.executable, "-X", "utf8", "-B", "-m", "unittest", "discover", "-s", str(file.parent), "-p", file.name, "-v"]
            result = subprocess.run(command, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                    text=True, encoding="utf-8", errors="replace",
                                    creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0)
            print(result.stdout, end="", flush=True)
            if result.returncode:
                failures.append(file.name)
    print(f"\nRuntime modules: {len(list((ROOT / 'tests/runtime').glob('test_*.py')))}; failed: {failures}", flush=True)
    sys.exit(bool(failures))
