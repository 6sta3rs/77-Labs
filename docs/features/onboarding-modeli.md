# First-run setup and model preparation

Simply displaying the **Przygotuj modele do pracy** (Prepare models for use)
window does not load models. When the engine is stopped, the welcome screen does
not start Python. **Sprawdź modele i warunki** (Check models and terms) explicitly
connects to the engine and, in the desktop application, starts the installed
environment. Install the environment and weights separately in
**Ustawienia → Modele i silnik** (Settings → Models and engine).

## User decisions

The plan lists each required repository separately. For the main OmniVoice model,
it may include both the model and its tokenizer. Each component has its own
information, sources and initially unchecked acceptance box. There is no blanket
acceptance. A saved decision applies to the exact fingerprint of the information
reviewed.

**Później** (Later), closing the window or pressing Escape postpones the review.
Return through **Przejrzyj warunki modeli** (Review model terms) in settings.
An unfinished review may appear again on the next visit. Closing the review and
changing the model are blocked while a decision is being saved and its result
is being confirmed. A failed read can be retried.

## State and contract

`GET /next/models/onboarding` reads the plan for the selected TTS model and the
pinned registry. It does not import ML libraries, download weights or save
decisions. An unsupported model or older backend produces a readable error
instead of an empty plan that appears successful. The plan alone does not confirm
a complete list of rights for every component.

The `voicestudio.license-onboarding.v1` localStorage key is only a completion
hint. The backend holds the authoritative state. Revoking a decision or changing
the fingerprint clears the hint and requires another review. HTTP 409 does not
automatically repeat acceptance. A save is considered successful only after
the state has been read back.

## Files and checks

- `src/lib/ModelLicenseOnboarding.svelte`, `src/lib/license-onboarding.ts` — UI and state.
- `src/lib/ModelLicenseReview.svelte` — individual decisions.
- `scripts/runtime/model_management.py` — the plan.

Regression checks: `node scripts/license-onboarding-check.mjs`,
`node scripts/model-licenses-check.mjs` and
`node scripts/model-onboarding-monitor-check.mjs`.
Use an isolated fixture for UI acceptance testing, without real decisions or models.
See [model terms](licencje-modeli.md), [installation](instalacja-runtime.md)
and [verification status](../verification/weryfikacja.md).
