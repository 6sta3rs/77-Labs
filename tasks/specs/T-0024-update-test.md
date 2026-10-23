# T-0024: test the update from 0.2.1 to 0.2.2 from the real feed

**What was verified (23 October 2026, from the real GitHub release feed).**
- `releases/latest/download/latest.json` of the project's repository is reachable and says `0.2.2`; its installer URL downloads (25,471,792 bytes) and is byte-identical to the locally built `.tmp/release/v0.2.2` installer.
- The signature in the feed equals the local `.sig`, and it verifies against the public key embedded in `desktop/tauri.conf.json` (checked with the `minisign-verify` crate in a scratch project under the ignored `.tmp/qa/T-0024/`). So the feed, the asset and the key agree for 0.2.2.
- The update-offer logic itself is covered by `tests/frontend/app-update-support-check.mjs`.

**What was NOT verified, and why.** Installing 0.2.1 and letting the updater install 0.2.2 from the real feed. The NSIS installer writes the per-user install location and the uninstall entry under the application identifier, and this machine already has a real installation of the same identifier. Running the 0.2.1 installer, even with a custom directory, would replace or re-point that installation (a downgrade), and the updater's passive install would again act on the registered location. The rule "do not touch the existing installation" therefore blocks the test here.

**Question for the owner.** May the test run on this machine's real per-user installation (it would be replaced by 0.2.1 and updated back to 0.2.2; user data in `%LOCALAPPDATA%\VoiceStudioNext` is not touched by the installer), or is there another Windows account or a virtual machine without an installation?

**Steps once decided.**
1. Install `.tmp/release/v0.2.1/Seventy-Seven-Labs_0.2.1_x64-setup.exe` (its endpoint is baked in at build time and points at the real feed).
2. Start the app with a fresh WebView profile (`WEBVIEW2_USER_DATA_FOLDER`) and data folder if the machine's data must stay untouched.
3. **Ustawienia → Aktualizacje → Sprawdź aktualizacje**: expect 0.2.2 with its notes, then **Pobierz i zainstaluj**: expect the passive installer, the restart and `0.2.2` on the page.
4. Record the result in `.tmp/qa/T-0024/` and `docs/progress.md`; only then start T-0033 (key rotation).
