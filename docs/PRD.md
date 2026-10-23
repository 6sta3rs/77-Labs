# Seventy Seven Labs - product requirements

Document version: 1.0, October 21, 2026. Covers the public application source
for version 0.2.0. This document describes the product and criteria for further
development. It does not establish that tests have been run, an installer is
available, or every model works.

## Purpose and users

Seventy Seven Labs is a local voice studio for Windows with a Polish interface.
It brings narration preparation, speech synthesis, multiple speakers,
transcription, and further audio production into one application. Users should
know where their data is stored, what runs locally, and when an operation
requires downloading models or connecting to a selected provider.

Primary needs:

- A narration author prepares text, selects a voice, generates a recording,
  and downloads it.
- A creator working with multiple speakers assigns voices to text blocks.
- Someone who needs a readable record of speech imports a file and exports
  text or timed subtitles.
- An advanced user prepares dubbing, an audiobook, or a local automation recipe
  and follows the task's actual progress.
- A contributor runs the interface without a private voice library or a GPU.

## Scope of the current code

"Available" means that the interface and implementation exist. It does not mean
full acceptance testing on a clean computer, across all models, or with material
of any length. The public release does not include the author's voices,
projects, recordings, license acknowledgments, tokens, or runtime environment.
Demonstration data is illustrative.

| Area | Current behavior | Limitation |
| --- | --- | --- |
| Narration editor | Speaker blocks, voice and engine selection, OmniVoice tags, undo and redo. | Tag support depends on the engine; a tag does not guarantee a particular expression. |
| Synthesis and playback | Request parameters, TTS tasks, actual output, waveforms, play/pause, seeking, and download. | Requires an installed runtime, a compatible model, and compliance with its terms. |
| Projects and history | Local text, speakers, settings, and recordings stored as Blobs in IndexedDB; a backend library. | Browser and desktop data may belong to separate profiles. Full migration from the old application is not promised. |
| Voices | Profiles, references, samples, editing, cloning, and model-dependent voice design. | Reference material requires the necessary rights and the speaker's consent. Voice similarity is not guaranteed. |
| Transcription | File import, mode and language selection, editing, history, TXT/SRT/VTT, and optional LLM editing. | ASR can make mistakes. Full text and subtitle segments have separate editing rules. |
| Dubbing | Source preparation, transcription, translation, segments, voices, and export. | The complete video workflow, background handling, all timing modes, and export variants need further acceptance testing. |
| Audiobooks and scenes | Text import and splitting, chapters, voices, a library, rendering, cancellation/resumption, and chunk playback. | Long tasks, all import formats, and all models need separate testing. |
| Audio tools | Local processing, voice conversion, diagnostics, and text tools. | Effects that require a model or LLM have separate dependencies; a panel's presence does not establish readiness. |
| Automation and dictation | Recipes, a queue, a watched folder, dictation, and a Windows widget. | System integrations require explicit opt-in. A physical microphone and pasting into other applications need separate acceptance testing. |
| Appearance and accessibility | Light/dark themes, palettes, keyboard controls, focus, text scaling, and reduced motion. | Voice animation is a visualization, not an assessment of quality or emotion. |
| Models and environment | A catalog, pinned sources, a CPU/CUDA installer, doctor checks, cache, transfer progress, and terms review. | The EXE does not include libraries and weights that can occupy many gigabytes. The full CUDA configuration and a clean VM need acceptance testing. |
| Integrations | Optional LLM services, a local API, MCP, and remote transport. | Connecting to a service may send text or media off the computer and consume the account's quota. |

## Main workflows

### First launch

1. The studio opens without loading ML libraries or downloading weights.
2. The user can explore the interface, postpone setup, or open
   **Ustawienia > Silnik** (Settings > Engine) for the environment and
   **Ustawienia > Modele** (Settings > Models) for weights and terms.
3. Installation creates a separate candidate CPU/CUDA environment. Doctor checks
   and activation are separate steps; an incomplete candidate does not replace
   a working environment.
4. Models are downloaded separately. Their terms are shown per repository
   and information revision, with acknowledgment initially unchecked.
5. Reading the catalog and terms does not accept them, download a model,
   or test synthesis.

### Text to speech

1. The user enters text and selects a voice for each speaker.
2. Settings show the parameters supported by the selected engine.
3. Generation starts the required local engine and an actual task.
4. Errors explain the cause and how to correct it or retry. Licensing,
   missing models, and missing environments have readable messages.
5. The user can play and seek within the result, download it, and save it with
   the project. Interruption should not remove recordings that are already complete.

### Speech to text

