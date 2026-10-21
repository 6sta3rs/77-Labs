<script lang="ts">
  import Button from '../../ui/Button.svelte';
  import { onMount } from 'svelte';
  import { FolderOpen, Play, Square } from '@lucide/svelte';
  import Input from '../../ui/Input.svelte';
  import Select from '../../ui/Select.svelte';
  import { automationCanRun, type AutomationRecipe } from './automation';
  import { watchFolder, emptyWatchStatus } from './watch-folder';

  let { recipes, ready, disabled = false }: { recipes: AutomationRecipe[]; ready: boolean; disabled?: boolean } = $props();
  const uid = $props.id();
  let status = $state(emptyWatchStatus()), path = $state(''), recipeId = $state(''), busy = $state(false), error = $state('');
  let mounted = false;
  const selected = $derived(recipes.find(recipe => recipe.id === recipeId && recipe.inputKind === 'audio'));
  const audioRecipes = $derived(recipes.filter(recipe => recipe.inputKind === 'audio'));
  const sourceReady = $derived(!!selected && automationCanRun(selected, ready));
  function fail(cause: unknown) { if (mounted) error = cause instanceof Error ? cause.message : String(cause); }
  async function choose() {
    if (busy || status.enabled) return;
    busy = true; error = '';
    try { const chosen = await watchFolder.pick(); if (mounted && chosen) path = chosen; } catch (cause) { fail(cause); } finally { if (mounted) busy = false; }
  }
  async function start() {
    if (busy || !sourceReady || disabled || !selected) return;
    busy = true; error = '';
    try { await watchFolder.start(path, selected); } catch (cause) { fail(cause); } finally { if (mounted) busy = false; }
  }
  async function stop() {
    error = ''; try { await watchFolder.stop(); } catch (cause) { fail(cause); }
  }
  onMount(() => {
    mounted = true;
    if (!watchFolder.available()) return () => { mounted = false; };
    let live = true;
    const unsubscribe = watchFolder.subscribe(value => {
      if (!live) return;
      status = value;
      if (!path) path = value.path;
      if (!recipeId) recipeId = value.recipeId;
    });
    void watchFolder.initialize().catch(cause => { if (live) fail(cause); });
    return () => { mounted = false; live = false; unsubscribe(); };
  });
  $effect(() => { if (!ready && status.enabled && watchFolder.requiresRuntime()) void watchFolder.stop('Silnik nie jest gotowy. Włącz obserwację ponownie po jego przygotowaniu.').catch(fail); });
</script>

<section class="tool-workspace-section watch-folder" aria-label="Obserwowany folder">
  <h2>Obserwowany folder</h2>
  {#if !watchFolder.available()}
    <p class="tool-workspace-note">Ta funkcja wymaga aplikacji desktopowej i lokalnego mostu plików.</p>
  {:else}
    <p class="tool-workspace-note">Domyślnie wyłączony. Włączenie dodaje istniejące i nowe nagrania z tego folderu do wybranej receptury. Podfoldery są pomijane. Pliki źródłowe pozostają bez zmian.</p>
    <label for={`${uid}-path`}>Lokalny folder wejściowy</label>
    <div class="watch-path"><Input id={`${uid}-path`} bind:value={path} disabled={status.enabled || busy} placeholder="C:\Nagrania\Do-przetworzenia"/><Button variant="outline" disabled={status.enabled || busy} onclick={choose}><FolderOpen size={14}/>Wybierz folder</Button></div>
    <Select ariaLabel="Zapisana receptura dla folderu" value={recipeId} disabled={status.enabled || busy} onchange={value => recipeId = value} options={[{ value: '', label: 'Wybierz zapisaną recepturę audio', disabled: true }, ...audioRecipes.map(recipe => ({ value: recipe.id, label: recipe.name }))]}/>
    {#if !audioRecipes.length}<p class="tool-workspace-note">Najpierw zapisz recepturę z wejściem audio.</p>{/if}
    <p class:watch-error={status.state === 'error'} class="watch-status" role="status">{status.enabled ? 'Włączony' : 'Wyłączony'} · {status.message}</p>
    {#if status.lastScan}<small>Ostatni odczyt: {new Date(status.lastScan).toLocaleTimeString('pl')} · oczekujące pliki: {status.pending.length} · pominięte wpisy: {status.skipped} · trwałe potwierdzenia: {status.acknowledged}</small>{/if}
    {#if error}<p class="tool-error" role="alert">{error}</p>{/if}
    <div class="tool-actions">
      {#if status.enabled}<Button variant="outline" onclick={stop}><Square size={14}/>Zatrzymaj źródło wejść</Button>{:else}<Button variant="outline" disabled={busy || !sourceReady || disabled || !path.trim()} onclick={start}><Play size={14}/>{busy ? 'Przygotowywanie…' : 'Włącz obserwację i kolejkę'}</Button>{/if}
    </div>
    <p class="tool-workspace-note">Audio do 64 MB: WAV, MP3, FLAC, OGG, M4A, AAC, Opus i WebM. Plik czeka co najmniej 3 s bez zmiany rozmiaru i daty; na Windows także na zwolnienie uchwytu zapisu. Zalecany zapis do pliku tymczasowego i dopiero potem zmiana nazwy na docelowe audio. Obserwacja używa kopii receptury z chwili włączenia. Zatrzymanie źródła nie anuluje zadań już dodanych do kolejki.</p>
  {/if}
</section>

<style>
  .watch-folder{display:flex;flex-direction:column;gap:12px}.watch-folder>label{font-size:var(--ui-text-12);color:var(--muted)}.watch-path{display:flex;gap:9px;align-items:center;flex-wrap:wrap}.watch-path :global(input){min-width:180px;flex:1}.watch-path>:global([data-slot="button"]){white-space:nowrap}.watch-status,.watch-folder>small{font-size:var(--ui-text-11);line-height:1.7;color:var(--muted);overflow-wrap:anywhere;margin:0}.watch-error{color:var(--warning,#d4a56b)}.watch-folder .tool-actions{margin:0}
</style>
