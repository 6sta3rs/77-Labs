"""Pinned, optional TTS extensions. Importing this module never downloads files."""
from pathlib import Path
import os

LANGUAGE_CODES = dict(zip(
    "Arabic Chinese Danish Dutch English Finnish French German Greek Hebrew Hindi Italian Japanese Korean Malay Norwegian Polish Portuguese Russian Spanish Swahili Swedish Turkish".split(),
    "ar zh da nl en fi fr de el he hi it ja ko ms no pl pt ru es sw sv tr".split(),
))
CHATTERBOX_TOKENIZER_URL = "https://github.com/explosion/spacy-pkuseg/releases/download/v0.0.26/spacy_ontonotes.zip"
CHATTERBOX_TOKENIZER_SHA256 = "b216e7f92de7ae285aeab8feba2faa8ea8216e5995ff6fb3d391cc8356db1bfe"

LANGUAGES = {
    "chatterbox": ["Arabic", "Chinese", "Danish", "Dutch", "English", "Finnish", "French", "German", "Greek", "Hebrew", "Hindi", "Italian", "Japanese", "Korean", "Malay", "Norwegian", "Polish", "Portuguese", "Russian", "Spanish", "Swahili", "Swedish", "Turkish"],
    # This Windows environment provisions English/Misaki and eSpeak languages.
    # Japanese/Chinese need additional dictionaries, not silently fetched here.
    "kokoro": ["English", "Spanish", "French", "Hindi", "Italian", "Portuguese"],
    "kitten2": ["English", "Arabic", "Chinese", "French", "German", "Hindi", "Italian", "Portuguese", "Russian", "Spanish", "Japanese", "Korean", "Turkish", "Dutch", "Swedish", "Danish", "Finnish", "Swahili", "Greek", "Hebrew"],
    "qwen3": ["Chinese", "English", "Japanese", "Korean", "German", "French", "Russian", "Portuguese", "Spanish", "Italian"],
    # Only the languages exposed here are promised by this adapter.
    "fish": ["Polish", "English", "German", "French", "Spanish", "Italian", "Portuguese", "Chinese", "Japanese", "Korean", "Russian", "Arabic"],
}

MODELS = [
    {"repo_id": "ResembleAI/chatterbox", "revision": "5bb1f6ee58e50c3b8d408bc82a6d3740c2db6e18", "label": "Chatterbox Multilingual V3", "engines": ["chatterbox-multilingual"], "required_files": ["ve.pt", "s3gen.pt", "t3_mtl23ls_v3.safetensors", "grapheme_mtl_merged_expanded_v1.json", "conds.pt", "Cangjie5_TC.json"], "license": "MIT"},
    {"repo_id": "hexgrad/Kokoro-82M", "revision": "f3ff3571791e39611d31c381e3a41a3af07b4987", "label": "Kokoro-82M", "engines": ["kokoro"], "required_files": ["config.json", "kokoro-v1_0.pth", "voices/af_heart.pt", "voices/ef_dora.pt", "voices/ff_siwis.pt", "voices/hf_alpha.pt", "voices/if_sara.pt", "voices/pf_dora.pt"], "allow_patterns": ["config.json", "kokoro-v1_0.pth", "voices/*.pt", "README.md", "LICENSE*"], "license": "Apache-2.0"},
    {"repo_id": "KittenML/kitten-tts-mini-0.8", "revision": "c02725660cea441db4c383af69f1f26f5cd00947", "label": "KittenTTS 0.8 Mini", "engines": ["kittentts"], "required_files": ["config.json", "kitten_tts_mini_v0_8.onnx", "voices.npz"], "license": "Apache-2.0"},
    {"repo_id": "KittenML/kitten-tts-2", "revision": "d9c7be8fbbeff3ebd3cb156c8f46a40ddc06b232", "label": "KittenTTS 2 · packed", "engines": ["kittentts2"], "required_files": ["config.json", "lm/config.json", "lm/model-ternary.safetensors", "lm/tokenizer.json", "speaker/model.safetensors", "voices/voices.json"], "allow_patterns": ["config.json", "lm/*.json", "lm/*.txt", "lm/model-ternary.safetensors", "speaker/*", "voices/*.npz", "voices/voices.json", "LICENSE.md", "README.md"], "dependencies": [{"repo_id": "ResembleAI/chatterbox-turbo", "revision": "749d1c1a46eb10492095d68fbcf55691ccf137cd", "required_files": ["s3gen_meanflow.safetensors"], "allow_patterns": ["s3gen_meanflow.safetensors"]}], "license": "Stellon Labs Community License"},
    {"repo_id": "Qwen/Qwen3-TTS-12Hz-0.6B-Base", "revision": "5d83992436eae1d760afd27aff78a71d676296fc", "label": "Qwen3-TTS Base 0.6B", "engines": ["qwen3-tts"], "required_files": ["config.json", "model.safetensors", "speech_tokenizer/model.safetensors", "tokenizer_config.json", "vocab.json", "merges.txt"], "license": "Apache-2.0"},
    {"repo_id": "Qwen/Qwen3-TTS-12Hz-1.7B-Base", "revision": "fd4b254389122332181a7c3db7f27e918eec64e3", "label": "Qwen3-TTS Base 1.7B", "engines": ["qwen3-tts-1.7b"], "required_files": ["config.json", "model.safetensors", "speech_tokenizer/model.safetensors", "tokenizer_config.json", "vocab.json", "merges.txt"], "license": "Apache-2.0"},
    {"repo_id": "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign", "revision": "5ecdb67327fd37bb2e042aab12ff7391903235d3", "label": "Qwen3-TTS VoiceDesign 1.7B", "engines": ["qwen3-voice-design"], "required_files": ["config.json", "model.safetensors", "speech_tokenizer/model.safetensors", "tokenizer_config.json", "vocab.json", "merges.txt"], "license": "Apache-2.0"},
    {"repo_id": "fishaudio/s2-pro", "revision": "1de9996b6be38b745688de084d87a5633f714e4e", "label": "Fish Audio S2 Pro", "engines": ["fish-s2-pro"], "required_files": ["config.json", "codec.pth", "model.safetensors.index.json", "model-00001-of-00002.safetensors", "model-00002-of-00002.safetensors", "tokenizer.json"], "license": "Fish Audio Research License", "note": "Usługa S2 Pro w Linux/WSL; GPU według upstream: minimum 24 GB VRAM. Wagi mają osobną licencję badawczą."},
]
# Selected files (and Kitten 2's codec), from the pinned Hub file metadata.
MODEL_SIZE_GIB = {
    "ResembleAI/chatterbox":2.989,"hexgrad/Kokoro-82M":.331,
    "KittenML/kitten-tts-mini-0.8":.076,"KittenML/kitten-tts-2":1.914,
    "Qwen/Qwen3-TTS-12Hz-0.6B-Base":2.343,
    "Qwen/Qwen3-TTS-12Hz-1.7B-Base":4.232,
    "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign":4.210,"fishaudio/s2-pro":10.252,
}
for spec in MODELS:
    spec.update(role="TTS", size_gb=MODEL_SIZE_GIB[spec['repo_id']])
    spec.setdefault("allow_patterns", spec.get("required_files", []) + ["*.json", "*.txt", "README.md", "LICENSE*"])

