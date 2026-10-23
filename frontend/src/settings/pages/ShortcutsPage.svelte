<script lang="ts">
  // "Skróty i mikrofon": static in-app shortcuts, the global dictation hotkey (Tauri) and microphone access.
  import { onDestroy, onMount } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { LoaderCircle, Mic, RefreshCw, ExternalLink, AppWindow, Keyboard, X } from '@lucide/svelte';
  import { uiLanguage, createUiTranslator } from '../../i18n';
  import { configureDesktopDictation, defaultDictationDesktopPreferences, desktopDictationStatus, shortcutError, showDictationWidget, watchDesktopDictation, type DictationDesktopPreferences, type DictationDesktopStatus } from '../../tools/dictation/dictation-desktop';
  import { settingsError } from '../system-settings';
  import { toast } from '../../ui/toast';
  import Button from '../../ui/Button.svelte';
  import Switch from '../../ui/Switch.svelte';
  import StatusBadge, { type BadgeKind } from '../../ui/StatusBadge.svelte';
  const tr = $derived(createUiTranslator($uiLanguage));

  let { desktop }: { desktop: boolean } = $props();

  /* ---------- in-app shortcuts (static) ---------- */
  const APP_KEYS: [string, string[][]][] = [
    ['Szukaj i przejdź do', [['Ctrl', 'K']]],
    ['Wygeneruj mowę w edytorze', [['Ctrl', 'Enter']]],
    ['Cofnij / ponów edycję', [['Ctrl', 'Z'], ['Ctrl', 'Y']]],
    ['Zamknij menu lub wróć z ustawień', [['Esc']]],
  ];

  /* ---------- global dictation hotkey ---------- */
  let status = $state<DictationDesktopStatus>(), draft = $state<DictationDesktopPreferences>(defaultDictationDesktopPreferences());
  let edited = $state(false), saving = $state(false), listening = $state(false);
  let disposed = false; const lifecycle = new AbortController();
  const supported = $derived(desktop && !!status?.supported);
  const invalid = $derived(draft.enabled ? shortcutError(draft.shortcut) : '');
  const chips = $derived(draft.shortcut.split('+'));
  function apply(value: DictationDesktopStatus) { if (disposed) return; status = value; if (!edited) draft = { ...value.preferences }; }
  function change(patch: Partial<DictationDesktopPreferences>) { draft = { ...draft, ...patch }; edited = true; }
  function discard() { edited = false; listening = false; if (status) draft = { ...status.preferences }; }
  function keyName(e: KeyboardEvent) {
    if (/^Key[A-Z]$/.test(e.code)) return e.code.slice(3);
    if (/^Digit\d$/.test(e.code)) return e.code.slice(5);
    if (e.code === 'Space') return 'Space';
    return /^F([1-9]|1\d|2[0-4])$/.test(e.code) && e.code !== 'F12' ? e.code : '';
  }
  function onkey(e: KeyboardEvent) {
    if (!listening) return;
    e.preventDefault(); e.stopPropagation();
    if (e.key === 'Escape') { listening = false; return; }
    const k = keyName(e);
    if (!k) return; // modifiers alone or unsupported keys: keep listening
    change({ shortcut: [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Win', k].filter(Boolean).join('+') });
    listening = false;
  }
  async function saveDictation() {
    if (saving || invalid || !supported) return;
    saving = true;
    try {
      const value = await configureDesktopDictation(draft); if (disposed) return;
      edited = false; apply(value);
      toast.ok(value.registered ? tr('Zapisano. Globalny skrót jest aktywny.') : tr('Zapisano. Globalny skrót jest wyłączony.'));
    } catch (cause) { if (!disposed) toast.bad(tr(settingsError(cause))); }
    finally { if (!disposed) saving = false; }
  }
  async function showWidget() {
    try { apply(await showDictationWidget()); toast.ok(tr('Pokazano pływające okno dyktowania')); }
    catch (cause) { if (!disposed) toast.bad(tr(settingsError(cause))); }
  }

  /* ---------- microphone ---------- */
  let mic = $state('unknown'), checking = $state(false);
  const BADGES: Record<string, [BadgeKind, string]> = { unknown: ['neutral', 'Nieodczytany'], granted: ['ok', 'Dostępny'], denied: ['bad', 'Brak zgody'], prompt: ['neutral', 'Zapyta o zgodę'] };
  const badge = $derived(BADGES[mic] ?? BADGES.unknown);
  // Reading the permission state does not open the microphone.
  async function readPermission() {
    try { mic = (await navigator.permissions.query({ name: 'microphone' as PermissionName })).state; }
    catch { mic = 'unknown'; }
  }
  async function refreshMic() { await readPermission(); toast.ok(tr('Odświeżono stan uprawnień')); }
  async function checkMic() {
    if (checking) return;
    checking = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop());
      mic = 'granted'; toast.ok(tr('Uzyskano dostęp do mikrofonu i od razu zamknięto strumień. Nie zapisano nagrania.'));
    } catch (cause) {
      mic = (cause as Error).name === 'NotAllowedError' ? 'denied' : 'unknown';
      toast.bad(tr('Nie uzyskano dostępu do mikrofonu. {reason}', { reason: tr(settingsError(cause)) }));
    } finally { if (!disposed) checking = false; }
  }
  async function openMicSettings() {
    try { await invoke('settings_open_microphone'); toast.ok(tr('Otwarto ustawienia mikrofonu Windows')); }
    catch (cause) { toast.bad(tr(settingsError(cause))); }
  }

  onMount(() => {
    void readPermission();
    void desktopDictationStatus().then(apply).catch(cause => { if (!disposed) toast.bad(tr(settingsError(cause))); });
    void watchDesktopDictation({ status: apply }, lifecycle.signal).catch(cause => { if (!disposed) toast.bad(tr(settingsError(cause))); });
  });
  onDestroy(() => { disposed = true; lifecycle.abort(); });
</script>

<svelte:window onkeydown={onkey}/>

<div class="p-page">
  <div class="page-heading"><div><h1>{tr('Skróty i mikrofon')}</h1><p>{tr('Skróty klawiszowe, dyktowanie w innych oknach i dostęp do mikrofonu.')}</p></div></div>

  <section class="p-card card">
    <div class="p-section">
      <header><h3>{tr('Skróty w aplikacji')}</h3><p>{tr('Działają w całej aplikacji. Nie można ich zmienić.')}</p></header>
      <dl class="p-kv">
        {#each APP_KEYS as [label, combos]}
          <div><dt>{tr(label)}</dt><dd>{#each combos as combo, i}{#if i}<span class="sep">/</span>{/if}{#each combo as k, j}{#if j}<span class="sep">+</span>{/if}<kbd>{k}</kbd>{/each}{/each}</dd></div>
        {/each}
      </dl>
    </div>

    <div class="p-section">
      <header class="split"><div><h3>{tr('Dyktowanie w innych oknach')}</h3><p>{tr('Skrót otwiera pływające okno. Mikrofon włączasz osobnym przyciskiem.')}</p></div>
        {#if supported}<Button variant="outline" disabled={saving} onclick={showWidget}><AppWindow size={15}/>{tr('Pokaż pływające okno')}</Button>{/if}</header>
      {#if !supported}
        <p class="p-notice">{status || !desktop ? tr('Globalny skrót, pływające okno i natywne wklejanie są dostępne w aplikacji desktopowej na Windows.') : tr('Odczytuję stan dyktowania…')}</p>
      {:else}
        {#if status?.error}<p class="p-notice bad" role="alert">{tr(String(status.error))}</p>{/if}
        <div class="p-rows">
          <div class="p-row">
            <div class="t"><b>{tr('Włącz globalny skrót')}</b><span>{tr('Działa też, gdy aplikacja jest w tle.')}</span></div>
            <Switch label={tr('Włącz globalny skrót dyktowania')} checked={draft.enabled} disabled={saving} onchange={v => change({ enabled: v })}/>
          </div>
          <div class="p-row" class:off={!draft.enabled}>
            <div class="t"><b>{tr('Kombinacja klawiszy')}</b><span>{#if listening}{tr('Naciśnij nową kombinację. Esc anuluje.')}{:else}{tr('Co najmniej dwa modyfikatory i litera, cyfra, Space lub F1–F24 (bez F12).')}{/if}</span></div>
            <div class="inline">
              <div class="keys" class:listening aria-live="polite" aria-label={tr('Kombinacja klawiszy: {keys}', { keys: listening ? tr('oczekiwanie na klawisze') : draft.shortcut })}>
                {#if listening}<span class="hint"><Keyboard size={14}/>{tr('Naciśnij klawisze…')}</span>
                {:else}{#each chips as k, j}{#if j}<span class="sep">+</span>{/if}<kbd>{k}</kbd>{/each}{/if}
              </div>
              {#if listening}<Button variant="outline" aria-label={tr('Anuluj zmianę skrótu')} onclick={() => listening = false}><X size={15}/>{tr('Anuluj')}</Button>
              {:else}<Button variant="outline" disabled={!draft.enabled || saving} onclick={() => listening = true}>{tr('Zmień skrót')}</Button>{/if}
            </div>
          </div>
          {#if invalid}<p class="p-field-err" role="alert">{invalid}</p>{/if}
          <div class="p-row">
            <div class="t"><b>{tr('Włącz przycisk wklejania do poprzedniego okna')}</b><span>{tr('Po dyktowaniu klikasz „Wklej” przy tytule okna. Kopiowanie i wklejanie to osobne akcje.')}</span></div>
            <Switch label={tr('Włącz ręczne wklejanie dyktowania do poprzedniego okna')} checked={draft.paste_enabled} disabled={saving} onchange={v => change({ paste_enabled: v })}/>
          </div>
        </div>
        <div class="foot">
          <span class="p-sub">{tr('Stan systemowy:')} {status?.registered ? tr('zarejestrowano {shortcut}', { shortcut: status.active_shortcut ?? '' }) : tr('skrót nieaktywny')}.</span>
          <div class="p-actions">
            {#if edited && !saving}<Button variant="ghost" onclick={discard}>{tr('Odrzuć zmiany')}</Button>{/if}
            <Button disabled={!edited || !!invalid || saving} onclick={saveDictation}>{#if saving}<LoaderCircle size={15} class="spin"/>{tr('Zapisywanie…')}{:else}{tr('Zapisz ustawienia dyktowania')}{/if}</Button>
          </div>
        </div>
      {/if}
    </div>

    <div class="p-section">
      <header class="split"><div><h3>{tr('Mikrofon')}</h3><p>{tr('Do dyktowania i nagrywania próbek głosu. Samo otwarcie tej strony go nie włącza.')}</p></div><StatusBadge kind={badge[0]} text={tr(badge[1])}/></header>
      <div class="p-actions">
        <Button disabled={checking || !navigator.mediaDevices?.getUserMedia} onclick={checkMic}>{#if checking}<LoaderCircle size={15} class="spin"/>{tr('Sprawdzam…')}{:else}<Mic size={15}/>{tr('Sprawdź dostęp do mikrofonu')}{/if}</Button>
        <Button variant="outline" disabled={checking} onclick={refreshMic}><RefreshCw size={15}/>{tr('Odśwież uprawnienia')}</Button>
        {#if desktop}<Button variant="ghost" onclick={openMicSettings}><ExternalLink size={15}/>{tr('Otwórz ustawienia mikrofonu Windows')}</Button>{/if}
      </div>
      {#if checking}<div class="p-progress" role="status"><progress class="p-bar" aria-label={tr('Sprawdzanie mikrofonu')}></progress><span>{tr('Czekam na odpowiedź systemu…')}</span></div>{/if}
      <p class="p-sub">{tr('Test otwiera strumień i od razu go zamyka; nie zapisuje dźwięku. Stan zgody nie dowodzi, że inna aplikacja nie blokuje urządzenia.')}</p>
    </div>
  </section>
</div>

<style>
  .card{display:flex;flex-direction:column;gap:18px}
  .inline{display:flex;align-items:center;gap:10px}
  /* same as the app's .shortcuts-page kbd (navigation-layout.css) */
  kbd{font:inherit;border:1px solid var(--border);background:var(--surface);padding:3px 6px;border-radius:4px}
  .sep{color:var(--muted);margin:0 5px;font-size:var(--ui-text-12)}
  .p-kv dd{display:flex;align-items:center;justify-content:flex-end;flex-wrap:wrap}
  .p-kv>div{align-items:center;padding:11px 0}
  .p-kv dt{font-size:var(--ui-text-13);color:var(--foreground)}
  .keys{display:flex;align-items:center;min-height:34px;padding:0 10px;border:1px solid var(--border);border-radius:8px;background:var(--background)}
  .keys.listening{border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 22%,transparent)}
  .hint{display:inline-flex;align-items:center;gap:6px;color:var(--accent);font-size:var(--ui-text-12)}
  .off .keys{opacity:.5}
  .foot{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}
  .foot .p-sub{margin:0}
  .p-card :global(.spin){animation:rot .8s linear infinite;color:var(--accent)}@keyframes rot{to{transform:rotate(360deg)}}
  @media(prefers-reduced-motion:reduce){.p-card :global(.spin){animation:none}}
</style>
