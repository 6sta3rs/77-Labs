# Voice orb style „Płyn” (ElevenLabs homepage material)

**Płyn** (`landing` in code; saved as `elevenlabs` in older settings) is the fifth voice-orb style in **Wygląd → Kula głosu**. It is a gradient disc with a static grain overlay and a flowing, audio-driven surface. The other four styles (Oryginalna, Spokojna, Burza, Intonacja) use the project's own procedural shader.

## Origin

The look is adapted from the orb on the ElevenLabs homepage (captured 2026-10-20): the fragment shader, the audio-driven fluid pass, and three decorative images. The audio feed follows the source analyser (FFT 256, smoothing 0.8; low 0–200 Hz, mid 200–2000 Hz, high 2000–20000 Hz, all).

> **Licensing.** ElevenLabs published no redistribution terms for these materials. They are included at the maintainer's decision (2026-10-22). Treat them as third-party material: before wider redistribution, confirm the rights or remove the style (see below).

## Files

| File | Role |
| --- | --- |
| `src/lib/playback/landing-orb.frag` | Adapted source fragment shader (WebGL1) |
| `src/lib/playback/landing-fluid.ts` | Fluid pass ported without the original OGL renderer |
| `src/lib/playback/landing-orb.ts` | Lazy module: shader, images, uniform defaults |
| `src/lib/assets/landing-orb/` | The three images below |
| `src/lib/playback/voice-orb.ts`, `shared-voice-orb.ts`, `VoiceOrb.svelte` | Renderer branch, shared clock and loading/fallback |

| Image | Original address | SHA-256 |
| --- | --- | --- |
| `gradient.webp` | `eleven-public-cdn.elevenlabs.io/marketing_website/_next/static/media/creative-1.18030cd4.webp` | `fcff6d1510b708049304f57f15eabf80d502dd95c6addcabc88175bde9f91f5f` |
| `fallback.png` | `…/creative-1.be8a6b68.png` | `c8be88e35e1c9b060304b92122049e79bec85318f43265e0a03248d3d566c229` |
| `noise.png` | `…/noise.24b8225d.png` | `0f83d492d1ea34b154424feea4508ac116b19425d26ca48b619533aaed0edada` |

## Behaviour

- The module and images load only when the style is selected; a normal start loads no textures.
- The shader renders in the colors of the chosen orb palette (**Z głosu** or a pinned one).
- If the images fail to load or WebGL is lost, the orb shows the local PNG with grain; a renderer created without textures falls back to the original procedural material.
- Reduced motion and off-screen presentations stop the clock.

## Removing the style

Delete the files above, the `landing` branches in the three renderer files, and the option in `src/lib/settings/Appearance.svelte`; keep `normalizeOrbVariant` mapping saved `elevenlabs`/`landing` to `original`. Update `THIRD_PARTY_NOTICES.md` and `docs/public-assets.json`.
