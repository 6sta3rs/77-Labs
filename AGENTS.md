# Agent instructions

## Context at the start of a task

1. Read `docs/kontekst-projektu.md`, `docs/postep.md`, and `README.md`.
2. Check `git status --short --branch` and `git log -5 --oneline`.
3. For engine work, read `docs/runtime.md`; for readiness assessments, read `docs/weryfikacja.md`.
4. Current code and current results take precedence over older descriptions. Do not present a historical test as performed in the current session.

## Required commits

- Record each completed logical change in its own local commit without asking for additional approval. This includes documentation and configuration. Commit after checking a change, not after every file save.
- Update `docs/postep.md` in the same commit: what changed, why, checks performed and their results, limitations, and remaining work. For architecture or startup changes, also update `docs/kontekst-projektu.md` and the relevant documentation.
- Review the diff before committing and explicitly stage task-owned files. Do not overwrite, revert, or include unrelated changes made by others. Describe an existing dirty checkout in the progress log if it affects the task.
- Use short, specific commit messages, such as `fix: correct recording seeking`, `feat: add voice filter`, or `docs: clarify engine context`.
- Do not commit secrets, `.env`, models, private databases, user recordings, dependencies, or generated output. Public audio is the procedural `public/demo/interface-tone.wav`; the engine archive has pinned provenance. Write reports to ignored `.tmp/qa`.
- Do not push, rewrite history, amend commits, or delete branches without the user's instruction. A missing remote does not prevent local commits.
- After committing, check `git status --short` and report the commit's short hash and check results. If a commit or check fails, explain the cause; do not claim completion or a passing result.

## Verification and project rules

- Match checks to the change. For Svelte/TypeScript code, run `npm run check` and `npm run build`; for tags, also run `node scripts/tag-check.mjs`.
- For Rust/Tauri, run `cargo check --manifest-path src-tauri/Cargo.toml`. Check the relevant UI/runtime flow for product behavior; a build or health response alone does not prove synthesis.
- For documentation-only changes, review content and links and run `git diff --check` on changed files. Do not run expensive generation unnecessarily.
- Before committing and publishing, run `python scripts/publication_check.py`. Keep private `--deny-file` patterns outside the repository. Do not copy private Git history or checkpoints into this public repository.
- Keep the application UI in Polish and public documentation in English. Preserve clear error messages and real progress. When documenting a Polish control, retain its actual label and add an English explanation where useful.
- Do not modify the old VoiceStudio installation, its database, or libraries and models shared through hardlinks. Use the isolated runtime described in `docs/runtime.md`.
- Do not claim full readiness for dubbing, audiobooks, the installer, or migration without testing those features.
