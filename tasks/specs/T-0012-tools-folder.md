# T-0012: `tools/` with an index of what each tool is for

**Problem.** About 85 developer tools (`scripts/dev`, `scripts/preview`, `scripts/release`, `scripts/build`, `tests/acceptance`) have no description of what they are for, when to run them or who calls them. A first inventory found about 25 of the 39 acceptance scripts called by nothing (not re-verified).

**Plan.**
1. Create `tools/README.md`: one table, `tool | purpose | when to run | called by`. Start from the inventory in `.tmp/qa` (ignored) and re-verify each row.
2. Move `scripts/dev` to `tools/dev`, `scripts/preview` to `tools/preview`, `scripts/release` and `scripts/build` to `tools/release`, and `tests/acceptance` to `tools/acceptance`. `scripts/runtime/` stays where it is: it is the backend embedded in the EXE through `include_str!`.
3. Naming rule: `.mjs` files kebab-case, `.py` files snake_case. Rename the outliers (`test-runtime.py` to `test_runtime.py`, `capture_screenshots.py` stays).
4. Update `package.json`, `ci.yml`, docs, `check-structure.mjs` and the line-limit exceptions list for the new paths.

**Checks.** `npm run test:structure`, `npm run check`, `npm run build`, `python scripts/dev/publication_check.py` (path of the moved tool updated in CI), docs links.

**Depends on.** T-0008 and T-0009 (decide what is deleted before moving it), T-0007.

**Done when.** `tools/README.md` explains every tool and nothing in the repo still points at the old paths.
