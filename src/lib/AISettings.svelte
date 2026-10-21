<script lang="ts">
  import Button from './ui/Button.svelte';
  import { onMount } from 'svelte';
  import { Check, LoaderCircle, RefreshCw, Sparkles } from '@lucide/svelte';
  import Select from './ui/Select.svelte';
  import Switch from './ui/Switch.svelte';
  import { getAISettings, getAIStatus, saveAISettings, testAI, type AISettings, type AIStatus, type EnhanceResult } from './ai';

  let { embedded = false }: { embedded?: boolean } = $props();
  let settings = $state<AISettings>({ enabled: true, model: '', intensity: 'natural', reactions: true });
  let connection = $state<AIStatus>();
  let loading = $state(true);
  let busy = $state(false);
  let loaded = $state(false);
  let error = $state('');
  let message = $state('');
  let result = $state<(EnhanceResult & { input: string[] })>();
  let controller: AbortController | undefined;
  let pending = false, disposed = false;
  const locked = $derived(!loaded || busy || loading);
  const selectedModelMissing = $derived(Boolean(settings.model && connection?.connected && !connection.models.some(model => model.id === settings.model)));
  function modelChoices() {
    const models = connection?.models ?? [];
    return [
      { value: '', label: `Domyślny Codex${connection?.defaultModel ? ` · ${connection.defaultModel}` : ''}` },
      ...models.map(model => ({ value: model.id, label: model.name })),
      ...(settings.model && !models.some(model => model.id === settings.model) ? [{ value: settings.model, label: `${settings.model} · brak w bieżącym katalogu`, disabled: true }] : []),
    ];
  }
  const models = $derived.by(modelChoices);
  function changeSettings(next: Partial<AISettings>) {
    if (!loaded || loading || busy || disposed) return;
    if (next.model !== undefined && (!connection?.connected || next.model && !connection.models.some(model => model.id === next.model))) return;
    settings = { ...settings, ...next }; result = undefined; message = '';
  }
  function fail(cause: unknown) {
    error = cause instanceof Error && cause.name === 'TimeoutError'
      ? 'Usługa AI nie odpowiedziała na czas. Spróbuj ponownie.'
      : cause instanceof Error ? cause.message : String(cause);
  }

  async function refresh() {
    if (busy || pending || disposed) return;
    const current = new AbortController(); controller = current; pending = true;
    loading = true; error = ''; message = ''; connection = undefined; result = undefined;
    try {
      const [saved, status] = await Promise.all([getAISettings(current.signal), getAIStatus(current.signal)]);
      current.signal.throwIfAborted();
      if (disposed || controller !== current) return;
      settings = saved; connection = status; loaded = true;
    } catch (cause) { if (!current.signal.aborted && !disposed) fail(cause); }
    finally { if (controller === current) { controller = undefined; pending = false; if (!disposed) loading = false; } }
  }
  async function save(test = false) {
    if (!loaded || loading || busy || disposed || test && (!connection?.connected || !settings.enabled || settings.model && !connection.models.some(model => model.id === settings.model))) return;
    const current = new AbortController(); controller = current;
    busy = true; error = ''; message = ''; result = undefined;
    try {
      const saved = await saveAISettings({ ...settings }, current.signal);
      current.signal.throwIfAborted(); if (disposed || controller !== current) return; settings = saved;
      message = 'Zapisano ustawienia AI.';
      if (test) {
        const tested = await testAI(current.signal);
        current.signal.throwIfAborted(); if (disposed || controller !== current) return; result = tested;
        message = 'Test zakończony. Codex odpowiedział przez zalogowane konto ChatGPT.';
      }
    } catch (cause) { if (!current.signal.aborted && !disposed) fail(cause); }
    finally { if (controller === current) { controller = undefined; if (!disposed) busy = false; } }
  }
  onMount(() => { void refresh(); return () => { disposed = true; controller?.abort(); }; });
</script>

