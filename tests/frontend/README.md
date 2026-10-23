# Frontend checks

`npm run test:ui` runs `tools/dev/run-checks.mjs`, which executes every `tests/frontend/*-check.mjs` and `ui-rules.mjs` (four at a time), prints every failure and fails if any check fails. A new check needs no registration; `node tools/dev/run-checks.mjs <part-of-name>` runs a subset. A check that cannot run in CI must be listed with a reason in `SKIPPED` in the runner (currently none).

## Manual browser scripts (unreferenced `*-check.js`)

The eight `*-check.js` files that no script or page references are not Node tests (the folder holds 23 `.js` files in total; the others are loaded by preview pages). They are pasted or imported in the browser console of a running page, with a trusted click first where the file says so. Nothing runs them automatically; the Playwright smoke planned in T-0030 is meant to replace them.

| File | Run on |
| --- | --- |
| `additional-ui-check.js`, `audio-card-check.js`, `component-ui-check.js`, `scrollbar-ui-check.js` | `/inputy.html` (component gallery) |
| `global-orb-browser-check.js` | `/?demo=tts`, with the sample looping |
| `navigation-refinement-check.js` | the production preview |
| `theme-check.js` | the Vite server, isolated profile |
| `orb-ui-check.js` | an entry module for `tools/preview/orb-preview.svelte`; no page references it today |

Python files in this folder (`audit-upstream.py`, `test_audit_upstream.py`, `speech-settings-backend-check.py`) are covered by the runtime test table of T-0029.
