"""Verify the client field contract directly in bundled source, without imports/models."""
import ast
import hashlib
import json
from pathlib import Path
from zipfile import ZipFile

_QA_OUTPUT = Path(__file__).resolve().parents[1] / ".tmp/qa"
_QA_OUTPUT.mkdir(parents=True, exist_ok=True)

repo = Path(__file__).resolve().parents[1]
archive = repo / "scripts/runtime/vendor/engine.zip"
expected = {
    "instruct", "guidance_scale", "t_shift", "denoise", "postprocess_output",
    "layer_penalty_factor", "position_temperature", "class_temperature",
    "max_chunk_chars", "crossfade_ms", "pronounce", "wav_bits", "preset_voice", "design_recipe",
}
checks = 0
def check(condition, message="Static speech contract assertion failed"):
    global checks
    checks += 1
    assert condition, message

with ZipFile(archive) as engine:
    source = engine.read("backend/api/routers/generation.py").decode("utf-8")
    module = ast.parse(source)
    route = next(node for node in module.body if isinstance(node, ast.AsyncFunctionDef) and node.name == "generate_speech")
    args = route.args.args
    defaults = dict(zip((arg.arg for arg in args[-len(route.args.defaults):]), route.args.defaults))
    fields = {name: ast.unparse(value) for name, value in defaults.items() if isinstance(value, ast.Call) and isinstance(value.func, ast.Name) and value.func.id == "Form"}
    check(expected <= fields.keys(), f"Unsupported client fields: {expected - fields.keys()}")
    check(fields["wav_bits"] == "Form('16')")
    check(ast.unparse(next(arg for arg in args if arg.arg == "wav_bits").annotation) == "Literal['16', '24', '32']")
    check(fields["preset_voice"] == "Form(None)")
    check(fields["design_recipe"] == "Form(None)")
    check(fields["crossfade_ms"] == "Form(50, ge=0, le=1000)")
    check(fields["max_chunk_chars"] == "Form(800, ge=0)")
    check(fields["pronounce"] == "Form(True)")
    check(fields["stream"] == "Form(False)")
    check('media_type="application/x-ndjson"' in source)
    check('getattr(backend, "supports_native_omnivoice_controls", False)' in source)
    check('gen_kwargs["voice"] = preset_voice' in source)
    check('stored_design_recipe = _design_recipe_json(design_recipe)' in source)
    wav_tree = ast.parse(engine.read("backend/services/generation_audio.py").decode("utf-8"))
    subtypes = next(node.value for node in wav_tree.body if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == "WAV_SUBTYPES" for target in node.targets))
    check(ast.literal_eval(subtypes) == {16: "PCM_16", 24: "PCM_24", 32: "FLOAT"})

    adapter_source = engine.read("backend/services/tts_backend.py").decode("utf-8")
    adapters = ast.parse(adapter_source)
    kitten = next(node for node in adapters.body if isinstance(node, ast.ClassDef) and node.name == "KittenTTSBackend")
    kitten_generate = next(node for node in kitten.body if isinstance(node, ast.FunctionDef) and node.name == "generate")
    kitten_code = ast.get_source_segment(adapter_source, kitten_generate)
    check('kw.get("speed"' in kitten_code)
    check('kw.get("voice")' in kitten_code)
    check(all(f'kw.get("{field}"' not in kitten_code for field in ["instruct", "guidance_scale", "t_shift", "denoise", "postprocess_output"]))

report = {
    "source": "scripts/runtime/vendor/engine.zip", "sha256": hashlib.sha256(archive.read_bytes()).hexdigest(),
    "check": "static AST only; no model import, download or inference", "client_fields": sorted(expected),
    "route_fields": fields, "wav_bits_supported": True, "wav_subtypes": {"16": "PCM_16", "24": "PCM_24", "32": "FLOAT"},
    "preset_voice_supported": True, "design_recipe_metadata_supported": True, "kitten_ignores_native_sampling": True,
    "checks_passed": checks,
}
target = repo / ".tmp/qa/speech-settings-contract.json"
target.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
print(f"Bundled speech settings contract: {checks} checks passed; {target.relative_to(repo)}")
