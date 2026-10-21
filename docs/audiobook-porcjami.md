# Listening to an audiobook while it renders

After preparing the plan and selecting **Generuj audiobook** ("Generate audiobook"),
the first completed chunk can appear in the player below the text. Later chunks
join the queue in order. When playback catches up with generation, the player
shows a waiting message. A manual pause remains in effect when another chunk arrives.

The seek bar covers the audio generated so far. Completion still produces a full
M4B or MP3 file; M4B preserves chapters. Final mastering may change the volume
compared with chunk playback. A model needs to load on first use, so immediate
playback is not guaranteed.

## Contract

The local adapter handles `/audiobook` and `/audiobook/resume/{id}` with the
`X-Next-Audiobook-Stream: 1` header. SSE `audio_chunk` events point to separate,
complete WAV files. They do not append bytes to an open M4B or MP3 file.
The original renderer continues to own license checks, jobs, history, and final output.

Resuming rebuilds the playback queue from the start using retained chunks; it does
not restore the local listening position. Decoder transitions may introduce a short
gap between chunks. A remote or older engine may provide only the completed file.
The chunk player and the ordinary preview should not play at the same time.

## Where to make changes

- `scripts/runtime/audiobook_streaming.py`: splitting, cache, and events.
- `src/lib/audiobook-playback.ts`: queue, pause, waiting, and seeking.
- `src/lib/AudiobookPlayer.svelte`: playback interface.
- `src/lib/ProductionWorkspace.svelte`: job handling and event delivery.
- `scripts/runtime/launcher.py`, `src-tauri/src/runtime.rs`: adapter integration.

Regression checks: `node scripts/audiobook-playback-check.mjs`
and `scripts/runtime/test_audiobook_streaming.py` in the appropriate environment.
A procedural WAV fixture does not validate voice quality, a long book, or the GPU
workflow. Cancellation and resuming, memory use, final output, and the running EXE
need separate acceptance checks.
See [verification](weryfikacja.md) and [runtime](runtime.md).
