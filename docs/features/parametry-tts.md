# Speech synthesis parameters

`AdvancedSpeechSettings.svelte` displays options for the selected adapter, while
`speech-settings.ts` validates and serializes them into a multipart `/generate`
request. Speed, steps, and seed remain the basic generation settings.

## Engine capabilities

The client has an explicit map of exact adapter identifiers. It does not infer
parameter support from a model name or an emotion flag alone. The map must be
checked again whenever the backend archive changes.

| Adapter | Additional fields |
| --- | --- |
| OmniVoice and its subprocess variant | Instruction, guidance, t-shift, denoising, postprocessing, layer penalty, and temperatures. |
| OmniVoice GGUF | Instruction and denoising. |
| VoxCPM2 | Instruction and guidance. |
| CosyVoice | Instruction with a confirmed reference. |
| Adapter without a verified mapping | No additional model controls. |

Shared fields include chunk length, crossfade, and the pronunciation dictionary.
A chunk length of 0 disables splitting. An empty numeric override preserves the
engine setting. Validation rejects NaN, infinity, invalid ranges, and a zero
t-shift. Hidden fields are omitted from requests after a model change.
OmniVoice instructions have their own taxonomy, separate from the free-form
descriptions used by other engines.

WAV settings, built-in voices, and the voice design draft require discovery of the
actual source contract: [WAV, preset, and design parameters](parametry-wav-0.5.7.md).
For multiple speakers, engine metadata and settings are frozen at the start of the
job so UI changes cannot alter later blocks of an ongoing generation.

## Streaming versus a completed WAV

The backend may support `stream=true` as NDJSON with start/chunk/done/error frames.
A client expecting a completed WAV Blob must not receive that stream. HTTP 200 does
not prove completion if a later frame contains an error.
Audiobook listening uses a separate [chunk queue](audiobook-porcjami.md).

Regression check without models: `node tests/frontend/speech-settings-check.mjs`.
Type checking, a build, and serialization tests do not validate how these
parameters sound; a separate acceptance check on the selected model is required.
