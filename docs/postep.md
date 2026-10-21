# Public project progress

## 21 October 2026 — English public documentation

Translated the README, PRD, contributor/security/provenance documents, agent instructions, and public technical guides into English at the user's request. The application interface and screenshots remain Polish. Actual Polish control labels are retained with English explanations. Existing filenames, commands, URLs, model names, and compatibility identifiers are preserved.

Updated the documentation language rule to English while retaining Polish application UI. Historical verification results remain explicitly historical; this documentation change does not claim new application or model testing. The private source checkout and runtime data are untouched.

The public package description and CI display name are also English. Scripts, dependencies, and application behavior are unchanged.

Checks passed: content review of 31 Markdown files, all 99 local links and heading anchors, UTF-8, whitespace, and a full publication/privacy audit with private deny patterns stored outside the repository. All five pinned assets (three screenshots, the demo tone, and the engine archive) are unchanged. A separate English source ZIP is generated from the new anonymous commit. Builds, UI/runtime acceptance tests, and inference were not rerun for this documentation-only change. Results are recorded in [verification](weryfikacja.md).

## 21 October 2026 — fast audit of the entire history

The first public starting point was committed with neutral author and committer identities. The scanner now reads all objects in batches instead of starting a separate Git process for every file. It retains checks for unreachable objects, names in trees, every index stage, taggers, and object replacement attempts. It verifies object identity, type, size, and complete responses; an error cannot produce PASS.

Recorded checks: 23 tests PASS, 1 SKIP for Windows directory-symlink permissions. A real scan with private patterns stored outside the repository covered 549 files, 578 Git objects, and the pinned ZIP: zero findings in about 9 seconds. Diff checks for both files and documentation passed. This change covered only the scanner, its tests, and the verification record; UI builds and inference were not repeated. The history audit is repeated after committing. Nothing was published remotely.

## 21 October 2026 — initial open-source preparation

Created a separate repository with fresh history and a neutral author identity. The private checkout had uncommitted changes and checkpoints containing data; it was left untouched, and the export was based on its last local commit.

Removed private recordings, reports, screenshots, and generated HTML previews containing embedded audio. A personal name, private synthesis profile, and local paths were replaced with neutral data or explicit parameters. Speech tests require a user-supplied reference. Reports go into ignored `.tmp/qa`.

Assets recovered from a commercial website and logos without a complete redistribution basis were replaced with original visualization code and Lucide icons. Reading older settings remains supported. Added the owner's selected AGPL-3.0-only license and separate notices for upstream, themes, and flags.

The README, PRD, contribution/security policies, publication scanner, and CI define the public starting point. The demo uses fictional projects and a procedural tone without human speech. Three new 1440×960 screenshots were visually reviewed; five demo checks passed without requests to the private backend.

Recorded checks on that tree: check 0/0, build, the full UI test suite, and cargo check PASS. The scanner initially had 17 PASS and 1 SKIP because Windows could not create the test symlink. File/index auditing with private patterns stored outside the repository passed; history is checked again after committing. See [verification](weryfikacja.md) for details and limits. Polish-character encoding in new documentation was also corrected, and local links were checked.

A build warning remains for the main chunk of approximately 728 kB. All models, full dubbing/audiobook renders, CUDA, and installation on a clean machine have not been accepted. No new inference, weight downloads, remote publication, or private-data migration were performed. Actual runtime data, private commits, and uncommitted work remain in the original directory.
