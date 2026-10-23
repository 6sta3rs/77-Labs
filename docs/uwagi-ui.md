# UI and component feedback

A living list of the user's interface feedback. Each item gets a number, an analysis (where in the code, the cause, a proposal), and a status. Decisions that apply to the whole application go in the "Rules" section. Component gallery: `/inputy.html`.

## How to report

A screenshot and one sentence are enough: what is wrong and how it should be. The agent adds the item here, analyzes the cause in the code, and proposes a fix. It implements after approval or when the fix is obvious.

Statuses: **new** -> **analysis** -> **to decide** -> **done** (with a commit) or **rejected** (with a reason).

## Rules (agreed with the user)

1. **Minimalism.** No decorative icon tiles in frames, no duplicated actions (one action = one button).
2. **No native browser controls** on screens: `<audio controls>`, `<video controls>`, visible `<input type=file>`, `type=number` spinners, `confirm()`. Always a component from `src/lib/ui/`.
3. **Icon button background on hover only.** A helper button (e.g. "+") is transparent; the background appears on hover.
4. **Focus outline only for keyboard navigation** (Tab, arrows). Clicking and typing do not draw an outline.
5. **Look and feel reference: shadcn / Base UI.** When fixing a component, compare it with the shadcn documentation. A selection in lists is a check mark, not a filled background.
6. **Sparing animation, no shrinking on click.** Fields, lists, collapsible sections, and ordinary buttons do not change size on click (UI-025, UI-029). Allowed: smooth color change, height expansion, list cross-fade (<= 300 ms, none under reduced motion). Shrinking the `Button` component is UI-030.
7. **Small window = mobile layout.** Side panels slide in from the bottom and the buttons that open them are at the bottom.
8. **Progress always visible.** Long operations show a bar, percentage, time, and a message about the stage, including "loading the model".
9. **The `/inputy.html` gallery is the source of truth.** A new or changed component goes there with its states (default, disabled, error, empty).
10. The interface and messages are in Polish, without raw technical errors.
11. **No small control sizes.** The smallest field size is `default`; variants below it (`sm`, `compact`, `xs`) are removed instead of used (UI-026).

## Open

| # | Where | Feedback | Analysis / proposal | Status |
|---|---|---|---|---|
| UI-010 | Voices | Remove the voice "Nowa narracja" ("New narration") | In the code this is the default project name, not a voice. If it is a library profile, it lives in the private database. A screenshot showing where it appears is needed. | to decide |
| UI-011 | Voices | A test voice for cloning | Proposal: a public-domain sample (e.g. LibriVox, Polish). Needs permission to download. | to decide |
| UI-019 | Audiobook | Reading tracking is estimated from time | Now uses measured per-portion durations and word-length weights (`read-along.ts`); exact word times still need engine word timestamps (faster-whisper `word_timestamps`). | partly done |
| UI-027 | Forms | Is the default field height of 32 px OK? Input/Textarea also have small sizes (`sm` 26 px, `compact` 28 px) | Evaluate after UI-026: possibly a 36 px default like shadcn (`h-9`) and remove `sm`/`compact` from Input/Textarea too. | to decide |
| UI-030 | Action buttons (`Button`) | `Button` has long had `scale .97` on click (e.g. "Wygeneruj mowę" / "Generate speech") | Remove for consistency with UI-025/029, or keep it only for action buttons. | to decide |
| UI-034 | Language lists | Flags only for 62 languages, the rest show a globe; rare languages have English names | Pull more flags from circle-flags (`flags/language`, MIT, with provenance) and possibly Polish names; many minority languages have no flag. Needs permission to download assets. | to decide |

## Done

