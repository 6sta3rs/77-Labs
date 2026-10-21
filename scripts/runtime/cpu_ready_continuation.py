"""Explicit continuation of the 29-positive CPU candidate after a Stop failure.

No install/activation/ML. Preserves the failed fresh-install receipt unchanged;
the separate result covers only owned start/stop/EXE restart on that candidate.
"""
import argparse
import asyncio
import json
from pathlib import Path

from release_cpu_smoke import ROOT, run_smoke

_QA_OUTPUT = Path(__file__).resolve().parents[2] / ".tmp/qa"
_QA_OUTPUT.mkdir(parents=True, exist_ok=True)


def main():
    parser = argparse.ArgumentParser(description="Oddzielny odbiór Start/Stop/restart gotowego kandydata CPU; nie jest ponowną instalacją.")
    parser.add_argument("--run", action="store_true")
    parser.add_argument("--exe", type=Path, required=True)
    parser.add_argument("--cpu-report", type=Path, required=True)
    parser.add_argument("--cpu-provenance", type=Path, required=True)
    parser.add_argument("--build-provenance", type=Path, required=True)
    parser.add_argument("--catalogue-probe", action="store_true", help="Jawne 4GET fast-catalogue evidence w każdym cyklu; bez rzeczywistych mutacji.")
    parser.add_argument("--report", type=Path, default=ROOT / ".tmp/qa/cpu-ready-continuation.json")
    arguments = parser.parse_args()
    if not arguments.run:
        parser.error("Wymagane jawne --run po diagnozie Stop, zwolnieniu własnego profilu/4312 i RootGO.")
    cycle_probe = None
    if arguments.catalogue_probe:
        from catalogue_latency_evidence import check_catalogue_cycle
        cycle_probe = check_catalogue_cycle
    result = asyncio.run(run_smoke(arguments, ready_continuation=True, cycle_probe=cycle_probe))
    print(json.dumps({"passed": result["passed"], "scope": result["kind"], "checks": len(result["checks"]), "report": str(arguments.report)}, ensure_ascii=False))
    raise SystemExit(0 if result["passed"] else 1)


if __name__ == "__main__":
    main()
