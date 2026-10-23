# Public project progress

## 23 October 2026 — version 0.2.1 build

Bumped the version to 0.2.1 (package, lockfiles, `tauri.conf.json`, `Cargo.toml`, README) so installed copies see the UI batch above as an update. `npm run desktop:release` produced a signed `Seventy-Seven-Labs_0.2.1_x64-setup.exe` (24 MB), its `.sig` and `latest.json` in `.tmp/release/v0.2.1/`; `latest.json` reports 0.2.1.

Not done: the release is not published to GitHub (needs the user's go-ahead), the installer was not run, and an update from 0.2.0 to 0.2.1 was not tested.

## 23 October 2026 — UI feedback batch (UI-013 to UI-021, UI-037)

User request: implement the open UI feedback items and test them. Six parallel agents, one area each; integrated and checked in one pass.

Change: `ConfirmDialog` (promise helper `confirmDialog()`, mounted in `App.svelte`) replaces all 11 native `confirm()` calls; `VideoCard` replaces three native `<video controls>`; `Checkbox` and `Drawer` components (gallery sections 21–22), raw number inputs moved to `Input`; the file inputs now go through `FilePicker` (also fixed its Polish plural, `polishPlural` in `src/lib/i18n/plural.ts`); one toast queue for the whole app (the old single 6 s toast in `App.svelte` is gone) and `userMessage(error, fallback)` at the main catch sites; `ActionBar` explains why "Generuj" is disabled; Modele shows download speed and ETA (`download-eta.ts`) with a global header indicator that polls only while a job is active; audiobook read-along uses measured portion durations with word-length weights (`read-along.ts`); `tests/frontend/ui-rules.mjs` guards rule 2 and runs in `test:ui`. `docs/uwagi-ui.md` statuses updated.

Checks: `npm run check` 0/0, `npm run build` PASS, `npm run test:ui` PASS (new checks: confirm-dialog, video-card, toast, user-message, download-eta, read-along, plural, ui-rules), `test:structure` PASS, `tag-check` PASS. `async-ui-check` needed its `ModelsPage` harness stubbed for the new download monitor (32/32). No Rust was changed, so `cargo check` was not run.

Not verified: none of the new components was exercised in a running window (dialog, video card, checkbox, drawer, indicator, hint); the header indicator may be hidden behind the settings overlay. Limitations: `userMessage` is not yet used at every catch site (ModelLicense*, AudioLab, VoiceManager, UpdatesPage, AiPage, EnginePage and others still show `.message`); `Drawer` is not yet used for the inspector; UI-019 is an estimate — exact word times need an engine change (faster-whisper `word_timestamps`). Still waiting for the user's decision: UI-010, 011, 027, 030, 034.

## 22 October 2026 — engine starts at launch, model warm-up, visible startup progress

User request: start the VoiceStudio TTS model immediately and show what is happening (and what already works) while the engine starts — previously nothing outside Ustawienia → Silnik showed startup, and only for the data backup.

Change: the app now starts the engine when it opens (`bootRuntime` in `App.svelte`; not in the browser demo) and `runtime.rs` sets `VOICESTUDIO_NEXT_PRELOAD_TTS=1`, enabling the existing preload gate so the TTS model loads in the background. New card `EngineStartup.svelte` (bottom-right) shows a checklist with elapsed time: engine files, backup, modules, local server (stages written by `launcher.py` as `NEXT_STARTUP_EVENT` lines and read by the existing log tail), the engine's own steps (`/startup/progress`, polled by Rust while starting, via a new shared `backend_get`), then the voice model from `/model/status` (sub-stage and percent when the engine reports one). `RuntimeStatus.startup.stage` is new; stages only move forward. English strings added; docs updated (README, context, runtime).

Checks: `npm run check` 0/0, `npm run build` PASS, `npm run test:ui` PASS (new `engine-startup-check.mjs`, it also pins the UI order to `STAGES` in `runtime.rs`), `test:structure` PASS, `runtime-startup/-client/-idle` and `engine-idle` checks PASS, `cargo check` OK. `cargo test runtime::`: 13 pass, 4 fail — the same 4 fail without my change because those tests need port 4312, which a running engine occupied. Real engine, isolated copy on port 4399 with empty data and no weights (the running engine on 4312 was not touched): stage events `engine_files → backup → modules → server` appeared in order, `/startup/progress` answered with the ownership marker (`env_prefs → native_preload → ml_imports → api_routes`), `/health` came after about 92 s on that cold first run, and the log shows the preload task now runs (`Preload skipped: … licence is not accepted yet`).

Not verified: the card in the real EXE (no screenshot), and the model warm-up with real weights — loading a second copy onto the GPU next to the user's running engine was avoided on purpose. Limitations: remaining time is not estimated (elapsed only); the resident model uses RAM/VRAM until the engine's 900 s model idle timeout or a stop; there is no setting yet to turn the launch start or the preload off.

## 22 October 2026 — app updates from GitHub Releases

User request: the bottom-left sidebar button should detect and download new versions, based on the owner's GitHub repository. Added the Tauri updater (`tauri-plugin-updater`, `tauri-plugin-process`): the button (**Sprawdź aktualizacje**) opens Ustawienia → Aktualizacje and checks the `latest.json` feed of the project's GitHub repository (endpoint injected at release build time from `git remote`, so it is not stored in the repository); a newer signed release shows its version and notes with **Pobierz i zainstaluj** (download, signature check, passive NSIS install, restart). Bundling is now NSIS with updater artifacts; `npm run desktop:release` (`scripts/release/build-update.mjs`) builds the signed installer and `latest.json` into `.tmp/release/v<version>/`. The signing key lives outside the repository (`%USERPROFILE%\.tauri\`); the public key is in `tauri.conf.json`. The studio refresh the button used to run is **Odśwież stan** on Ustawienia → Silnik, now enabled while the engine is stopped (it also connects the browser preview); `catalog-ui-check.js` was retargeted to that path. Docs: `docs/features/aktualizacje-aplikacji.md`, README.

Checks: `npm run check` 0/0, `cargo check` OK, `npm run test:ui` PASS, `i18n-check` 14/14, `test:structure` PASS; `npm run desktop:release` produced a signed `Seventy-Seven-Labs_0.2.0_x64-setup.exe` (24 MB), its `.sig` and `latest.json`. Not verified yet: an update from one published version to a higher one (needs a second release), the browser QA `catalog-ui-check.js` run.

Limitations: only NSIS-installed copies can update; the `--no-bundle` EXE from `target/release` must be replaced by an installed copy once. The key has no password; losing it blocks future updates for installed copies.

## 22 October 2026 — settings: one search field

From the prototype review: the settings sidebar had two searches (the "Szukaj… Ctrl K" button that opens the global palette and a separate "Filtruj ustawienia…" field). Now there is one field in the "Szukaj…" button style with the magnifier, which filters the 12 settings pages by name (empty result: „Brak pasujących ustawień.”); the Ctrl K hint and the second field are gone. The rest of the app keeps the real `SidebarHeader` (button opening the palette).

Checks: `npm run check` 0/0; in the dev UI typing „sie” leaves only „Sieć i dostęp” under its group, compared with the prototype screenshot (`.tmp/qa/settings-port/final/`). Limitation: the filter matches page names, not the settings inside pages (same as the prototype); Ctrl+K inside Settings still opens the global palette.

## 22 October 2026 — docs follow the new settings structure

README, PRD, `kontekst-projektu.md` (new short settings-structure note), `struktura-projektu.md`, `runtime.md` and nine feature docs now use the new paths (for example Ustawienia → Silnik → Środowiska, Sieć i dostęp → Zdalny silnik, Prywatność i użycie → Znak wodny). Corrected an older error: the engine idle time is set in Silnik → Stan, not Ogólne.

Checks: `npm run test:structure` PASS (133 doc links), `git diff --check` clean.

## 22 October 2026 — settings: old components removed, tests retargeted, two regressions fixed

Removed the 16 settings components replaced by the new pages (SystemSettings, GeneralSettings, StorageSettings, UpdateSettings, DictionarySettings, AISettings, EngineCatalog, ExtraTtsEnvironments, EngineRuntimeInstaller, RuntimeDiagnostics, RuntimeInstaller, RemoteBackendSettings, IntegrationSettings, ApiReference, PreviewCacheSettings, DictationDesktopSettings) and the dead model-state JSON in `App.svelte`. The seven tests that read them (`ai-settings`, `async-ui`, `dictation-desktop`, `engine-idle`, `engine-installation`, `engine-readiness`, `preview-cache`; all passed on `368a416` before the change) now target the owning pages with the same intent; documented contract changes: tagging saves on each change, the idle hint wording. New `tests/helpers/runes-component.mjs` runs a page script with live Svelte reactivity, which exposed two regressions now fixed: the Środowiska tab polled install progress only once (the effect never re-ran), and AI tagging saves could overlap and restore stale settings (now serialised, and blocked during the tagging test). The Engine page shows "start it with the button at the top" only in the desktop app, where that button exists.

Checks: `npm run check` 0/0, `npm run build` PASS, `npm run test:ui` PASS, the seven retargeted tests PASS, `tag-check.mjs` PASS, `npm run test:structure` PASS, `git diff --check` clean; release EXE rebuilt (`npm run desktop:build`) and starts. Not verified: the settings pages against a live engine.

## 22 October 2026 — settings: Silnik ported

The reference page of the redesign. Sticky blurred status header (state, hardware, device and preset, start, red "Zatrzymaj" with a 4 s confirm, restart), live CPU/RAM/GPU/VRAM tiles from `/sysinfo` (a monitor read, does not keep the engine awake), the "Generowanie" card computed from the last 12 `/history` records (median speed "N×", "W 1 minutę … nagrania", bar chart with tooltips), model in memory with unload, then tabs Stan (idle time, data folder), Obliczenia (device, CUDA card, global and per-family preset, memory, offload, torch.compile, timeouts, GPU report), Środowiska (Python environment installer, extra engine environments, extra TTS libraries, FFmpeg/FFprobe/yt-dlp) and Dzienniki i diagnostyka (recent errors, system check, local readiness, log viewer with filter/copy/download/clear, support report).

Checks: `svelte-check` 0/0; screenshots against the prototype at 1280/900 px (ready state through a fetch mock, stopped state in the real app) in `.tmp/qa/settings-port/engine/`. Not verified: any real engine action, the Tauri installer and EXE picker, the chart tooltip on hover.

Limitations: no uptime ("Działa od") because no monitor endpoint exposes it; idle time offers 5/15/30/60 min only (Rust accepts no "no limit"); chart tooltips show the mode, not engine/device (history has neither); errors show the engine's class and message, without a plain-language table; environment size/install date are not reported.

## 22 October 2026 — settings: AI i klucze ported

Tabs Modele językowe (providers with brand icons, API keys, connect/test/model list via `/api/settings/llm-providers`, ChatGPT/Codex account row, Claude Code CLI shown as not detected), Funkcje AI (50/50 "Domyślny model"; function rows as model status + "Zmień" + switch, editor with Domyślny | Własny, one model list across providers, manual id; separate Tagowanie card with an inline test preview; Redakcja dyktowania) and Tłumaczenie i rozpoznawanie (translators through `/next/settings/credential(s)`, OpenAI-compatible ASR). New `pages/ModelPicker.svelte`. The style doc now describes the status + "Zmień" pattern.

Checks: `svelte-check` 0/0, `i18n-check.mjs` 14/14, screenshots against the prototype at 1280/900 px with intercepted fixture responses (`.tmp/qa/settings-port/ai/`); the real app only in the not-ready state.

Limitations (need engine or Tauri work): Claude Code needs an agent bridge that src-tauri does not provide; ChatGPT login is still `codex login` in a terminal (no in-app login/logout); tagging works only through Codex; the engine stores one model per provider, so a custom function model changes that provider's model everywhere; `/models` has no dates, so no "Najnowsze/Starsze" grouping or "nowy" mark; LLM and ASR keys are not returned masked.

## 22 October 2026 — settings: Przechowywanie and Prywatność i użycie ported

Przechowywanie: data folder move plan, model folder (now the only place to change model paths), restart to apply, disk usage per category, database backups, history limit, preview samples and temporary files with confirm steps. Prywatność i użycie has tabs Prywatność (analytics consent, translation provider), Znak wodny (the former Privacy toggle and the Integrations "invisible watermark" toggle are one switch; all three switches saved in one `POST /watermark/settings`, then re-read and confirmed; detector) and Użycie (former "Wykorzystanie" stats from `/stats/usage`).

Checks: `svelte-check` 0/0; `preview-cache-check.mjs` and `recording-retention-check.mjs` pass; screenshots of the not-ready state in the real app and of the ready state on a mocked fixture page (`.tmp/qa/settings-port/`). Not verified against a live engine: folder picker, restart, deletes, backup, watermark detection, sample generation.

Limitations: the folder picker exists only in the desktop app (the browser preview shows a path field); "Przywróć domyślny" for the data folder only clears the plan (no endpoint moves data back); restart progress has no stages; some engine-provided labels stay untranslated.

## 22 October 2026 — settings: Modele ported

Modele has tabs Synteza mowy, Rozpoznawanie mowy, Modele językowe, Pozostałe and Pobieranie i dostęp. Rows join engines with their weights (download, resume, cancel, delete behind a type-the-ID confirm, active model, licence state with inline review/accept/revoke), the "Przejrzyj warunki modeli" card lists engines and registry models needing a decision, the language tab lists cloud providers and links to AI i klucze. One Hugging Face token endpoint (`/next/settings/hf-token`, app store only), the HF mirror (moved from Sieć) and the model folder as a read-only link to Przechowywanie. The hard-coded OmniVoice/Faster-Whisper rows and the raw model-state JSON were removed.

Checks: `svelte-check` 0/0; screenshots against the prototype at 1280/900 px through a mocked harness (`.tmp/qa/settings-port/models/`) and the not-ready state in the real app. Not verified: a live engine, a completed download, licence accept/revoke against the backend.

Limitations: no download speed or time left (the engine reports bytes only); cloud providers show key state, not a tested connection or model count; mirror presets dropped (Auto covers them).

## 22 October 2026 — settings: Sieć i dostęp and Integracje ported

Sieć i dostęp has tabs Udostępnianie (LAN share with confirm, PIN, addresses, base port, Tailscale Serve), Zdalny silnik (former "Dostęp zdalny" and "Zdalne procesy robocze", one copy; opened directly from the remote-engine pill) and Serwer proxy. Integracje: OpenAI-compatible API test, MCP settings/test/client config, voice bindings for MCP clients, API reference (search, method filter, safe GET send, export). The watermark moved to Prywatność and engine provenance to Aktualizacje.

Checks: `svelte-check` 0/0; `remote-routing-check.mjs` and `integrations-check.mjs` pass; screenshots against the prototype through a mocked-response harness (`.tmp/qa/settings-port/network|integrations/`) and the not-ready state in the real app. Not verified against a live engine, Tailscale, a remote engine or a real MCP client.

Limitations: the engine does not report whether Tailscale Serve is on, so "Włączony" reflects actions in the current visit; no hostname address (the engine returns IPs only); the API reference no longer shows parameter/schema detail.

## 22 October 2026 — settings: Aplikacja pages ported

Ported from the approved prototype: Ogólne (UI language, dubbing review, default translation mode), Wygląd (the real `Appearance` component inside the new page frame, reset with a 4 s confirm), Słownik wymowy (`/pronunciation` add/edit/delete/toggle, test, JSON export/import with confirm), Skróty i mikrofon (shortcut list, desktop dictation hotkey, microphone permission state, test and Windows settings link), Aktualizacje (app version, engine provenance from `/next/settings/update-source`, GitHub release check, changelog). Results are toasts; with the engine stopped each page shows one notice.

Checks: `svelte-check` 0/0; screenshots of all five pages next to the prototype at 1280 and 900 px in `.tmp/qa/settings-port/app/` (engine not running, so the not-ready state only). Not verified: ready state of Słownik and Aktualizacje against a live engine, the Tauri dictation hotkey, real microphone access.

Limitations: the dictionary test cannot highlight replaced words (`/pronunciation/test` returns only the whole text); the per-release notes list from the old check was dropped as in the prototype.

## 22 October 2026 — settings: new navigation and shared page pieces

User request: move the approved settings prototype (`.tmp/settings-redesign`, reviewed 2026-10-22) into the app without omissions. This commit adds the frame; pages are ported in the following commits.

Change: `settings-catalog.ts` now has 12 pages in 4 groups (Aplikacja, Silnik i modele, Połączenia, Dane) instead of 20 flat items; `SettingsShell` shows group headers; `App.svelte` routes each page to `src/lib/settings/pages/<Name>Page.svelte` (placeholders until ported), passes an optional intent (`openSettings('network','remote')` from the remote-engine pill), maps the old `ai-settings` target to `ai`, and drops the global "engine not running" notice (each page shows one notice itself). Shared pieces: `settings-page.css` (`p-` layout classes), `StatusBadge`, `toast.ts` + `Toaster` (bottom-centre result notifications), `ProviderIcon` with 8 MIT provider marks from lobe-icons (`THIRD_PARTY_NOTICES.md`, `src/lib/ui/provider-icons/`), per-group English files `en-settings-*.ts`, style rules in `docs/features/ustawienia-styl.md`. Texts across the app that pointed to „Modele i silnik” now point to „Silnik” (starting the engine) or „Modele” (downloads, terms); the device popover link opens Silnik.

Checks: `npm run check` 0/0, `git diff --check` clean. Not run at this step: build and UI tests (run after the pages land).

## 22 October 2026 — shared controls corrected as in the approved settings prototype

User request: move the approved settings prototype into the app, including the component corrections made during its review. This entry covers the shared components; the settings pages follow in separate commits.

Change (app-wide, `src/lib/ui`, `src/lib/styles`): list popups (`Select`) are solid `--surface-raised` without blur, and their scroll arrows are solid, so text under the popup no longer shows through; text fields are 32 px like `Select` and `Button` (was 30 px); fields, select triggers and outline buttons share one clearly visible border (`--foreground` 18 % over `--input-border`); `Button` text is 13 px like the fields (was 14 px); filled blue and red buttons lose the inset highlight and outer glow; a disabled filled button is flat (transparent, `--border`, muted text) instead of a dimmed fill; new `Button variant="light"` (white fill) for finishing or closing an inline editor.

Checks: `npm run check` 0/0, `npm run test:styles` PASS, `npm run test:buttons` PASS. `publication_check` reports only the known local `refs/t3/.../checkpoints` refs created by T3 Code; file contents pass.

Limitations: the 13 px button text and stronger borders apply to every screen, not only Settings; the mobile sizes (≤639 px) are unchanged. Not yet checked visually outside Settings.

## 22 October 2026 — Płyn preview shows the full effect

User request: the Płyn animation in the settings preview did not show the full potential of the style. Cause: the shared demo signal is a smooth, low-amplitude pulse (level ≤ 0.66), and the fluid only splashes while the overall level is rising, so the preview showed little of the flow.

Change: `orbShowcaseFrame` in `voice-orb.ts` — a 12 s loop (breathing, phrased speech at ~4.5 syllables/s, a pause, an emphatic burst with strong highs, decay) with a seamless wrap. The textured Płyn renderer uses it in preview mode; other styles keep `orbPreviewFrame`. Real playback is unchanged. Three tests added to `orb-preview-motion-check.mjs` (finite and bounded, contains quiet/pause/loud and loops, rises often enough to splash).

Checks: `npm run check` 0/0, orb tests PASS, `npm run test:structure` PASS. Runtime: a QA page mounting the Płyn preview orb rendered with `texture=ready`, `fluid=ready` and a clearly textured, grainy sphere in a screenshot; later screenshots of the loop timed out in the preview tool, so the loud phase was not captured visually — the tests cover the signal, not the look.

Limitations: the demo is still synthetic (no recorded audio); real playback shows the full effect with real speech.

## 22 October 2026 — Płyn orb restored to the ElevenLabs-derived material

User report: **Płyn** (formerly „ElevenLabs”) was supposed to be only a rename, but it rendered the plain procedural material identical to „Oryginalna”. Cause: when the public copy was prepared, the textured shader, fluid pass and images were left out and the saved `landing` style was aliased to the original shader (see the 21 October entry that lists them as not included).

Change: restored the `landing` branch from the earlier private state (kept in a local ignored checkout), preserving newer code — orb palettes, `normalizeOrbVariant`, translations. Added `landing-orb.frag`, `landing-fluid.ts`, `landing-orb.ts` and the three images in `src/lib/assets/landing-orb/` (SHA-256 identical to the pinned originals); the renderer, shared source and `VoiceOrb.svelte` load them lazily. A renderer without textures still degrades to the original material. The shader keeps using the chosen palette (`previewPalette` stays 1). Documented in [Płyn orb style](features/kula-plyn.md), `THIRD_PARTY_NOTICES.md` and `docs/public-assets.json`. The only test change: `orb-preview-motion-check.mjs` passes `preview` as the third constructor argument again.

Checks: `npm run check` 0/0, `npm run build` OK, `tag-check.mjs` OK, `npm run test:structure` PASS, orb tests `orb-preview-motion`, `shared-voice-orb`, `voice-orb-renderer`, `orb-reactivity`, `orb-smoothing`, `orb-motion` PASS. Runtime: in the dev gallery (`inputy.html#control-14`, Płyn selected) the canvas reports `texture=ready`, `fluid=ready`, frames advancing, grain image loaded, and the screenshot shows the flowing textured sphere.

Limitations: ElevenLabs published no redistribution terms for these materials; they are included at the maintainer's explicit decision and must be cleared before wider distribution (removal steps in the feature doc). The earlier source-comparison and GPU evidence (`landing-*.json`) from the private history was not imported; the full audio-reactivity comparison against the source was not re-run. Nothing pushed.

## 21 October 2026 — desktop EXE: generated audio was rejected

User report: the new EXE did not return generated audio. The engine produced and sent the WAV (`200`, `content-type: audio/wav`), but the app showed „Silnik nie zwrócił pliku audio.” Cause: `@tauri-apps/plugin-http` 2.8 constructs its `Response` without headers and attaches them afterwards, so `Blob.type` is empty and every desktop audio check failed (TTS, audio cleanup, tools). The browser preview uses native `fetch` and was not affected. `request()` in `src/lib/platform/api.ts` now rebuilds the desktop response with its real headers; `runtime-client-check.mjs` covers this (fails without the fix).

Checks: `npm run check` 0/0, `runtime-client-check.mjs` 7/7, `npm run test:ui` PASS, rebuilt release EXE; a real generation through the EXE UI (sandbox WebView2 profile with CDP, real engine and model from the external disk, ~136 s cold) produced the card „Nagranie 1 · 0:05 · Gotowe do odtwarzania” with no console errors.

## 21 October 2026 — English interface option ported and completed

The unfinished English UI translation (prepared on the earlier flat layout) is now part of the current code. Visible Polish strings are wrapped with `tr(...)`/`translateUi(...)` and the interface language is chosen in **Ustawienia → Ogólne** (Settings → General); Polish stays the default and its output is unchanged. `src/lib/i18n/` holds the module (`index.ts`) and dictionaries; strings added since the original work and those it had left untranslated are in `en-additions.ts` (3221 keys in total). Tools: `scripts/dev/i18n-svelte.mjs` (wraps static markup), `tests/frontend/i18n-check.mjs` (core behaviour, now part of `test:ui`). Also included from the same work: the orb music demo (`orb-demo.html`, `src/OrbMusicDemo.svelte`, `scripts/dev/generate_demo_music.py`; the generated WAV is not tracked).

Node test harnesses that load single modules now get the real i18n module from `tests/helpers/i18n.mjs`. Stale tests fixed on the way: `runtime-startup-check.mjs` (startup budget is 305 s; one-time idle sync excluded), `audio-diagnostics-check.mjs` (source path), `voice-profile-check.mjs` (missing collaborators).

Checks: `npm run check` 0/0, `npm run build` PASS, `npm run test:ui` PASS, `test:structure` PASS, every `tests/frontend/*.mjs` check PASS (except `engine-readiness-app-transform.mjs`, a CLI transform that needs arguments), `activity_check.py` OK, `test_publication_check.py` OK, `publication_check.py` with a private deny list PASS. Not verified: the English UI was not reviewed screen by screen in a browser or the EXE; some engine-provided messages and a few option labels in the pronunciation dictionary remain Polish.

## 21 October 2026 — single working copy: development changes since the public snapshot

This repository is now the project's only working copy; the former private development checkout was archived outside the project folder and is not part of this history. Its changes since the public snapshot were brought over in one reviewed step, applying the same publication rules as before (no recordings, databases, evidence reports with local paths, private names, or third-party reference assets).

Included: the new folder layout (`src/lib/<area>/`, `tests/{frontend,runtime,acceptance}`, `scripts/{build,dev,preview,runtime}`; see [project structure](architecture/struktura-projektu.md)); engine stability work (300 s startup budget, 15 s graceful stop, manual stop of an unresponsive engine, 30-minute window after an interrupted request, readable 503 when the model folder is missing, `/generate` input validation, bytecode cache, ffmpeg probe bypass, `[next-diag]` synthesis diagnostics, `engine_benchmark.py`); configurable idle time (5/15/30/60 min, default 15); dubbing translation now uses the engine selected in settings and offers to download a missing Argos language pack; speed below 1× keeps the pauses that carry the slowdown; `tools_acceptance.py` for built-in tools; recovery of damaged local projects and a single WAV decode when joining speakers; UI work (bottom-sheet panel, FilePicker, AudioPreview, Select, FilterChip, collapsible sections, control gallery, language flags in the form language list, orb palette colours, loading cards).

Not included: the textured orb material and shader adapted from a third-party website and the model publisher icons (no established redistribution terms) — the **Płyn** orb uses the original procedural material here; private QA evidence and audits. Public-only files moved into the new layout: `scripts/dev/publication_check.py`, `scripts/dev/generate_demo_tone.py`, `scripts/preview/capture_screenshots.py`, `tests/runtime/test_publication_check.py`, `tests/frontend/theme-compatibility-check.mjs`; CI updated.

Two stale tests were fixed: `runtime-client-check.mjs` (missing collaborators of `api.ts`; `/engines` is now a cold metadata read) and `async-ui-check.mjs` (dubbing translation reads the active engine and Argos pack state before translating, and sends `provider`).

Checks: `npm run check` 0 errors/0 warnings, `npm run build` PASS, `npm run test:ui` PASS, `test:structure` PASS (129 doc links), stories/production/speech-app/speech-settings/engine-idle/runtime-client/tag/wav-format checks PASS, `activity_check.py` 26/26, `test_publication_check.py` 24 OK (1 skipped), `cargo check` PASS, `publication_check.py` with a private deny list PASS (0 findings). No new inference in this step; real-engine results of the included fixes were measured in the development checkout before the move.

## 21 October 2026 — product-facing names

The user approved **Labs**, **Róża**, and **silnik Seventy Seven Labs** as the visible theme and engine names; the orb remains **Przepływ**. Ordinary UI descriptions and public guides use these names. Exact upstream identities, source versions, copyright statements, and licenses remain available in dedicated provenance details and third-party notices. Real model names and model terms remain accurate.

This changes presentation, not palette values, saved identifiers, local storage, API/transport fields, the theme JSON v1 contract, or the pinned backend archive. Added theme-compatibility coverage to the standard UI test suite. README screenshots are refreshed from fictional demo data, with new hashes recorded in the public asset manifest. The private development checkout, models, and runtime data remain untouched. Current validation and limitations are recorded in [verification](verification/weryfikacja.md).

Checks passed: Svelte/TypeScript 0 errors and 0 warnings, production build, full UI regression suite including 7 compatibility checks, 24 real theme interactions, and the five demo capture checks. New names and retained source attribution were verified in the browser with no JavaScript errors or private-backend requests. Three screenshots were refreshed and visually reviewed. The main-chunk warning remains (about 729 kB). No Rust or engine changes and no new inference/EXE acceptance. Final whitespace, documentation-link, privacy, and remote CI checks accompany the publication of this change.

## 21 October 2026 — GitHub publication setup

The user authorized uploading the prepared English source to the existing public `77-Labs` repository. The destination was confirmed to be empty, and `origin` was configured in this public checkout. The private development repository and its history are not part of the upload.

Pre-publication checks passed: clean `main`, neutral author and committer identities, only the public branch ref, and a full privacy scan using an external private deny list (549 files, 624 Git objects, the pinned engine archive, zero findings). The publication guide now describes checking `origin` and sending only reviewed `main`. Documentation content, links, and whitespace are checked before committing. Application code, dependencies, models, and media are unchanged; application builds and inference are not repeated for this publication setup. Push success, remote commit identity, and GitHub CI are verified separately after the commit.

## 21 October 2026 — English public documentation

Translated the README, PRD, contributor/security/provenance documents, agent instructions, and public technical guides into English at the user's request. The application interface and screenshots remain Polish. Actual Polish control labels are retained with English explanations. Existing filenames, commands, URLs, model names, and compatibility identifiers are preserved.

Updated the documentation language rule to English while retaining Polish application UI. Historical verification results remain explicitly historical; this documentation change does not claim new application or model testing. The private source checkout and runtime data are untouched.

The public package description and CI display name are also English. Scripts, dependencies, and application behavior are unchanged.

Checks passed: content review of 31 Markdown files, all 99 local links and heading anchors, UTF-8, whitespace, and a full publication/privacy audit with private deny patterns stored outside the repository. All five pinned assets (three screenshots, the demo tone, and the engine archive) are unchanged. A separate English source ZIP is generated from the new anonymous commit. Builds, UI/runtime acceptance tests, and inference were not rerun for this documentation-only change. Results are recorded in [verification](verification/weryfikacja.md).

## 21 October 2026 — fast audit of the entire history

The first public starting point was committed with neutral author and committer identities. The scanner now reads all objects in batches instead of starting a separate Git process for every file. It retains checks for unreachable objects, names in trees, every index stage, taggers, and object replacement attempts. It verifies object identity, type, size, and complete responses; an error cannot produce PASS.

Recorded checks: 23 tests PASS, 1 SKIP for Windows directory-symlink permissions. A real scan with private patterns stored outside the repository covered 549 files, 578 Git objects, and the pinned ZIP: zero findings in about 9 seconds. Diff checks for both files and documentation passed. This change covered only the scanner, its tests, and the verification record; UI builds and inference were not repeated. The history audit is repeated after committing. Nothing was published remotely.

## 21 October 2026 — initial open-source preparation

Created a separate repository with fresh history and a neutral author identity. The private checkout had uncommitted changes and checkpoints containing data; it was left untouched, and the export was based on its last local commit.

Removed private recordings, reports, screenshots, and generated HTML previews containing embedded audio. A personal name, private synthesis profile, and local paths were replaced with neutral data or explicit parameters. Speech tests require a user-supplied reference. Reports go into ignored `.tmp/qa`.

Assets recovered from a commercial website and logos without a complete redistribution basis were replaced with original visualization code and Lucide icons. Reading older settings remains supported. Added the owner's selected AGPL-3.0-only license and separate notices for upstream, themes, and flags.

The README, PRD, contribution/security policies, publication scanner, and CI define the public starting point. The demo uses fictional projects and a procedural tone without human speech. Three new 1440×960 screenshots were visually reviewed; five demo checks passed without requests to the private backend.

Recorded checks on that tree: check 0/0, build, the full UI test suite, and cargo check PASS. The scanner initially had 17 PASS and 1 SKIP because Windows could not create the test symlink. File/index auditing with private patterns stored outside the repository passed; history is checked again after committing. See [verification](verification/weryfikacja.md) for details and limits. Polish-character encoding in new documentation was also corrected, and local links were checked.

A build warning remains for the main chunk of approximately 728 kB. All models, full dubbing/audiobook renders, CUDA, and installation on a clean machine have not been accepted. No new inference, weight downloads, remote publication, or private-data migration were performed. Actual runtime data, private commits, and uncommitted work remain in the original directory.
