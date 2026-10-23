# Model terms

The application, model code, weights, tokenizer and voice references may have
different licenses. **Ustawienia → Modele → Przejrzyj warunki modeli** (Settings →
Models → Review model terms) opens **Warunki modeli** (Model terms), which shows information for a specific repository and its explicitly
declared dependencies. `unknown` and `NOASSERTION` mean the terms are unresolved;
they do not confirm permission to use the material.

## Reviewing and recording a decision

The panel shows the declared license, sources, restrictions, an information
fingerprint and local decision history. It does not replace the provider's full
documents. Opening a source, downloading weights or reading the catalog does not
record acceptance.

The user reviews the terms, selects the initially unchecked box and records
acceptance for **one model**. This action does not start synthesis. If the
fingerprint changes while the decision is being saved, another review is
required; the application clears the checkbox instead of automatically accepting
the new content. Revoking acceptance is a separate action and does not remove
weights or recordings. A local record does not grant rights to a voice or replace
consent or access required by the provider.

## API contract

- `GET /models/licenses/details/{repo_id:path}` — information, state and history.
- `GET /models/licenses/acceptance/{repo_id:path}` — state only.
- `POST /models/licenses/accept` — `{ repo_id, fingerprint, accepted: true }`.
- `POST /models/licenses/revoke` — `{ repo_id }`.
- HTTP 409 `terms_changed` — read the updated information without an automatic POST.
- HTTP 403 `model_licence_required` — open the required repositories for review;
  retrying generation remains an explicit user decision.

An older server without this contract produces an unsupported-feature message.
There is no fallback endpoint that silently records acceptance. Downloading a
model does not clear the first-use check.

## Files and checks

- `src/lib/models/ModelLicenseReview.svelte` — review, acceptance and revocation.
- `src/lib/models/model-licenses.ts` — parsing, transport and HTTP 403/409 handling.
- `src/lib/settings/pages/ModelsPage.svelte` — entry point from the catalog.
- `src/lib/platform/api.ts` — generation errors.

Regression check: `node tests/frontend/model-licenses-check.mjs`. Test acceptance and
revocation must use controlled fixture state only. Do not accept real terms on
the user's behalf. See [first-run setup](onboarding-modeli.md),
[third-party notices](../../THIRD_PARTY_NOTICES.md) and
[voice and data policies](../../SECURITY.md).
