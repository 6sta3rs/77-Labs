<script lang="ts">
  import Checkbox from '../ui/Checkbox.svelte'
  import { uiLanguage, createUiTranslator } from "../i18n"
  const tr = $derived(createUiTranslator($uiLanguage))

  import Button from '../ui/Button.svelte';
  import { onDestroy, untrack } from 'svelte'
  import { ExternalLink, FileCheck, LoaderCircle, RefreshCw, X } from '@lucide/svelte'
  import { prepareRequest, request } from '../platform/api'
  import { ModelLicenseService, ModelLicenseTermsChangedError, licenseCategoryLabel, licenseLink, licenseStateLabel, licenseText, type ModelLicenseDetails } from './model-licenses'
  import { openLicenseSource } from './license-sources'
  let { ready, repoId, onchanged, onreviewed, onbusychange, onclose }: { ready: boolean; repoId: string; onchanged?: (details: ModelLicenseDetails) => void | Promise<void>; onreviewed?: (details: ModelLicenseDetails) => void; onbusychange?: (busy: boolean) => void; onclose?: () => void } = $props()
  const uid = $props.id(), service = new ModelLicenseService(request)
  let details = $state<ModelLicenseDetails>(), loading = $state(false), busy = $state(false), agreed = $state(false), withdrawing = $state(false)
  let error = $state(''), message = $state('')
  let controller: AbortController | undefined, disposed = false, requestedRepo = ''
  const locked = $derived(!ready || loading || busy)
  const disclosures = [
    { key: 'commercial_inference', label: 'Użycie komercyjne modelu' }, { key: 'commercial_outputs', label: 'Komercyjne użycie wyników' },
    { key: 'redistribution', label: 'Dalsze udostępnianie' }, { key: 'voice_rights', label: 'Prawa do głosu' },
    { key: 'review_status', label: 'Stan przeglądu rejestru' }, { key: 'component_closure', label: 'Kompletność składników' },
    { key: 'readiness', label: 'Weryfikacja dowodów' }, { key: 'blockers', label: 'Brakujące potwierdzenia' },
  ]
  const revisions = [
    { key: 'evidence_revision', label: 'Wersja źródła warunków' }, { key: 'runtime_revision', label: 'Wersja modelu w rejestrze' },
    { key: 'registry_version', label: 'Wersja rejestru' }, { key: 'registry_digest', label: 'Hash rejestru' }, { key: 'evidence_checked_at', label: 'Data przeglądu źródeł' },
  ]
  const variantFields = [
    { key: 'id', label: 'Id wariantu' }, { key: 'label', label: 'Nazwa' }, { key: 'license_category', label: 'Kategoria' },
    { key: 'commercial_inference', label: 'Użycie komercyjne modelu' }, { key: 'commercial_outputs', label: 'Komercyjne użycie wyników' },
  ]
  function date(value?: string | null) { if (!value) return tr('Brak daty w starszym zapisie'); const parsed = new Date(value); return Number.isFinite(parsed.getTime()) ? parsed.toLocaleString(tr.locale) : value }
  async function openSource(value: unknown) {
    const url = licenseLink(value)
    if (!url) { error = 'Brak poprawnego adresu HTTPS źródła warunków.'; return }
    error = ''
    try { await openLicenseSource(url) } catch (cause) { if (!disposed) error = cause instanceof Error ? cause.message : 'Nie udało się otworzyć źródła warunków.' }
  }
  async function load() {
    if (!ready || !repoId || busy || disposed) return
    const repo = repoId, abort = new AbortController(); controller?.abort(); controller = abort
    requestedRepo = repo
    loading = true; agreed = false; withdrawing = false; error = ''; message = ''; details = undefined
    try { await prepareRequest('/models/licenses/details/', abort.signal); const result = await service.details(repo, abort.signal); if (!disposed && controller === abort && repo === repoId && !abort.signal.aborted) { details = result; onreviewed?.(result) } }
    catch (cause) { if (!disposed && !abort.signal.aborted) error = cause instanceof Error ? cause.message : 'Nie odczytano warunków modelu.' }
    finally { if (controller === abort && !disposed) loading = false }
  }
  async function decide(action: 'accept' | 'revoke') {
    if (disposed || locked || !details || (action === 'accept' ? !agreed : !withdrawing)) return
    const reviewed = details, abort = new AbortController(); controller?.abort(); controller = abort
    const currentRequest = () => !disposed && controller === abort && repoId === reviewed.repo_id && !abort.signal.aborted
    busy = true; error = ''; message = ''; agreed = false; withdrawing = false
    try {
      onbusychange?.(true)
      await prepareRequest('/models/licenses/', abort.signal)
      if (action === 'accept') await service.accept(reviewed, true, abort.signal); else await service.revoke(reviewed.repo_id, abort.signal)
      const current = await service.details(reviewed.repo_id, abort.signal)
      if (!currentRequest()) return
      details = current
      onreviewed?.(current)
      if (action === 'accept' && !current.acceptance.accepted) throw new Error('Nie potwierdzono zapisu akceptacji. Przeczytaj aktualny stan i ponów decyzję tylko świadomie.')
      if (action === 'revoke' && current.acceptance.state !== 'withdrawn') throw new Error('Nie potwierdzono cofnięcia. Odśwież stan przed dalszym użyciem modelu.')
      message = action === 'accept' ? 'Zapisano lokalne potwierdzenie dokładnie tych warunków dla tego modelu. Nie uruchomiono generowania ani pobierania.' : 'Cofnięto lokalne potwierdzenie tego modelu. Pliki modelu i historia nagrań pozostały zachowane.'
      try { await onchanged?.(current) } catch { if (currentRequest()) message += ' Odśwież katalog modeli, aby ponownie odczytać jego stan.' }
    } catch (cause) {
      if (currentRequest()) {
        if (cause instanceof ModelLicenseTermsChangedError) {
          let refreshed = false
          try { const current = await service.details(reviewed.repo_id, abort.signal); if (currentRequest()) { details = current; onreviewed?.(current); refreshed = true } }
          catch { if (currentRequest()) details = undefined }
          if (currentRequest()) error = cause.message + (refreshed ? ' Wczytano aktualne informacje; przeczytaj je przed potwierdzeniem.' : '')
        } else error = cause instanceof Error ? cause.message : 'Nie zapisano decyzji dotyczącej licencji.'
      }
    } finally { if (controller === abort && !disposed) { busy = false; onbusychange?.(false) } }
  }
  $effect(() => {
    const active = ready, repo = repoId, pending = busy
    if (active && repo) {
      if (!pending) untrack(() => { if (requestedRepo !== repo) void load() })
    } else { requestedRepo = ''; controller?.abort(); details = undefined; agreed = false; withdrawing = false; loading = false; error = ''; message = '' }
  })
  onDestroy(() => { disposed = true; controller?.abort(); if (busy) { busy = false; onbusychange?.(false) } })
