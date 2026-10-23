# Settings pages: style conventions

Settings has 12 pages in 4 groups (`frontend/src/settings/settings-catalog.ts`); each page is `frontend/src/settings/pages/<Name>Page.svelte`, routed in `frontend/src/App.svelte`. Reference page: `EnginePage.svelte`. Shared pieces: `frontend/src/settings/settings-page.css` (global `p-` classes, imported in `main.ts`), `frontend/src/ui/StatusBadge.svelte`, `frontend/src/ui/toast.ts` + `Toaster.svelte`, `frontend/src/ui/ProviderIcon.svelte`. The approved prototype these rules come from was reviewed with the owner on 2026-10-22.

## Skeleton
```svelte
<div class="p-page">
  <div class="page-heading"><div><h1>Nazwa strony</h1><p>Jedno zdanie, po co ta strona.</p></div></div>
  <section class="p-card"> <div class="p-section"><header><h3>Tytuł</h3><p>Jedna linia.</p></header> … </div> </section>
</div>
```
- Title `h1` plus one-line lead. No paragraph walls, no marketing text; details live in row descriptions.
- Sections inside one `p-card` are separated by hairlines (`p-section`); header with a right-side action: `<header class="split">`.
- Never `<details>`/collapsible sections. Hide things only when the state makes them irrelevant (e.g. engine stopped).
- Tabs only when the page has 3+ independent areas that would not fit one screen: real markup `<div class="filter-tabs p-tabs" role="tablist"><button role="tab" aria-selected class:chosen>`; render only the active tab's content. Otherwise plain sections.
- The Engine page has five tabs: Stan, Uruchamianie i pamięć, Obliczenia, Środowiska, Dzienniki i diagnostyka. App-side launch choices (autostart, model preload, idle time) live in „Uruchamianie i pamięć” and are usable while the engine is stopped; rows that need the engine are disabled or hidden there. A value that could not be read is named in a `p-notice warn` ("Nie odczytano: …") with a „Spróbuj ponownie” button instead of silently dropping its row.

## Setting row (`p-rows` > `p-row`)
`<div class="p-row"><div class="t"><b>Tytuł</b><span>Jedna krótka linia opisu.</span></div> control </div>`
Control on the right: Select, Switch, ButtonGroup, Input, Button. Several controls: wrap them in a `display:flex;gap:8px` div. Row without hairline: `p-row flat`.

## Other classes
`p-actions` (button row), `p-notice [ok|bad|warn|info]` (persistent state only, see Notifications), `p-kv` (`dl > div > dt + dd`, tabular numbers), `p-bar` (flat 4px; `<progress class="p-bar">` or `<div class="p-bar"><i style:width>`; `.hi`/`.vhi` = warn/danger), `p-progress` (progress + caption row), `p-confirm`, `p-sticky-hdr` (blurred sticky card), `p-h2/p-h3/p-sub`.

## StatusBadge
`<StatusBadge kind="ok|warn|bad|wait|neutral" text="Gotowe"/>`. ok = success, warn/wait = amber, bad = red, neutral = muted without icon. Status only, never a button. Tab counts: `compact` (numbers get no icon). Text sentence case, short ("Aktualne", "Czeka na restart", "Błąd"). Do not copy badge CSS.

## Colour and states
- Progress, loading, spinners: accent blue (`--accent`).
- Stop / delete / reset: outline `Button` first; red `variant="destructive"` only for the confirming step, never `confirm()`: either a `p-confirm` block, or the button turns into "Potwierdź …" (destructive) for 4 s (see `arm()` in EnginePage).
- Buttons that belong together sit directly next to each other (normal 8px gap) in `p-actions`. Status or feedback ("Zapisano", a result) is rendered AFTER the last button, only while visible (`{#if}`, never `visibility:hidden` / opacity 0, so it reserves no width), left-aligned after the group. In a setting row the right-aligned control keeps its edge and feedback goes to its left.
- A disabled primary button is neutral outline-disabled (transparent, muted text; `settings-page.css`), never a dimmed blue fill.
- Saved feedback: a short green "Zapisano" (`<span class="saved on">`, shown for ~2 s) next to the control that was clicked; a switch says only "Zapisano" (restart or side-effect info belongs in the row description, not in the message). Whole-form results ("Zapisano. Nowe połączenia użyją serwera proxy.") are toasts. Pending restart: `wait` badge.
- Tokens only: `--surface --border --muted --foreground --accent --success --danger --ui-text-N`; amber is `--settings-warn` . No raw colours.

