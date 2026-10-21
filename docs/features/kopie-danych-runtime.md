# Data backups before updates

`scripts/runtime/runtime_backup.py` creates a restore point for the private DATA
directory before importing the backend and running migrations for a new version.
The launcher supplies the SHA of the verified archive. A `BackupError` stops
startup before migration.

## What is backed up

The backup is created in `DATA/backups/backup-<UTC>-<SHA>-<id>/data`.
The database is read through the SQLite Backup API, including WAL contents, and
validated with `quick_check`. Copying only the open `.db` file is insufficient.
Related files in DATA are copied too: references, voices, portraits, recordings,
projects and settings. The manifest records file sizes and SHA-256 hashes.

Models, caches, environments and previous backups are excluded. The backup does
not include localStorage/IndexedDB from the WebView profile or arbitrary files
outside DATA. It is not a backup of the whole computer. It may contain sensitive
recordings and configuration; protect it as carefully as the source data.

## Consistency and progress

Available disk space is checked before startup. Files must remain stable while
being copied; links and incompatible paths are rejected. The complete manifest
and completion marker are written only at the end. A damaged marker or a missing
backup file blocks further startup. Interrupted backups remain available for
inspection.

`NEXT_BACKUP_EVENT` events describe the plan, database pages and bytes copied.
They are not replaced with an artificial percentage based on the number of
stages. Restarting the same package may reuse an existing verified backup instead
of creating another one.

## Restoring data

There is no automatic restoration or backup deletion. Before restoring data
manually, stop every process using DATA, verify all hashes and check backend
version compatibility. Preserve the current data before replacing it.

Check the module with temporary data:
`python -S scripts/runtime/test_runtime_backup.py`.
That check does not verify restoration of a private installation.
See [engine updates](aktualizacja-silnika.md), the [runtime guide](../architecture/runtime.md)
and [data protection](../../SECURITY.md).
