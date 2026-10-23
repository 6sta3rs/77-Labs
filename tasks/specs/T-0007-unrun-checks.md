# T-0007: triage the 36 checks that never run

**Problem.** `tests/frontend/` has 69 `*-check.mjs` files; 36 are in no npm script and CI runs only `npm run test:ui`, so a regression they would catch goes unnoticed. Nobody knows whether they still pass. Turning the 32-segment `&&` chain into a glob loop now would switch all of them on at once.

**Steps.**
1. List them: files in `tests/frontend/*-check.mjs` not named in `package.json` or `.github/workflows/ci.yml`.
2. Run each once (`node tests/frontend/<name>`), record pass / fail / needs-environment in `docs/progress.md`.
3. Passing ones go into `test:ui`; failing ones are fixed or deleted with a reason; ones needing a desktop or an engine move to `tests/acceptance` (or `tools/acceptance` after T-0012).
4. Only then replace the `&&` chain with a loop over the files. Keep `ui-rules.mjs` and the nested `test:styles` in the set, and keep a stable order.

**Do not.** Delete tests that read source text before step 2 (see R-1 on the board); `tag-check.mjs` is required by `AGENTS.md`.

**Done when.** Every `*-check.mjs` is either run by `npm run test:ui` or has a documented reason it is not; CI is green.
