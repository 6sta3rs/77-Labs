"""Prepare an independent Python environment from local, offline uv caches.

No models, network access, or changes to the existing VoiceStudio environment.
Run with the installed VoiceStudio Python (or any Python 3.11 on Windows).
"""

from pathlib import Path as _SourcePath
import sys as _source_sys
_source_layout = _SourcePath(__file__).resolve().parent.parent
if (_source_layout / "app/launcher.py").is_file() and (_source_layout / "install/bootstrap.py").is_file():
    for _source_dir in ("app", "install"):
        _source_sys.path.insert(0, str(_source_layout / _source_dir))

from pathlib import Path
import json
import os
import shutil
import subprocess
import sys


def prepare_model_cache(root):
    """Private directory entries on the models' volume; never model downloads."""
    env_file = Path.home() / ".config" / "omnivoice" / "env"
    cache = None
    if env_file.is_file():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            if line.startswith("OMNIVOICE_CACHE_DIR="):
                cache = Path(line.split("=", 1)[1].strip().strip('\"\''))
                break
    if cache is None or not cache.is_dir():
        return
    cache = cache.resolve()
    destination = (cache.parent.parent / "VoiceStudioNext" / cache.name).resolve()
    if destination == cache or destination.is_relative_to(cache):
        raise RuntimeError("The private model cache must be separate from the source cache")
    destination.mkdir(parents=True, exist_ok=True)
    count = 0
    for model in cache.iterdir():
        if not model.is_dir() or not model.name.startswith("models--"):
            continue
        for folder, directories, files in os.walk(model):
            directories[:] = [name for name in directories if not (Path(folder) / name).is_symlink()]
            relative = Path(folder).relative_to(cache)
            target_folder = destination / relative
            target_folder.mkdir(parents=True, exist_ok=True)
            for name in files:
                original = (Path(folder) / name).resolve()
                target = target_folder / name
                if not original.is_relative_to(cache) or not original.is_file() or target.exists() or name.endswith((".lock", ".incomplete")):
                    continue
                if "refs" in relative.parts:
                    shutil.copy2(original, target)
                else:
                    os.link(original, target)
                count += 1
    (root / "model-cache.json").write_text(json.dumps({"path": str(destination), "source": str(cache), "method": "private NTFS hardlink snapshot; mutable refs copied", "newEntries": count}, indent=2), encoding="utf-8")
    print(f"Model cache prepared offline: {destination}, {count} new entries", flush=True)


def main():
    root = Path(os.environ["LOCALAPPDATA"]) / "VoiceStudioNext" / "runtime"
    root.mkdir(parents=True, exist_ok=True)
    if (root / "python-ready.json").is_file():
        prepare_model_cache(root)
        print("Private Python runtime already prepared", flush=True)
        return
    old = Path(os.environ["APPDATA"]) / "VoiceStudio" / "runtime"
    source_python = old / "project" / ".venv" / "Scripts" / "python.exe"
    uv = shutil.which("uv")
    if not uv or not source_python.is_file():
        raise RuntimeError("Preparation requires local uv and the existing Python dependency inventory.")
    base = Path(subprocess.check_output([str(source_python), "-c", "import sys; print(sys.base_prefix)"], text=True).strip())
    private_base = root / "python"
    if not (private_base / "python.exe").is_file():
        shutil.copytree(base, private_base, ignore=shutil.ignore_patterns("__pycache__"), dirs_exist_ok=True)
    target = root / ".venv"
    if not (target / "Scripts" / "python.exe").is_file():
        subprocess.run([uv, "venv", "--offline", "--python", str(private_base / "python.exe"), str(target)], check=True)
    requirements = subprocess.check_output([uv, "pip", "freeze", "--python", str(source_python)], text=True)
    # uv's freeze omits origin URLs for manually installed optional wheels.
    # Preserve those origins so offline resolution uses their URL-cache keys.
    probe = "import importlib.metadata as m,json; print(json.dumps({d.metadata['Name'].lower().replace('_','-'):json.loads(d.read_text('direct_url.json'))['url'] for d in m.distributions() if d.read_text('direct_url.json')}))"
    origins = json.loads(subprocess.check_output([str(source_python), "-c", probe], text=True))
    requirements = "\n".join(
        f"{line.split('==')[0]} @ {origins[line.split('==')[0].lower().replace('_', '-')]}"
        if "==" in line and line.split('==')[0].lower().replace('_', '-') in origins else line
        for line in requirements.splitlines()
    ) + "\n"
    requirements_path = root / "requirements.lock.txt"
    requirements_path.write_text(requirements, encoding="utf-8")
    resolution = subprocess.run([
        uv, "pip", "sync", "--offline", "--link-mode", "hardlink",
        "--cache-dir", str(old / ".uv-cache"),
        "--python", str(target / "Scripts" / "python.exe"),
        "--index", "https://download.pytorch.org/whl/cu128",
        "--default-index", "https://pypi.org/simple", "--index-strategy", "unsafe-best-match",
        str(requirements_path),
    ])
    method = "offline uv cache hardlinks"
    if resolution.returncode:
        # An exact offline snapshot is preferable to downloading/upgrading a
        # different ML stack. Hardlinks are independent directory entries;
        # uninstalling the old app does not invalidate this environment.
        # These dependency files are treated as immutable by Next.
        print("Offline wheel metadata incomplete; linking exact installed dependency snapshot", flush=True)
        source_packages = old / "project" / ".venv" / "Lib" / "site-packages"
        private_packages = target / "Lib" / "site-packages"
        count = 0
        for folder, directories, files in os.walk(source_packages):
            directories[:] = [name for name in directories if name != "__pycache__" and not (Path(folder) / name).is_symlink()]
            relative = Path(folder).relative_to(source_packages)
            destination = private_packages / relative
            destination.mkdir(parents=True, exist_ok=True)
            for name in files:
                original = Path(folder) / name
                output = destination / name
                if original.is_symlink() or name.endswith((".pyc", ".pth", ".egg-link")):
                    continue
                if not output.exists():
                    os.link(original, output)
                    count += 1
        print(f"Prepared {count} private dependency hardlinks (no package bytes copied)", flush=True)
        method = "exact installed dependency snapshot via NTFS hardlinks"
    subprocess.run([str(target / "Scripts" / "python.exe"), "-c", "import torch, fastapi, uvicorn; print('Runtime dependencies ready:', torch.__version__)"], check=True)
    (root / "python-ready.json").write_text(json.dumps({"independent": True, "python": str(target / "Scripts" / "python.exe"), "dependencies": method, "pythonDistribution": "private copy"}, indent=2), encoding="utf-8")
    prepare_model_cache(root)
    print(f"Independent runtime ready: {target}")


if __name__ == "__main__":
    main()
