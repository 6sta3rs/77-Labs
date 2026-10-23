# Security architecture

How the application protects itself and what it deliberately does not claim. For reporting a problem see [SECURITY.md](../../SECURITY.md); for what can leave the computer see [privacy](privacy.md). This page describes the code at the time of writing. There has been no external audit.

## Trust boundaries

```
WebView (http://tauri.localhost)  --Tauri IPC (capabilities)-->  Rust supervisor (desktop/src)
        |                                                             | spawns, owns, stops
        | HTTP/WebSocket, loopback only                               v
        +----------------------------------------------->  Python engine, 127.0.0.1:4312
                                                                      |
                              user-chosen, explicit: Hugging Face, LLM provider, remote engine, update feed
```

- **WebView to Rust.** The window may call only the commands listed in `desktop/capabilities/main.json` (`core:default`, `updater:default`, `process:allow-restart`, and `http:default` limited to `http://127.0.0.1:4312/*`). The content security policy in `desktop/tauri.conf.json` allows scripts only from `'self'` and connections only to IPC and the engine port.
- **WebView to engine.** The engine binds to `127.0.0.1` only. It accepts browser requests from an exact-origin allow-list (`OMNIVOICE_ALLOWED_ORIGINS`, set by `scripts/runtime/app/launcher.py`: `http://tauri.localhost` and `tauri://localhost`), and the engine's `core/csrf.py` checks the origin and the `X-VoiceStudio-CSRF` header on requests that change state. The Vite dev server origin (`http://127.0.0.1:4310`, `http://localhost:4310`) is trusted only when `VOICESTUDIO_DEV_ORIGINS=1`, which the supervisor sets in debug builds only (`docs/architecture/runtime.md`, T-0035); the same flag gates the origin lists in `ai_tagging.py`, `remote_backend.py` and `integration_settings.py`.
- **Rust to engine.** The supervisor starts the engine with a per-run marker, waits for the marker on `/health`, and stops only the process tree it owns.
- **Engine to the outside.** Only on a user action; see [privacy](privacy.md). Product analytics are switched off (`OMNIVOICE_ANALYTICS_DISABLED=1`).

## The `X-VoiceStudio-Next` token is a marker, not an access control

`VOICESTUDIO_NEXT_TOKEN` is generated per run and echoed by the engine in the `x-voicestudio-next` header of every response (`launcher.py`, `OwnedBackend`). Its job is to let the supervisor recognise its own engine and not adopt a foreign listener on port 4312. Anyone who can reach the port can read it, so it must never be described or used as authentication. Access control on the local machine rests on binding to loopback, the origin allow-list, the CSRF header and the Windows account. Another local process of the same Windows user can talk to the engine; that is outside the threat model (see "Not claimed").

## Content security policy

`script-src 'self'` has no `'unsafe-inline'` and no `'unsafe-eval'`. `style-src` has `'unsafe-inline'`, and that is a known, accepted weakness: Svelte components set inline `style` attributes and CSS custom properties at run time (progress bars, the voice orbs, layout variables; about two dozen `style=` and `style:` uses in `frontend/src`). The risk it leaves is CSS injection, not script execution. It can be removed by moving those values to classes or CSS variables set from script and then dropping the keyword; nothing depends on it except those components.

## Updates and releases

- The updater verifies each installer's signature against the public key embedded in `desktop/tauri.conf.json` before running it. The private key lives outside the repository (`%USERPROFILE%\.tauri\seventy-seven-labs-updater.key` or `TAURI_SIGNING_PRIVATE_KEY`). It currently has no password, and its rotation with a two-feed scheme is planned (T-0033, owner).
- `tools/release/build-update.mjs` refuses to build unless the working tree is clean, HEAD carries the tag `v<version>` and the five version manifests agree (`tools/release/release-guards.mjs`, T-0032). It writes a SHA-256 file next to the installer.
- Installers are not code-signed with a certificate (T-0037); Windows SmartScreen may warn.
- A release build in CI with provenance attestation is planned (T-0031).

## Supply chain

GitHub Actions are pinned to commit SHAs (`test:structure` enforces it), Dependabot proposes updates weekly, and `.github/workflows/audit.yml` runs `npm audit --omit=dev` and `cargo audit` weekly. `cargo audit` currently ignores three advisories about `zip` 4.6.1, which `tauri-plugin-updater` brings in and which concern archive extraction that the Windows updater does not perform. Python runtime dependencies are installed into a private environment from pinned sources; hashes establish file identity, not safety (see SECURITY.md).

## Repository hygiene

`python tools/dev/publication_check.py` scans files, all Git objects and the pinned engine archive for private strings before commits and in CI. A secret that was ever committed must be revoked, not only removed.

## Not claimed

No security audit, no sandbox between the application and other processes of the same Windows user, no encryption of the database, recordings or saved credentials at rest, no code-signing certificate, no reproducible builds, and no guarantee about the optional integrations (a configured remote engine, LLM provider or MCP client sees what it is sent).