| # | Feedback | Solution |
|---|---|---|
| UI-013 | 12x system `confirm()` | `ConfirmDialog` + `confirmDialog()` replace all native `confirm()` |
| UI-014 | Number fields with browser arrows, no Checkbox component | Raw number inputs use `Input type=number` (no arrows); new `Checkbox` |
| UI-015 | One toast per 6 s, errors disappear | One typed toast queue for the whole app; errors stay until dismissed, `role="alert"` |
| UI-016 | Raw technical errors in messages | `userMessage(error, fallback)` at the main catch sites (other sites still to migrate) |
| UI-017 | Grayed-out "Generuj" / "Zatrzymaj" ("Generate" / "Stop") without explanation | `ActionBar` shows the reason when "Generuj" is disabled |
| UI-018 | No download speed or ETA, no global indicator | Speed and ETA in download rows plus a global header indicator; polling only while a job is active |
| UI-020 | No bottom drawer in `/inputy.html` | `Drawer` component and gallery sections for it and for `Checkbox` |
| UI-021 | No automatic guard for rule 2 | `tests/frontend/ui-rules.mjs` in `test:ui` |
| UI-037 | Dubbing and tools still have native `<video controls>` (3 places) | `VideoCard` replaces the three native `<video controls>` |
| UI-001 | The "Pierwsze kroki" ("First steps") window returns despite acceptance; decorative icon tile | The window opens only when the engine reports unaccepted terms; tile removed |
| UI-002 | Background under "+" at Voices always visible | Background on hover only |
| UI-003 | X and trash next to a speaker do the same thing | One X; Ctrl+Z undoes |
| UI-004 | The +/-10 s buttons are too small | 26 px icon, 9 px digit |
| UI-005 | Settings panel on a small screen | Buttons at the bottom, panel slides in from the bottom with dragging |
| UI-006 | No click animations | Press scale 0.97, shared progress bar style (superseded by UI-029) |
| UI-007 | No cloning tab in Tools | "Klonowanie głosu" ("Voice cloning") in Tools |
| UI-008 | Audiobook: 3 voices, no progress, PDF junk, no reading tracking | Required narrator, part progress with ETA, "Uporządkuj tekst AI" ("Tidy text with AI"), window with the fragment being read |
| UI-009 | Blue outline after a click everywhere | Outline only for keyboard navigation |
| UI-022 | Native "Choose file / No file chosen" | `FilePicker` component in 8 places |
| UI-023 | Gallery like documentation | Component list on the left, demos in one column |
| UI-024 | Select differs from shadcn | Check mark instead of a background, keyboard without an outline, animation, group separator |
| UI-025 | Select: dislike of the click animation | Removed the shrinking of the list button and the enlargement of the dropdown; only the cross-fade remains |
| UI-026 | Select: `sm` and smaller sizes unacceptable, `default` small but tolerated | Removed `xs`/`compact`/`sm` (unused in the app); `default` 32 px and `lg` 36 px remain |
| UI-028 | Studio panel: sections "Język" ("Language"), "Efekty audio" ("Audio effects"), etc. | A section with a list expanded without animation while the slider collapsed smoothly; `InspectorSection` now uses the same height animation (grid 0fr<->1fr) and arrow rotation as the slider; gallery: section 20 "Sekcja zwijana" ("Collapsible section") |
| UI-029 | Collapsible "Język" section | Removed the global shrinking of all ordinary buttons (Play too); smooth color changes remain |
| UI-031 | File picker | The button should be the same size as ordinary buttons: `FilePicker` is always `default` (32 px, like `Button`); smaller sizes removed |
| UI-032 | Gallery, narration editor | Remove the "Automatyczne pauzy" ("Automatic pauses") / "Odtwórz przykład" ("Play example") buttons under the editor: removed the `ActionBar` demo from section 08 (the bar still works in Studio) |
| UI-033 | Gallery, form | The "form language" should list all of the model's languages with flags: the full pinned OmniVoice language map (640 codes after merging aliases) through `engineLanguageOptions()`: a "Popularne" ("Popular") group (62, Polish names, flags) and "Pozostałe (578)" ("Other (578)") (globe, often an English name) |
| UI-035 | Theme cards and editor | Color names should match what the app has: the editor shows only the 31 colors the app really uses, each with a Polish name of its place in the UI (e.g. "Przycisk główny (np. Wygeneruj mowę)" - "Primary button (e.g. Generate speech)"); 30 roles with no effect on the app stay in the JSON but are hidden |
| UI-012 / UI-036 | Audio across the app | A waveform card everywhere instead of native `<audio controls>`; bar animation while loading; progress jumps: new `AudioPreview` (the same card as Studio recordings, waveform computed from the file, one player at a time) in 13 places; bars "breathe" while loading and generating; progress updated every frame during playback (also in `Player`) with `timeupdate` as a fallback |
| UI-038 | Voice orb, the former third-party-style variant: rename, same color as other orbs, color choice, behave like the others | The variant is named "Płyn" ("Fluid"); always tinted by the orb palette; a new "Kolor kuli" ("Orb color") setting (From voice + 7 palettes) in Settings -> Appearance and in the gallery; the "Płyn" orb animates like the others in the gallery |
| UI-039 | Studio player | The +/-10 s icons are too small and asymmetric; the Play button should look like the example (ready / loading) | A custom `SkipIcon` (arc with an arrow plus "10" in one 22 px icon, mirrored, center +/-0.15 px) in 36 px round buttons; Play 40 px in the text color with a dark icon, in loading a gray circle with a ring. No third-party SVG paths were copied |
| UI-040 | Language select list (640 items) | The list opens detached from the field, above the previous section | With a deeply placed selected option the computed top of the list fell off screen and was only clipped. Now the list scrolls to the option and itself stays above the field; the selected option covers the field (0 px) at every screen height, accounting for the scroll-arrow strips |
| UI-041 | "Nowe nagranie" ("New recording") card (generation) | Gaps between the wavy bars too large compared to a normal waveform; unnecessary progress bar at the bottom | Placeholder bars have the dimensions of a real waveform (3.5 px, 2 px gap) and fill the width; removed the bar at the bottom of the card (the percentage, if the engine reports it, stays in the status text) |
| UI-042 | Filters (FilterChip) | Pill-style filter look | 24 px pill, 8 px radius, 12 px text; inactive transparent with gray text, active inverted (background in the text color); one "+" icon rotates 45 degrees into "x" (200 ms); value after a vertical bar, flag for languages |
| UI-043 | Recording card (loading) | "Generation 2" pattern: white Play button, waveform, loading indicator on the right | The Play button in the card is a white 32 px circle with a Play/Pause icon (no indicator inside); while loading and generating, a spinning indicator on the right replaces the time, star, restore, and download |
