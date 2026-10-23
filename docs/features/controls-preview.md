# Interface component gallery

Run `npm run dev` and open `http://127.0.0.1:4310/inputy.html`.
The `frontend/src/gallery.ts` entry point displays the studio's real Svelte components:
inputs, selects, sliders, switches, buttons, tooltips, theme cards, the editor,
filters, model selection, and audio examples. The interface labels are Polish.

## Data and behavior

Examples use their own in-memory state. Changing the palette, resetting examples,
or typing should not change private application projects, voices, or preferences.
Demonstration values such as stability or similarity illustrate controls; they do
not introduce new synthesis parameters.

Sliders support the keyboard and display their values. Select supports keyboard
selection and focus restoration. Expandable panels and popups respect reduced
motion; closed content cannot receive focus. Audio examples use an explicitly
synthetic demonstration signal, without a user's voice or a model.

## Where to make changes

- `frontend/src/gallery/ControlGallery.svelte`: layout and local example state.
- `frontend/src/ui/`, `frontend/src/styles/ui.css`: shared controls.
- `frontend/src/gallery/AudioExamples.svelte`: playback and orb material examples.
- `frontend/src/gallery.ts`, `inputy.html`: development entry point.
- `tools/preview/controls-preview.mjs`: optional standalone preview generator.

Generated HTML is an artifact, not a second source of components. Before sharing
it, check that its data is clean and that it reflects the current code.
The gallery is for checking appearance and interaction. It does not validate
synthesis, transcription, model installation, or readiness of the whole application.
See [shared controls](t3-controls.md), [themes](t3-code-themes.md),
and the [contribution guidelines](../../CONTRIBUTING.md).
