<script lang="ts">
  import { ArrowLeft, AudioLines, Mic, WandSparkles } from '@lucide/svelte';
  import type { Profile } from '../platform/api';
  import Button from '../ui/Button.svelte';
  import ButtonGroup from '../ui/ButtonGroup.svelte';
  import VoiceCloneForm from './VoiceCloneForm.svelte';
  import VoiceDesignForm from './VoiceDesignForm.svelte';

  let { ready, oncreated, oncancel }: {
    ready: boolean; oncreated: (profile: Profile) => Promise<void>; oncancel: () => void;
  } = $props();
  let method = $state<'clone' | 'design'>('clone'), busy = $state(false);
</script>

<section class="voice-create-page" aria-labelledby="voice-create-title">
  <header class="voice-create-heading"><Button variant="ghost" size="sm" onclick={oncancel}><ArrowLeft size={16}/>Wróć</Button><div class="voice-create-title"><div class="voice-create-icon"><AudioLines size={24}/></div><div><h1 id="voice-create-title">Dodaj głos</h1><p>Wybierz sposób tworzenia i przygotuj głos do swojej biblioteki.</p></div></div></header>
  <div class="voice-create-layout">
    <aside class="voice-create-guide" aria-label="Sposób tworzenia głosu"><h2>Sposób tworzenia</h2><ButtonGroup label="Sposób tworzenia głosu" mode="single" value={method} disabled={busy} onchange={value => { method = value === 'design' ? 'design' : 'clone'; }} items={[{ value: 'clone', label: 'Klonuj głos', icon: Mic }, { value: 'design', label: 'Zaprojektuj głos', icon: WandSparkles }]}/><p>{method === 'clone' ? 'Zachowaj brzmienie z nagrania. Wczytaj próbkę albo użyj mikrofonu i dodaj jej tekst.' : 'Stwórz nowe brzmienie bez nagrania. Wybierz barwę, wiek, wysokość głosu i sposób mówienia.'}</p><div class="voice-create-hint"><h3>{method === 'clone' ? 'Przygotuj próbkę' : 'Dobierz charakter'}</h3><p>{method === 'clone' ? 'Najlepiej sprawdza się 10–30 sekund wyraźnej mowy jednej osoby, bez muzyki i pogłosu.' : 'Zacznij od kilku cech. Pozostaw „Automatycznie” przy ustawieniach, których nie chcesz określać.'}</p></div></aside>
    <div class="voice-create-form"><div class="voice-create-form-heading"><h2>{method === 'clone' ? 'Klonowanie głosu' : 'Projektowanie głosu'}</h2><p>{method === 'clone' ? 'Nagranie i dane nowego głosu' : 'Nazwa i cechy nowego brzmienia'}</p></div>{#if method === 'clone'}<VoiceCloneForm {ready} {oncreated} {oncancel} onbusychange={value => busy = value}/>{:else}<VoiceDesignForm {ready} {oncreated} {oncancel} onbusychange={value => busy = value}/>{/if}</div>
  </div>
</section>

<style>
  .voice-create-page{width:min(1120px,100%);margin:0 auto;padding:32px clamp(20px,4vw,48px) 48px;min-width:0;color:var(--foreground);font-size:var(--ui-font-size)}.voice-create-heading{display:grid;justify-items:start;gap:26px;margin-bottom:30px}.voice-create-title{display:flex;align-items:center;gap:16px;min-width:0}.voice-create-icon{display:grid;place-items:center;flex:none;width:48px;height:48px;border:1px solid var(--border);border-radius:14px;background:var(--surface-raised)}h1,h2,h3,p{margin:0}h1{font-size:1.85em;line-height:1.2;letter-spacing:-.025em}.voice-create-title p,.voice-create-form-heading p{margin-top:8px;line-height:1.5;color:var(--foreground)}.voice-create-layout{display:grid;grid-template-columns:280px minmax(0,1fr);gap:40px;align-items:start}.voice-create-guide{display:grid;gap:18px;min-width:0}.voice-create-guide h2,.voice-create-form-heading h2{font-size:1.15em}.voice-create-guide>p,.voice-create-hint p{line-height:1.65;color:var(--foreground)}.voice-create-guide :global(.vs-button-group){display:flex;flex-direction:column;width:100%;gap:8px;border:0;background:none}.voice-create-guide :global(.vs-group-button){width:100%;justify-content:flex-start;min-height:44px;border-radius:10px}.voice-create-hint{padding:18px;border:1px solid var(--border);border-radius:12px;background:var(--surface-raised)}.voice-create-hint h3{font-size:1em;margin-bottom:8px}.voice-create-form{min-width:0;padding:24px;border:1px solid var(--border);border-radius:16px;background:var(--surface)}.voice-create-form-heading{padding-bottom:22px;margin-bottom:22px;border-bottom:1px solid var(--border)}@media(max-width:850px){.voice-create-layout{grid-template-columns:minmax(0,1fr);gap:24px}.voice-create-guide :global(.vs-button-group){flex-direction:row}.voice-create-guide :global(.vs-group-button){flex:1;justify-content:center}.voice-create-hint{display:none}}@media(max-width:480px){.voice-create-page{padding:20px 14px 32px}.voice-create-form{padding:18px}.voice-create-title{align-items:flex-start;gap:12px}.voice-create-icon{width:40px;height:40px}.voice-create-title p{font-size:.95em}.voice-create-guide :global(.vs-group-button){white-space:normal;min-width:0}}
</style>
