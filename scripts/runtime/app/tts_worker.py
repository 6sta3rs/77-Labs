"""Optional engines in private venvs; existing SubprocessBackend owns cancellation."""
from __future__ import annotations

from pathlib import Path as _SourcePath
import sys as _source_sys
_source_layout = _SourcePath(__file__).resolve().parent.parent
if (_source_layout / "app/launcher.py").is_file() and (_source_layout / "install/bootstrap.py").is_file():
    for _source_dir in ("app", "install"):
        _source_sys.path.insert(0, str(_source_layout / _source_dir))

import base64
import io
import json
import os
from pathlib import Path
import struct
import sys
import threading
import traceback

from tts_catalog import ENGINES, all_specs, model_spec, require_snapshot

MAX_FRAME = 64 * 1024 * 1024
_model = None
_pipelines = {}
_send_lock = threading.Lock()
_cpu_configured = False

def _send(stream, message):
    data = json.dumps(message, ensure_ascii=False).encode()
    if len(data) > MAX_FRAME:
        raise ValueError("Wynik przekracza limit przesyłania audio. Podziel tekst na krótsze fragmenty.")
    with _send_lock:
        stream.write(struct.pack("!I", len(data)) + data)
        stream.flush()

def _read(stream, count):
    data = bytearray()
    while len(data) < count:
        piece = stream.read(count - len(data))
        if not piece:
            return None
        data.extend(piece)
    return bytes(data)

def _receive(stream):
    head = _read(stream, 4)
    if head is None:
        return None
    count, = struct.unpack("!I", head)
    if not 0 < count <= MAX_FRAME:
        raise ValueError("Nieprawidłowy rozmiar żądania silnika.")
    body = _read(stream, count)
    if body is None:
        raise EOFError("Przerwane żądanie silnika.")
    value = json.loads(body)
    if not isinstance(value, dict):
        raise ValueError("Nieprawidłowe żądanie silnika.")
    return value

def install_offline_resolver(cache):
    """Third-party defaults may ask for main; resolve only our pinned snapshots."""
    os.environ.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1", HF_HUB_CACHE=str(cache), HF_HOME=str(Path(cache).parent), HF_HUB_DISABLE_IMPLICIT_TOKEN="1")
    import huggingface_hub as hub
    specs = all_specs()
    def snapshot(repo_id, *args, **kwargs):
        if repo_id not in specs:
            raise RuntimeError(f"Silnik wymaga dodatkowych wag spoza lokalnego katalogu: {repo_id}.")
        return str(require_snapshot(specs[repo_id], cache))
    def download(repo_id, filename, *args, **kwargs):
        root = Path(snapshot(repo_id))
        name = Path(kwargs.get("subfolder") or "") / filename
        if name.is_absolute() or ".." in name.parts:
            raise ValueError("Nieprawidłowa ścieżka pliku modelu.")
        path = root / name
        if not path.is_file():
            raise RuntimeError(f"Brak lokalnego pliku {repo_id}/{name.as_posix()}. Uzupełnij pobieranie modelu.")
        return str(path)
    hub.hf_hub_download = download
    hub.snapshot_download = snapshot

def block_external_connections():
    """G2P/tokenizer libraries must not start hidden downloads during inference."""
    import socket
    import ipaddress
    original = socket.socket.connect
    def connect(sock, address):
        if isinstance(address, tuple):
            try:
                if not ipaddress.ip_address(address[0]).is_loopback:
                    raise RuntimeError("Pobieranie podczas syntezy jest wyłączone. Przygotuj zasoby języka w ustawieniach.")
            except ValueError as exc:
                raise RuntimeError("Połączenie zewnętrzne podczas syntezy jest wyłączone.") from exc
        return original(sock, address)
    socket.socket.connect = connect
    os.environ.update(HTTP_PROXY="http://127.0.0.1:9", HTTPS_PROXY="http://127.0.0.1:9", NO_PROXY="127.0.0.1,::1,localhost", PIP_NO_INDEX="1")

def _reference(message, *, transcript=False):
    value = message.get("ref_audio")
    if not value:
        raise ValueError("Ten model wymaga nagrania referencyjnego wybranego głosu.")
    path = Path(value)
    if not path.is_file() or path.stat().st_size > 128 * 1024 * 1024:
        raise ValueError("Brak lokalnego nagrania referencyjnego lub plik przekracza 128 MB.")
    if transcript and not str(message.get("ref_text") or "").strip():
        raise ValueError("Ten model wymaga tekstu nagrania referencyjnego. Uzupełnij transkrypcję głosu.")
    return str(path)

