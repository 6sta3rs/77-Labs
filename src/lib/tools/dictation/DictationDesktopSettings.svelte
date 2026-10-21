<script lang="ts">
  import { uiLanguage, createUiTranslator } from "../../i18n"
  const tr = $derived(createUiTranslator($uiLanguage))

  import Button from '../../ui/Button.svelte';
  import { onDestroy, onMount } from 'svelte';
  import { Save, AppWindow, Keyboard } from '@lucide/svelte';
  import Switch from '../../ui/Switch.svelte';
  import { configureDesktopDictation, defaultDictationDesktopPreferences, desktopDictationStatus, shortcutError, showDictationWidget, watchDesktopDictation, type DictationDesktopPreferences, type DictationDesktopStatus } from './dictation-desktop';
  import '../studio-tools.css';
  const uid=$props.id();let status=$state<DictationDesktopStatus>(),draft=$state<DictationDesktopPreferences>(defaultDictationDesktopPreferences()),edited=$state(false),busy=$state(false),error=$state(''),message=$state('');
  const invalid=$derived(draft.enabled?shortcutError(draft.shortcut):'');let disposed=false;const lifecycle=new AbortController();
  function apply(value:DictationDesktopStatus){if(disposed)return;status=value;if(!edited)draft={...value.preferences};}
  async function save(){if(busy||invalid||!status?.supported)return;busy=true;error='';message='';try{const value=await configureDesktopDictation(draft);if(disposed)return;edited=false;apply(value);message=value.registered?'Zapisano ustawienia. Globalny skrót jest aktywny.':'Zapisano ustawienia. Globalny skrót jest wyłączony.';}catch(cause){if(!disposed)error=(cause as Error).message;}finally{if(!disposed)busy=false;}}
  async function show(){error='';try{apply(await showDictationWidget());}catch(cause){if(!disposed)error=(cause as Error).message;}}
  onMount(()=>{void desktopDictationStatus().then(apply).catch(cause=>{if(!disposed)error=(cause as Error).message;});void watchDesktopDictation({status:apply},lifecycle.signal).catch(cause=>{if(!disposed)error=(cause as Error).message;});});
  onDestroy(()=>{disposed=true;lifecycle.abort();});
</script>

<section class="studio-tools dictation-desktop-settings" aria-label={tr("Dyktowanie Windows i globalny skrót")}><div class="page-heading"><div><h2>{tr("Dyktowanie w innych oknach")}</h2><p>{tr("Globalny skrót otwiera pływające okno. Mikrofon uruchamiasz osobnym przyciskiem.")}</p></div><Keyboard size={22}/></div>
  {#if error}<p class="tool-error" role="alert">{tr(String(error))}</p>{/if}{#if status?.error}<p class="tool-error" role="alert">{tr(String(status.error))}</p>{/if}{#if message}<p class="tool-notice" role="status">{tr(String(message))}</p>{/if}
  {#if status&&!status.supported}<p class="tool-notice">{tr("Globalny skrót, pływające okno i natywne wklejanie są dostępne w aplikacji desktopowej na Windows.")}</p>{/if}
  <div class="tool-card"><div class="desktop-switch"><span>{tr("Włącz globalny skrót")}</span><Switch label={tr("Włącz globalny skrót dyktowania")} checked={draft.enabled} onchange={value=>{draft={...draft,enabled:value};edited=true;}} disabled={busy||!status?.supported}/></div><label for={`${uid}-shortcut`}>{tr("Kombinacja klawiszy")}</label><input id={`${uid}-shortcut`} class="text-input" value={draft.shortcut} oninput={event=>{draft={...draft,shortcut:event.currentTarget.value};edited=true;}} disabled={busy||!status?.supported} placeholder={tr("Ctrl+Alt+Shift+D")} spellcheck="false"/><p class="page-footnote">{tr("Wybierz co najmniej dwa modyfikatory i literę, cyfrę, Space lub F1–F24 z wyjątkiem F12. Windows zgłosi konflikt zajętej kombinacji przy zapisie.")}</p>{#if invalid}<p class="tool-error" role="alert">{invalid}</p>{/if}
    <div class="desktop-switch"><span>{tr("Włącz przycisk wklejania do poprzedniego okna")}</span><Switch label={tr("Włącz ręczne wklejanie dyktowania do poprzedniego okna")} checked={draft.paste_enabled} onchange={value=>{draft={...draft,paste_enabled:value};edited=true;}} disabled={busy||!status?.supported}/></div><p class="page-footnote">{tr("Przywołaj widget globalnym skrótem z wybranego dokumentu. Po zakończeniu kliknij „Wklej” przy pokazanym tytule okna. Kopiowanie i wklejanie są oddzielnymi, jawnymi akcjami. Globalny skrót i przycisk wklejania są domyślnie wyłączone.")}</p>
    <p class="page-footnote" role="status">{tr("Stan systemowy:")} {status?.registered?tr('zarejestrowano {shortcut}',{shortcut:status.active_shortcut ?? ''}):tr("skrót nieaktywny")}.</p><div class="tool-actions"><Button variant="default" disabled={busy||!edited||!!invalid||!status?.supported} onclick={save}><Save size={15}/>{busy?tr('Zapisywanie…'):tr("Zapisz ustawienia dyktowania")}</Button><Button variant="outline" disabled={busy||!status?.supported} onclick={show}><AppWindow size={15}/>{tr("Pokaż pływające okno")}</Button></div>
  </div>
</section>
<style>.dictation-desktop-settings{margin-top:28px}.desktop-switch{display:flex;justify-content:space-between;gap:18px;align-items:center;font-size:var(--ui-text-13);line-height:1.7}</style>
