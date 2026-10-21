# Updating the engine source

The backend is pinned in `scripts/runtime/engine.zip`. The adjacent
`engine-provenance.json` records its source, version, upstream commit and
individual file hashes. A version number alone does not identify the contents.

## Preparing the source

`scripts/runtime/bundle.py` reads the selected commit through `git archive`,
without importing the backend. Write a candidate to a separate directory
instead of overwriting the active ZIP. For example, with your own upstream checkout:

```powershell
python scripts/runtime/bundle.py .tmp/upstream --commit <full-upstream-SHA> --version <version> --output .tmp/engine-candidate/engine.zip
python scripts/runtime/check_engine_candidate.py --current scripts/runtime/engine.zip --candidate .tmp/engine-candidate/engine.zip --report .tmp/engine-candidate/report.json --prepare
python -m unittest discover -s scripts/runtime -p test_engine_bundle.py -v
```

The archive must retain the resources required at startup, migrations,
configuration, lockfile and original notices. A static comparison does not prove
that synthesis works. After changing the backend, verify the adapters and UI
parameters again.

## Selecting a complete runtime generation

The launcher publishes each new version to a separate
`runtime/engines/engine-<SHA>-...` directory. It validates the archive, prepares
the source and checks completeness before atomically writing the small selection
pointer. It does not overwrite files already loaded on Windows. If the contract
for disabling automatic preload is unknown, preparation stops.

A [consistent backup](kopie-danych-runtime.md) is created before existing data
is migrated. A backup failure must stop startup. Install new dependencies in a
separate environment without changing shared libraries or models.

## Acceptance checks and rollback

1. Finish running tasks and stop only the backend process you own.
2. Keep the previous package, manifest, configuration and a complete data backup.
3. Run the candidate in an isolated runtime with a copy of the data first.
4. Check migrations, the process ownership marker, startup and shutdown, and the
   required workflows: saving a project, TTS, ASR, downloading output and any
   features affected by the change.
5. Build and run the EXE with the same set of ZIP, manifest and adapters.

Restoring an older ZIP does not undo database migrations. An older backend needs
a compatible data backup; also preserve any data created during the trial.
Removing unused runtime generations is a separate operation. See the
[runtime guide](runtime.md), [verification status](weryfikacja.md) and
[contribution guidelines](../CONTRIBUTING.md).
