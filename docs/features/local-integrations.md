# Local API, MCP and audio provenance

**Ustawienia → Integracje** (Settings → Integrations; tabs **API zgodne z OpenAI**,
**MCP** and **Referencja API** — API reference) uses the private backend at `127.0.0.1:4312`;
in Vite, requests go through `/backend`. MCP is disabled by default.
Saving settings does not enable cloud services, telephony or network exposure
of the port.

## API and MCP

Metadata from `/v1/audio/capabilities`, `/.well-known/voicestudio-speech`
and `/v1/models` describes the protocol and model names/aliases. A catalog entry
does not prove that weights have been downloaded or synthesis has succeeded.
Discovery may advertise MCP even when its listener is disabled.

Enabling MCP saves `data/integration-settings.json` and requires a restart of
the private engine. The connection test performs initialize, initialized and
tools/list, then closes its own session. It does not invoke generative tools/call
operations. Client-to-voice assignments are separate from profiles; removing an
assignment does not delete a voice. A client identifier is not a password.

Local transport restricts the host and Origin. Do not expose the port to the
Internet or treat the process ownership header as remote-access security.
A separate [remote transport](remote-engine.md) is available for your own server.

## Watermarking and sources

The watermark lives in **Ustawienia → Prywatność i użycie → Znak wodny** (Settings →
Privacy and usage → Watermark). Reading `/watermark/status` reports configuration and library availability.
It does not run the detector. Detecting a watermark in a selected file requires
a separate button and may load the AudioSeal model. A response containing an
error is not a negative detection result. A watermark does not establish voice
rights or the speaker's consent.

**Ustawienia → Aktualizacje → Pochodzenie silnika** (Settings → Updates → Engine
provenance) shows the source version, installed distribution, archive SHA and
pinned provenance when it matches the active package. Missing information is
reported explicitly. Code and model terms remain separate.

## Files

- `frontend/src/settings/pages/IntegrationsPage.svelte`, `frontend/src/platform/integrations.ts` — UI and transport.
- `frontend/src/settings/pages/PrivacyPage.svelte`, `frontend/src/settings/pages/UpdatesPage.svelte` — watermark and provenance.
- `scripts/runtime/app/integration_settings.py` — configuration and diagnostics.
- `scripts/runtime/install/windows_runtime_paths.py` — local Windows library paths.

Regression checks: `node tests/frontend/integrations-check.mjs`
and `tests/runtime/test_integration_settings.py` in the appropriate environment.
A successful handshake and catalog read do not verify tools/call, watermarking
or inference. See the [runtime guide](../architecture/runtime.md),
[verification status](../verification/verification.md) and
[third-party notices](../../THIRD_PARTY_NOTICES.md).
