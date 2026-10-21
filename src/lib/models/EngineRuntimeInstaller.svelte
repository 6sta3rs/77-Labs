<script lang="ts">
  import Button from '../ui/Button.svelte';
  import { onDestroy } from 'svelte';
  import { openLicenseSource, validateLicenseSource } from './license-sources';
  import { RefreshCw, Download, Square, Check } from '@lucide/svelte';
  import { engineInstallation, runtimeInstallActive, runtimeInstallLabels, runtimePhaseLabels, runtimeSize, runtimeTransfer,
    type EngineRuntimeCatalog, type EngineRuntimeJob, type EngineRuntimeRecipe } from './engine-installation';
  import '../tools/studio-tools.css';
  let { ready, onchange, onrestart }: { ready: boolean; onchange?: () => void | Promise<void>; onrestart?: () => Promise<void> } = $props();
  let opened=$state(false), catalog=$state<EngineRuntimeCatalog>(), jobs=$state<EngineRuntimeJob[]>([]), loading=$state(false), action=$state(false);
  let reviewing=$state(''), accepted=$state(false), error=$state(''), message=$state('');
  let readController:AbortController|undefined, actionController:AbortController|undefined, disposed=false;
  const active=$derived(jobs.some(runtimeInstallActive));
  const jobFor=(id:string)=>jobs.find(job=>job.engine_id===id);
  function fail(cause:unknown){if(!disposed&&(cause as Error).name!=='AbortError')error=(cause as Error).message||String(cause);}
  function canOpenSource(url:string){try{validateLicenseSource(url);return true;}catch{return false;}}
  async function openSource(url:string){try{await openLicenseSource(url);}catch(cause){fail(cause);}}
  async function copySource(url:string){try{await navigator.clipboard.writeText(url);message='Skopiowano adres źródła. Otwórz go w swojej przeglądarce.';}catch{error='Nie udało się skopiować. Zaznacz widoczny adres źródła i skopiuj go ręcznie.';}}
  async function refresh(signal:AbortSignal, includeCatalog=true){
    const [nextCatalog,nextJobs]=await Promise.all([includeCatalog?engineInstallation.catalog(signal):Promise.resolve(undefined),engineInstallation.jobs(signal)]);
    signal.throwIfAborted();if(disposed)return;
    if(nextCatalog){catalog=nextCatalog;if(reviewing&&!nextCatalog.engines.some(recipe=>recipe.disclosure_id===reviewing)){reviewing='';accepted=false;}}
    jobs=nextJobs.jobs;
  }
  async function reload(){
    if(!ready||loading||action)return;
    readController?.abort();const current=new AbortController();readController=current;loading=true;error='';
    try{await refresh(current.signal);}catch(cause){if(!current.signal.aborted)fail(cause);}finally{if(readController===current&&!disposed)loading=false;}
  }
  async function work(fn:(signal:AbortSignal)=>Promise<void>){
    if(!ready||action||loading||disposed)return;
    const current=new AbortController();actionController=current;action=true;error='';message='';
    try{await fn(current.signal);}catch(cause){if(!current.signal.aborted)fail(cause);}finally{if(actionController===current&&!disposed)action=false;}
  }
  async function install(recipe:EngineRuntimeRecipe){await work(async signal=>{
    await engineInstallation.install(recipe,reviewing,accepted,signal);signal.throwIfAborted();reviewing='';accepted=false;
    message='Uruchomiono prywatny instalator. Możesz zamknąć ten panel; postęp zostanie zapisany.';await refresh(signal,false);await onchange?.();
  });}
  async function cancel(recipe:EngineRuntimeRecipe){await work(async signal=>{
    await engineInstallation.cancel(recipe.engine_id,signal);signal.throwIfAborted();
    message='Wysłano żądanie zatrzymania. Anulowanie zostanie potwierdzone po zakończeniu całego drzewa instalatora.';await refresh(signal,false);
  });}
  async function activate(recipe:EngineRuntimeRecipe){await work(async signal=>{
    const response=await engineInstallation.activate(recipe,signal);signal.throwIfAborted();
    message=response.restart_required?'Zapisano środowisko tego silnika. Uruchom ponownie lokalny silnik, aby je udostępnić.':'Zapisano środowisko silnika.';
    await refresh(signal,false);await onchange?.();
  });}
  $effect(()=>{
    if(!ready||!opened)return;
    const current=new AbortController();readController=current;loading=true;
    void refresh(current.signal).catch(cause=>{if(!current.signal.aborted)fail(cause);}).finally(()=>{if(!current.signal.aborted&&!disposed)loading=false;});
    return()=>{current.abort();readController?.abort();actionController?.abort();loading=false;action=false;};
  });
  $effect(()=>{
    if(!ready||!opened||!active)return;
    const current=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
    const poll=async()=>{try{await refresh(current.signal,false);}catch(cause){if(!current.signal.aborted)fail(cause);}finally{if(!current.signal.aborted)timer=setTimeout(poll,1500);}};
    timer=setTimeout(poll,1000);return()=>{current.abort();if(timer)clearTimeout(timer);};
  });
  onDestroy(()=>{disposed=true;readController?.abort();actionController?.abort();});
