# Additional engine environments

The **Środowiska dodatkowych silników** (Additional engine environments) panel in
**Ustawienia → Silnik → Środowiska** (Settings → Engine → Environments) prepares separate Python environments or the audio.cpp executable. This is
separate from downloading model weights. Reading the catalog does not install
packages or test models.

## Workflow

1. Select a recipe and review its sources, versions, terms and estimated disk space.
2. Start installation explicitly. The catalog may report an unsupported platform
   or a CUDA requirement instead of presenting an option that only appears usable.
3. Follow the stages and log. Cancellation waits for the installer's process tree
   to exit.
4. After successful verification, activate the environment with the separate
   action and restart the engine.
5. Download the weights, review their terms and select the model separately.

Recipes come from the pinned backend, including those for IndexTTS, MOSS,
Confucius, Supertonic, PocketTTS, VoxCPM, CosyVoice and audio.cpp. The current list
and requirements appear in the panel; having a recipe does not mean every
installation has passed acceptance testing.

## Isolation

Installation attempts use `runtime_root/sidecars/<engine_id>/<attempt_id>`. They
have their own uv executable and cache, without installing into the main venv or
global Python. Do not move a prepared venv: it may contain absolute paths.
A new recipe creates its own directory, and partial data is retained for inspection.

Activation changes only the permitted key in the private environment configuration
and requires a restart. It does not change the active model or accept terms on
the user's behalf. Some transitive dependencies are resolved during installation;
a recipe is not a complete lockfile with hashes for every external environment.

## Files and checks

- `scripts/runtime/install/engine_installation.py` — catalog extraction from the AST,
  worker and status reporting.
- `scripts/runtime/install/private_environment.py` — atomic configuration writes.
- `src/lib/settings/pages/EnginePage.svelte` — the panel (**Środowiska** tab).
- `src/lib/models/engine-installation.ts` — transport and approval of the selected recipe.

Checks that do not require expensive inference:
`python -S tests/runtime/test_engine_installation.py`

and `node tests/frontend/engine-installation-check.mjs`.
Fixture tests do not verify installation of every engine on every Windows setup.
See [base runtime installation](runtime-installation.md),
[additional TTS models](additional-tts-models.md) and [model terms](model-licenses.md).
