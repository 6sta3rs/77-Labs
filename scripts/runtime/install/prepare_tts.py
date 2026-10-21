"""Explicit installation of optional engines into new, app-owned environments."""
from __future__ import annotations

from pathlib import Path as _SourcePath
import sys as _source_sys
_source_layout = _SourcePath(__file__).resolve().parent.parent
if (_source_layout / "app/launcher.py").is_file() and (_source_layout / "install/bootstrap.py").is_file():
    for _source_dir in ("app", "install"):
        _source_sys.path.insert(0, str(_source_layout / _source_dir))

import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import threading
import time
import venv
from contextlib import contextmanager

from tts_catalog import ENGINES, CHATTERBOX_TOKENIZER_URL, CHATTERBOX_TOKENIZER_SHA256
from tts_extensions import ENV_VERSION, environment_dir, environment_python

REQUIREMENTS = {
    "chatterbox": ["chatterbox-tts @ git+https://github.com/resemble-ai/chatterbox.git@5de7a54aa4e5e2baadb0182dde554908b48b85c2"],
    "kokoro": ["kokoro==0.9.4", "misaki[en]==0.9.4", "transformers==4.46.3", "huggingface-hub==0.36.2", "numpy==2.2.6", "espeakng-loader==0.2.4", "https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.8.0/en_core_web_sm-3.8.0-py3-none-any.whl"],
    "kitten": ["kittenml @ git+https://github.com/KittenML/KittenTTS.git@e948cb2fb1633bdb428d1d0b30f03c2bddb782f3"],
    "qwen3": ["qwen-tts @ git+https://github.com/QwenLM/Qwen3-TTS.git@022e286b98fbec7e1e916cb940cdf532cd9f488e"],
    "fish": ["numpy==2.2.6", "soundfile==0.13.1", "scipy==1.15.3", "huggingface-hub==0.36.2", "librosa==0.11.0"],
}
IMPORTS = {"chatterbox": "chatterbox.mtl_tts", "kokoro": "kokoro", "kitten": "kittenml", "qwen3": "qwen_tts", "fish": "soundfile"}

@contextmanager
def environment_lock(folder):
    folder.parent.mkdir(parents=True,exist_ok=True)
    handle=open(folder.parent/(folder.name+".lock"),"a+b")
    try:
        if os.name=="nt":
            import msvcrt
            handle.seek(0);handle.write(b"1");handle.flush();handle.seek(0)
            msvcrt.locking(handle.fileno(),msvcrt.LK_NBLCK,1)
        else:
            import fcntl
            fcntl.flock(handle,fcntl.LOCK_EX|fcntl.LOCK_NB)
        yield
    finally:
        handle.close()