## Notifications
- Result of a click (test, check, save, backup, update check) = toast: `import { toast } from '../../ui/toast'`, `toast.ok|bad|warn|info(msg)`. `Toaster` is mounted once in `App.svelte`; never add a per-page toast. Pass translated text: `toast.ok(tr("Zapisano"))`.
- Kinds: ok green (`--success`), bad red (`--danger`), warn amber (`--settings-warn`), info neutral muted. Tokens only: icon + 1px border + 12% tint.
- Dismiss: ok/info 4 s, warn 6 s, bad stays until closed (X, `role="alert"`); hover pauses the timer. Max 3 visible, bottom centre.
- Inline `p-notice [ok|bad|warn|info]` only for a persistent state (engine stopped, pending restart, subscription policy), never for a click result.
- Field validation: `<p class="p-field-err" role="alert">` directly under the field. Copy: the button itself says "Skopiowano" for ~2 s. Tiny "Zapisano" next to a control: `<span class="saved">` (green, check added by `settings-page.css`).

## Button hierarchy
Dark outline buttons on dark cards guide nothing, so every action has a role (real `Button`, no custom buttons):
- **Filled blue** (`Button` default, `--primary`): the ONE main apply / save / connect / add / run action of a section or state ("Zapisz klucz", "Dodaj dostawcę", "Pobierz", "Sprawdź system", "Zapisz ustawienia", manual-model "Użyj"). Max one visible per section; if a section has two candidates, the secondary one steps back to outline (see `otherPrimary` in AiPage). Repeated rows (providers, models) keep blue only for the step that moves the row forward ("Pobierz", "Wznów"); "Użyj" / "Sprawdź i aktywuj" are outline.
- **Filled white** (`<Button variant="light">`, `settings-page.css`): finishing or closing an inline editor / panel ("Gotowe", "Zamknij").
- **Outline**: secondary neutral actions ("Odśwież", "Kopiuj", "Zmień", "Testuj", "Anuluj", "Zatrzymaj" before confirming).
- **Ghost**: tertiary, text-like actions and links ("Edytuj", "Wpisz model ręcznie", "Przejdź do …").
- **Destructive red**: only the confirmed destructive step ("Potwierdź usunięcie").
- Disabled stays calm and flat (above). A page that only reads (General, Appearance) may have no blue button; every other section/state that needs an action has its primary filled.
- Nested boxes (inline editors, result panels) use `--surface-raised` with the hairline border, never `--background` (darker than the card). Code / log wells stay recessed. Muted body text must stay at least 4.5:1; if not, `color-mix(in srgb, var(--foreground) 62%, transparent)`.

## No custom controls
Do not invent controls the app already has: segmented choice = ButtonGroup, dropdown = Select, tabs = `.filter-tabs`, toggle = Switch, text = Input, key caps = plain `<kbd>` (app style: `--surface`, 1px `--border`, radius 4px).
**Models** in a list row (an AI function, tagging) are a plain status, not a select: provider icon + `Dostawca · model` (`.mstat` in `AiPage.svelte`), cut with "…" at the maximum width with the full name in the tooltip, followed by an outline "Zmień" button and the row's Switch. "Zmień" is hidden while the function is turned off (the status then reads "Wyłączona"). "Zmień" opens a darker inline area under the row (`--surface-raised`, hairline border) and turns into a white "Gotowe" (`variant="light"`). The area holds the "Domyślny | Własny" ButtonGroup, the only marker of the mode: "Domyślny" shows nothing more; "Własny" shows ONE model list across all connected providers (`pages/ModelPicker.svelte`, the app's `.vs-select-trigger` with provider icon + name, provider headers with icons in the popup) and a ghost "Wpisz model ręcznie", which replaces the list in the same slot with a provider Select (icon + name), the id Input and a blue "Użyj"; all controls are 32 px. Only the page-level "Domyślny model" uses the picker directly (50/50 row: description left, picker right).

## Components
Use the real ones from `frontend/src/ui`: Button (`variant` default|outline|ghost|secondary|destructive), ButtonGroup (`label`, `items`, `mode`, `value`, `onchange`), Select (`ariaLabel`, `value`, `options`, `onchange`), Switch (`label`, `checked`), Input, Slider, FilePicker, Tooltip, Textarea. Lucide icons size 15 in buttons. Always give controls an aria-label.

## Copy and data
- UI text in Polish, sentence case ("Zapisz zmiany", not "Zapisz Zmiany"). One short line per setting description; say what it does or when to change it.
- Description measure: `settings-page.css` limits section header text, row descriptions (`.p-row .t > span`) and `.p-sub` to `max-width:64ch`; `.p-notice` boxes keep the full width. Do not set widths on descriptions in page CSS.
- A section header carries one line at most. Information about a single row (what a button does, a limit, a restart) goes into that row's description, not into a standalone `<p>` under the section header.
- Real data only: every value comes from the engine, Tauri, or local settings. When the engine is stopped, show one notice for the page and hide what the state makes irrelevant; never show invented numbers.
- Empty states: no box-in-box. One lead line in the card header, then the actions row (and starter tiles) straight in the card; no dashed inner container, no second heading.
