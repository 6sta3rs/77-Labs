# Models and the weights catalog

**Ustawienia → Modele i silnik** (Settings → Models and engine) separates the
library environment, downloaded weights and active engine selection. Downloading
a model does not install the dependencies for every family or confirm permission
to use it.

## Choosing a directory

The panel shows both the configured path and the effective path for the current
process. **Zapisz katalog** (Save directory) changes `OMNIVOICE_CACHE_DIR` in the
private `data/environment` file. It does not move existing models. Restart the
engine to use the new path. The weights directory must be separate from data and
runtime directories; invalid paths and links are rejected.

## Downloading and cancellation

**Pobierz wagi** (Download weights) starts a dedicated supervised process using
pinned repository revisions. Only the token saved for this application is used.
Progress reports actual bytes when the size is known. Task state is persistent;
a retry can complete an unfinished download.

Cancellation waits for the owned process and its descendants to exit. Other
processes remain outside the supervisor's control. A disconnected client alone
does not prove that work has stopped. The main synthesis process uses local files
without downloading anything during inference.

## Removal and terms

Removing an individual model requires its identifier and a state in which it is
not actively in use. Removal is limited to the application's own cache; it does
not remove another installation's libraries or models. Review the
[model terms](licencje-modeli.md), including tokenizer dependencies. `installed`
describes file completeness, not a successful synthesis test.

## Files

- `src/lib/EngineCatalog.svelte`, `src/lib/model-management.ts` — catalog and UI.
- `scripts/runtime/model_management.py` — tasks, cache, downloads and removal.
- `scripts/runtime/launcher.py` — effective process configuration.

Regression checks: `scripts/runtime/test_model_management.py`.
Full acceptance testing also requires an actual transfer, a restart, a test of
the selected model and data checks. See [runtime installation](instalacja-runtime.md)
and [additional TTS models](dodatkowe-modele-tts.md).