def _device():
    global _cpu_configured
    import torch
    if os.environ.get("NEXT_TTS_DEVICE", "cpu") == "cpu":
        if not _cpu_configured:
            try:threads=int(os.environ.get('NEXT_TTS_CPU_THREADS','4'))
            except ValueError:threads=4
            torch.set_num_threads(max(1,min(threads,16)))
            try:torch.set_num_interop_threads(1)
            except RuntimeError:pass
            _cpu_configured=True
        return "cpu"
    if not torch.cuda.is_available():
        raise RuntimeError("Wybrana CUDA nie jest dostępna w środowisku silnika.")
    return "cuda"

def _load(engine_id, cache):
    global _model
    if _model is not None:
        return _model
    path = require_snapshot(model_spec(engine_id), cache)
    family = ENGINES[engine_id]["family"]
    if family == "chatterbox":
        from chatterbox.mtl_tts import ChatterboxMultilingualTTS
        _model = ChatterboxMultilingualTTS.from_local(path, _device(), t3_model="v3")
    elif family == "kitten":
        from kittenml import KittenTTS
        options = {"cache_dir": str(cache)}
        if engine_id == "kittentts2":
            options.update(device=_device(), weights="packed", decoder="default")
        _model = KittenTTS(str(path), **options)
    elif family == "qwen3":
        import torch
        from qwen_tts import Qwen3TTSModel
        device = _device()
        _model = Qwen3TTSModel.from_pretrained(str(path), device_map=device, dtype=torch.bfloat16 if device == "cuda" else torch.float32, attn_implementation="sdpa", local_files_only=True)
    elif family == "kokoro":
        # KPipeline loads only local weights through the pinned resolver.
        import espeakng_loader
        os.environ["PHONEMIZER_ESPEAK_LIBRARY"] = espeakng_loader.get_library_path()
        os.environ["ESPEAK_DATA_PATH"] = espeakng_loader.get_data_path()
        _model = True
    elif family == "fish":
        _model = True
    return _model

KOKORO_VOICES = {"English": ("a", "af_heart"), "Spanish": ("e", "ef_dora"), "French": ("f", "ff_siwis"), "Hindi": ("h", "hf_alpha"), "Italian": ("i", "if_sara"), "Japanese": ("j", "jf_alpha"), "Portuguese": ("p", "pf_dora"), "Chinese": ("z", "zf_xiaobei")}

