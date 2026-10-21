# Shared controls

The basic dimensions and states of inputs, selects, and switches adapt styles from
[T3 Code](https://github.com/pingdotgg/t3code/tree/89424d9fa01c6bd24664315c7ccda8d6cb1eab61/apps/web/src/components/ui).
Copyright (c) 2026 T3 Tools Inc.; [MIT license](../src/lib/themes/LICENSE-T3).
Interaction behavior is adapted to Svelte and the voice studio.

## Component contract

- Input and Textarea use consistent background, border, error, readonly, and disabled roles.
- Select uses a portal and viewport-relative positioning. It supports arrow keys,
  Home/End, Enter/Space, Escape, Tab, and prefix search.
- Slider remains a native range input; it displays its value and supports the
  keyboard, a collapsible variant, and reduced motion.
- Switch separates its semantic ON state from neutral selection in lists.
- Button provides shared variants for actions, icons, download links, and import labels.
- Modals and popups restore focus; closing content should not receive keyboard
  input. Surface styling and blur have a single owner.

## Where to make changes

| Area | File or directory |
| --- | --- |
| Component implementations | `src/lib/ui/` |
| Input roles and geometry | `src/lib/ui.css` |
| Palette colors | `src/lib/appearance.ts`, `src/lib/ui-colors.ts` |
| Portal, positioning, and dismissal | `src/lib/ui/overlay.ts` |
| Popup surfaces | `src/lib/ui/overlays.css` |
| Focus intent | `src/lib/focus-intent.ts`, `src/lib/ui/focus-intent.css` |

Checks: `npm run check`, `npm run build`, and the relevant regression checks in
`npm run test:ui`. Separately check actual keyboard use, focus restoration,
contrast, and reduced motion. The [component gallery](podglad-kontrolek.md)
describes the examples. The gallery alone does not validate ML workflows.
