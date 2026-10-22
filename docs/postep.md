# Public project progress

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
