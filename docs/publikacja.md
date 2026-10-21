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
python -B scripts/test_publication_check.py
python scripts/publication_check.py
cargo check --manifest-path src-tauri/Cargo.toml
git diff --check
git status --short
```

The script checks files, the index, all Git objects (including unreachable ones), checkpoint refs, private formats, tokens, personal paths, embedded audio, and the exact engine SHA. The tone is pinned in `public-assets.json` and reproducible with `scripts/generate_demo_tone.py`.

Supply additional private strings through `--deny-file`: a JSON array stored **outside the repository**. Matched values are not printed. For the first release, add `--require-anonymous` to check authors, committers, and taggers.

These rules do not replace reviewing new screenshots, recordings, or licenses. Current screenshots show only fictional demo data.

## Ongoing work

Write QA reports to ignored `.tmp/qa`. Select your own speech explicitly through script arguments and keep it outside Git. `integration.py` requires `--run --profile ID`; ASR/conversion/dubbing require a speech reference as described by `--help`. The demo tone is not speech.

Initial public commits have a neutral identity. Before another commit, check local `git config user.name` and `git config user.email` to avoid inheriting private global settings.

CI checks the frontend and source. It does not run models, accept terms, or prove GPU, installer, or complete dubbing behavior.

The `origin` remote points to the public GitHub repository. Verify its destination with `git remote get-url origin` before publishing, then push only the reviewed `main` branch. Send **this public history**; do not push the private development checkout or checkpoint refs. A source archive is created from the public commit using `git archive`; it excludes dependencies, build output, and `.git`.
