# Roadmap: from 6/10 to about 8/10

Where this comes from: two three-model councils (Opus 5.5, Fable 5.1, Sonnet 5.5, 23 October 2026). The first scored the repository **6/10**. The second reviewed this plan in two rounds and projected **7.4 to 7.6** for versions 1 and 2. This version (3) applies the corrections that the reviewers raised and the chairman verified; it was **not** re-scored by the council, so 8 is a target, not a measured result. A real score comes only from a council run on the finished repository.

10/10 is not a sensible target: it needs things outside the code (a paid or sponsored code-signing certificate, an external security audit, reproducible builds, several shipped languages with native QA).

Baseline per area: structure 7, code quality 7-7.5, tests+CI 4.5, security/privacy 6.5-7, build/release 5-5.5, docs 7-8, UX/i18n/a11y 6.5, performance 6.

## What 8 means (each point is enforced by an automated check where possible)
- **Structure:** layout as in `docs/architecture/project-structure.md` (renamed by T-0015); every file under `tools/` is in `tools/README.md` (a test fails for an unlisted or orphaned one); naming rules in `check-structure`.
- **Code quality:** no non-data file over 1000 lines; every remaining line-limit exception equals its current size and the check fails when a file shrinks without lowering its limit; a per-file ratchet on the longest source line (`App.svelte` has 85 lines over 200 characters, 30 over 400); a rule fails on an empty `catch {}` or a `catch {` with no statement and no `// reason`; `cargo clippy -D warnings` green; `ruff` with a committed rule subset after the T-0029 table exists.
- **Tests + CI:** CI runs on Windows (`cargo check/test` with all 52 `#[test]`, clippy, `test:structure`); a manifest runner that runs every `tests/frontend/*-check.mjs`; a committed table of the 27 `tests/runtime/test_*.py` modules (CI / Windows-only / needs engine) with the green subset gated; a launcher contract test without torch; a Playwright smoke with a mocked runtime API and an axe scan (0 serious/critical on five named pages, plus a Tab-order assertion); published coverage baselines (Python `coverage`, `cargo llvm-cov`, no threshold yet).
- **Security/privacy:** updater key with a password, held as a CI secret in a protected environment; a two-feed updater scheme (T-0033); releases built only by a tagged CI workflow (draft until a human promotes it) with provenance attestation; dev origins out of production; the engine analytics kill switch set and documented; actions pinned by SHA, Dependabot, `npm audit`, `cargo audit`; the local `refs/t3` removed; branch protection with required checks.
- **Build/release:** one tag produces the release; guards (clean tree, HEAD = tag on a detached checkout, version parity in package.json, package-lock.json, tauri.conf.json, Cargo.toml, Cargo.lock); `CHANGELOG.md`; the update path tested from the real GitHub feed.
- **Docs:** generated numbers (bundle size, test counts); English file names; backticked paths checked in docs, README, CONTRIBUTING, SECURITY, AGENTS and `tasks/**`; `CONTRIBUTING.md` extended.
- **UX/i18n/a11y:** no fixed Polish locale in formatting (a test with an allow-list), `Intl.PluralRules` plurals, axe and Tab-order checks, items that were only code-checked verified in the running app. Capped at about 7.5 while one language besides Polish ships; accepted.
- **Performance:** a budget enforced from `dist/` (`App` chunk, total eager JS, set from the measured post-split numbers); `en` catalog loaded on demand; a recorded cold-start baseline that a weekly job re-checks; a busy engine port gives a clear message within 5 s.

## Order