def synthesize(engine_id, message, cache):
    import numpy as np
    family = ENGINES[engine_id]["family"]
    text = str(message.get("text") or "").strip()
    if not text:
        raise ValueError("Wpisz tekst do syntezy.")
    language = normalize_language(engine_id, message.get("language"))
    model = _load(engine_id, cache)
    rate = ENGINES[engine_id]["sample_rate"]
    speed = float(message.get("speed", 1))
    if not .5 <= speed <= 2:
        raise ValueError("Szybkość musi mieścić się w zakresie 0,5–2.")
    if family == "chatterbox":
        from chatterbox.mtl_tts import SUPPORTED_LANGUAGES
        code = next((code for code, label in SUPPORTED_LANGUAGES.items() if label.lower() == str(language).lower() or code == language), None)
        if not code:
            raise ValueError(f"Chatterbox nie obsługuje języka: {language}.")
        audio = model.generate(text, language_id=code, audio_prompt_path=_reference(message))
        rate = int(model.sr)
    elif family == "kokoro":
        if language not in KOKORO_VOICES:
            raise ValueError(f"Kokoro nie obsługuje języka: {language}.")
        from kokoro import KPipeline
        code, voice = KOKORO_VOICES[language]
        if code not in _pipelines:
            _pipelines[code] = KPipeline(lang_code=code, repo_id=model_spec(engine_id)["repo_id"], device=_device())
        chunks = [np.asarray(result.audio) for result in _pipelines[code](text, voice=voice, speed=speed)]
        if not chunks:
            raise RuntimeError("Kokoro nie zwrócił audio.")
        audio = np.concatenate(chunks)
    elif family == "kitten":
        if engine_id == "kittentts2":
            seed = message.get("seed")
            audio = model.generate(text, reference=_reference(message, transcript=True), reference_text=message["ref_text"], normalize=language == "English", advanced={"seed": int(seed)} if seed is not None else {})
        else:
            audio = model.generate(text, voice="expr-voice-2-f", speed=speed)
        rate = int(model.sample_rate)
    elif family == "qwen3":
        if engine_id == "qwen3-voice-design":
            description = str(message.get("description") or message.get("instruct") or "").strip()
            if not description:
                raise ValueError("Qwen3 VoiceDesign wymaga opisu głosu.")
            waves, rate = model.generate_voice_design(text=text, language=language, instruct=description)
        else:
            waves, rate = model.generate_voice_clone(text=text, language=language, ref_audio=_reference(message, transcript=True), ref_text=message["ref_text"])
        audio = waves[0]
    else:
        audio, rate = fish_synthesize(message)
    if hasattr(audio, "detach"):
        audio = audio.detach().float().cpu().numpy()
    audio = np.asarray(audio, dtype=np.float32).squeeze()
    if audio.ndim != 1 or not audio.size or not np.isfinite(audio).all():
        raise RuntimeError("Silnik zwrócił nieprawidłowy sygnał audio.")
    # The app contract has one rate per backend. Do not mislabel a service WAV.
    target_rate = ENGINES[engine_id]["sample_rate"]
    if rate != target_rate:
        from scipy.signal import resample_poly
        from math import gcd
        factor = gcd(rate, target_rate)
        audio = resample_poly(audio, target_rate // factor, rate // factor)
    if speed != 1 and family != "kokoro" and engine_id != "kittentts":
        import librosa
        audio = librosa.effects.time_stretch(audio, rate=speed)
    return audio

def normalize_language(engine_id, value):
    from tts_catalog import LANGUAGES
    names = ENGINES[engine_id].get("languages", LANGUAGES.get(ENGINES[engine_id]["family"], ["English"]))
    aliases = dict(zip("ar zh da nl en fi fr de el he hi it ja ko ms no pl pt ru es sw sv tr cs id".split(), "Arabic Chinese Danish Dutch English Finnish French German Greek Hebrew Hindi Italian Japanese Korean Malay Norwegian Polish Portuguese Russian Spanish Swahili Swedish Turkish Czech Indonesian".split()))
    value = str(value or "English").strip()
    label = aliases.get(value.lower().split("-")[0].split("_")[0], value)
    match = next((name for name in names if name.lower() == label.lower()), None)
    if not match:
        raise ValueError(f"Ten model nie obsługuje języka: {value}.")
    return match

def fish_synthesize(message):
    import urllib.request
    import soundfile as sf
    from tts_extensions import fish_configuration
    config = fish_configuration(Path(__file__).parent)
    reference = _reference(message, transcript=True)
    body = {"text": message["text"], "references": [{"audio": base64.b64encode(Path(reference).read_bytes()).decode(), "text": message["ref_text"]}], "format": "wav", "streaming": False, "normalize": False}
    request = urllib.request.Request(config["url"] + "/v1/tts", json.dumps(body).encode(), {"Content-Type": "application/json"})
    # Redirects must not forward private reference audio to a different host.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            raise RuntimeError("Usługa Fish przekierowała żądanie. Sprawdź jej lokalny adres.")
    with urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect).open(request, timeout=240) as response:
        data = response.read(MAX_FRAME + 1)
        if len(data) > MAX_FRAME:
            raise ValueError("Wynik Fish jest zbyt duży. Podziel tekst.")
    audio, rate = sf.read(io.BytesIO(data), dtype="float32")
    return audio, rate

def serve(engine_id):
    if engine_id not in ENGINES:
        raise ValueError("Nieznany silnik.")
    stdin = sys.stdin.buffer
    output = os.fdopen(os.dup(1), "wb")
    os.dup2(2, 1)  # Third-party stdout belongs in the log, never in the protocol.
    cache = os.environ["OMNIVOICE_CACHE_DIR"]
    _send(output, {"op": "ready", "engine": engine_id, "sample_rate": ENGINES[engine_id]["sample_rate"]})
    initialized = False
    while (message := _receive(stdin)) is not None:
        if message.get("op") in {"shutdown", "quit"}:
            return
        if message.get("op") == "ping":
            _send(output, {"op": "pong"})
            continue
        if message.get("op") != "synthesize":
            _send(output, {"op": "error", "message": "Nieznana operacja silnika."})
            continue
        done = threading.Event()
        def heartbeat():
            while not done.wait(5):
                _send(output, {"op": "progress", "stage": "synthesis"})
        thread = threading.Thread(target=heartbeat, daemon=True)
        thread.start()
        try:
            if not initialized:
                install_offline_resolver(cache)
                block_external_connections()
                initialized = True
            import numpy as np
            audio = synthesize(engine_id, message, cache)
            pcm = (np.clip(audio, -1, 1) * 32767).astype("<i2")
            done.set(); thread.join()
            _send(output, {"op": "audio", "audio_pcm_b64": base64.b64encode(pcm.tobytes()).decode(), "sample_rate": ENGINES[engine_id]["sample_rate"], "n_samples": len(pcm)})
        except Exception as exc:
            done.set(); thread.join()
            if "out of memory" in str(exc).lower():
                torch = sys.modules.get("torch")
                if torch is not None and torch.cuda.is_available():
                    torch.cuda.empty_cache()  # return the failed request's blocks so the next one can run
            traceback.print_exc(file=sys.stderr)
            _send(output, {"op": "error", "stage": "synthesis", "message": str(exc)[:1000]})