def write_state(path, **values):
    path.parent.mkdir(parents=True, exist_ok=True)
    values["updated_at"] = time.time()
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(values, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(path)

def watch_parent():
    # A pending Windows ReadFile on inherited stdin can block native DLL init
    # in a descendant. Peek first; dependency children get their own DEVNULL.
    try:
        if os.name=='nt':
            import msvcrt,_winapi
            handle=msvcrt.get_osfhandle(sys.stdin.fileno())
            while True:
                available,_=_winapi.PeekNamedPipe(handle)
                if available:_winapi.ReadFile(handle,available)
                else:time.sleep(.25)
        else:
            while os.read(sys.stdin.fileno(),1):pass
    except OSError:pass
    os._exit(72)

def prepare(engine_id, root, device="cpu", *, supervised=False):
    root=root.resolve()
    folder=environment_dir(engine_id,root)
    if not folder.resolve().is_relative_to(root) or folder.is_symlink():
        raise ValueError("Katalog środowiska wychodzi poza prywatny runtime.")
    with environment_lock(folder):
        return _prepare_locked(engine_id,root,device,supervised=supervised)

def _prepare_locked(engine_id, root, device="cpu", *, supervised=False):
    root = root.resolve()
    family = ENGINES[engine_id]["family"]
    folder = environment_dir(engine_id, root)
    job = root / "tts-setup" / f"{family}.json"
    if not folder.resolve().is_relative_to(root) or folder.is_symlink():
        raise ValueError("Katalog środowiska wychodzi poza prywatny runtime.")
    marker = folder / ".next-private-tts"
    if folder.exists() and not marker.is_file():
        raise ValueError("Katalog nie został utworzony przez instalator TTS. Wybierz osobny runtime.")
    if family in {"kokoro", "fish"} or engine_id == "kittentts":
        device = "cpu"
    if supervised:
        threading.Thread(target=watch_parent, daemon=True).start()
    try:
        write_state(job, state="creating", message="Tworzenie osobnego środowiska bibliotek", device=device)
        folder.mkdir(parents=True, exist_ok=True)
        marker.write_text("Seventy Seven Labs private TTS environment\n", encoding="utf-8")
        (folder / "environment.json").unlink(missing_ok=True)
        python = environment_python(engine_id, root)
        if not python.is_file():
            venv.EnvBuilder(with_pip=True).create(folder)
        uv = shutil.which("uv")
        installer = [uv, "pip", "install", "--python", str(python)] if uv else [str(python), "-m", "pip", "install"]
        env = os.environ.copy()
        for key in list(env):
            if key.startswith(("HF_", "HUGGINGFACE_", "OMNIVOICE_", "PYTHONPATH", "VIRTUAL_ENV")):
                env.pop(key, None)
        env.update(PYTHONNOUSERSITE="1", PIP_DISABLE_PIP_VERSION_CHECK="1", PIP_NO_INPUT="1", HF_HUB_DISABLE_IMPLICIT_TOKEN="1")
        if family != "fish":
            write_state(job, state="installing", message="Instalowanie PyTorch w osobnym środowisku", device=device)
            index = "cu126" if device == "cuda" else "cpu"
            subprocess.run([*installer, "torch==2.6.0", "torchaudio==2.6.0", "--index-url", f"https://download.pytorch.org/whl/{index}"], stdin=subprocess.DEVNULL, env=env, check=True, timeout=1800)
        write_state(job, state="installing", message="Instalowanie bibliotek silnika; szczegóły w lokalnym logu", device=device)
        subprocess.run([*installer, *REQUIREMENTS[family]], stdin=subprocess.DEVNULL, env=env, check=True, timeout=1800)
        assets={}
        if family=="chatterbox":
            env["PKUSEG_HOME"]=str(folder/'assets'/'pkuseg')
            write_state(job,state="installing",message="Przygotowanie przypiętych danych tokenizera Chatterbox",device=device)
            setup="import os,hashlib;from pathlib import Path;from spacy_pkuseg.download import download_model,unzip_file;home=Path(os.environ['PKUSEG_HOME']);download_model("+repr(CHATTERBOX_TOKENIZER_URL)+",str(home),"+repr(CHATTERBOX_TOKENIZER_SHA256)+",progress=False);archive=home/'spacy_ontonotes.zip';"
            setup+="assert hashlib.file_digest(archive.open('rb'),'sha256').hexdigest()=="+repr(CHATTERBOX_TOKENIZER_SHA256)+";unzip_file(str(archive),str(home/'spacy_ontonotes'));assert all((home/'spacy_ontonotes'/name).is_file() for name in ['features.msgpack','weights.npz'])"
            subprocess.run([str(python),'-c',setup],stdin=subprocess.DEVNULL,env=env,check=True,timeout=300)
            assets['spacy_ontonotes']=CHATTERBOX_TOKENIZER_SHA256
        write_state(job, state="checking", message="Sprawdzanie importów i wersji bibliotek", device=device)
        env.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1")
        probe = f"import importlib,json; importlib.import_module({IMPORTS[family]!r}); "
        probe += "import torch; " if family != "fish" else ""
        probe += "print('NEXT_TTS_PROBE:'+json.dumps({'cuda':" + ("torch.cuda.is_available()" if family != "fish" else "False") + "}))"
        output=subprocess.check_output([str(python), "-c", probe], stdin=subprocess.DEVNULL, env=env, text=True, timeout=600)
        evidence=json.loads(next(line.split(':',1)[1] for line in output.splitlines() if line.startswith('NEXT_TTS_PROBE:')))
        if device=="cuda" and not evidence["cuda"]:
            raise RuntimeError("Wybrano CUDA, ale osobne środowisko nie potwierdziło jej dostępności.")
        freeze = subprocess.check_output([str(python), "-m", "pip", "freeze"], stdin=subprocess.DEVNULL, env=env, text=True, timeout=60)
        (folder / "requirements-resolved.txt").write_text(freeze, encoding="utf-8")
        write_state(folder / "environment.json", schema=ENV_VERSION, family=family, probe="passed", device=device, requirements=REQUIREMENTS[family],assets=assets)
        write_state(job, state="complete", message="Biblioteki gotowe. Dostępność syntezy zależy również od lokalnych wag i konfiguracji.", device=device)
    except Exception as exc:
        write_state(job, state="failed", message="Przygotowanie bibliotek nie powiodło się. Szczegóły w lokalnym logu instalacji.", error=type(exc).__name__, device=device)
        raise

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--engine", required=True, choices=ENGINES)
    parser.add_argument("--root", type=Path, default=Path(__file__).parent)
    parser.add_argument("--device", choices=["cpu", "cuda"], default="cpu")
    parser.add_argument("--supervised", action="store_true")
    args = parser.parse_args()
    prepare(args.engine, args.root, args.device, supervised=args.supervised)
