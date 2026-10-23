# Installing the Python environment

The interface can run without models. Local synthesis requires three separate
steps: installing Python and its libraries, obtaining the model weights, and
reviewing the model terms. The EXE includes the backend source; it does not include
the multi-gigabyte GPU dependencies or model weights.

## Windows workflow

1. Open **Ustawienia → Silnik → Środowiska → Samodzielne środowisko Python**
   (Settings → Engine → Environments → Standalone Python environment).
2. Choose CPU or NVIDIA CUDA 12.8. The CUDA option requires a compatible GPU and
   driver. The panel shows the estimated disk space requirement.
3. Start installation. A new `runtime_<id>` directory is created alongside the
   existing environment, using pinned CPython/uv distributions and SHA-256 checks.
4. Wait for the doctor checks to finish. They check imports, isolation and startup
   of the installer's own backend process, without downloading models or
   generating audio.
5. Stop the engine and select **Użyj tego środowiska** (Use this environment).
   Activation is a separate step and does not remove the previous environment.
6. Download the selected weights from the model catalog, review their terms and
   perform your own short synthesis test.

Cancellation waits for the installer's process tree to exit. A retry creates a
new candidate. Installation should leave the global Python/PATH configuration,
other applications and private data unchanged. `VOICESTUDIO_NEXT_PYTHON` is an
explicit interpreter override; unset it before selecting an environment in the
panel.

## Files and limitations

- `scripts/runtime/vendor/bootstrap-provenance.json` — distribution sources and hashes.
- `scripts/runtime/install/bootstrap.py` — dependency preparation and doctor checks.
- `src-tauri/src/installer.rs` — downloads, processes and activation.
- `src/lib/settings/pages/EnginePage.svelte` (**Środowiska** tab), `src/lib/platform/runtime-installer.ts` —
  the panel and actual progress reporting.

Doctor checks alone do not verify inference. A clean CPU machine, CUDA setup and
distributable installer each require separate acceptance testing, as described
in the [verification status](../verification/verification.md). Dependencies built from source may
require C++ build tools; pinned runtime dependencies do not make the build
toolchain fully reproducible. See the [runtime guide](../architecture/runtime.md) and
[third-party notices](../../THIRD_PARTY_NOTICES.md).
