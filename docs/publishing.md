# Publishing the source

This repository is a separate public starting point. The private checkout and its history are not part of the publication. Do not copy the old `.git` directory, checkpoints, or ignored output into this repository.

## Contents

Application and adapter code, the pinned licensed engine, documentation, fictional demo data, a procedural tone, and new UI screenshots. Examples in `engine.zip` come from the pinned upstream sources; they are not Seventy Seven Labs user recordings.

Private projects, databases, recordings, voices, reports, account screenshots, and model-term decisions were not transferred. Assets without established redistribution terms were replaced with neutral icons and original visualizations. Third-party author attributions were preserved.

## Checks

```powershell
npm ci
npm run check
npm run build
npm run test:ui
python -B tests/runtime/test_publication_check.py
python tools/dev/publication_check.py
cargo check --manifest-path desktop/Cargo.toml
git diff --check
git status --short
```

The script checks files, the index, all Git objects (including unreachable ones), checkpoint refs, private formats, tokens, personal paths, embedded audio, and the exact engine SHA. The tone is pinned in `public-assets.json` and reproducible with `tools/dev/generate_demo_tone.py`.

Supply additional private strings through `--deny-file`: a JSON array stored **outside the repository**. Matched values are not printed. For the first release, add `--require-anonymous` to check authors, committers, and taggers.

These rules do not replace reviewing new screenshots, recordings, or licenses. Current screenshots show only fictional demo data.

## Releases

A release is a tag. Everything after the tag is done by `.github/workflows/release.yml`; nothing is published without a person.

1. Set the same version in `package.json`, `package-lock.json`, `desktop/tauri.conf.json`, `desktop/Cargo.toml` and `desktop/Cargo.lock` (`npm run test:structure` fails when they differ), add a `## <version> - <date>` section to [CHANGELOG.md](../CHANGELOG.md) (an optional `Update notes (Polish):` line is what the in-app updater shows), commit, and tag that commit `v<version>`. Pushing the tag starts the workflow.
2. The workflow runs the gates (check, build, `test:ui`, `test:structure`, the publication check, `cargo test`, clippy, the changelog section) on the tagged commit. Then the `build` job waits for approval by the required reviewers of the `release` environment, builds with `npm run desktop:release` (the guards in `tools/release/release-guards.mjs` run first), attests the build provenance and creates a **draft** release with the installer, its `.sig`, a `.sha256` file and `latest.json`.
3. Review the draft. A draft is never the "latest" release, so no installed copy is offered the update yet. **Publishing the draft pushes the update to every installation that polls `latest.json`**; only the owner promotes it.
4. Publishing triggers `.github/workflows/verify-release.yml`, which downloads the feed that installed copies poll, downloads the installer it points to and verifies its signature against the key in `desktop/tauri.conf.json` (`tools/release/verify-feed.mjs`). If it fails, unpublish the release at once.

One-time setup by the owner, none of which an agent does: create the GitHub environment `release` with required reviewers; add the secrets `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` to that environment only; protect `main` with the required checks (T-0051); move to a key with a password and the two-feed scheme ([T-0033](../tasks/specs/T-0033-updater-key-rotation.md)); consider free open-source code signing (T-0037). Until the setup exists, `npm run desktop:release` on the maintainer's machine is the only way to build a release, with the same guards.

## Ongoing work

Write QA reports to ignored `.tmp/qa`. Select your own speech explicitly through script arguments and keep it outside Git. `integration.py` requires `--run --profile ID`; ASR/conversion/dubbing require a speech reference as described by `--help`. The demo tone is not speech.

Initial public commits have a neutral identity. Before another commit, check local `git config user.name` and `git config user.email` to avoid inheriting private global settings.

CI checks the frontend and source. It does not run models, accept terms, or prove GPU, installer, or complete dubbing behavior.

The `origin` remote points to the public GitHub repository. Verify its destination with `git remote get-url origin` before publishing, then push only the reviewed `main` branch. Send **this public history**; do not push the private development checkout or checkpoint refs. A source archive is created from the public commit using `git archive`; it excludes dependencies, build output, and `.git`.
