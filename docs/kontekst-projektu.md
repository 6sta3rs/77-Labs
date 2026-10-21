# Project context

**Seventy Seven Labs 0.2.0** is a local voice studio for Windows. The public source has a fresh history without the previous user's data. Write the product name exactly as Seventy Seven Labs.

The application interface is Polish. Public documentation is English; filenames and compatibility identifiers remain stable.

## Architecture

- Svelte 5 / TypeScript / Vite: interface, editor, library, and transport.
- Tauri 2 / Rust: window, native files, process supervision, and installation.
- Python / FastAPI: the Seventy Seven Labs engine, combining a pinned upstream backend with adapters in `scripts/runtime/`. Exact upstream identity, version, authors, and license are documented in [third-party notices](../THIRD_PARTY_NOTICES.md) and the engine provenance manifest.
- `engine.zip` and `engine-provenance.json`: immutable upstream sources, licenses, and provenance.
- Data defaults to `%LOCALAPPDATA%/VoiceStudioNext`, outside the repository.

The Tauri identifier `local.studioa1tts.voicestudio-next`, `voicestudio.*` storage keys, and runtime directories are retained for compatibility. A cosmetic product rename should not change these identifiers.

## Running and development

Run `npm ci`, then `npm run dev`: http://127.0.0.1:4310. `/?demo=tts` displays fictional data and a procedural tone. `inputy.html` opens the component gallery.

`npm run desktop:dev` starts Tauri; `npm run desktop:build` creates an EXE without an installer. The backend on port 4312 starts on demand, stops after confirmed inactivity, and requires its own environment and weights. See [runtime](runtime.md) and [installation](instalacja-runtime.md).

The file map is in the [README](../README.md). See the [PRD](PRD.md) for scope and criteria, [verification](weryfikacja.md) for recorded results, and [progress](postep.md) for handover notes.

A build and a health response do not prove synthesis or a complete dubbing/audiobook workflow. Historical private-deployment results were not copied into the new history.

## Privacy and licenses

Do not add recordings, databases, accounts, tokens, or private paths. Write QA output under `.tmp/qa`. The project's demo audio is only a procedural tone; upstream retains its documented assets in the pinned archive.

Do not edit hardlinked models or libraries in place. The public version uses neutral icons and original visualizations. Product-facing themes are **Labs** and **Róża**, and the procedural orb variant is **Przepływ**. Older identifiers remain compatibility details, not product labels. Renaming a presentation label does not change ownership or licensing of imported sources; preserve source copyright, licenses, and factual model names.

Commit each logical change with a progress update, following [AGENTS.md](../AGENTS.md). Run the [publication check](publikacja.md) before publishing.
