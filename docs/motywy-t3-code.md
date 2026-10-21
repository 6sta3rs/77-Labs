# T3 Code themes and palettes

The palettes come from `pingdotgg/t3code`,
[themePalettes.ts at the pinned revision](https://github.com/pingdotgg/t3code/blob/86534db4d3525a070589a234d660a3e0373a42ea/packages/shared/src/themePalettes.ts).
Copyright (c) 2026 T3 Tools Inc.; MIT license, with the complete text in
[LICENSE-T3](../src/lib/themes/LICENSE-T3).

## Behavior

Studio offers T3 Code, Ocean, Grove, Ember, Iris, and T3 Chat in light and dark
variants. `src/lib/themes/t3-palettes.ts` preserves the source values, while
`appearance.ts` maps them to interface roles. Contrast settings can change the
resulting borders. Thumbnails use the actual palettes.

**System** mode reads the system color scheme and selects separate assignments for
light and dark appearance. The dots on a theme card assign its variant to the
corresponding mode; clicking the card name assigns the available variants.
The older `studio` and `rose` identifiers preserve settings compatibility.

Custom themes can be created, duplicated, edited, exported, and imported as
T3 Code v1 JSON. Imports have a 256 KB limit and validate color roles. Deletion
requires confirmation; deleting the active theme restores the appropriate default
palette. A corrupt local library blocks writes to preserve data that may still be
recoverable. There is no synchronization with T3 Code or online gallery.

## Where to make changes

- `src/lib/Appearance.svelte`: cards, assignments, and settings.
- `src/lib/ThemeDialog.svelte`: editor and imports.
- `src/lib/themes/library.ts`: format, validation, and local library.
- `src/lib/appearance.ts`: applying palettes and saving preferences.

The library uses localStorage `voicestudio.themes.v1`; preferences use
`voicestudio.appearance.v2`. Test in a separate profile to avoid changing your
own settings. See the [component gallery](podglad-kontrolek.md)
and [third-party notices](../THIRD_PARTY_NOTICES.md).
