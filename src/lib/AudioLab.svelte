<script lang="ts">
  import Button from './ui/Button.svelte';
  import { onDestroy, tick } from 'svelte';
  import { Download, SlidersHorizontal, Sparkles } from '@lucide/svelte';
  import ReferenceAudioInput from './ReferenceAudioInput.svelte';
  import Switch from './ui/Switch.svelte';
  import { audioCatalog, audioEditErrors, cleanAudio, decodeAudioFile, defaultAudioEdit, encodeAudioWav, measureAudio, processAudio, type AudioCatalog, type AudioEdit, type AudioMeasurements, type AudioPcm } from './audio-lab';
  import { redactDiagnosticText } from './runtime-diagnostics';
  import './studio-tools.css';
  let { ready, allowModelCleaning = false, onresult }: { ready: boolean; allowModelCleaning?: boolean; onresult?: (result:{blob:Blob;filename:string;title:string;duration:number}) => void | Promise<void> } = $props();
  const uid = $props.id();
  let file = $state<File>(), pcm = $state.raw<AudioPcm>(), measurements = $state<AudioMeasurements>(), edit = $state<AudioEdit>(defaultAudioEdit(0));
  let resultUrl = $state(''), resultFilename = $state(''), resultMeasurements = $state<AudioMeasurements>();
  let loading = $state(false), busy = $state(false), recording = $state(false), error = $state(''), message = $state(''), catalog = $state<AudioCatalog>();
  let catalogError=$state('');
  let controller:AbortController|undefined, catalogController:AbortController|undefined, disposed = false;
  function exclusivePlayback(node:HTMLElement){const playing=(event:Event)=>node.querySelectorAll('audio').forEach(audio=>{if(audio!==event.target)audio.pause();});node.addEventListener('play',playing,true);return{destroy:()=>node.removeEventListener('play',playing,true)};}
  const validation = $derived(pcm ? audioEditErrors(pcm,edit) : []);
  const db = (value:number) => value > 0 ? `${(20*Math.log10(value)).toFixed(1)} dBFS` : '−∞ dBFS';
  function clearResult() { if(resultUrl)URL.revokeObjectURL(resultUrl); resultUrl='';resultFilename='';resultMeasurements=undefined; }
  async function select(next?:File) {
    controller?.abort(); const current=new AbortController();controller=current;
    file=next;pcm=undefined;measurements=undefined;clearResult();error='';message='';
    if(!next){loading=false;return;} loading=true;
    try { const decoded=await decodeAudioFile(next,current.signal);current.signal.throwIfAborted();if(disposed)return;pcm=decoded;measurements=measureAudio(decoded);edit=defaultAudioEdit(measurements.duration); }
    catch(cause){if(!current.signal.aborted&&!disposed)error=redactDiagnosticText((cause as Error).message);}
    finally{if(controller===current&&!disposed)loading=false;}
  }
  function update(key:keyof AudioEdit, raw:string){edit={...edit,[key]:raw===''?Number.NaN:Number(raw)};}
  async function present(blob:Blob,filename:string,info:AudioMeasurements,title:string,signal:AbortSignal){signal.throwIfAborted();clearResult();resultUrl=URL.createObjectURL(blob);resultFilename=filename;resultMeasurements=info;await onresult?.({blob,filename,title,duration:info.duration});signal.throwIfAborted();}
  async function renderLocal(){
    if(!pcm||busy||loading||recording||validation.length)return;
    const current=new AbortController();controller=current;busy=true;error='';message='';
    try{await tick();current.signal.throwIfAborted();const result=processAudio(pcm,edit),blob=encodeAudioWav(result.pcm);await present(blob,`obrobione-${file?.name.replace(/\.[^.]+$/,'')||'audio'}.wav`,result.measurements,'Lokalna obróbka audio',current.signal);message=`Zapisano wynik PCM WAV 16-bit. ${result.clippedBeforeLimit?`Ograniczono ${result.clippedBeforeLimit} próbek przekraczających zakres; zmniejsz głośność, aby uniknąć przesterowania.`:''}${result.silentNormalization?' Próbka jest bliska ciszy; normalizacja jej nie wzmocniła.':''}`;}
    catch(cause){if(!current.signal.aborted&&!disposed)error=redactDiagnosticText((cause as Error).message);}
    finally{if(controller===current&&!disposed)busy=false;}
  }
  async function isolate(){
    if(!ready||!allowModelCleaning||!file||busy||loading||recording)return;
    const current=new AbortController();controller=current;busy=true;error='';message='';
    try{const result=await cleanAudio(file,current.signal);const decoded=await decodeAudioFile(new File([result.blob],result.filename,{type:'audio/wav'}),current.signal);await present(result.blob,result.filename,measureAudio(decoded),'Przetwarzanie mowy lokalnym modelem',current.signal);message=`Silnik zwrócił przetworzony plik. Ten endpoint nie potwierdza, czy separacja mowy się powiodła. ${result.conversionFallback?'Zgłosił awaryjny zapis formatu źródłowego.':''}`;}
    catch(cause){if(!current.signal.aborted&&!disposed)error=redactDiagnosticText((cause as Error).message);}
    finally{if(controller===current&&!disposed)busy=false;}
  }
  $effect(()=>{if(!ready)return;const current=new AbortController();catalogController=current;catalogError='';void audioCatalog(current.signal).then(result=>{if(!disposed&&!current.signal.aborted)catalog=result;}).catch(cause=>{if(!disposed&&!current.signal.aborted)catalogError=redactDiagnosticText((cause as Error).message);});return()=>current.abort();});
  onDestroy(()=>{disposed=true;controller?.abort();catalogController?.abort();clearResult();});
