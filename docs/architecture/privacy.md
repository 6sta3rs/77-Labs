# Privacy: what can leave the computer

Seventy Seven Labs is local first. This page lists every path by which data can leave the machine, what triggers it, and what is switched off. It describes the code at the time of writing; the checks named here are the ones that exist, not a promise about future releases. See also [SECURITY.md](../../SECURITY.md).

## Product analytics: off, and not offered

The pinned engine (`scripts/runtime/vendor/engine.zip`, upstream backend 0.5.7) contains `backend/core/analytics.py`, an opt-in PostHog client. Its defaults are conservative (the user's `analytics_enabled` preference is false, exception autocapture is off, only allow-listed metadata would be sent), but it also ships an upstream project key as the destination, and a switch in the interface would send events to a project that this distribution does not control.

What this app does about it:

- `scripts/runtime/app/launcher.py` sets `OMNIVOICE_ANALYTICS_DISABLED=1` for the engine. That is the engine's hard kill switch: it outranks both the opt-in and the destination token, so nothing is sent even if the preference file says otherwise.
- **Ustawienia → Prywatność i użycie** (Settings → Privacy and usage) shows **Zgoda na analitykę produktu** (Product analytics consent) as unavailable ("This distribution has no analytics recipient configured"): `ANALYTICS_OFFERED` in `frontend/src/settings/system-settings.ts` is `false`.
- Checks: `tests/runtime/test_analytics_switch.py` loads the pinned engine's `analytics.py` offline with a stub preference store and shows that it is off by default, that it would be on after an opt-in (control), and that the kill switch makes it off again; it also shows that `configure_environment()` of the launcher sets the switch.
- Not verified: network capture of a running engine (no traffic was observed on a real session), and the first-run consent step of the upstream interface (this app does not use it).
- To offer analytics one day, the project would need its own destination, a visible description of the events, and a change of `ANALYTICS_OFFERED` together with removing the switch; none of that exists.

## Network traffic that does exist

| What | When | Where it goes | Controlled by |
| --- | --- | --- | --- |
| Update check and download | **Ustawienia → Aktualizacje** or the **Sprawdź aktualizacje** button (nothing is contacted until the user clicks; an update is installed only after a signature check against the key embedded in `desktop/tauri.conf.json`) | the GitHub release feed of this repository (`latest.json`) | the user (the check button; installation is a separate click) |
| Runtime installation | **Samodzielne środowisko Python** (the app tells the user when the private environment is missing; nothing is downloaded on its own) | python and package downloads for the private runtime | the user (an explicit install action) |
| Model and weight downloads | the model management UI | Hugging Face and the model's own sources; the engine runs with `HF_HUB_OFFLINE=1` otherwise | the user (an explicit download) |
| Translation, tagging and dictation refinement | only when an LLM provider is configured under **AI i klucze** | the provider the user chose receives the text being processed | the user (provider and key) |
| Remote engine and remote workers | only after **Sieć i dostęp → Zdalny silnik** is connected | the remote engine receives text, references and media for the operations that are routed to it | the user |
| MCP and local integrations | disabled by default (`OMNIVOICE_MCP_DISABLE=1`) | a local agent on the same machine | the user |

The engine itself listens on `127.0.0.1:4312` only. Voices, recordings, projects, the usage statistics page and the databases stay in `%LOCALAPPDATA%\VoiceStudioNext`; the usage statistics are computed locally and are never uploaded.

## What the repository itself must never contain

Recordings, databases, tokens, personal paths and voice-profile names. This is enforced by `python tools/dev/publication_check.py` (a deny list kept outside the repository) before every commit and in CI, and by the rules in [AGENTS.md](../../AGENTS.md).
