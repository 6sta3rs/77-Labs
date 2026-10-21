# Third-party licenses and provenance

Seventy Seven Labs code is provided under **AGPL-3.0-only**; the full text
is in [LICENSE](LICENSE). This inventory describes significant bundled
components and the scope of their licenses. It does not modify their terms.

## VoiceStudio - backend

- Source: [debpalash/VoiceStudio](https://github.com/debpalash/VoiceStudio),
  version 0.5.7, commit `7a6c8980bb9c04db145357a8190a37a0e9f462da`.
- Bundled sources: `scripts/runtime/engine.zip`; file manifest and SHA-256:
  `scripts/runtime/engine-provenance.json`.
- Upstream application license: **AGPL-3.0-only**.
- Copyright 2024-present Palash Debnath and VoiceStudio contributors.
- The original `LICENSE` and `LICENSE-NOTICE.md` remain in the archive.
  The [pinned upstream notice](https://github.com/debpalash/VoiceStudio/blob/7a6c8980bb9c04db145357a8190a37a0e9f462da/LICENSE-NOTICE.md)
  distinguishes application code, the OmniVoice package, and downloaded models.

The Seventy Seven Labs engine incorporates the imported backend sources above
and local extensions in `scripts/runtime`. The application provides a separate
Svelte/Tauri interface. The launcher prepares its own copy of the backend and
applies documented adapters. The [runtime](docs/architecture/runtime.md) document explains
startup behavior. The product name does not change the imported source's
authorship or license. This is not an official VoiceStudio release or a product
of its authors.

## OmniVoice - Python package

According to the original `LICENSE-NOTICE.md`, the `omnivoice/` directory
inside the engine archive is a separate package by Han Zhu and the OmniVoice
authors, licensed under **Apache License 2.0**. This project does not relicense
it. The application's AGPL license does not change that license or the terms
of model weights.

Source: [k2-fsa/OmniVoice](https://github.com/k2-fsa/OmniVoice).
Full text: [LICENSES/Apache-2.0.txt](LICENSES/Apache-2.0.txt);
canonical version: [Apache Software Foundation](https://www.apache.org/licenses/LICENSE-2.0).
Binary packages must include the required license texts and notices
for each component actually distributed.

## T3 Code - palettes and selected control styles

The project imports palettes and selected control styles from
[pingdotgg/t3code](https://github.com/pingdotgg/t3code).
Copyright (c) 2026 T3 Tools Inc. License: **MIT**; the full text remains in
[src/lib/themes/LICENSE-T3](src/lib/themes/LICENSE-T3).

- Palettes: revision `86534db4d3525a070589a234d660a3e0373a42ea`,
  [packages/shared/src/themePalettes.ts](https://github.com/pingdotgg/t3code/blob/86534db4d3525a070589a234d660a3e0373a42ea/packages/shared/src/themePalettes.ts).
- Control style reference:
  `89424d9fa01c6bd24664315c7ccda8d6cb1eab61`,
  [apps/web/src/components/ui](https://github.com/pingdotgg/t3code/tree/89424d9fa01c6bd24664315c7ccda8d6cb1eab61/apps/web/src/components/ui).
- Components and behavior are adapted to Svelte and the local studio.
  Details: [themes](docs/features/motywy-t3-code.md), [controls](docs/features/t3-controls.md).

The application displays two of these palette families as **Labs** and
**Róża** (Rose). These product labels do not change source attribution or
the MIT license. Legacy source filenames, theme identifiers, and the existing
theme JSON v1 format remain for compatibility.

## Circle Flags - language markers

The 62 local SVG files come from
[HatScripts/circle-flags](https://github.com/HatScripts/circle-flags),
revision `379588b5da95482d6bbf10bd45644a35b0609ea6`.
Copyright (c) 2026 HatScripts. License: **MIT**;
the [original text](src/lib/ui/language-flags/LICENSE.md),
[description](src/lib/ui/language-flags/README.md), and `provenance.json`
are included in the flags directory. The manifest describes how source
symlinks were resolved to file contents.

## Dependencies and interface assets

npm, Rust, and Python dependencies retain their own licenses. Exact versions
are recorded in `package-lock.json`, `src-tauri/Cargo.lock`, and `uv.lock`
inside the engine archive. Assess versions and licenses for the actual
package; this document is not a complete transitive dependency inventory
or set of notices for the EXE.

The public release uses original procedural visualizations and neutral model
icons. Model names identify models; they do not
imply endorsement or affiliation with their authors. Legacy internal
identifiers may remain for settings compatibility and do not grant rights
to third-party materials.

Application screenshots should show its own interface and clean demo data.
System fonts are referenced by name; the repository does not distribute
Windows system font files.

## Models, tokenizers, and recordings

The repository does not contain model weights, private voice profiles,
recordings, databases, or users' terms acknowledgments. The application's
AGPL license does not grant rights to downloaded weights, tokenizers,
training data, or voices. Individual revisions may have commercial,
noncommercial, attribution, or access terms that require separate review.

This also applies to dependencies of the main model, such as an audio tokenizer.
Reading metadata or recording a local acknowledgment in the panel does not
establish that all necessary rights have been secured. Consult the sources
listed for the specific model. Cloning consent and rights to the reference
recording are separate from code and model licenses.

## Before distributing ready-to-use packages

Publishing source code does not establish readiness to redistribute all
binary dependencies. Before including libraries or weights in a release:

1. Inventory the files actually distributed and their versions.
2. Include the applicable licenses, copyright statements, notices, and
   corresponding source, as required by each component's terms.
3. Review FFmpeg/PyAV distributions, bundled codecs, and optional GPU libraries;
   the source license of a Python package alone does not describe all its binaries.
4. Assess weight and tokenizer terms separately. Do not transfer personal
   acknowledgments or model access to package recipients.

When distributing or providing network access to a modified program,
obligations follow the full AGPL text. Preserve original notices, modification
statements, and access to the corresponding source. Software licenses do not
grant permission to present third-party trademarks as your own.