</script>

<section class="studio-tools audio-lab" aria-label="Obróbka i analiza audio" use:exclusivePlayback>
  <div class="page-heading"><div><h2>Obróbka audio</h2><p>Przytnij nagranie, ustaw głośność i zapisz rzeczywisty plik WAV.</p></div></div>
  {#if error}<p class="tool-error" role="alert">{error}</p>{/if}{#if message}<p class="tool-notice" role="status">{message}</p>{/if}
  <div class="tool-card"><ReferenceAudioInput label="Nagranie do obróbki" referenceAdvice={false} disabled={busy||loading} onchange={next=>void select(next)} onrecordingchange={value=>recording=value}/><p class="page-footnote">Lokalna obróbka obsługuje nagrania do 5 minut i 16 milionów próbek kanałów. Format skompresowany jest dekodowany do PCM 24 kHz; standardowy WAV zachowuje częstotliwość próbkowania.</p>{#if loading}<p role="status">Odczytywanie i pomiar nagrania…</p>{/if}
    {#if pcm&&measurements}<dl class="audio-metadata"><dt>Czas</dt><dd>{measurements.duration.toFixed(3)} s</dd><dt>PCM po odczycie</dt><dd>{measurements.sampleRate.toLocaleString('pl-PL')} Hz · {measurements.channels} kanał(y)</dd><dt>Szczyt / RMS</dt><dd>{db(measurements.peak)} / {db(measurements.rms)}</dd><dt>Próbki przy pełnej skali</dt><dd>{measurements.clippedSamples.toLocaleString('pl-PL')}</dd></dl>
      <div class="tool-columns">{#each [{key:'start',label:'Początek w sekundach'},{key:'end',label:'Koniec w sekundach'}] as row}<label for={`${uid}-${row.key}`}>{row.label}<input id={`${uid}-${row.key}`} class="text-input" type="number" min="0" max={measurements.duration} step="any" value={edit[row.key as 'start'|'end']} disabled={busy} oninput={event=>update(row.key as 'start'|'end',event.currentTarget.value)}/></label>{/each}</div>
      <div class="audio-switch"><span>Normalizacja szczytu</span><Switch label="Normalizacja szczytu" checked={edit.normalize} onchange={value=>edit={...edit,normalize:value}} disabled={busy}/></div>
      <div class="tool-columns"><label for={`${uid}-gain`}>Zmiana głośności w dB<input id={`${uid}-gain`} class="text-input" type="number" min="-60" max="24" step="any" value={edit.gainDb} disabled={busy||edit.normalize} oninput={event=>update('gainDb',event.currentTarget.value)}/></label><label for={`${uid}-target`}>Docelowy szczyt w dBFS<input id={`${uid}-target`} class="text-input" type="number" min="-24" max="0" step="any" value={edit.targetDb} disabled={busy||!edit.normalize} oninput={event=>update('targetDb',event.currentTarget.value)}/></label></div>
      <div class="tool-columns">{#each [{key:'fadeInMs',label:'Łagodne wejście w ms'},{key:'fadeOutMs',label:'Łagodne wyjście w ms'}] as row}<label for={`${uid}-${row.key}`}>{row.label}<input id={`${uid}-${row.key}`} class="text-input" type="number" min="0" step="any" value={edit[row.key as 'fadeInMs'|'fadeOutMs']} disabled={busy} oninput={event=>update(row.key as 'fadeInMs'|'fadeOutMs',event.currentTarget.value)}/></label>{/each}</div>
      {#if validation.length}<p class="tool-error" role="alert">{validation.join('\n')}</p>{/if}
      <div class="tool-actions"><Button variant="default" disabled={busy||recording||!!validation.length} onclick={renderLocal}><SlidersHorizontal size={15}/>{busy?'Przetwarzanie…':'Przygotuj wynik lokalnie'}</Button><Button variant="outline" disabled={busy} onclick={()=>edit=defaultAudioEdit(measurements!.duration)}>Przywróć pełne nagranie</Button></div>
    {/if}
  </div>
  {#if resultUrl&&resultMeasurements}<div class="tool-card"><h3>Wynik obróbki</h3><audio controls src={resultUrl} aria-label="Wynik obróbki audio"></audio><p>{resultMeasurements.duration.toFixed(3)} s · {resultMeasurements.sampleRate.toLocaleString('pl-PL')} Hz · {resultMeasurements.channels} kanał(y) · szczyt {db(resultMeasurements.peak)}</p><Button variant="outline" href={resultUrl} download={resultFilename}><Download size={15}/>Pobierz {resultFilename}</Button></div>{/if}
  <div class="tool-card"><h3>Izolacja mowy</h3><p class="page-footnote">Ta operacja uruchamia lokalny model separacji przez silnik. Przy błędzie modelu silnik może zwrócić samo wejście po konwersji; odsłuchaj rezultat przed użyciem.</p>{#if !allowModelCleaning}<p class="page-footnote">Operacja będzie dostępna po potwierdzeniu przygotowania lokalnego modelu separacji.</p>{/if}<Button variant="outline" disabled={!ready||!allowModelCleaning||!file||busy||loading||recording} onclick={isolate}><Sparkles size={15}/>Próba izolacji mowy lokalnym modelem</Button></div>
  {#if catalog||catalogError}<details class="audio-catalog"><summary>Katalog efektów i rozszerzeń silnika</summary>{#if catalogError}<p class="tool-error" role="alert">Nie udało się odczytać katalogu: {catalogError}</p>{/if}{#if catalog}<p class="page-footnote">Presety silnika są stosowane podczas syntezy lub dubbingu. Ten katalog nie nakłada ich na wczytane nagranie.</p><div class="tool-list">{#each catalog.effects as item}<article><div><strong>{item.label}</strong><small>{item.id}</small></div></article>{/each}</div><p class="page-footnote">Rozszerzenia: {catalog.plugins.map(item=>`${item.display_name||item.id} (${item.available?'dostępne':'niedostępne'}${item.is_local?', lokalne':', usługa zewnętrzna'})`).join('; ')||'Brak zarejestrowanych rozszerzeń'}</p>{/if}</details>{/if}
</section>

<style>.audio-lab{margin-top:24px}.audio-lab h3{margin:0;font-size:var(--ui-text-14)}.audio-metadata{display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:var(--ui-text-12);line-height:1.6}.audio-metadata dt{color:var(--muted)}.audio-metadata dd{margin:0;overflow-wrap:anywhere}.audio-switch{display:flex;justify-content:space-between;align-items:center;gap:15px;font-size:var(--ui-text-13)}.audio-catalog{margin:20px 0;font-size:var(--ui-text-13)}.audio-catalog small{display:block;color:var(--muted);margin-top:7px}.audio-lab .tool-columns>label{min-width:0}@media(max-width:600px){.audio-metadata{grid-template-columns:1fr;gap:7px}.audio-metadata dd{margin-bottom:8px}}</style>
