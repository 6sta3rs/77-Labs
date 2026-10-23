# Models and the weights catalog

**Ustawienia → Modele** (Settings → Models; tabs **Synteza mowy**, **Rozpoznawanie
mowy**, **Modele językowe**, **Pozostałe** and **Pobieranie i dostęp**) manages
downloaded weights and active engine selection. Library environments are installed
separately in **Ustawienia → Silnik → Środowiska** (Settings → Engine → Environments). Downloading
a model does not install the dependencies for every family or confirm permission
to use it.

## Choosing a directory

**Modele → Pobieranie i dostęp** shows the effective path for the current process.
The path itself is changed in **Ustawienia → Przechowywanie → Foldery → Wagi modeli**
(Settings → Storage → Folders → Model weights) with **Wybierz folder…** (Choose
folder); this changes `OMNIVOICE_CACHE_DIR` in the
private `data/environment` file. It does not move existing models. Restart the
engine to use the new path. The weights directory must be separate from data and
runtime directories; invalid paths and links are rejected.

## Downloading and cancellation

**Pobierz** (Download) starts a dedicated supervised process using
pinned repository revisions. Only the token saved for this application is used.
Progress reports actual bytes when the size is known. Task state is persistent;
a retry can complete an unfinished download.

Cancellation waits for the owned process and its descendants to exit. Other
processes remain outside the supervisor's control. A disconnected client alone
does not prove that work has stopped. The main synthesis process uses local files
without downloading anything during inference.

## Removal and terms

**Usuń model** (Remove model) requires its identifier and a state in which it is
not actively in use. Removal is limited to the application's own cache; it does
not remove another installation's libraries or models. Review the
[model terms](model-licenses.md), including tokenizer dependencies. `installed`
describes file completeness, not a successful synthesis test.

## Files

- `frontend/src/settings/pages/ModelsPage.svelte`, `frontend/src/models/model-management.ts` — catalog and UI.
- `frontend/src/settings/pages/StoragePage.svelte`, `frontend/src/settings/storage-settings.ts` — model directory.
- `scripts/runtime/app/model_management.py` — tasks, cache, downloads and removal.
- `scripts/runtime/app/launcher.py` — effective process configuration.

Regression checks: `tests/runtime/test_model_management.py`.
Full acceptance testing also requires an actual transfer, a restart, a test of
the selected model and data checks. See [runtime installation](runtime-installation.md)
and [additional TTS models](additional-tts-models.md).
