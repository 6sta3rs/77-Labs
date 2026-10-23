# Windows dictation and the floating window

The global shortcut and pasting into other applications are disabled by default.
Opening the widget alone does not start the microphone, a model, or Python.

## User workflow

1. In **Ustawienia → Skróty i mikrofon → Dyktowanie w innych oknach** (Settings →
   Shortcuts and microphone → Dictation in other windows), choose a key combination
   and explicitly enable the shortcut. A conflict with another application produces an error and preserves
   the previous binding.
2. The shortcut shows or hides the floating window. Holding the keys should not
   toggle the view repeatedly.
3. **Wczytaj modele bez nagrywania** ("Load models without recording") prepares
   the engine. Only **Rozpocznij dyktowanie** ("Start dictation") requests microphone
   access and starts a session.
4. **Zatrzymaj i zakończ** ("Stop and finish") waits for the final result.
   Cancelling or hiding the window stops recording. The text remains editable.
5. **Kopiuj tekst** ("Copy text") copies the text to the clipboard. Pasting requires
   a separate opt-in and a click with a specified target.

## Window, runtime lease, and target

The widget has its own local WebView. It uses the shared `LiveDictation` and
AudioWorklet implementation and holds its own lease on the runtime supervisor.
Hiding, closing, or exiting releases only the widget's leases. If a hidden view
does not confirm that it has stopped, that WebView is destroyed; text held only
in memory may be lost.

Pasting does not happen automatically after recognition. The target is captured
when the widget is invoked by the shortcut from another process and is checked
again before sending Ctrl+V. Windows may refuse a focus change or input into an
application running with higher privileges. The code does not bypass these
restrictions; the text can be pasted manually. Sending keystrokes alone does not
prove that the target application accepted the text.

## Where to make changes

- `src-tauri/src/dictation_desktop.rs`: shortcut, widget, target, and leases.
- `src/lib/tools/dictation/dictation-desktop.ts`: IPC and session lifecycle.
- `src/lib/settings/pages/ShortcutsPage.svelte`: explicit settings and microphone access.
- `src/lib/tools/dictation/DictationWidget.svelte`: text, Start/Stop, and copying.
- `src/lib/tools/dictation/dictation.ts`, `src/lib/tools/dictation/dictation-worklet.js`: PCM transport.

Checks: `node tests/frontend/dictation-desktop-check.mjs`
and `cargo test --locked --manifest-path src-tauri/Cargo.toml dictation_desktop::tests`.
Contract tests do not replace testing with a physical microphone and the running
EXE. Test pasting only in a controlled test window you own.
See [verification](../verification/weryfikacja.md) and [privacy](../../SECURITY.md).
