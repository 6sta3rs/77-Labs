# Performance baselines

Numbers that a later change can be compared with. Each says where it was measured; none is a promise.

## Cold start of the window

Seconds from starting the release EXE (`desktop/target/release/seventy-seven-labs.exe`) to the mounted interface, on a fresh WebView profile and fresh application data, without starting the engine: **about 0.8 s** (runs of 0.78 to 0.81 s on the development machine, 23 October 2026). Measured by `tests/acceptance/exe_smoke.py`; the value is in `tests/acceptance/cold-start-baseline.json` (`localSeconds`).

The weekly workflow `.github/workflows/exe-smoke.yml` builds the EXE on a Windows runner, runs the same script and fails when `runnerSeconds` is set and the start is more than 50% slower. `runnerSeconds` is `null` until the first run has measured the runner (a runner is slower than this machine, so the local value must not be used there); record it from that run's `window_starts_and_app_mounts` line.

Not measured: the engine warm-up (needs a real engine and weights; the bootstrapped runtime downloads multi-GB packages, so it stays a manual measurement), and a first-ever start with an empty WebView2 profile on a cold disk.

## Busy engine port

With a foreign program listening on `127.0.0.1:4312`, **Uruchom silnik** shows "Port 4312 jest zajęty. Seventy Seven Labs nie przejmie obcego procesu." after 0.03 s (limit: 5 s), also when no Python runtime is installed. Measured with `tests/acceptance/exe_smoke.py --busy-port` (the weekly job runs it as well). A dynamic port is deferred: it needs a CSP change (`connect-src` names the port) and changes in about 57 files.