ENGINES = {
    "chatterbox-multilingual": {"family": "chatterbox", "model": 0, "sample_rate": 24000, "clone": True, "description": "Polska narracja i klonowanie głosu; Chatterbox Multilingual V3."},
    "kokoro": {"family": "kokoro", "model": 1, "sample_rate": 24000, "clone": False, "description": "Gotowy głos dobierany do języka; zapisany profil nie jest klonowany. Bez oficjalnej obsługi polskiego."},
    "kittentts": {"family": "kitten", "model": 2, "languages": ["English"], "sample_rate": 24000, "clone": False, "description": "KittenTTS 0.8 Mini: angielski głos Bella na CPU, bez klonowania zapisanego profilu."},
    "kittentts2": {"family": "kitten", "model": 3, "languages": LANGUAGES["kitten2"], "sample_rate": 24000, "clone": True, "license_required": True, "description": "KittenTTS 2: klonowanie z transkryptem referencji. Brak oficjalnej obsługi polskiego."},
    "qwen3-tts": {"family": "qwen3", "model": 4, "sample_rate": 24000, "clone": True, "description": "Qwen3-TTS Base 0.6B: klonowanie głosu w 10 językach, bez polskiego."},
    "qwen3-tts-1.7b": {"family": "qwen3", "model": 5, "sample_rate": 24000, "clone": True, "description": "Qwen3-TTS Base 1.7B: klonowanie głosu w 10 językach, bez polskiego."},
    "qwen3-voice-design": {"family": "qwen3", "model": 6, "sample_rate": 24000, "clone": False, "design": True, "description": "Qwen3 VoiceDesign: tworzenie głosu z opisu w 10 językach, bez polskiego."},
    "fish-s2-pro": {"family": "fish", "model": 7, "sample_rate": 44100, "clone": True, "license_required": True, "description": "Fish S2 Pro: klonowanie i polski przez osobną usługę Linux/WSL."},
}

def model_spec(engine_id):
    return MODELS[ENGINES[engine_id]["model"]]

def snapshot_path(spec, cache=None):
    cache = Path(cache or os.environ.get("OMNIVOICE_CACHE_DIR", ""))
    return cache / ("models--" + spec["repo_id"].replace("/", "--")) / "snapshots" / spec["revision"]

def require_snapshot(spec, cache=None):
    path = snapshot_path(spec, cache)
    missing = [name for name in spec["required_files"] if not (path / name).is_file() or (path / name).stat().st_size == 0]
    if missing:
        raise RuntimeError(f'Brak kompletnych lokalnych wag {spec["repo_id"]}. Pobierz je w „Modele i silnik”.')
    for dependency in spec.get("dependencies", []):
        require_snapshot(dependency, cache)
    return path

def all_specs():
    return {spec["repo_id"]: spec for model in MODELS for spec in [model, *model.get("dependencies", [])]}
