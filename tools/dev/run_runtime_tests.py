"""Runs the Python checks that need no engine, listed as "ci" in tests/manifest-python.json, one process each.

Fails when a tests/runtime/*.py or tests/frontend/*.py file is not in the manifest (so a new test is never silently skipped),
when a listed file is missing, or when any check fails. Usage: python tools/dev/run_runtime_tests.py [--list]
"""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TESTS = ROOT / "tests"
TIMEOUT = 300


def main() -> int:
    manifest = json.loads((TESTS / "manifest-python.json").read_text(encoding="utf-8"))
    listed = set(manifest["ci"]) | set(manifest["skipped"])
    present = {f"{folder}/{path.name}" for folder in ("runtime", "frontend") for path in (TESTS / folder).glob("*.py")}
    problems = [f"not in the manifest: {name}" for name in sorted(present - listed)]
    problems += [f"listed but missing: {name}" for name in sorted(listed - present)]
    if problems:
        print("\n".join(problems), file=sys.stderr)
        return 1
    if "--list" in sys.argv:
        print("\n".join(manifest["ci"]))
        return 0
    failed = []
    for name in manifest["ci"]:
        try:
            result = subprocess.run([sys.executable, "-B", "-X", "utf8", str(TESTS / name)], cwd=ROOT, capture_output=True,
                                    text=True, encoding="utf-8", errors="replace", timeout=TIMEOUT)
            code, tail = result.returncode, (result.stdout + result.stderr).strip().splitlines()[-1:]
        except subprocess.TimeoutExpired:
            code, tail = 1, [f"timed out after {TIMEOUT} s"]
        print(f"{'ok  ' if code == 0 else 'FAIL'} {name} {tail[0][:100] if tail else ''}", flush=True)
        if code != 0:
            failed.append(name)
    print(f"{len(manifest['ci']) - len(failed)}/{len(manifest['ci'])} passed, {len(manifest['skipped'])} skipped (see the manifest for reasons)")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