### M1 Trust the gate (first, it protects every later change)
1. **T-0028 (M, includes T-0010)** Windows CI job: `npm ci && npm run build` first (`tauri::generate_context!` needs `../dist`), `Swatinem/rust-cache`, `cargo check --locked`, `cargo test` skipping the two interactive `#[cfg(windows)]` tests in `dictation_desktop.rs` (lines 804-823) on a headless runner, `npm run test:structure`; `concurrency` with cancel-in-progress; a `tauri build --no-bundle` proof job limited by `paths` to `src-tauri/**` (and `desktop/**` after T-0011); a separate "clippy fix-up" commit before `cargo clippy -D warnings` becomes a gate; before the job is required, fix the path portability of the existing UI checks (they only ever ran on Ubuntu). The one-line `test:structure` step lands first.
2. **T-0019 (S, owner)** Delete the local `refs/t3` (273 today, growing; acceptance is "zero refs matching `refs/t3/`", not a number) and note that the T3 tool recreates them.
3. **T-0035 (S/M)** Dev origins (`:4310`) only when a dev flag is passed in `launcher.py:219`, `ai_tagging.py:67`, `remote_backend.py:396`, `integration_settings.py:82`. The per-run token is NOT an access control (it is echoed on every response, `launcher.py:359`), so no token criterion. Negative test: a request from `http://127.0.0.1:4310` is rejected in production mode.
4. Quick fixes, one commit each: T-0001, T-0002 (also `CONTRIBUTING.md:49,58`; the path check is data-driven from one list of roots so it survives later moves), T-0003, T-0004, T-0005, T-0006, T-0016, T-0020.
5. **T-0007 (M)** Triage the 36 unrun `*-check.mjs` and 8 unreferenced `*-check.js`; `tools/dev/run-checks.mjs` replaces the `&&` chain, runs all, prints all failures, fails on unlisted files.

### M2 Structure (before new tooling; protected by M1)
6. Owner decisions T-0008, T-0009, T-0014. T-0013 (`prototypes/`) is deferred: it needs a privacy review and nothing depends on it.
7. **T-0012 (M)** `tools/` with `tools/README.md`. `tests/acceptance` STAYS (it holds tests; `tasks/specs/T-0012-tools-folder.md` updated). Path-rewrite list: `AGENTS.md`, `ci.yml`, `CONTRIBUTING.md`, `tests/runtime/test_publication_check.py`, and `tests/runtime_paths.py` (it hard-codes `tools/release` and `tests/acceptance`; acceptance: all 27 runtime modules still import). T-0015 (English names for all docs), T-0017.
8. **T-0011 (L)** `frontend/src` and `desktop/` per its spec, only after a `tauri build` proof on a scratch copy and a green proof job; if `tauri build` on `desktop/` needs hacks, defer it (structure still reaches 8 with `tools/` and the rules; 7.7 without). Extra checklist: Vite `publicDir`, `svelte-check --tsconfig`, `vite.config.ts` importing `ai-dev.ts` (moved by T-0012), `tauri info` from the root with the `.tmp` repository copies present, and mine `.tmp/structure-reorganization` (an earlier attempt).
9. **T-0038 (M)** `check-structure` rules: naming per extension, every file under `tools/` listed, no orphan scripts.

### M3 Secure and automate the release
10. **T-0032 (S)** `build-update.mjs` guards: clean tree, HEAD = tag (also on a detached checkout), version parity of the five manifests (also in `test:structure`).
11. **T-0034 (S)** SHA-pinned actions, `dependabot.yml`, scheduled `npm audit --omit=dev` and `cargo audit`, a checksum for the NSIS download.
12. **T-0036 (S)** Extend `SECURITY.md`, add `docs/architecture/security.md` (planned) (token is a marker, CSP `unsafe-inline` rationale, trust boundaries); **T-0050 (S)** privacy: the engine ships `backend/core/analytics.py` (PostHog, switch `OMNIVOICE_ANALYTICS_DISABLED`) and the launcher does not set it; verify the default, set the switch, negative test, `docs/architecture/privacy.md` (planned); **T-0051 (owner)** branch protection with required checks on `main`.
13. **T-0024 (S/M)** Update test from the REAL feed: install 0.2.1 (installer kept in the ignored `.tmp/release/v0.2.1`; the tag `v0.2.1` does not exist) on isolated data and update to 0.2.2 from GitHub (the 0.2.2 feed is the current one). A local feed is not reachable: the endpoint is fixed at build time (`build-update.mjs:15,26`).
14. **T-0033 (M, owner)** New updater key with a password and a two-feed scheme: new-key builds use a new endpoint (for example `latest-v2.json`, the endpoint name becomes a parameter of `build-update.mjs`); every later release also re-uploads the bridge `latest.json` with its old-key `.sig` (the `.sig` is reusable), so pre-bridge installs keep working; the old key is kept offline until the bridge is published. Accept: a pre-bridge install and a bridge install both update from the same release page. Hygiene gain, not compromise recovery.
15. **T-0031 (L)** `release.yml` on tag `v*`: runs `test:structure`, `publication_check` and the Windows job first; builds `desktop:release` (20-30 min with LTO); secrets from a protected environment with required reviewers; provenance attestation; creates a DRAFT release (a draft is never "latest", promotion pushes the update to every install); a post-release job downloads the published feed and verifies the signature with the public key; notes from `CHANGELOG.md`.
16. **T-0037 (owner)** Apply for free open-source code signing (SignPath Foundation or Azure Trusted Signing; eligibility unverified) and wire it into `release.yml` if granted. It is the one item that lifts security and build/release past 7.5; without it a strict council caps both there.

