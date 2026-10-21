<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { productionJson, postJson } from './production'
  import Button from './ui/Button.svelte'
  import Select from './ui/Select.svelte'
  type Environment = { id:string;name:string;dependencies_ready:boolean;weights_ready:boolean;configured:boolean;reason:string;setup?:{state:string;message:string}|null }
  let { onchange }: { onchange?:()=>Promise<void> } = $props()
  let engines=$state<Environment[]>([]),error=$state(''),busy=$state(false),device=$state('cpu')
  let fishUrl=$state('http://127.0.0.1:8080'),fishConfirmed=$state(false)
  let disposed=false, controller:AbortController|undefined, timer:ReturnType<typeof setTimeout>|undefined
  const installing=$derived(engines.some(engine=>engine.setup&&['creating','installing','checking'].includes(engine.setup.state)))
  async function refresh(){
    if(disposed)return
    clearTimeout(timer)
    controller?.abort();const current=new AbortController();controller=current
    try{
      const data=await productionJson<{engines:Environment[]}>('/next/tts/status',{signal:current.signal})
      if(disposed||controller!==current)return
      const wasInstalling=installing;engines=data.engines;error=''
      if(wasInstalling&&!installing)await onchange?.()
      if(installing)timer=setTimeout(()=>void refresh(),2000)
    }catch(cause){if(!disposed&&controller===current&&!current.signal.aborted)error=cause instanceof Error?cause.message:String(cause)}
  }
  async function prepare(id:string){
    busy=true;error=''
    try{await productionJson('/next/tts/prepare',postJson({engine_id:id,device}));await refresh()}
    catch(cause){error=cause instanceof Error?cause.message:String(cause)}
    finally{busy=false}
  }
  async function configureFish(){
    busy=true;error=''
    try{await productionJson('/next/tts/fish-service',{...postJson({url:fishUrl,confirmed_model:fishConfirmed}),method:'PUT'});await refresh();await onchange?.()}
    catch(cause){error=cause instanceof Error?cause.message:String(cause)}
    finally{busy=false}
  }
  onMount(()=>{void refresh()})
  onDestroy(()=>{disposed=true;controller?.abort();clearTimeout(timer)})
</script>

<section class="extra-tts" aria-label="Dodatkowe silniki TTS">
  <header><div><h2>Dodatkowe modele TTS</h2><p>Biblioteki każdego silnika są przygotowywane osobno. Wagi pobierzesz w katalogu poniżej.</p></div><Button variant="ghost" size="sm" disabled={busy} onclick={()=>void refresh()}>Odśwież stan</Button></header>
  {#if error}<p class="tool-error" role="alert">{error}</p>{/if}
  {#if engines.length}
    <div class="device"><Select label="Obliczenia dla nowych środowisk" ariaLabel="Obliczenia dodatkowych modeli" bind:value={device} options={[{value:'cpu',label:'Procesor (CPU)'},{value:'cuda',label:'Karta NVIDIA (CUDA)'}]}/><p>Kokoro i KittenTTS 0.8 działają na CPU. Fish korzysta z własnej usługi Linux/WSL.</p></div>
    <div class="environment-list">{#each engines as engine}<article><div><strong>{engine.name}</strong><p>{engine.dependencies_ready?'Biblioteki gotowe':'Brak bibliotek'} · {engine.weights_ready?'Wagi lokalne':'Brak kompletnych wag'}</p>{#if engine.setup&&['creating','installing','checking','failed'].includes(engine.setup.state)}<p role="status">{engine.setup.message}</p>{/if}{#if !engine.configured}<p>{engine.reason}</p>{/if}</div><Button variant="outline" size="sm" disabled={busy||installing||engine.dependencies_ready} onclick={()=>void prepare(engine.id)}>{engine.dependencies_ready?'Przygotowano':'Przygotuj biblioteki'}</Button></article>{/each}</div>
    <details><summary>Połączenie z Fish S2 Pro</summary><p>Uruchom własną usługę S2 Pro w Linux/WSL. Adres musi wskazywać ten komputer. Odpowiedź health potwierdza transport; model wskazujesz na podstawie konfiguracji swojej usługi.</p><label>Adres lokalnej usługi<input class="text-input" bind:value={fishUrl}/></label><label class="tool-checkbox"><input type="checkbox" bind:checked={fishConfirmed}/> Usługa korzysta z fishaudio/s2-pro, rewizja 1de9996b6be38b745688de084d87a5633f714e4e.</label><Button variant="outline" size="sm" disabled={!fishConfirmed||busy} onclick={()=>void configureFish()}>Zapisz połączenie Fish</Button></details>
  {/if}
</section>

<style>
  .extra-tts{margin:24px 0;border:1px solid var(--border);border-radius:10px;padding:18px}.extra-tts header{display:flex;gap:16px;justify-content:space-between;align-items:flex-start}.extra-tts h2{font-size:var(--ui-text-15)}.extra-tts p{font-size:var(--ui-text-12);line-height:1.6;color:var(--muted);margin:5px 0 0}.device{display:grid;grid-template-columns:minmax(180px,280px) 1fr;gap:20px;align-items:end;margin:20px 0}.environment-list{display:grid}.environment-list article{display:flex;gap:16px;align-items:center;justify-content:space-between;padding:13px 0;border-top:1px solid var(--border)}.environment-list strong{font-size:var(--ui-text-13);font-weight:600}.environment-list article>div{min-width:0}@media(max-width:640px){.device{grid-template-columns:1fr;gap:8px}.environment-list article{align-items:flex-start;flex-wrap:wrap}}
</style>