<div class="ai-settings" class:embedded>
  <header><Sparkles size={embedded ? 20 : 24}/><div>{#if embedded}<h2>OpenAI — połączenie przez Codex/ChatGPT</h2>{:else}<h1>AI i subskrypcja</h1>{/if}<p>Automatyczne tagowanie w edytorze korzysta z modelu zapisanego poniżej.</p></div></header>
  <section class="connection-card" aria-label="Połączenie OpenAi przez Codex">
    <div class="connection-heading"><strong>OpenAi · ChatGPT przez Codex</strong><span class:connected={connection?.connected}>{loading ? 'Sprawdzanie…' : connection?.connected ? 'Połączono' : 'Brak połączenia'}</span></div>
    {#if connection}<p>{connection.message}{#if connection.connected && connection.plan}{' '}Plan konta: <strong>{connection.plan}</strong>.{/if}</p>{#if connection.connected}<p>Modele językowe w bieżącym katalogu Codex: <strong>{connection.models.length}</strong>. Lista pochodzi z aktualnego odczytu połączenia.</p>{/if}{/if}
    <p>Korzysta z istniejącego logowania Codex i limitów Twojej subskrypcji. Tekst narracji jest wysyłany do OpenAI.</p>
    <p>Połączenie korzysta z profilu Codex zalogowanego na tym komputerze.</p>
    {#if connection && !connection.connected}<p>Zaloguj Codex na tym komputerze poleceniem <code>codex login</code>, a następnie odśwież połączenie.</p>{/if}
    <Button variant="outline" disabled={loading || busy} onclick={refresh}><RefreshCw size={14}/>Odśwież połączenie</Button>
  </section>
  <section class="options" aria-label="Ustawienia automatycznego tagowania">
    <div class="option-row"><div><h2>Automatyczne tagowanie AI</h2><p>Dodawaj pauzy i reakcje dopasowane do treści narracji.</p></div><Switch label="Automatyczne tagowanie AI" checked={settings.enabled} disabled={locked} onchange={(enabled) => changeSettings({ enabled })}/></div>
    <div class="field"><Select label="Model językowy OpenAi" value={settings.model} disabled={locked || !connection?.connected} onchange={(model) => changeSettings({ model })} options={models}/></div>
    {#if selectedModelMissing}<p class="note" role="status">Zapisany model {settings.model} nie występuje w bieżącym katalogu. Wybierz dostępny model lub domyślny Codex i zapisz zmianę.</p>{/if}
    <div class="field"><Select label="Intensywność tagowania" value={settings.intensity} disabled={locked} onchange={(intensity) => changeSettings({ intensity: intensity as AISettings['intensity'] })} options={[{value:'subtle',label:'Subtelna — głównie pauzy'},{value:'natural',label:'Naturalna — oszczędne reakcje'},{value:'expressive',label:'Ekspresyjna — więcej reakcji'}]}/></div>
    <div class="option-row"><div><h2>Reakcje głosowe</h2><p>Pozwól AI dodać śmiech, westchnienia i krótkie wokalizacje. Po wyłączeniu dodaje tylko pauzy.</p></div><Switch label="Reakcje głosowe AI" checked={settings.reactions} disabled={locked} onchange={(reactions) => changeSettings({ reactions })}/></div>
  </section>
  <p class="note">Tagi są dopasowane do OmniVoice. Wynik zachowuje słowa i interpunkcję; nieobsługiwane znaczniki i zmiany treści są odrzucane. Operację w edytorze możesz cofnąć.</p>
  <div class="actions"><Button variant="default" disabled={locked} onclick={() => save()}><Check size={15}/>Zapisz ustawienia</Button><Button variant="outline" disabled={locked || !connection?.connected || !settings.enabled || selectedModelMissing} onclick={() => save(true)}>{#if busy}<LoaderCircle class="spin" size={15}/>{:else}<Sparkles size={15}/>{/if}{busy ? 'Oczekiwanie na Codex…' : 'Zapisz i przetestuj'}</Button></div>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  {#if message}<p class="message" role="status">{message}</p>{/if}
  {#if result}<section class="test-result" aria-label="Wynik testu AI"><h2>Test na Twojej subskrypcji</h2><p>Model: {result.model} · {result.seconds.toLocaleString('pl-PL')} s</p><h3>Przed</h3><pre>{result.input.join('\n\n')}</pre><h3>Po tagowaniu</h3><pre>{result.enhanced_blocks.join('\n\n')}</pre></section>{/if}
</div>

<style>
  .ai-settings.embedded{max-width:none;margin:22px 0 26px;padding:0}.embedded>header{align-items:flex-start;margin-bottom:18px}.embedded>header h2{font-size:var(--ui-text-15);font-weight:600;line-height:1.6}.embedded .connection-card,.embedded .options,.embedded .test-result{padding:16px;margin-bottom:14px}.embedded .field{margin:18px 0}.embedded .actions{margin-top:18px}
  .ai-settings{max-width:760px;margin:auto;padding:40px clamp(20px,4vw,56px);font-size:var(--ui-font-size,13px)}header{display:flex;gap:14px;align-items:center;margin-bottom:28px}header :global(svg){color:var(--accent);flex-shrink:0}header p,.connection-card p,.note,.option-row p,.test-result>p{color:var(--muted);line-height:1.65;margin-top:7px;font-size:var(--ui-text-12)}.connection-card,.options,.test-result{border:1px solid var(--border);border-radius:10px;background:var(--surface);padding:20px;margin-bottom:20px}.connection-heading{display:flex;align-items:center;justify-content:space-between;gap:16px}.connection-heading>span{color:var(--muted);font-size:var(--ui-text-11)}.connection-heading>span.connected{color:var(--accent)}.connection-card :global([data-slot="button"]){margin-top:16px}.option-row{display:flex;align-items:center;justify-content:space-between;gap:24px}.option-row>div{flex:1}.option-row h2,.test-result h2{font-size:var(--ui-text-13);font-weight:550}.option-row :global(.vs-switch-label){font-size:0}.field{margin:22px 0}.option-row p{max-width:510px}.actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:22px}.message,.error{font-size:var(--ui-text-12);line-height:1.7;margin:18px 0}.error{color:var(--destructive,#f17272)}.message{color:var(--accent)}.test-result{margin-top:20px}.test-result h3{font-size:var(--ui-text-11);font-weight:500;color:var(--muted);margin:18px 0 8px}.test-result pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;line-height:1.8;margin:0}.note{margin:0}code{font-size:var(--ui-text-12)}:global(.ai-settings .spin){animation:ai-spin 1s linear infinite}@keyframes ai-spin{to{transform:rotate(360deg)}}
</style>
