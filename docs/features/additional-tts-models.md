# Additional TTS models

Adapters extend the catalog without changing the original backend archive.
Each family can have its own Python environment outside the base venv.
Weights, libraries, terms and active engine selection are separate steps.

| Family | Voice input | Execution |
| --- | --- | --- |
| Chatterbox Multilingual | Reference recording | Dedicated Python environment, CPU/CUDA. |
| Kokoro | Built-in voice appropriate for the language | CPU. |
| KittenTTS 0.8 | Built-in voice | Adapter or separate environment. |
| KittenTTS 2 | Recording and its transcript | Dedicated Python environment, CPU/CUDA. |
| Qwen3-TTS Base 0.6B / 1.7B | Recording and its transcript | CPU/CUDA. |
| Qwen3-TTS VoiceDesign | Voice description | CPU/CUDA. |
| Fish S2 Pro | Recording and its transcript | Separate Linux/WSL service and local HTTP adapter. |

Supported languages and exact revisions come from `scripts/runtime/app/tts_catalog.py`
and the active catalog. Selecting an unsupported language must produce a readable
error; support for Polish must not be inferred from a family name alone.

## Preparation

In **Ustawienia → Silnik → Środowiska → Dodatkowe modele TTS** (Settings → Engine →
Environments → Additional TTS models), choose **Procesor** (CPU) or **CUDA** and **Przygotuj biblioteki**
(Prepare libraries). The installer creates a dedicated directory for the family,
installs packages and checks imports. Then download all required weights from
the model catalog and review the separate terms for the model and its dependencies.
A failed import must not be presented as readiness.

Family environments live in `runtime/tts-envs`, with an `environment.json`
manifest and a record of the dependencies actually resolved. The selected
CPU/CUDA mode comes from the manifest, not from whichever device happens to be
available. Libraries from other installations and shared immutable files are not
updated in place.

## Fish S2 Pro

The operator prepares a compatible Fish server on Linux/WSL and a specific
checkpoint. In the panel, enter its loopback address and declare the matching
model and revision. A successful `/health` response verifies transport, not model
identity. The adapter sends the reference to this local service; do not expose
the service on a public interface. Credentials in URLs and redirects are rejected.

## Where to change behavior

- `scripts/runtime/app/tts_catalog.py` — revisions, files, languages and variants.
- `scripts/runtime/app/tts_extensions.py` — registry, statuses and the `/next/tts/*` API.
- `scripts/runtime/app/tts_worker.py` — synthesis parameters and execution.
- `scripts/runtime/install/prepare_tts.py` — library preparation.
- `src/lib/settings/pages/EnginePage.svelte` — the panel (**Środowiska** tab, including the Fish connection).

Regression checks: `tests/runtime/test_tts_extensions.py`
and `tests/runtime/test_tts_registry.py`. They do not collectively verify
the sound of every model. Plan generation tests separately with clean data,
recording the model and hardware in the report. See [model terms](model-licenses.md)
and the [weights catalog](model-production.md).