</script>

<section class="model-license-review" aria-label={tr(String(`Warunki modelu ${repoId}`))}>
  <header><FileCheck size={20}/><div><h2>{tr("Warunki modelu")}</h2><code>{repoId}</code></div>{#if onclose}<Button variant="ghost" size="icon" aria-label={tr("Zamknij warunki modelu")} disabled={busy} onclick={onclose}><X size={16}/></Button>{/if}</header>
  <p>{tr("Decyzja dotyczy jednego modelu i wskazanej wersji warunków. Aplikacja zapisuje ją lokalnie; nie przyznaje dodatkowych praw ani dostępu od dostawcy.")}</p>
  <Button variant="outline" disabled={locked} onclick={load}><RefreshCw size={14}/>{tr("Odśwież warunki i stan")}</Button>
  {#if loading || busy}<p role="status"><LoaderCircle size={14} class="spin"/>{busy ? tr('Zapisywanie jawnej decyzji…') : tr('Odczytywanie informacji o modelu…')}</p>{/if}
  {#if !ready}<p role="status">{tr("Uruchom prywatny silnik, aby odczytać jego rejestr licencji.")}</p>{/if}
  {#if details}
    <div class="license-status"><strong>{tr(licenseStateLabel(details.acceptance.state))}</strong><span>{tr(licenseCategoryLabel(details.acceptance.category))}</span></div>
    <h3>{tr("Deklaracja licencji w rejestrze")}</h3><p class="license-original">{licenseText(details.info.license)}</p>
    {#if details.acceptance.category === 'unknown' || String(details.info.license).toUpperCase().includes('NOASSERTION')}<p class="license-notice">{tr("Rejestr zwraca nieustalone warunki lub NOASSERTION. Panel nie potwierdza dozwolonych zastosowań tego modelu. Poniższe źródła pozostają podstawą Twojej decyzji.")}</p>{/if}
    <h3>{tr("Autorzy i wymagane uznanie")}</h3><p class="license-original">{licenseText(details.info.credit)}</p>
    <h3>{tr("Uwagi z rejestru upstream")}</h3><p class="license-original">{licenseText(details.info.notes)}</p>
    <div class="license-links">{#each [{ key: 'source_url', label: 'Repozytorium modelu' }, { key: 'evidence_url', label: 'Wskazane źródło warunków' }] as link}{#if licenseLink(details.info[link.key])}<a href={licenseLink(details.info[link.key])} target="_blank" rel="noreferrer" onclick={event => { event.preventDefault(); void openSource(details!.info[link.key]) }}>{tr(String(link.label))}<ExternalLink size={13}/><small>{licenseText(details.info[link.key])}</small></a>{:else}<p>{tr(String(link.label))}: {licenseText(details.info[link.key])}</p>{/if}{/each}</div>
    <p>{tr("Ten endpoint przekazuje deklaracje i odnośniki, bez pełnego tekstu dokumentów licencji. Przed potwierdzeniem zapoznaj się z podanymi źródłami. Klasyfikacja rejestru nie zastępuje ich treści.")}</p>
    <h3>{tr("Szczegóły warunków i kompletności")}</h3><dl>{#each disclosures as field}<dt>{tr(String(field.label))}</dt><dd>{licenseText(details.info[field.key])}</dd>{/each}</dl>
    {#if details.info.variants?.length}<h3>{tr("Warianty i ich odrębne warunki")}</h3>{#each details.info.variants as variant}<article class="license-variant"><dl>{#each variantFields as field}<dt>{tr(String(field.label))}</dt><dd>{licenseText(variant[field.key])}</dd>{/each}</dl>{#if licenseLink(variant.evidence_url)}<a href={licenseLink(variant.evidence_url)} target="_blank" rel="noreferrer" onclick={event => { event.preventDefault(); void openSource(variant.evidence_url) }}>{tr("Źródło warunków wariantu")}<ExternalLink size={13}/></a>{:else}<p>{tr("Źródło:")} {licenseText(variant.evidence_url)}</p>{/if}<dl>{#each ['license', 'license_status', 'output_terms'] as key}<dt>{tr("Obserwacja źródłowa:")} {key}</dt><dd class="license-original">{licenseText(variant.observations?.[key])}</dd>{/each}</dl></article>{/each}{/if}
    {#if details.acceptance.state === 'terms_updated'}<p class="license-notice">{tr("Poprzednia decyzja nie obejmuje aktualnych warunków. Zmienione pola:")} {licenseText(details.acceptance.changed_fields)}.</p>{/if}
    <details><summary>{tr("Wersje i odcisk warunków")}</summary><dl>{#each revisions as field}<dt>{tr(String(field.label))}</dt><dd><code>{licenseText(details.info[field.key])}</code></dd>{/each}<dt>{tr("Odcisk warunków do potwierdzenia")}</dt><dd><code>{details.acceptance.fingerprint}</code></dd></dl><p>{tr("Backend sprawdza ten odcisk przy zapisie. Zmiana warunków wymaga ich ponownego odczytania i nowej decyzji.")}</p></details>
    {#if details.acceptance.required && !details.acceptance.accepted}<label class="license-confirm" for={`${uid}-agree`}><Checkbox id={`${uid}-agree`} bind:checked={agreed} disabled={locked}/>{tr("Zapoznałem się z powyższymi informacjami i wskazanymi warunkami. Potwierdzam, że mam uprawnienia wymagane do planowanego użycia tego modelu.")}</label><Button variant="default" disabled={locked || !agreed} onclick={() => decide('accept')}>{tr("Zapisz moje potwierdzenie dla tego modelu")}</Button>{/if}
    {#if details.acceptance.state === 'accepted'}{#if withdrawing}<p class="license-notice">{tr("Cofnąć potwierdzenie tylko dla")} {details.repo_id}{tr("? Backend ponownie zablokuje użycie wymagające tych warunków.")}</p><div class="license-actions"><Button variant="outline" disabled={locked} onclick={() => decide('revoke')}>{tr("Potwierdzam cofnięcie")}</Button><Button variant="ghost" disabled={locked} onclick={() => withdrawing = false}>{tr("Zachowaj potwierdzenie")}</Button></div>{:else}<Button variant="ghost" disabled={locked} onclick={() => withdrawing = true}>{tr("Cofnij moje potwierdzenie tego modelu")}</Button>{/if}{/if}
    <details><summary>{tr("Historia lokalnych decyzji (")}{details.history.length})</summary>{#each details.history as entry}<article class="license-history"><strong>{entry.action === 'accepted' ? tr('Potwierdzono warunki') : entry.action === 'withdrawn' ? tr("Cofnięto potwierdzenie") : entry.action}</strong><span>{date(entry.at)} {tr("· wersja aplikacji:")} {entry.app_version || tr('niezapisana')}</span><code>{entry.fingerprint || tr("brak odcisku w starszym zapisie")}</code></article>{/each}{#if !details.history.length}<p>{tr("Brak zapisanych decyzji.")}</p>{/if}</details>
  {/if}
  {#if error}<p class="license-error" role="alert">{tr(String(error))}</p>{/if}{#if message}<p class="license-notice" role="status">{tr(String(message))}</p>{/if}
</section>

<style>
  .model-license-review{display:flex;flex-direction:column;align-items:stretch;gap:14px;padding:20px;border:1px solid var(--border);border-radius:10px;background:var(--surface);min-width:0}.model-license-review header{display:flex;align-items:flex-start;gap:12px}.model-license-review header>div{flex:1;min-width:0}.model-license-review h2{font-size:var(--ui-text-15);font-weight:600;margin-bottom:8px}.model-license-review h3{font-size:var(--ui-text-12);font-weight:600;margin-top:7px}.model-license-review p{font-size:var(--ui-text-12);line-height:1.8;color:var(--muted);display:flex;align-items:center;gap:7px;white-space:pre-wrap;overflow-wrap:anywhere}.model-license-review code{font-size:var(--ui-text-10);overflow-wrap:anywhere}.model-license-review>:global([data-slot="button"]){align-self:flex-start}.license-status{display:flex;flex-wrap:wrap;justify-content:space-between;gap:10px;padding:12px;border:1px solid var(--border);border-radius:7px;font-size:var(--ui-text-11)}.license-status>span{color:var(--muted)}.model-license-review .license-original{white-space:pre-wrap;display:block;color:var(--foreground)}.license-links{display:flex;flex-direction:column;gap:14px}.model-license-review a{display:flex;flex-wrap:wrap;align-items:center;gap:6px;text-decoration:underline;color:var(--foreground);font-size:var(--ui-text-12)}.license-links small{flex-basis:100%;font-size:var(--ui-text-10);overflow-wrap:anywhere}.model-license-review dl{display:grid;grid-template-columns:minmax(150px,1fr) 2fr;gap:10px 14px;font-size:var(--ui-text-11);line-height:1.8}.model-license-review dt{color:var(--muted)}.model-license-review dd{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;min-width:0}.model-license-review summary{font-size:var(--ui-text-12);cursor:pointer}.model-license-review details>dl{margin-top:14px}.license-variant{padding:14px;border:1px solid var(--border);border-radius:7px;display:flex;flex-direction:column;gap:14px}.license-notice{padding:12px;border:1px solid var(--border);border-radius:7px}.model-license-review .license-error{color:var(--danger)}.license-confirm{display:flex;gap:10px;align-items:flex-start;font-size:var(--ui-text-12);line-height:1.8;cursor:pointer}.license-confirm :global(input){margin-top:4px}.license-actions{display:flex;flex-wrap:wrap;gap:8px}.license-history{display:flex;flex-direction:column;gap:7px;padding:14px 0;border-bottom:1px solid var(--border);font-size:var(--ui-text-11)}.license-history>span{color:var(--muted)}@media(max-width:600px){.model-license-review dl{grid-template-columns:1fr;gap:4px}.model-license-review dd{margin-bottom:10px}.model-license-review{padding:16px}}
</style>
