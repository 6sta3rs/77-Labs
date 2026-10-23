# Generated numbers

Written by `node tools/dev/write-numbers.mjs`; do not edit by hand. Other documents quote these figures and should point here.

## Tests

| Group | Count |
| --- | --- |
| Frontend checks run by `npm run test:ui` (`tests/frontend/*-check.mjs` and `ui-rules.mjs`) | 74 files |
| Python checks in CI (`tests/manifest-python.json`, group `ci`) | 28 files (9 listed as skipped with a reason) |
| Rust unit tests (`#[test]` in `desktop/src`) | 53 (2 marked `#[ignore]`) |
| Browser tests (`npm run test:e2e`) | 6 |
| Acceptance scripts (`tests/acceptance`, run by hand or by the weekly job) | 40 files |

## Built interface (`dist/assets`)

| Measure | Size |
| --- | --- |
| All JavaScript | 2230247 bytes (2178 KiB) in 10 files |
| All CSS | 265370 bytes (259 KiB) |
| App-<hash>.js | 895088 bytes (874 KiB) |
| landing-orb-<hash>.js | 495414 bytes (484 KiB) |
| index-<hash>.js | 452793 bytes (442 KiB) |
| appearance-<hash>.js | 147702 bytes (144 KiB) |
| sheet-drag-<hash>.js | 109993 bytes (107 KiB) |

The budgets that fail the build are in `tools/dev/bundle-budget.json` (`npm run test:bundle`).
