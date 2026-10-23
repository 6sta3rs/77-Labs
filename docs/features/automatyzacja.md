# Recipes and the local queue

**Automatyzacja** ("Automation") saves recipes containing 1-8 sequential steps:
speech recognition, synthesis, voice conversion, local translation, or audio
processing. Input is text or up to 10 audio files, each no larger than 64 MB.
The queue runs one job at a time. Recipes are sequences of steps, without
conditional graphs or custom code.

## Execution

Input and output types are checked before a job starts. Model steps require
installed weights, suitable voices, and a ready runtime. Recipes do not install
models. Translation uses the selected local Argos or NLLB engine.
An audio processing step can run without the backend: it trims, normalizes, or
adjusts volume and saves a separate PCM WAV file. The default normalization peak
is -3 dBFS.

The panel shows the current step and confirmed completions. **Zatrzymaj po kroku**
("Stop after this step") waits for the current request to finish, then skips the
remaining steps. Breaking the transport connection does not confirm that GPU work
has stopped; an operation with an uncertain outcome should not automatically
advance the queue.

## Persistence and retrying

Recipes, the input snapshot, results, and state are stored in IndexedDB
`voicestudio-next-automation`. Input must be persisted before execution starts.
Audio is stored as a Blob; a `blob:` URL is used only for playback in the current
session. Changing views does not stop the queue. After a restart, unfinished jobs
are marked **Przerwane** ("Interrupted"); the user decides whether to run them again
from the beginning. Deleting an individual item requires confirmation and does not
delete the voice profile.

## Watched folder on Windows

Choose a folder you own and a saved recipe, then explicitly enable watching.
The source remains disabled after every application start or WebView reload.
Only files directly inside the folder are watched; subfolders are excluded.

The scanner waits for a stable file size and modification time, and for the file
handle to be released. Links, UNC paths, devices, empty files, and files over the
size limit are rejected. File stability does not guarantee a valid compressed
stream. The producing application should write a temporary file, close it, and
only then give it the target audio extension.

Persistent acknowledgments reduce duplicate processing after a restart. A changed
file is treated as a new input version. Source files are not deleted or moved.
Disabling watching blocks new inputs; jobs already saved keep their own state.

## Files and checks

- `src/lib/tools/automation/AutomationWorkspace.svelte`, `src/lib/tools/automation/automation.ts`: panel and queue.
- `src/lib/tools/automation/WatchFolderPanel.svelte`, `src/lib/tools/automation/watch-folder.ts`: file source.
- `src-tauri/src/watch_folder.rs`: scanner, path ownership, and acknowledgments.

Regression checks: `node tests/frontend/automation-check.mjs`,
`node tests/frontend/watch-folder-check.mjs`, and `node tests/frontend/automation-audio-check.mjs`.
The real folder picker, Windows file handles, and ML recipes need separate
acceptance checks.
See [verification](../verification/weryfikacja.md) and the [data policy](../../SECURITY.md).
