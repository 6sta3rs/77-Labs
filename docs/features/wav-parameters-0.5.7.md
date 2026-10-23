# WAV format, presets, and voice design

Additional controls are enabled after `generateCapabilities` discovers the actual
`/generate` signature in the active source code. A version number or engine name
alone is not enough. An older backend without this metadata does not receive the
new fields.

## Output format

**Zaawansowane ustawienia mowy** ("Advanced speech settings") may offer PCM WAV16,
PCM WAV24, and WAV32 float. These are storage formats, not a promise of improved
model quality. Multiple blocks are joined without hidden resampling, preserving
the sample rate, channels, and pauses. Incompatible input WAV parameters produce a
readable error. The output limit is 512 MiB.

## Presets and the design draft

The built-in voice list comes from `preset_voices` in the active catalog. Selecting
a preset sends `preset_voice` instead of treating it as a cloned voice profile.
Changing the engine clears an incompatible selection.

The voice design draft is optional metadata: a description of up to 2,000
characters and selections in six categories. It does not replace a reference or
a delivery instruction. It is not sent alongside a clone reference or a selected
preset. The backend performs the actual mapping. An unsupported engine should not
present this feature as available.

The project and recording retain the settings, format, preset, and design draft.
Restoring a historical result does not silently switch the active engine. Older
data without optional metadata remains readable.

## Files and checks

- `scripts/runtime/app/integration_settings.py`: source contract discovery.
- `src/lib/tts/speech-settings.ts`: validation and serialization.
- `src/lib/tts/AdvancedSpeechSettings.svelte`: controls.
- `src/lib/playback/audio.ts`: PCM/float decoding and joining.
- `src/App.svelte`, `src/lib/data.ts`: generation, persistence, and restoration.

Regression checks: `node tests/frontend/speech-settings-check.mjs`,
`node tests/frontend/wav-format-check.mjs`, and
`node tests/frontend/speech-app-contract-check.mjs`.
Procedural WAV tests do not require voice cloning and do not validate TTS.
See [model parameters](tts-parameters.md) and [model terms](model-licenses.md).
