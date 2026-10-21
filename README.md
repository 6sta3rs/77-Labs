# Seventy Seven Labs

A local voice studio for Windows. Write narration, assign voices to speakers, work with transcripts, and keep projects on your computer.

**Svelte 5 · TypeScript · Tauri 2 · Python/FastAPI · AGPL-3.0-only**

Development version **0.2.0**, with a **Polish-language application interface** and English documentation. This repository includes the application source and pinned VoiceStudio 0.5.7 engine sources. Model weights, the Python environment, private recordings, and account data are not included.

![Narration editor with a fictional dialogue](docs/screenshots/studio.png)

## Features

- A multi-speaker editor with OmniVoice tags and undo.
- Voice and TTS engine selection, playback, seeking, and export.
- A local library of projects and recordings.
- Audio transcription and transcript editing.
- Workflows for dubbing, audiobooks, and automation recipes.
- CPU/CUDA environment setup, model weights and terms, and appearance settings.

Synthesis and recognition require a configured engine and the appropriate weights. Full dubbing, long audiobooks, every model combination, and installation on a clean Windows machine still need further acceptance testing. The [PRD](docs/PRD.md) defines scope and criteria; the [verification record](docs/weryfikacja.md) documents checks performed on the public release.

## Preview without models

Requirements: Node.js **22.12 or newer**, npm, and Git. Python and a GPU are not required.

```powershell
npm ci
npm run dev
```

Open **http://127.0.0.1:4310/?demo=tts**. This preview uses fictional voices, dialogues, and history. Every audio example plays the same procedural tone without human speech. It demonstrates the interface, not the output of the listed models. Demo data stays in memory.

Component gallery: **http://127.0.0.1:4310/inputy.html**. [Demo details](docs/tts-demo.md).

![Library of fictional voices](docs/screenshots/voices.png)

## Desktop application

Windows also requires stable Rust, the C++ tools from Visual Studio Build Tools, and WebView2. See the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

```powershell
npm run desktop:dev
npm run desktop:build
```

The build produces an EXE without an installer: `src-tauri/target/release/seventy-seven-labs.exe`.

The window opens without loading models. Under **Ustawienia → Modele i silnik** (Settings → Models and engine), set up a CPU or NVIDIA CUDA environment and download a model separately. Read and accept its terms before use. The EXE includes backend code, but not the multi-gigabyte libraries and weights. See [environment installation](docs/instalacja-runtime.md) and [engine operation](docs/runtime.md).

The browser displays the UI but does not start the Tauri supervisor. Synthesis in web development mode requires a separately running backend at `127.0.0.1:4312`.

## Data and privacy

Web projects are stored in the browser profile's localStorage/IndexedDB. Desktop engine data defaults to `%LOCALAPPDATA%/VoiceStudioNext`, outside the repository. Older directory names, storage keys, and Tauri identifiers are retained for compatibility with existing data.

The public history starts fresh with a neutral author identity. It excludes private development history, checkpoints, databases, voice samples, and recorded model-term decisions. See the [publication guide](docs/publikacja.md).

Network integrations are optional. Downloading models and using a selected language service may require internet access. Only clone a voice you have permission to use. See [security](SECURITY.md).

![Appearance settings in the Polish application interface](docs/screenshots/appearance.png)

## Development

```powershell
npm run check
npm run build
npm run test:ui
python scripts/publication_check.py
cargo check --manifest-path src-tauri/Cargo.toml
```

The publication check examines files, the nested engine archive, approved audio, and all Git objects, including unreachable objects. Local QA reports go into the ignored `.tmp/qa` directory. Speech tests require your own explicitly selected reference; the demo tone is for player and UI testing.

See [CONTRIBUTING.md](CONTRIBUTING.md) and the [technical context](docs/kontekst-projektu.md).

### Where do I change something?

| Area | File |
| --- | --- |
| Navigation and application composition | `src/App.svelte` |
| Editor and tags | `src/lib/SpeechEditor.svelte`, `src/lib/tags.ts` |
| Voice/model selection | `src/lib/VoicePicker.svelte`, `src/lib/ModelPicker.svelte` |
| Persistent recordings | `src/lib/library.ts` |
| Player and visualization | `src/lib/Player.svelte`, `src/lib/VoiceOrb.svelte` |
| Controls and themes | `src/lib/ui/`, `src/lib/appearance.ts`, `src/styles.css` |
| Demo data | `src/lib/tts-demo.ts`, `public/demo/` |
| API and supervision | `src/lib/api.ts`, `src-tauri/src/runtime.rs` |
| Python startup and installation | `scripts/runtime/launcher.py`, `scripts/runtime/bootstrap.py` |
| Product requirements | `docs/PRD.md` |

## License and provenance

Seventy Seven Labs code is licensed under **AGPL-3.0-only** — see [LICENSE](LICENSE). The bundled VoiceStudio engine uses AGPL-3.0-only; its `omnivoice/` package has separate Apache-2.0 terms. T3 Code themes and flags retain their own licenses and attributions. [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) explains these boundaries.

Model weights have separate terms; the application license does not grant rights to every model. Backend source and SHA-256 information are in `scripts/runtime/engine-provenance.json`. This project is not an official release of T3 Code or any model provider.
