"""Source lookup for explicit test entrypoints. Does not start or import ML."""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIRS = (
    ROOT / "scripts/runtime/app",
    ROOT / "scripts/runtime/install",
    ROOT / "tools/release",
    ROOT / "tests/runtime",
    ROOT / "tests/acceptance",
)
for directory in reversed(SOURCE_DIRS):
    if str(directory) not in sys.path:
        sys.path.insert(0, str(directory))


def runtime_source(name: str, root: Path = ROOT) -> Path:
    """Find a source resource without confusing it with deployed runtime data."""
    directories = (root / "scripts/runtime/app", root / "scripts/runtime/install",
                   root / "tools/release", root / "scripts/runtime/vendor",
                   root / "tests/runtime", root / "tests/acceptance")
    for directory in directories:
        candidate = directory / name
        if candidate.is_file():
            return candidate
    raise FileNotFoundError(f"Nie znaleziono źródła runtime: {name}")
