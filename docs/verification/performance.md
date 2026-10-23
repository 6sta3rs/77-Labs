# Performance baselines

Numbers that a later change can be compared with. Each says where it was measured; none is a promise.

## Cold start of the window

Seconds from starting the release EXE (`desktop/target/release/seventy-seven-labs.exe`) to the mounted interface, on a fresh WebView profile and fresh application data, without starting the engine: **about 0.8 s** (runs of 0.78 to 0.81 s on the development machine, 23 October 2026). Measured by `tests/acceptance/exe_smoke.py`; the value is in `tests/acceptance/cold-start-baseline.json` (`localSeconds`).

The weekly workflow `.github/workflows/exe-smoke.yml` builds the EXE on a Windows runner, runs the same script and fails when `runnerSeconds` is set and the start is more than 50% slower. `runnerSeconds` is `null` until the first run has measured the runner (a runner is slower than this machine, so the local value must not be used there); record it from that run's `window_starts_and_app_mounts` line.

Not measured: the engine warm-up (needs a real engine and weights; the bootstrapped runtime downloads multi-GB packages, so it stays a manual measurement), and a first-ever start with an empty WebView2 profile on a cold disk.

## Busy engine port

With a foreign program listening on `127.0.0.1:4312`, **Uruchom silnik** shows "Port 4312 jest zajęty. Seventy Seven Labs nie przejmie obcego procesu." after 0.03 s (limit: 5 s), also when no Python runtime is installed. Measured with `tests/acceptance/exe_smoke.py --busy-port` (the weekly job runs it as well). A dynamic port is deferred: it needs a CSP change (`connect-src` names the port) and changes in about 57 files.

## Bundle size and what was not split

`npm run test:bundle` (`tools/dev/check-bundle-budget.mjs`, budgets in `tools/dev/bundle-budget.json`) fails the build when `dist/assets` outgrows its budget; current sizes are in [numbers](numbers.md): the entry chunk 442 KiB, the App chunk 874 KiB, all JavaScript 2,178 KiB, CSS 259 KiB (budgets 5% above). The landing orb (484 KiB) is already a separate chunk.

Two ideas of the roadmap were evaluated and **not** done: loading the English catalog on demand, and lazy imports for the settings shell and the tool workspaces. The English catalog cannot simply be lazy: `frontend/src/i18n/index.ts` builds reverse lookup tables over all catalogs so that English messages from the engine are mapped back to Polish even when Polish is active, and the i18n tests rely on synchronous catalogs. Splitting `App.svelte` and the workspaces needs the component split of T-0039 first. The measured cost is small (the whole window is interactive in about 0.8 s, see above), so the budget only prevents growth. T-0027 (language catalogs on demand) stays blocked until more than about five languages exist.
