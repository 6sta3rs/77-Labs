# Generated numbers

Written by `node tools/dev/write-numbers.mjs`; do not edit by hand. Other documents quote these figures and should point here.

## Tests

| Group | Count |
| --- | --- |
| Frontend checks run by `npm run test:ui` (`tests/frontend/*-check.mjs` and `ui-rules.mjs`) | 76 files |
| Python checks in CI (`tests/manifest-python.json`, group `ci`) | 27 files (10 listed as skipped with a reason) |
| Rust unit tests (`#[test]` in `desktop/src`) | 53 (2 marked `#[ignore]`) |
| Browser tests (`npm run test:e2e`) | 11 |
| Acceptance scripts (`tests/acceptance`, run by hand or by the weekly job) | 40 files |

## Built interface (`dist/assets`)

| Measure | Size |
| --- | --- |
| All JavaScript | 2231227 bytes (2179 KiB) in 10 files |
| All CSS | 265370 bytes (259 KiB) |
| App-<hash>.js | 895191 bytes (874 KiB) |
| landing-orb-<hash>.js | 495414 bytes (484 KiB) |
| index-<hash>.js | 453312 bytes (443 KiB) |
| appearance-<hash>.js | 147702 bytes (144 KiB) |
| sheet-drag-<hash>.js | 110020 bytes (107 KiB) |

The budgets that fail the build are in `tools/dev/bundle-budget.json` (`npm run test:bundle`).
