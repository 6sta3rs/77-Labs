# Safe interface preview

After `npm ci` and `npm run dev`, open http://127.0.0.1:4310/?demo=tts.

Voices, dialogues, models, projects, and history are fictional data from `src/lib/tts-demo.ts`, held in memory. The engine's voice library is not copied. README screenshots were captured in this mode using a separate browser profile.

All cards use `public/demo/interface-tone.wav`: 3.43 seconds, mono PCM16, 24 kHz. The file is a procedural sum of 220 and 440 Hz sine waves with an amplitude envelope. It contains no human voice, requires no model, and does not represent the sound of the fictional profiles.

The tone supports metadata, play/pause, seeking, download, and visualization checks. It is not a TTS quality, ASR, or cloning test; supply your own speech reference outside Git.

Generator: `python scripts/generate_demo_tone.py`. Media check: `python scripts/publication_check.py`.
