# Optional transcript refinement

In **Mowa na tekst** ("Speech to text"), **Poproś LLM o redakcję po rozpoznaniu**
("Ask an LLM to refine the transcript after recognition") is off by default.
It applies to the next request and uses the previously configured provider.
It may send text outside the computer and consume that service's quota; it does
not choose a provider for the user.

## Applying and reverting

The original recognition result and the suggestion are shown separately.
**Użyj redakcji w TXT i edytorze** ("Use the refinement in TXT and the editor")
selects the suggestion for the downloaded TXT and the **Otwórz w edytorze**
("Open in editor") action. It does not overwrite a manually edited transcript or
its segments. **Cofnij użycie redakcji** ("Undo use of the refinement") restores
their current version, preserving manual corrections.

SRT and VTT always use the segments and their timestamps. The LLM suggestion has
no alignment and is not automatically split into subtitles. Further edits to the
suggestion can be made after explicitly opening it in the narration editor.

## State and limitations

The backend returns `refined_text` when refinement changes the text. A missing
field may mean no change, disabled refinement, or an unavailable LLM. The UI keeps
the original and does not assign another request's status to this recording.
The original, suggestion, and decision can be saved in local history; older
results without them are supported.

## Where to make changes

- `src/lib/platform/api.ts`: the `refine` field and transcription response.
- `src/lib/tools/transcription/transcription.ts`: normalization, history, and TXT text selection.
- `src/lib/tools/transcription/TranscriptionWorkspace.svelte`: comparison and applying the suggestion.

Regression checks: `node tests/frontend/transcription-refinement-check.mjs`
and `node tests/frontend/transcription-check.mjs`. A transport test with a fixture does
not validate ASR or an external LLM response. Acceptance checks should cover Polish
characters, manual corrections, reverting, TXT/SRT/VTT, and reopening results.
See [verification](../verification/verification.md) and [privacy](../../SECURITY.md).