1. The user selects their own file, an engine, and a recognition mode.
2. They see progress, text, and timed segments.
3. They correct the result manually. An LLM suggestion is optional and reversible.
4. They export TXT or subtitles. Export preserves Polish characters and correct
   segment times; changing the full text does not invent new timings.

## Architecture and storage

- **Svelte 5, TypeScript, and Vite** provide the interface and browser preview.
- **Tauri 2 and Rust** handle the Windows window, native commands, process
  isolation, files, installation, and runtime supervision.
- **Python/FastAPI** runs the Seventy Seven Labs engine with pinned sources
  and local extensions. `scripts/runtime/vendor/engine-provenance.json` records its
  source and SHA-256; [third-party notices](../THIRD_PARTY_NOTICES.md) identify
  the imported components and their authors.
- The supervised backend uses `127.0.0.1:4312`; the Vite preview uses port 4310
  and the `/backend` proxy. The browser preview does not replace the Tauri
  supervisor.
- Runtime and data files default to `%LOCALAPPDATA%\VoiceStudioNext`,
  while some interface state is stored in localStorage/IndexedDB. Technical
  names such as `VoiceStudioNext` and legacy identifiers remain for compatibility.
- Additional model families may use separate environments. Models, dependencies,
  logs, and private databases do not belong in the repository.

See the [runtime](architecture/runtime.md), [environment installation](features/instalacja-runtime.md),
and [project context](architecture/kontekst-projektu.md) documents for details.

## Privacy and licenses

Project code is licensed under **AGPL-3.0-only**. Weights, tokenizers,
dependencies, and third-party materials retain their own terms; the application
license does not automatically grant commercial rights to a model, recording,
or voice. Full text: [LICENSE](../LICENSE). Sources and exceptions:
[THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).

Local synthesis and export should work with models downloaded in advance.
Downloading weights, LLM services, translators, and a remote backend may
require network access. Users must be able to see the selected service
and deliberately start such operations. Tokens and login credentials are
not included in the project package.

Cloning requires the user's own voice or material with appropriate consent.
A local acknowledgment does not replace rights to a recording or the speaker's
consent. Reporting and data protection: [SECURITY.md](../SECURITY.md).

## Quality requirements and acceptance criteria

The following are acceptance conditions, not a list of passing tests.
Each report records the public source commit, engine version, environment,
test data type, result, and skipped steps.

| Criterion | Measurable condition |
| --- | --- |
| Clean sources | No private recordings, profiles, databases, tokens, or author-specific paths in tracked files or public Git history. |
| Repeatable frontend setup | `npm ci`, `npm run check`, and `npm run build` succeed from the public checkout. |
| Safe startup | Opening the window does not start inference or downloads; a missing runtime still allows configuration and shows a clear state. |
| Process ownership | An occupied port does not lead to adopting another server; Stop and exit close only owned processes. |
| TTS | An owned short reference and text produce a decodable WAV with nonzero duration; play/pause/seek and download work; the download hash matches the saved recording. |
| Project persistence | Text, speakers, voice selection, and the saved audio Blob survive closing and reopening. |
| Transcription | A disclosed test sample produces editable text; TXT/SRT/VTT preserve UTF-8 and increasing timestamps. Recognition errors are recorded. |
| Model terms | Opening the interface does not record decisions. A changed terms fingerprint requires review again, without automatic acceptance. |
| Accessibility | Key workflows work with a keyboard; focus is visible, dialogs restore focus, and reduced motion stops continuous animation. |
| Windows acceptance | Building and actually running the EXE are reported separately. Clean installation and GPU configurations require their own trials. |
| Long tasks | Dubbing and audiobooks have separate tests for rendering, cancellation, resumption, and the final file on the specified model. |

## Development plan

1. **Public starting point:** complete documentation, clean demo data, explicit
   notices, data checks, and repeatable source builds.
2. **Windows installation:** acceptance testing from scratch on a clean CPU
   machine and separately on a compatible CUDA configuration; errors,
   insufficient disk space, cancellation, and retry.
3. **Model matrix:** separate TTS/ASR evidence for specific revisions, languages,
   hardware, and terms; no blanket claim that every adapter is supported.
4. **Longer productions:** complete video dubbing, long books, retakes,
   synchronization, crash recovery, and export completeness.
5. **Distribution:** decisions on signing, an installer, updates, and complete
   binary dependency notices before publishing ready-to-use packages.

Current commitments do not include hosting a multi-user service, guaranteed
macOS/Linux support, full parity with every upstream feature, automatic
migration of all old data, or securing rights to other people's voices
and every model.
