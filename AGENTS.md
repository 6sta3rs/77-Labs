# Agent instructions

## Context at the start of a task

1. Read `docs/architecture/kontekst-projektu.md`, `docs/architecture/struktura-projektu.md`, `docs/postep.md`, and `README.md`.
2. Check `git status --short --branch` and `git log -5 --oneline`.
3. For engine work, read `docs/architecture/runtime.md`; for readiness assessments, read `docs/verification/weryfikacja.md`.
4. Current code and current results take precedence over older descriptions. Do not present a historical test as performed in the current session.

## Required commits

- Record each completed logical change in its own local commit without asking for additional approval. This includes documentation and configuration. Commit after checking a change, not after every file save.
- Update `docs/postep.md` in the same commit: what changed, why, checks performed and their results, limitations, and remaining work. For architecture or startup changes, also update `docs/architecture/kontekst-projektu.md` and the relevant documentation.
- Review the diff before committing and explicitly stage task-owned files. Do not overwrite, revert, or include unrelated changes made by others. Describe an existing dirty checkout in the progress log if it affects the task.
- Use short, specific commit messages, such as `fix: correct recording seeking`, `feat: add voice filter`, or `docs: clarify engine context`.
- Do not commit secrets, `.env`, models, private databases, user recordings, dependencies, or generated output. Public audio is the procedural `public/demo/interface-tone.wav`; the engine archive has pinned provenance. Write reports to ignored `.tmp/qa`.
- Do not push, rewrite history, amend commits, or delete branches without the user's instruction. A missing remote does not prevent local commits.
- After committing, check `git status --short` and report the commit's short hash and check results. If a commit or check fails, explain the cause; do not claim completion or a passing result.

## Tasks

- Planned and finished work lives in `tasks/BOARD.md` (rules in `tasks/README.md`). Check it before starting a request; reuse the matching `T-NNNN` or add a row with the next free ID.
- Set `doing` when you start. Set `done` with the short commit hash only after the checks below passed. A decision that belongs to the owner is `blocked` with the question written down.
- Put task evidence in the ignored `.tmp/qa/T-NNNN/`; keep conclusions in `tasks/specs/` or `docs/postep.md`.

## Verification and project rules

- Match checks to the change. For Svelte/TypeScript code, run `npm run check` and `npm run build`; for tags, also run `node tests/frontend/tag-check.mjs`. Also run `npm run test:structure` when moving files or editing docs links.
- For Rust/Tauri, run `cargo check --manifest-path src-tauri/Cargo.toml`. Check the relevant UI/runtime flow for product behavior; a build or health response alone does not prove synthesis.
- For documentation-only changes, review content and links and run `git diff --check` on changed files. Do not run expensive generation unnecessarily.
- This folder is the **only** working copy of the project and its history is public (remote `origin` on GitHub). Never add the user's personal data: absolute home paths (write `%LOCALAPPDATA%`/`%USERPROFILE%` instead), names, e-mail, real voice-profile names or IDs, recordings, databases, screenshots of private data, or engine logs. QA reports and measurements go to the ignored `.tmp/qa`.
- Before committing, run `python tools/dev/publication_check.py --deny-file <private list>`; the private deny list is kept outside the repository (ask the user for its location if it is not known). Keep the neutral local git identity (`Seventy Seven Labs contributors <contributors@example.invalid>`). Do not import the archived private history or its checkpoints.
- Keep the application UI in Polish and public documentation in English. Preserve clear error messages and real progress. When documenting a Polish control, retain its actual label and add an English explanation where useful.
- Do not modify the old VoiceStudio installation, its database, or libraries and models shared through hardlinks. Use the isolated runtime described in `docs/architecture/runtime.md`.
- Do not claim full readiness for dubbing, audiobooks, the installer, or migration without testing those features.
