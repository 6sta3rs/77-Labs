# Local API, MCP and audio provenance

The integrations panel uses the private backend at `127.0.0.1:4312`;
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
A separate [remote transport](zdalny-silnik.md) is available for your own server.

## Watermarking and sources

Reading `/watermark/status` reports configuration and library availability.
It does not run the detector. Detecting a watermark in a selected file requires
a separate button and may load the AudioSeal model. A response containing an
error is not a negative detection result. A watermark does not establish voice
rights or the speaker's consent.

Diagnostics show the source version, installed distribution, archive SHA and
pinned provenance when it matches the active package. Missing information is
reported explicitly. Code and model terms remain separate.

## Files

- `src/lib/IntegrationSettings.svelte`, `src/lib/integrations.ts` — UI and transport.
- `scripts/runtime/integration_settings.py` — configuration and diagnostics.
- `scripts/runtime/windows_runtime_paths.py` — local Windows library paths.

Regression checks: `node scripts/integrations-check.mjs`
and `scripts/runtime/test_integration_settings.py` in the appropriate environment.
A successful handshake and catalog read do not verify tools/call, watermarking
or inference. See the [runtime guide](runtime.md),
[verification status](weryfikacja.md) and
[third-party notices](../THIRD_PARTY_NOTICES.md).