### M4 Code health, tests, docs
17. **T-0039 (XL, burn-down)** Split `runtime.rs` (tests into their own file) and `engine_catalogue_metadata.py`; ratchet every other exception to its current size; per-file longest-line ratchet; `App.svelte` long lines get their own commit.
18. **T-0040 (M)** Silent-error rule (empty `catch {}` and statement-less `catch {` without `// reason` fail); `App.svelte:164` shows a toast when `saveAppearance` returns false (it returns a boolean, not a promise).
19. **T-0029 (M, after T-0012)** First the 27-row table (CI / Windows-only / needs engine; the 6 non-`test_` files included), then a tracked `requirements-ci.txt` pinning only what the tests import (fastapi, httpx, cryptography, uvicorn, starlette, websockets; numpy and soundfile are not imported by `tests/runtime`), the gated subset, a manifest that fails on an unlisted file, then `ruff`. **T-0048 (S/M)** launcher contract test: the wrapper and middleware (`launcher.py:359`, `activity.py:477`) under `TestClient` with a stub app, no torch. **T-0052 (S)** publish Python and Rust coverage baselines.
20. **T-0030 (L, after T-0011)** Playwright + `@axe-core/playwright` with a mocked runtime API, in two steps (mock server plus two pages, then the other three); five named pages; 0 serious/critical violations; a Tab-order assertion. **T-0044 (M)** fixes from the scan.
21. **T-0049 (S)** weekly job: start the built EXE on isolated data and check over CDP that the UI loads (WebView2 is on the runner). `/health` plus one synthesis stays manual until the bootstrapped runtime can be cached (it downloads multi-GB torch wheels).
22. **T-0042 (M)** Generated numbers (bundle size, test counts) in `docs/verification/`, `CHANGELOG.md`, extend `CONTRIBUTING.md`.
23. **T-0025 (M-L)** Fixed Polish locale in 32 places outside `i18n/` (display formatting, `Intl.DisplayNames('pl')`, `'pl-PL'` defaults, `toLocaleLowerCase('pl')`); a test with an allow-list for `languages.ts` and `i18n/index.ts`; `Intl.PluralRules` plurals. **T-0022 (M)** verify in the running app what was only code-checked.

### M5 Performance
24. **T-0046 (M)** Dynamic imports for the settings shell, tool workspaces and landing orb; `en` loaded on demand (the language initialised before the app mounts); a script fails the build over the budget, set from the measured post-split numbers.
25. **T-0047 (S+S)** (a) cold-start and warm-up baseline in `docs/verification/`, re-checked by the weekly job (fail at +50%); (b) a busy engine port gives a clear Polish message within 5 s. A dynamic port is deferred (needs a CSP change and plumbing across about 57 files).

## Dropped or deferred
`knip` as a CI gate (run it quarterly), `cargo deny licenses`, monthly split of the progress log, T-0023 pixel comparison, T-0013 `prototypes/`, true dynamic engine port, nightly `/health` with synthesis, T-0026 (RTL), T-0027 (merged into T-0046), reproducible builds, external audit.

## Review notes (open points the council raised and this plan accepts)
- Whether the free signing programmes accept this project is unverified (T-0037).
- Whether `tauri build` finds `desktop/` without `--config` is unverified (T-0011).
- 15 of 27 Python modules green on Windows is a guess until the T-0029 table exists.
- The two-feed updater scheme (T-0033) was reasoned from `build-update.mjs`, not run.
