<a id="t3-code-themes-and-palettes"></a>

# Labs themes and palettes

Seventy Seven Labs provides light and dark palettes, separate assignments for
each appearance mode, and a local custom theme library. Imported palette
origins, revisions, copyright, and licenses are recorded in
[third-party notices](../../THIRD_PARTY_NOTICES.md). The complete original license
remains in [LICENSE-T3](../../frontend/src/themes/LICENSE-T3).

## Behavior

Studio offers Labs, Ocean, Grove, Ember, Iris, and **Róża** (Rose) in light and dark
variants. `frontend/src/themes/t3-palettes.ts` preserves the bundled palette values, while
`appearance.ts` maps them to interface roles. Contrast settings can change the
resulting borders. Thumbnails use the actual palettes.

**System** mode reads the system color scheme and selects separate assignments for
light and dark appearance. The dots on a theme card assign its variant to the
corresponding mode; clicking the card name assigns the available variants.
The older `studio` and `rose` identifiers preserve settings compatibility.

Custom themes can be created, duplicated, edited, exported, and imported as
theme JSON v1. Imports have a 256 KB limit and validate color roles. Deletion
requires confirmation; deleting the active theme restores the appropriate default
palette. A corrupt local library blocks writes to preserve data that may still be
recoverable. There is no online synchronization or gallery.

## Where to make changes

- `frontend/src/settings/Appearance.svelte`: cards, assignments, and settings.
- `frontend/src/settings/ThemeDialog.svelte`: editor and imports.
- `frontend/src/themes/library.ts`: format, validation, and local library.
- `frontend/src/settings/appearance.ts`: applying palettes and saving preferences.

The library uses localStorage `voicestudio.themes.v1`; preferences use
`voicestudio.appearance.v2`. Test in a separate profile to avoid changing your
own settings. See the [component gallery](controls-preview.md)
and [third-party notices](../../THIRD_PARTY_NOTICES.md).
