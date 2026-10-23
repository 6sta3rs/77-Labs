# Shared controls

Seventy Seven Labs uses a shared set of inputs, selects, switches, buttons, and
overlays. Interaction behavior is implemented for Svelte and the voice studio.
Imported style origins, revisions, copyright, and licenses are recorded in
[third-party notices](../../THIRD_PARTY_NOTICES.md); the original license text
remains in [LICENSE-T3](../../src/lib/themes/LICENSE-T3).

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
| Input roles and geometry | `src/lib/styles/ui.css` |
| Palette colors | `src/lib/settings/appearance.ts`, `src/lib/styles/ui-colors.ts` |
| Portal, positioning, and dismissal | `src/lib/ui/overlay.ts` |
| Popup surfaces | `src/lib/ui/overlays.css` |
| Focus intent | `src/lib/styles/focus-intent.ts`, `src/lib/ui/focus-intent.css` |

Checks: `npm run check`, `npm run build`, and the relevant regression checks in
`npm run test:ui`. Separately check actual keyboard use, focus restoration,
contrast, and reduced motion. The [component gallery](podglad-kontrolek.md)
describes the examples. The gallery alone does not validate ML workflows.