</script>

<details class="studio-tools engine-runtime-installer" bind:open={opened}>
  <summary>Środowiska dodatkowych silników</summary>
  <p class="page-footnote">Niektóre silniki wymagają osobnego Pythona i bibliotek albo programu audio.cpp. Tutaj przygotujesz je w prywatnym katalogu aplikacji. Wagi modeli pobierzesz w katalogu modeli, chyba że receptura poniżej wyraźnie obejmuje ich instalację.</p>
  {#if !ready}<p class="tool-notice">Uruchom lokalny silnik, aby odczytać dostępne receptury.</p>{/if}
  {#if error}<p class="tool-error" role="alert">{error}</p>{/if}{#if message}<p class="tool-notice" role="status">{message}</p>{/if}
  <div class="tool-actions"><Button variant="outline" disabled={!ready||loading||action} onclick={reload}><RefreshCw size={15}/>{loading?'Odczytywanie…':'Odśwież instalacje'}</Button></div>
  {#if catalog}<p class="page-footnote runtime-root">Katalog prywatnych środowisk: {catalog.root}. Biblioteki są kopiowane. Istniejące instalacje pozostają dostępne do czasu jawnego udostępnienia nowej.</p>
    <div class="runtime-recipes">{#each catalog.engines as recipe (recipe.engine_id)}
      {@const job=jobFor(recipe.engine_id)}
      <article class="tool-card runtime-recipe">
        <div class="runtime-heading"><div><h3>{recipe.display_name}</h3><p class="page-footnote">{recipe.kind==='native'?'Osobny program natywny':'Osobne środowisko Python'}{recipe.version?` · ${recipe.version}`:''}</p></div>{#if job}<span class="runtime-state">{runtimeInstallLabels[job.state]||job.state}</span>{/if}</div>
        {#if recipe.host_note}<p class={recipe.supported?'page-footnote':'tool-notice'}>{recipe.host_note}</p>{/if}
        <p class="page-footnote">{recipe.download_bytes?`Archiwum programu: ${runtimeSize(recipe.download_bytes)}.`:'Dokładny rozmiar transferu zależy od rozwiązanych pakietów i pamięci podręcznej.'} Miejsce na instalację: około {runtimeSize(recipe.required_bytes)} + 5 GiB wolnego zapasu{recipe.size_confidence==='unknown'?' (szacunek niepotwierdzony)':recipe.kind==='sidecar'?' (szacunek receptury)':''}.</p>
        {#if recipe.weights_repo_id}<p class="page-footnote">Ta receptura obejmuje wagi: {recipe.weights_repo_id}{recipe.weights_bytes?` · około ${runtimeSize(recipe.weights_bytes)}`:''}.</p>{:else}<p class="page-footnote">Ta receptura nie pobiera wag modelu. Przygotuj wymagane wagi oddzielnie przed syntezą.</p>{/if}
        {#if job}
          {#if runtimeInstallActive(job)}<p class="runtime-phase" role="status">{runtimePhaseLabels[job.phase]||'Przygotowanie instalacji'}{runtimeTransfer(job)?` · ${runtimeTransfer(job)}`:''}</p>{/if}
          {#if job.steps.length}<ol class="runtime-steps">{#each job.steps as step}<li><span>{runtimePhaseLabels[step.id]||step.id}</span><small>{({pending:'Oczekuje',running:'W toku',done:'Gotowe',skipped:'Pominięto',error:'Błąd'} as Record<string,string>)[step.state]||step.state}</small></li>{/each}</ol>{/if}
          {#if job.error}<p class="tool-error" role="alert">{job.error}</p>{/if}
          {#if job.log.length}<details class="runtime-log"><summary>Ostatnie komunikaty instalatora</summary><pre>{job.log.join('\n')}</pre></details>{/if}
          {#if job.state==='complete'&&job.verified===false}<p class="tool-error" role="alert">Pliki instalacji są niekompletne lub receptura uległa zmianie. Sprawdź źródła i ponów instalację.</p>{:else if job.state==='complete'}<p class="tool-notice">{job.effective?'To środowisko jest wskazane w bieżącej sesji silnika.':job.restart_required?'Środowisko wskazane do użycia. Zapis obowiązuje po ponownym uruchomieniu lokalnego silnika.':'Instalacja sprawdzona. Osobny przycisk poniżej wskaże ją aplikacji po restarcie silnika.'} Test importu nie zastępuje testu syntezy danego modelu.</p>{/if}
          {#if ['cancelled','interrupted','failed'].includes(job.state)}<p class="page-footnote">Ponowienie wykorzysta prywatną, częściową instalację tej samej receptury. Pobrane dane nie są automatycznie usuwane.</p>{/if}
        {/if}
        <details class="runtime-sources" open={reviewing===recipe.disclosure_id}>
          <summary>Źródła, wersje i warunki pobierania</summary>
          <p class="page-footnote">{recipe.dependency_policy}</p><p class="page-footnote">{recipe.license_summary}</p>
          <ul>{#each recipe.source_urls as url}<li>{#if canOpenSource(url)}<a href={url} target="_blank" rel="noreferrer" onclick={event=>{event.preventDefault();void openSource(url);}}>{url}</a>{:else}<code>{url}</code> <Button variant="ghost" onclick={()=>copySource(url)}>Kopiuj adres źródła</Button>{/if}</li>{/each}</ul>
          <ul>{#each recipe.license_links as link}<li>{#if canOpenSource(link.url)}<a href={link.url} target="_blank" rel="noreferrer" onclick={event=>{event.preventDefault();void openSource(link.url);}}>{link.title}</a>{:else}<span>{link.title}: </span><code>{link.url}</code> <Button variant="ghost" onclick={()=>copySource(link.url)}>Kopiuj adres warunków</Button>{/if}</li>{/each}</ul>
          {#if recipe.venv_args?.length}<p class="page-footnote">Python receptury: {recipe.venv_args.join(' ')}.</p>{/if}
          {#if recipe.install_args?.length}<p class="page-footnote runtime-root">Pakiety/receptura: {recipe.install_args.join(' ')}{recipe.torch_pins?.length?` · ${recipe.torch_pins.join(', ')}`:''}.</p>{/if}
          {#if recipe.archive_sha256}<p class="page-footnote runtime-root">SHA-256 archiwum: {recipe.archive_sha256}</p>{/if}
          {#if reviewing===recipe.disclosure_id}<div class="runtime-consent"><label><input type="checkbox" bind:checked={accepted} disabled={action||active}/>Przeczytałem źródła i warunki. Zezwalam na pobranie programów, zależności i wskazanych wag oraz uruchomienie instalacji w osobnym środowisku.</label>
            {#if recipe.license_required&&!recipe.license_accepted}<p class="tool-notice">Najpierw zaakceptuj szczegółowe warunki tego silnika w katalogu modeli, a następnie odśwież ten panel.</p>{/if}
            <div class="tool-actions"><Button variant="outline" disabled={!ready||action||loading||active||!accepted||(recipe.license_required&&!recipe.license_accepted)} onclick={()=>install(recipe)}><Download size={15}/>Potwierdź instalację</Button><Button variant="ghost" disabled={action} onclick={()=>{reviewing='';accepted=false;}}>Zamknij potwierdzenie</Button></div>
          </div>{/if}
        </details>
        <div class="tool-actions">
          {#if job&&runtimeInstallActive(job)}<Button variant="outline" disabled={!ready||action||loading||job.state==='cancelling'} onclick={()=>cancel(recipe)}><Square size={14}/>Anuluj instalację</Button>
          {:else if job?.state==='complete'&&job.disclosure_id===recipe.disclosure_id&&job.verified!==false}<Button variant="outline" disabled={!ready||action||loading||active||job.restart_required||job.effective} onclick={()=>activate(recipe)}><Check size={15}/>{job.effective?'Udostępnione środowisko':'Udostępnij po restarcie'}</Button>{#if job.restart_required&&onrestart}<Button variant="outline" disabled={!ready||action||loading||active} onclick={()=>work(async signal=>{await onrestart!();signal.throwIfAborted();message='Uruchomiono ponownie lokalny silnik. Sprawdź dostępność modelu w katalogu.';await onchange?.();})}>Uruchom ponownie silnik</Button>{/if}
          {:else}<Button variant="outline" disabled={!ready||action||loading||active||!recipe.supported} onclick={()=>{reviewing=recipe.disclosure_id;accepted=false;message='';error='';}}><Download size={15}/>{job?'Sprawdź i ponów instalację':'Sprawdź instalację'}</Button>{/if}
        </div>
      </article>
    {/each}</div>
  {/if}
</details>

<style>
  .engine-runtime-installer{margin-top:28px}.engine-runtime-installer>summary{font-size:var(--ui-text-15);font-weight:550;cursor:pointer;line-height:1.8}.runtime-recipes{display:grid;gap:14px;margin-top:18px}.runtime-heading{display:flex;justify-content:space-between;align-items:start;gap:14px}.runtime-heading h3{margin:0;font-size:var(--ui-text-14)}.runtime-heading p{margin-bottom:0}.runtime-state{font-size:var(--ui-text-11);color:var(--muted);text-align:right}.runtime-root,.runtime-sources{overflow-wrap:anywhere}.runtime-phase{font-size:var(--ui-text-12);line-height:1.8}.runtime-steps{list-style:none;padding:0;display:grid;gap:7px;font-size:var(--ui-text-12)}.runtime-steps li{display:flex;justify-content:space-between;gap:12px}.runtime-steps small{color:var(--muted)}.runtime-log summary,.runtime-sources summary{font-size:var(--ui-text-12);cursor:pointer;line-height:1.8}.runtime-log pre{max-height:230px;overflow:auto;background:var(--background);border:1px solid var(--border);border-radius:7px;padding:12px;font-size:var(--ui-text-11);white-space:pre-wrap;overflow-wrap:anywhere}.runtime-sources ul{padding-left:18px;font-size:var(--ui-text-11);line-height:1.9}.runtime-consent{display:grid;gap:12px;margin-top:16px}.runtime-consent label{font-size:var(--ui-text-12);line-height:1.8;display:flex;gap:10px;align-items:start}.runtime-consent input{margin-top:5px;flex-shrink:0}@media(max-width:650px){.runtime-heading{flex-direction:column}.runtime-state{text-align:left}}
</style>
